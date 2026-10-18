const EVENTS = {
  'email.sent': { status: 'sent', from: ['pending', 'sending', 'retry', 'failed', 'uncertain'] },
  'email.delivery_delayed': { status: 'delayed', from: ['pending', 'sending', 'retry', 'sent', 'failed', 'uncertain', 'delayed'] },
  'email.delivered': { status: 'delivered', from: ['pending', 'sending', 'retry', 'sent', 'failed', 'uncertain', 'delayed', 'delivered'] },
  'email.failed': { status: 'failed', from: ['pending', 'sending', 'retry', 'sent', 'uncertain', 'delayed', 'failed'] },
  'email.bounced': { status: 'bounced', from: ['pending', 'sending', 'retry', 'sent', 'uncertain', 'delayed', 'failed', 'delivered', 'bounced'] },
  'email.suppressed': { status: 'suppressed', from: ['pending', 'sending', 'retry', 'sent', 'uncertain', 'delayed', 'failed', 'suppressed'] },
  'email.complained': { status: 'complained', from: ['pending', 'sending', 'retry', 'sent', 'uncertain', 'delayed', 'failed', 'delivered', 'bounced', 'suppressed', 'complained'] }
};

const clean = value => String(value || '').replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 500);
const tag = (tags, name) => Array.isArray(tags) ? tags.find(entry => entry.name === name)?.value : tags?.[name];

async function applyNotificationEvent({ Order, event, eventId, logger = console }) {
  const rule = EVENTS[event.type];
  if (!rule) return { ignored: true };
  const messageId = event.data?.email_id;
  const eventAt = new Date(event.created_at);
  if (typeof messageId !== 'string' || !messageId || !Number.isFinite(+eventAt)) {
    throw Object.assign(new Error('Invalid email delivery event.'), { statusCode: 400 });
  }
  const notificationId = tag(event.data.tags, 'notification_id');
  const correlation = typeof notificationId === 'string' && /^[\da-f-]{36}$/i.test(notificationId)
    ? { id: notificationId } : { messageId };
  // Signed correlation tags allow delivery to be recorded even when the provider
  // webhook arrives before the worker has saved the HTTP send response.
  const filter = {
    ...correlation, status: { $in: rule.from }, lastProviderEventId: { $ne: eventId },
    $and: [
      { $or: [{ messageId }, { messageId: { $exists: false } }, { messageId: null }, { messageId: '' }] },
      { $or: [{ lastProviderEventAt: { $lte: eventAt } }, { lastProviderEventAt: { $exists: false } }, { lastProviderEventAt: null }] }
    ]
  };
  if (['email.sent', 'email.delivery_delayed'].includes(event.type)) {
    // A final provider failure must not be erased by a delayed acceptance event.
    // Failed API attempts without a message ID can still be reconciled safely.
    filter.$and.push({ $or: [{ status: { $ne: 'failed' } }, { messageId: { $exists: false } }, { messageId: null }, { messageId: '' }] });
  }
  const failure = ['failed', 'bounced', 'suppressed', 'complained'].includes(rule.status);
  const error = rule.status === 'delayed' ? 'The receiving mail server has delayed delivery.' : failure
    ? clean(event.data.failed?.reason || event.data.bounce?.message || event.data.suppressed?.reason || `Email ${rule.status}. Check the provider delivery history.`) : '';
  const values = {
    status: rule.status, messageId, lastProviderEventAt: eventAt, lastProviderEventId: eventId,
    ambiguous: false, lastError: error,
    ...(rule.status === 'sent' ? { sentAt: eventAt } : {}),
    ...(rule.status === 'delivered' ? { deliveredAt: eventAt } : {})
  };
  const result = await Order.updateOne({ notifications: { $elemMatch: filter } }, {
    $set: Object.fromEntries(Object.entries(values).map(([key, value]) => [`notifications.$.${key}`, value])),
    $unset: { 'notifications.$.leaseToken': '', 'notifications.$.leaseUntil': '' }
  });
  if (result.modifiedCount && failure) logger.error?.({ event: 'order_notification_delivery_issue', notificationId, messageId, status: rule.status });
  // Replays, older events, non-order contact emails, and unrelated messages are
  // acknowledged without mutation. A database error propagates so Resend retries.
  return { updated: Boolean(result.modifiedCount) };
}

module.exports = { applyNotificationEvent, EVENTS };
