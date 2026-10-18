const crypto = require('crypto');
const { checkoutError } = require('../services/orderPricing');
const { TYPES, queueOrderNotification, notificationSummary,
  orderView, assertCurrentNotification, canRetry, snapshot } = require('../services/orderNotifications');

function createNotificationController({ Order, runTransaction, now = () => new Date() }) {
  const validateId = id => {
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw checkoutError('Invalid order');
  };
  const transaction = async (id, mutate) => {
    validateId(id);
    return runTransaction(async session => {
      const order = await Order.findById(id).session(session);
      if (!order) throw checkoutError('Order not found', 404);
      const changed = mutate(order);
      if (changed !== false) await order.save({ session });
      return order;
    });
  };
  const handle = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (!error.statusCode) console.error('Notification admin operation failed:', error.message);
      res.status(error.statusCode || 500).json({ success: false,
        message: error.statusCode ? error.message : 'Unable to update customer emails. Please try again.' });
    }
  };
  return {
    getNotifications: handle(async (req, res) => {
      validateId(req.params.id);
      const order = await Order.findById(req.params.id);
      if (!order) throw checkoutError('Order not found', 404);
      res.json({ success: true, data: (order.notifications || []).map(job => notificationSummary(job, order)) });
    }),
    sendNotification: handle(async (req, res) => {
      const { type } = req.body || {};
      if (!TYPES.includes(type)) throw checkoutError('Choose a valid email type.');
      const order = await transaction(req.params.id, value => {
        assertCurrentNotification(value, type);
        // Older orders have no delivery evidence. Recover only the specific
        // message the admin requests, never bulk-replay historical lifecycle events.
        if ((value.notifications || []).some(job => job.type === type)) {
          throw checkoutError('This email already has a history. Refresh the order and use its retry action if available.', 409);
        }
        const job = queueOrderNotification(value, type, { now: now() });
        job.retryRequestedAt = now();
        job.retryRequestedBy = String(req.user?._id || 'admin');
      });
      res.status(202).json({ success: true, data: orderView(order, true) });
    }),
    retryNotification: handle(async (req, res) => {
      const id = req.params.notificationId;
      if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) throw checkoutError('Invalid email notification.');
      const order = await transaction(req.params.id, value => {
        const job = (value.notifications || []).find(entry => entry.id === id);
        if (!job) throw checkoutError('Email notification not found.', 404);
        // A repeated click/request must never produce a second logical send.
        if (['pending', 'sending', 'retry'].includes(job.status)) return false;
        if (!canRetry(job, value)) throw checkoutError('This email cannot safely be retried. Check its delivery status before sending another.', 409);
        const timestamp = now();
        if (job.retryRequestedAt && timestamp - new Date(job.retryRequestedAt) < 60000) throw checkoutError('Please wait a minute before retrying this email.', 429);
        // An explicit retry of a definite rejection may use corrected sender
        // configuration. Automatic retries always reuse the frozen request/key.
        // Accepted or ambiguous sends never reach this branch.
        job.payload = snapshot(value, job.id, timestamp);
        job.renderedMessage = undefined;
        job.idempotencyKey = `order-email/${crypto.randomUUID()}`;
        job.firstAttemptAt = undefined;
        job.status = 'pending'; job.nextAttemptAt = timestamp; job.attempts = 0;
        job.skipReason = '';
        job.leaseToken = undefined; job.leaseUntil = undefined;
        job.retryRequestedAt = timestamp; job.retryRequestedBy = String(req.user?._id || 'admin');
      });
      res.status(202).json({ success: true, data: orderView(order, true) });
    }),
    updatePreferences: handle(async (req, res) => {
      if (typeof req.body?.enabled !== 'boolean') throw checkoutError('Choose whether to send customer email updates.');
      const order = await transaction(req.params.id, value => {
        if (!value.isManualOrder) throw checkoutError('Website orders always receive transactional email updates.', 409);
        if (req.body.enabled && !value.customerInfo?.email?.trim()) throw checkoutError('Add a customer email address before enabling updates.', 409);
        value.sendCustomerEmail = req.body.enabled;
        if (!req.body.enabled) {
          for (const job of value.notifications || []) {
            if (['pending', 'retry'].includes(job.status)) {
              job.status = job.ambiguous ? 'uncertain' : 'skipped';
              job.skipReason = 'Customer email updates are disabled for this manual order.';
            }
          }
        }
      });
      res.json({ success: true, data: orderView(order, true) });
    })
  };
}

module.exports = { createNotificationController };
