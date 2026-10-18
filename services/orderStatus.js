const { checkoutError } = require('./orderPricing');
const { queueOrderNotification, supersedeNotifications } = require('./orderNotifications');

// Caller owns the transaction, so every product and the order commit together.
async function changeStock(items, direction, Product, session) {
  if (!Array.isArray(items) || !items.length) throw checkoutError('Order has no items', 409);
  const products = new Map();
  for (const item of items) {
    const id = String(item.product);
    if (!products.has(id)) products.set(id, await Product.findById(id).session(session));
    const product = products.get(id);
    const units = item.stockQuantity ?? item.quantity;
    if (!product || !Number.isSafeInteger(units) || units < 1 || !Number.isSafeInteger(product.quantity)) {
      throw checkoutError('Inventory needs manual reconciliation before this order can be updated', 409);
    }
    const delta = direction * units;
    if (item.selectedColor) {
      const color = Array.isArray(product.colors) && product.colors.find(c => (typeof c === 'string' ? c : c.name) === item.selectedColor);
      if (!color) throw checkoutError('The ordered color no longer exists. Please reconcile inventory first.', 409);
      if (typeof color !== 'string') {
        const next = color.quantity + delta;
        if (!Number.isSafeInteger(color.quantity) || !Number.isSafeInteger(next) || next < 0) throw checkoutError('Invalid or insufficient color stock', 409);
        color.quantity = next;
        product.markModified('colors');
      }
    }
    const next = product.quantity + delta;
    if (!Number.isSafeInteger(next) || next < 0) throw checkoutError('Insufficient stock', 409);
    product.quantity = next;
    product.inStock = next > 0;
    if (direction < 0 && product.autoHideWhenZero && next === 0) {
      product.inventoryAutoHidden = product.visible !== false;
      product.visible = false;
    } else if (direction > 0 && next > 0 && product.inventoryAutoHidden) {
      product.visible = true;
      product.inventoryAutoHidden = false;
    }
  }
  for (const product of products.values()) await product.save({ session });
}

function createOrderStatusUpdater({ Order, Product, runTransaction }) {
  return async (id, status, trackingNumber) => {
    const transitions = {
      pending: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'],
      shipped: ['delivered', 'cancelled'], delivered: [], cancelled: []
    };
    if (!Object.hasOwn(transitions, status)) throw checkoutError('Invalid order status');
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw checkoutError('Invalid order');
    if (trackingNumber !== undefined && (typeof trackingNumber !== 'string' || trackingNumber.length > 200)) throw checkoutError('Invalid tracking number');
    return runTransaction(async session => {
      const order = await Order.findById(id).session(session);
      if (!order) throw checkoutError('Order not found', 404);
      const tracking = trackingNumber?.trim();
      if (tracking && /[<>\r\n]/.test(tracking)) throw checkoutError('Invalid tracking number');
      if (order.status === status) {
        if (status === 'shipped' && tracking && tracking !== order.trackingNumber) {
          order.trackingNumber = tracking;
          supersedeNotifications(order, ['shipped']);
          queueOrderNotification(order, 'shipped');
          await order.save({ session });
          return { order, changed: true };
        }
        return { order, changed: false };
      }
      if (!transitions[order.status]?.includes(status)) throw checkoutError(`Cannot change ${order.status} to ${status}`, 409);
      if (status !== 'cancelled' && (order.paymentStatus !== 'paid' || order.paymentReviewReason)) {
        throw checkoutError('Confirm payment and resolve any payment review before fulfillment', 409);
      }
      if (status === 'cancelled') {
        if (order.stockDeducted === true) {
          await changeStock(order.items, 1, Product, session);
          order.stockDeducted = false;
          order.stockRestoredAt = new Date();
        } else if (order.stockDeducted === undefined && order.paymentStatus === 'paid') {
          order.inventoryReviewReason = 'Legacy order: stock deduction history is unknown. Check inventory manually; no stock was automatically restored.';
        }
      }
      order.status = status;
      if (trackingNumber) order.trackingNumber = trackingNumber.trim();
      if (['shipped', 'delivered', 'cancelled'].includes(status)) {
        supersedeNotifications(order, status === 'shipped' ? ['order_confirmation'] : ['order_confirmation', 'shipped']);
        queueOrderNotification(order, status);
      }
      await order.save({ session });
      return { order, changed: true };
    });
  };
}

module.exports = { changeStock, createOrderStatusUpdater };
