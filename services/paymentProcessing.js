const { checkoutError } = require('./orderPricing');

function validatePayment(order, payment) {
  if (!order) throw checkoutError('Order not found', 404);
  if (payment.status !== 'success') throw checkoutError('Payment has not succeeded');
  if (payment.reference !== order.paymentReference) throw checkoutError('Payment reference does not match this order', 409);
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
    throw checkoutError('Invalid payment amount', 409);
  }
  // Older paid orders may be revisited, but must never be fulfilled again.
  if (order.paymentStatus === 'paid' && order.pricingVersion !== 1) return;
  if (order.pricingVersion !== 1 || !Number.isSafeInteger(order.expectedAmount) || order.expectedAmount <= 0) {
    throw checkoutError('This older order needs payment review. Please contact support if you have paid.', 409);
  }
  const requestedAmountMatches = Number.isSafeInteger(payment.requested_amount) && payment.requested_amount === order.expectedAmount;
  if (payment.requested_amount != null && !requestedAmountMatches) {
    throw checkoutError('Payment requested amount does not match the order', 409);
  }
  // Paystack can add its fee when the merchant passes fees to the customer.
  // Only trust the original requested amount from verified provider data and
  // require the entire increase to be its fee, plus at most one kobo rounding.
  const increase = payment.amount - order.expectedAmount;
  const includesCustomerFee = increase > 0 && requestedAmountMatches &&
    Number.isSafeInteger(payment.fees) && payment.fees > 0 &&
    (increase === payment.fees || increase - payment.fees === 1);
  if ((payment.amount !== order.expectedAmount && !includesCustomerFee) || payment.currency !== order.currency) {
    throw checkoutError('Payment amount or currency does not match the order', 409);
  }
  if (typeof payment.customer?.email !== 'string' || payment.customer.email.toLowerCase() !== order.customerInfo.email.toLowerCase()) {
    throw checkoutError('Payment customer does not match the order', 409);
  }
}

// Dependencies are injectable so financial invariants can be tested without live payments or a database.
function createPaymentProcessor({ Order, Product, runTransaction }) {
  return async function processPayment(payment) {
    const orderId = payment?.metadata?.orderId;
    if (typeof orderId !== 'string' || !/^[a-f\d]{24}$/i.test(orderId)) throw checkoutError('Invalid payment order');
    return runTransaction(async session => {
      const order = await Order.findById(orderId).session(session);
      validatePayment(order, payment);
      if (order.paymentStatus === 'paid') return { order, newlyPaid: false };

      // Read every affected product before writing. A shortage records the payment for manual review.
      const products = new Map();
      let reviewReason = order.status === 'cancelled' ? 'Payment received for a cancelled order. Review fulfillment or refund.' : '';
      for (const item of order.items) {
        const id = String(item.product);
        if (!products.has(id)) products.set(id, await Product.findById(id).session(session));
        const product = products.get(id);
        const units = item.stockQuantity ?? item.quantity;
        if (!product || !Number.isSafeInteger(units) || units < 1 || !Number.isSafeInteger(product.quantity) || product.quantity < units) {
          reviewReason ||= 'Payment received, but stock is unavailable. Review fulfillment or refund.';
          continue;
        }
        if (item.selectedColor) {
          const color = Array.isArray(product.colors) && product.colors.find(c => (typeof c === 'string' ? c : c.name) === item.selectedColor);
          if (!color || (typeof color !== 'string' && (!Number.isSafeInteger(color.quantity) || color.quantity < units))) {
            reviewReason ||= 'Payment received, but the selected color is unavailable. Review fulfillment or refund.';
            continue;
          }
          if (typeof color !== 'string') {
            color.quantity -= units;
            product.markModified('colors');
          }
        }
        product.quantity -= units;
        product.inStock = product.quantity > 0;
        if (product.autoHideWhenZero && !product.inStock) {
          product.inventoryAutoHidden = product.visible !== false;
          product.visible = false;
        }
      }
      if (!reviewReason) {
        // Sequential operations are required within MongoDB transactions.
        for (const product of products.values()) await product.save({ session });
      }
      order.paymentStatus = 'paid';
      order.paidAt = new Date();
      order.stockDeducted = !reviewReason;
      order.paymentReviewReason = reviewReason;
      if (!reviewReason) order.status = 'processing';
      await order.save({ session });
      return { order, newlyPaid: true };
    });
  };
}

module.exports = { createPaymentProcessor, validatePayment };
