const { checkoutError } = require('./orderPricing');
const { changeStock } = require('./orderStatus');

const PAYMENT_METHODS = ['bank_transfer', 'cash', 'other'];
function paymentDetails(body) {
  if (!PAYMENT_METHODS.includes(body.paymentMethod)) throw checkoutError('Choose a payment method');
  const reference = body.paymentReference ?? '';
  if (typeof reference !== 'string' || reference.length > 200 || /[<>\r\n]/.test(reference)) throw checkoutError('Invalid payment reference');
  return { paymentMethod: body.paymentMethod, paymentReference: reference.trim() };
}
function createManualPaymentRecorder({ Order, Product, runTransaction }) {
  return async (id, body) => {
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw checkoutError('Invalid order');
    const details = paymentDetails(body);
    return runTransaction(async session => {
      const order = await Order.findById(id).session(session);
      if (!order) throw checkoutError('Order not found', 404);
      if (!order.isManualOrder) throw checkoutError('Website payments must be verified through the payment provider', 409);
      if (order.status === 'cancelled') throw checkoutError('Cannot record payment for a cancelled order', 409);
      if (order.paymentStatus === 'paid') return { order, newlyPaid: false };
      if (order.status !== 'pending' || order.stockDeducted !== false) throw checkoutError('This order needs manual inventory review', 409);
      await changeStock(order.items, -1, Product, session);
      Object.assign(order, details, { paymentStatus: 'paid', paidAt: new Date(), status: 'processing', stockDeducted: true });
      await order.save({ session });
      return { order, newlyPaid: true };
    });
  };
}
module.exports = { paymentDetails, createManualPaymentRecorder };
