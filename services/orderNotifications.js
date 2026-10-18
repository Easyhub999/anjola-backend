const crypto = require('crypto');
const { checkoutError } = require('./orderPricing');

const TYPES = ['order_confirmation', 'payment_confirmation', 'payment_review', 'shipped', 'delivered', 'cancelled'];
const STATUSES = ['pending', 'sending', 'retry', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'suppressed', 'complained', 'skipped', 'uncertain'];
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const plain = value => value?.toObject ? value.toObject() : value;

function skipReason(order) {
  if (!order.customerInfo?.email?.trim()) return 'No customer email address is recorded.';
  if (order.isManualOrder && order.sendCustomerEmail !== true) return 'Customer email updates are disabled for this manual order.';
  return '';
}

function snapshot(order, id, now) {
  const customer = plain(order.customerInfo);
  return {
    orderId: order._id ? String(order._id) : undefined,
    notificationId: id, notificationYear: now.getUTCFullYear(),
    orderNumber: order.orderNumber, customerInfo: { ...customer },
    items: (order.items || []).map(value => {
      const item = plain(value);
      return { name: item.name, price: item.price, quantity: item.quantity,
        selectedSize: item.selectedSize, selectedColor: item.selectedColor,
        selectedPieces: item.selectedPieces, pricePerPiece: item.pricePerPiece };
    }),
    totalAmount: order.totalAmount, trackingNumber: order.trackingNumber,
    isManualOrder: order.isManualOrder, sendCustomerEmail: order.sendCustomerEmail,
    paymentStatus: order.paymentStatus, status: order.status, paymentMethod: order.paymentMethod,
    paymentReference: order.paymentReference, paidAt: order.paidAt, createdAt: order.createdAt || now,
    refundInfo: order.paymentStatus === 'paid'
      ? 'Please contact us to confirm your refund arrangements. Cancellation does not automatically issue a refund.' : undefined
  };
}

// This mutates only the document. Its caller MUST persist it with the business
// change, inside the same transaction where inventory/payment is involved.
function queueOrderNotification(order, type, { now = new Date() } = {}) {
  if (!TYPES.includes(type)) throw checkoutError('Invalid notification type');
  order.notifications ||= [];
  const id = crypto.randomUUID();
  const reason = skipReason(order);
  const notification = {
    id, type, status: reason ? 'skipped' : 'pending', createdAt: now,
    nextAttemptAt: now, attempts: 0, ambiguous: false,
    idempotencyKey: `order-email/${id}`, payload: snapshot(order, id, now), skipReason: reason
  };
  order.notifications.push(notification);
  // Mongoose casts/clones pushed subdocuments; return the stored instance so
  // callers' audit fields are included in the eventual save.
  return order.notifications[order.notifications.length - 1];
}

// Never deliver an obsolete instruction after a newer business event. In-flight
// and possibly accepted sends retain their evidence for delivery reconciliation.
function supersedeNotifications(order, types) {
  for (const job of order.notifications || []) {
    if (types.includes(job.type) && ['pending', 'retry', 'failed'].includes(job.status) && !job.ambiguous && !job.messageId) {
      job.status = 'skipped';
      job.skipReason = 'A newer order update replaced this message.';
    }
  }
}

function canRetry(job, order) {
  if (job.ambiguous || job.messageId || !['failed', 'skipped'].includes(job.status)) return false;
  if (job.status === 'skipped' && job.skipReason === 'A newer order update replaced this message.') return false;
  try { assertCurrentNotification(order, job.type); return true; } catch { return false; }
}

function notificationSummary(job, order) {
  const fields = ['id', 'type', 'status', 'attempts', 'createdAt', 'lastAttemptAt', 'nextAttemptAt', 'sentAt', 'deliveredAt', 'lastError', 'skipReason'];
  return { ...Object.fromEntries(fields.map(key => [key, job[key]])),
    attempts: job.totalAttempts ?? job.attempts, canRetry: canRetry(job, order) };
}

function orderView(order, admin = false) {
  const value = { ...plain(order) };
  if (admin) value.notifications = (value.notifications || []).map(job => notificationSummary(job, value));
  else { delete value.notifications; delete value.internalNotes; }
  delete value.paymentAuthorizationUrl;
  return value;
}

function assertCurrentNotification(order, type) {
  const valid = type === 'order_confirmation' ? order.status === 'pending' && order.paymentStatus !== 'paid'
    : type === 'payment_confirmation' ? order.paymentStatus === 'paid' && !order.paymentReviewReason
      : type === 'payment_review' ? order.paymentStatus === 'paid' && Boolean(order.paymentReviewReason)
        : ['shipped', 'delivered', 'cancelled'].includes(type) && order.status === type;
  if (!valid) throw checkoutError('This email does not match the current order status.', 409);
  const reason = skipReason(order);
  if (reason) throw checkoutError(reason, 409);
}

module.exports = { TYPES, STATUSES, IDEMPOTENCY_WINDOW_MS, queueOrderNotification, supersedeNotifications,
  skipReason, snapshot, canRetry, notificationSummary, orderView, assertCurrentNotification };
