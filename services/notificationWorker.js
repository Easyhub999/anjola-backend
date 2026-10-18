const { randomUUID } = require('node:crypto');

// Resend retains idempotency keys for 24 hours. Stop ambiguous retries before
// that boundary: after it, a resend could duplicate an already accepted email.
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000, 32_400_000];
const clipError = value => String(value || 'Email delivery failed').replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 500);
const matched = result => (result?.matchedCount ?? result?.n ?? 0) > 0;

function createNotificationWorker({
  Order, senders = {}, prepare, sendPrepared, now = () => new Date(), logger = console,
  intervalMs = 15_000, leaseMs = 90_000, maxBatch = 10, maxAttempts = 8,
  retryDelaysMs = RETRY_DELAYS_MS, idempotencyWindowMs = IDEMPOTENCY_WINDOW_MS
}) {
  if (!Order?.findOneAndUpdate || !Order?.updateOne) throw new TypeError('Notification worker requires an Order model');
  if (Boolean(prepare) !== Boolean(sendPrepared)) throw new TypeError('prepare and sendPrepared must be supplied together');
  if (!Number.isInteger(maxBatch) || maxBatch < 1 || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('Notification worker limits must be positive integers');
  }
  if (!Number.isFinite(leaseMs) || leaseMs < 60_000) throw new TypeError('Notification lease must be at least 60 seconds');

  let timer = null;
  let running = null;
  let stopping = false;
  const time = () => new Date(now());
  // Logs identify the job, never the customer's address, email body or provider
  // error text (which can contain recipient details).
  const log = (event, orderId, job, status) => {
    logger.error?.({ event, ...(orderId ? { orderId: String(orderId) } : {}),
      ...(job ? { notificationId: job.id, type: job.type } : {}), ...(status ? { status } : {}) });
  };
  const jobFilter = (orderId, job) => ({
    _id: orderId,
    notifications: { $elemMatch: { id: job.id, status: 'sending', leaseToken: job.leaseToken } }
  });
  const updateJob = (orderId, job, values, unset = {}) => Order.updateOne(jobFilter(orderId, job), {
    $set: Object.fromEntries(Object.entries(values).map(([key, value]) => [`notifications.$.${key}`, value])),
    ...(Object.keys(unset).length ? {
      $unset: Object.fromEntries(Object.keys(unset).map(key => [`notifications.$.${key}`, '']))
    } : {})
  });

  async function claim() {
    const current = time();
    const due = { status: { $in: ['pending', 'retry'] }, nextAttemptAt: { $lte: current } };
    // Separate first attempts from retries so firstAttemptAt is set atomically
    // once, without resetting the provider's idempotency safety deadline.
    const candidates = [
      { filter: { status: 'sending', leaseUntil: { $lte: current } }, extra: { ambiguous: true } },
      { filter: { ...due, firstAttemptAt: { $ne: null } }, extra: {} },
      { filter: { ...due, firstAttemptAt: null }, extra: { firstAttemptAt: current } }
    ];
    for (const candidate of candidates) {
      const leaseToken = randomUUID();
      const values = { status: 'sending', leaseToken, leaseUntil: new Date(+current + leaseMs),
        lastAttemptAt: current, ...candidate.extra };
      const order = await Order.findOneAndUpdate({ notifications: { $elemMatch: candidate.filter } }, {
        $set: Object.fromEntries(Object.entries(values).map(([key, value]) => [`notifications.$.${key}`, value])),
        $inc: { 'notifications.$.attempts': 1, 'notifications.$.totalAttempts': 1 }
      }, {
        new: true,
        projection: { _id: 1, notifications: { $elemMatch: { leaseToken } } }
      });
      if (order) {
        const job = order.notifications?.find(item => item.leaseToken === leaseToken);
        if (!job) throw new Error('Claimed notification was not returned by the database');
        return { orderId: order._id, job };
      }
    }
    return null;
  }

  async function finish(orderId, job, outcome) {
    const completedAt = time();
    let values;
    if (outcome?.success && outcome.skipped) {
      values = { status: 'skipped', skipReason: clipError(outcome.reason || 'Customer emails are disabled or no email address is available'),
        lastError: '', errorCode: '', ambiguous: false };
    } else if (outcome?.success && typeof outcome.messageId === 'string' && outcome.messageId) {
      values = { status: 'sent', messageId: outcome.messageId, sentAt: completedAt, lastError: '', errorCode: '', ambiguous: false };
    } else {
      const invalidResult = !outcome || (outcome.success && !outcome.messageId);
      const ambiguous = Boolean(job.ambiguous || outcome?.ambiguous || invalidResult);
      const retryable = invalidResult || outcome.retryable === true;
      const delay = retryDelaysMs[Math.min(Math.max(job.attempts - 1, 0), retryDelaysMs.length - 1)];
      const providerDelay = Number.isFinite(outcome?.retryAfterMs) && outcome.retryAfterMs > 0 ? outcome.retryAfterMs : 0;
      const nextAttemptAt = new Date(+completedAt + Math.max(delay, providerDelay));
      const deadline = +new Date(job.firstAttemptAt || job.lastAttemptAt) + idempotencyWindowMs;
      const exhausted = job.attempts >= maxAttempts || +nextAttemptAt >= deadline;
      const status = retryable && !exhausted ? 'retry' : ambiguous ? 'uncertain' : 'failed';
      values = { status, ambiguous, lastError: clipError(outcome?.error || 'Email provider did not confirm acceptance'),
        errorCode: String(outcome?.errorCode || 'notification_error').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100),
        ...(status === 'retry' ? { nextAttemptAt } : {}) };
    }
    const result = await updateJob(orderId, job, values, { leaseToken: true, leaseUntil: true });
    // A verified provider webhook may have recorded delivery while send() was
    // returning. Its newer status must not be overwritten by this completion.
    if (matched(result) && ['failed', 'uncertain'].includes(values.status)) {
      log('order_notification_needs_attention', orderId, job, values.status);
    }
    return matched(result);
  }

  async function processJob({ orderId, job }) {
    const deadline = +new Date(job.firstAttemptAt || job.lastAttemptAt) + idempotencyWindowMs;
    if (job.ambiguous && +time() >= deadline) {
      await finish(orderId, job, { success: false, retryable: false, ambiguous: true,
        error: 'Previous attempt may have been accepted; automatic retry stopped before an unsafe duplicate. Check provider delivery history.' });
      return;
    }
    if (!job.idempotencyKey) {
      await finish(orderId, job, { success: false, retryable: false,
        error: 'Notification has no idempotency key; sending requires administrator review.' });
      return;
    }

    let leaseLost = false;
    let renewing = null;
    const renew = () => {
      if (renewing || leaseLost) return;
      renewing = updateJob(orderId, job, { leaseUntil: new Date(+time() + leaseMs) })
        .then(result => { if (!matched(result)) leaseLost = true; })
        .catch(() => {
          leaseLost = true;
          log('order_notification_lease_renewal_failed', orderId, job);
        }).finally(() => { renewing = null; });
    };
    const heartbeat = setInterval(renew, Math.floor(leaseMs / 3));
    heartbeat.unref?.();
    try {
      let outcome;
      if (prepare && !job.renderedMessage) {
        let prepared;
        try {
          prepared = await prepare(job.type, job.payload);
        } catch (error) {
          // Preparation has not contacted the provider, so it is safe to retry.
          prepared = { success: false, retryable: true, ambiguous: false, error: error?.message };
        }
        if (!prepared?.success || prepared.skipped) {
          await finish(orderId, job, prepared || { success: false, retryable: false, error: 'Unable to prepare notification' });
          return;
        }
        if (!prepared.message || typeof prepared.message !== 'object') {
          await finish(orderId, job, { success: false, retryable: false, error: 'Notification template did not produce a message' });
          return;
        }
        // Persist the exact provider request before the first send, preserving
        // sender/templates/tags across retries, configuration changes and deploys.
        if (!matched(await updateJob(orderId, job, { renderedMessage: prepared.message }))) return;
        job.renderedMessage = prepared.message;
      }
      if (leaseLost) return;
      const sender = prepare ? sendPrepared : senders[job.type];
      if (typeof sender !== 'function') {
        outcome = { success: false, retryable: false, error: 'No email sender is configured for this notification type' };
      } else {
        try {
          outcome = await sender(prepare ? job.renderedMessage : job.payload, { idempotencyKey: job.idempotencyKey });
        } catch (error) {
          outcome = { success: false, retryable: true, ambiguous: true, error: error?.message };
        }
      }
      if (!leaseLost) await finish(orderId, job, outcome);
    } finally {
      clearInterval(heartbeat);
      if (renewing) await renewing;
    }
  }

  function runOnce() {
    if (running) return running;
    if (stopping) return Promise.resolve(0);
    running = (async () => {
      let processed = 0;
      while (!stopping && processed < maxBatch) {
        const claimed = await claim();
        if (!claimed) break;
        await processJob(claimed);
        processed++;
      }
      return processed;
    })().finally(() => { running = null; });
    return running;
  }
  function wake() {
    return runOnce().catch(() => {
      // A failed database completion leaves the lease recoverable using the
      // same idempotency key. Never manufacture a second notification here.
      log('order_notification_worker_error');
      return 0;
    });
  }
  function start() {
    if (timer) return;
    stopping = false;
    timer = setInterval(wake, intervalMs);
    timer.unref?.();
    void wake();
  }
  async function stop() {
    stopping = true;
    clearInterval(timer);
    timer = null;
    if (running) await running.catch(() => {});
  }

  return { start, stop, wake, runOnce };
}

module.exports = { createNotificationWorker, IDEMPOTENCY_WINDOW_MS, RETRY_DELAYS_MS };
