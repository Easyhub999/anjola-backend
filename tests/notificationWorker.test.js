const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationWorker, IDEMPOTENCY_WINDOW_MS } = require('../services/notificationWorker');

const clone = value => structuredClone(value);
const initialTime = new Date('2026-10-18T12:00:00Z');
const notification = (overrides = {}) => ({
  id: 'notification-1', type: 'shipped', status: 'pending', attempts: 0,
  createdAt: initialTime, nextAttemptAt: initialTime,
  idempotencyKey: 'order-email/notification-1',
  payload: { orderNumber: 'ANJ-test', customerInfo: { email: 'private@example.test' }, trackingNumber: 'track-1' },
  ...overrides
});
function matches(values, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const value = values[key];
    if (expected === null) return value == null;
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, operand]) => {
        if (operator === '$in') return operand.includes(value);
        if (operator === '$lte') return value != null && +new Date(value) <= +new Date(operand);
        if (operator === '$ne') return operand === null ? value != null : value !== operand;
        throw new Error(`Unsupported fake Mongo operator: ${operator}`);
      });
    }
    return value === expected;
  });
}
// Applies a positional update only to the element matched by $elemMatch. Each
// mutation occurs synchronously before yielding, modelling Mongo's atomic CAS.
function database(jobs = [notification()]) {
  const orders = [{ _id: 'order-1', notifications: clone(jobs) }];
  const calls = [];
  const faults = { update: null, claim: null };
  function find(filter) {
    for (const order of orders) {
      if (filter._id && filter._id !== order._id) continue;
      const job = order.notifications.find(item => matches(item, filter.notifications.$elemMatch));
      if (job) return { order, job };
    }
    return null;
  }
  function apply(job, update) {
    for (const [operator, fields] of Object.entries(update)) {
      for (const [path, value] of Object.entries(fields)) {
        assert(path.startsWith('notifications.$.'), 'updates must target only the claimed array element');
        const key = path.slice('notifications.$.'.length);
        if (operator === '$set') job[key] = clone(value);
        else if (operator === '$inc') job[key] = (job[key] || 0) + value;
        else if (operator === '$unset') delete job[key];
        else throw new Error(`Unsupported fake Mongo update: ${operator}`);
      }
    }
  }
  const Order = {
    async findOneAndUpdate(filter, update, options) {
      calls.push({ method: 'claim', filter: clone(filter), update: clone(update), options: clone(options) });
      if (faults.claim) faults.claim(filter, update);
      const found = find(filter);
      if (!found) return null;
      apply(found.job, update);
      assert.equal(options.new, true);
      return { _id: found.order._id, notifications: clone(found.order.notifications.filter(job =>
        matches(job, options.projection.notifications.$elemMatch))) };
    },
    async updateOne(filter, update) {
      calls.push({ method: 'update', filter: clone(filter), update: clone(update) });
      if (faults.update) faults.update(filter, update);
      const found = find(filter);
      if (!found) return { matchedCount: 0, modifiedCount: 0 };
      apply(found.job, update);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
  return { Order, orders, calls, faults, job: index => orders[0].notifications[index || 0] };
}
function harness({ jobs, send, ...options } = {}) {
  const db = database(jobs);
  let current = +initialTime;
  const sent = [], logs = [];
  const sender = async (payload, metadata) => {
    sent.push({ payload: clone(payload), metadata: clone(metadata) });
    return send ? send(payload, metadata) : { success: true, messageId: 'email-1' };
  };
  const deps = { Order: db.Order, senders: { shipped: sender }, now: () => new Date(current),
    logger: { error: entry => logs.push(entry) }, ...options };
  return { ...db, sent, logs, deps, worker: createNotificationWorker(deps),
    advance: ms => { current += ms; }, setTime: date => { current = +new Date(date); } };
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('atomic claim records provider acceptance and never resends accepted jobs', async () => {
  const h = harness();
  assert.equal(await h.worker.runOnce(), 1);
  assert.equal(h.job().status, 'sent');
  assert.equal(h.job().messageId, 'email-1');
  assert.equal(h.job().attempts, 1);
  assert.equal(+h.job().firstAttemptAt, +initialTime);
  assert.equal(h.job().leaseToken, undefined);
  assert.equal(h.job().leaseUntil, undefined);
  assert.deepEqual(h.sent[0].metadata, { idempotencyKey: 'order-email/notification-1' });
  h.advance(3 * 86400_000);
  assert.equal(await h.worker.runOnce(), 0);
  assert.equal(h.sent.length, 1);
  const completion = h.calls.find(call => call.method === 'update');
  assert.equal(completion.filter.notifications.$elemMatch.id, 'notification-1');
  assert.equal(completion.filter.notifications.$elemMatch.status, 'sending');
  assert(completion.filter.notifications.$elemMatch.leaseToken);
});

test('temporary rejection is retried on schedule with the original key and first-attempt time', async () => {
  let attempts = 0;
  const h = harness({ send: async () => ++attempts === 1
    ? { success: false, retryable: true, ambiguous: false, error: 'Rate limit', retryAfterMs: 120_000 }
    : { success: true, messageId: 'email-retried' } });
  await h.worker.runOnce();
  assert.equal(h.job().status, 'retry');
  assert.equal(+h.job().nextAttemptAt, +initialTime + 120_000);
  h.advance(119_999);
  assert.equal(await h.worker.runOnce(), 0);
  h.advance(1);
  await h.worker.runOnce();
  assert.equal(h.job().status, 'sent');
  assert.equal(h.job().attempts, 2);
  assert.equal(+h.job().firstAttemptAt, +initialTime);
  assert.deepEqual(h.sent[0], h.sent[1]);
});

test('permanent failure stops retries and emits an alert without customer data', async () => {
  const h = harness({ send: async () => ({ success: false, retryable: false,
    error: 'Invalid private@example.test\n' + 'x'.repeat(600) }) });
  await h.worker.runOnce();
  assert.equal(h.job().status, 'failed');
  assert.equal(h.job().lastError.length, 500);
  assert(!h.job().lastError.includes('\n'));
  assert.equal(h.logs[0].event, 'order_notification_needs_attention');
  assert(!JSON.stringify(h.logs).includes('private@example.test'));
  h.advance(3600_000);
  assert.equal(await h.worker.runOnce(), 0);
});

test('ambiguous failures stop before the idempotency window can permit duplicate email', async () => {
  const h = harness({ send: async () => { throw new Error('Network response was lost'); } });
  await h.worker.runOnce();
  assert.equal(h.job().status, 'retry');
  assert.equal(h.job().ambiguous, true);
  h.advance(IDEMPOTENCY_WINDOW_MS);
  await h.worker.runOnce();
  assert.equal(h.sent.length, 1);
  assert.equal(h.job().status, 'uncertain');
  assert.equal(h.logs.at(-1).status, 'uncertain');
});

test('bounded attempts distinguish known failures from uncertain delivery', async () => {
  for (const ambiguous of [false, true]) {
    const h = harness({ maxAttempts: 2, send: async () => ({
      success: false, retryable: true, ambiguous, error: 'Temporary provider failure'
    }) });
    await h.worker.runOnce();
    h.advance(60_000);
    await h.worker.runOnce();
    assert.equal(h.sent.length, 2);
    assert.equal(h.job().status, ambiguous ? 'uncertain' : 'failed');
    h.advance(3600_000);
    assert.equal(await h.worker.runOnce(), 0);
  }
});

test('two workers and overlapping wakes cannot claim the same active notification', async () => {
  const pending = deferred();
  const h = harness({ send: () => pending.promise });
  const second = createNotificationWorker(h.deps);
  const firstRun = h.worker.runOnce();
  assert.equal(h.worker.runOnce(), firstRun, 'one worker serializes its own batches');
  const secondRun = second.runOnce();
  await new Promise(setImmediate);
  assert.equal(h.sent.length, 1);
  assert.equal(await secondRun, 0);
  pending.resolve({ success: true, messageId: 'one-delivery' });
  assert.equal(await firstRun, 1);
  assert.equal(h.job().attempts, 1);
});

test('crash after provider acceptance recovers the expired lease using provider idempotency', async () => {
  const accepted = new Map();
  let deliveries = 0;
  const h = harness({ send: async (_, { idempotencyKey }) => {
    if (!accepted.has(idempotencyKey)) accepted.set(idempotencyKey, `email-${++deliveries}`);
    return { success: true, messageId: accepted.get(idempotencyKey) };
  } });
  h.faults.update = (_, update) => {
    if (update.$set['notifications.$.status'] === 'sent') throw new Error('Database connection lost');
  };
  await assert.rejects(h.worker.runOnce(), /Database connection lost/);
  assert.equal(h.job().status, 'sending');
  assert.equal(deliveries, 1);
  h.faults.update = null;
  h.advance(90_001);
  const restarted = createNotificationWorker(h.deps);
  await restarted.runOnce();
  assert.equal(h.sent.length, 2);
  assert.equal(deliveries, 1);
  assert.equal(h.job().status, 'sent');
  assert.equal(h.job().messageId, 'email-1');
  assert.equal(h.job().attempts, 2);
});

test('expired sending jobs outside the safe window are never automatically dispatched', async () => {
  const h = harness({ jobs: [notification({ status: 'sending', attempts: 1,
    firstAttemptAt: new Date(+initialTime - IDEMPOTENCY_WINDOW_MS - 1),
    lastAttemptAt: new Date(+initialTime - IDEMPOTENCY_WINDOW_MS - 1),
    leaseToken: 'crashed-worker', leaseUntil: new Date(+initialTime - 1) })] });
  await h.worker.runOnce();
  assert.equal(h.sent.length, 0);
  assert.equal(h.job().status, 'uncertain');
});

test('provider request is persisted before send and survives sender/template changes across retries', async () => {
  let prepared = 0;
  const requests = [];
  const h = harness({
    prepare: async () => ({ success: true, message: { from: `sender-${++prepared}@example.test`, html: 'Original template' } }),
    sendPrepared: async (message, metadata) => {
      requests.push({ message: clone(message), metadata: clone(metadata) });
      assert.deepEqual(h.job().renderedMessage, message, 'request must be durable before the provider receives it');
      return requests.length === 1
        ? { success: false, retryable: true, ambiguous: true, error: 'Timeout' }
        : { success: true, messageId: 'email-after-restart' };
    }
  });
  await h.worker.runOnce();
  h.advance(60_000);
  const restarted = createNotificationWorker({ ...h.deps,
    prepare: async () => { throw new Error('New deployment template should not run'); } });
  await restarted.runOnce();
  assert.equal(prepared, 1);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(h.job().status, 'sent');
});

test('failure to persist a rendered request prevents any provider call', async () => {
  let sends = 0;
  const h = harness({ prepare: async () => ({ success: true, message: { html: 'Email' } }),
    sendPrepared: async () => { sends++; return { success: true, messageId: 'unexpected' }; } });
  h.faults.update = (_, update) => {
    if (update.$set['notifications.$.renderedMessage']) throw new Error('Cannot persist message');
  };
  await assert.rejects(h.worker.runOnce(), /Cannot persist message/);
  assert.equal(sends, 0);
  assert.equal(h.job().status, 'sending');
});

test('verified delivery webhook wins a race with the worker acceptance response', async () => {
  const h = harness({ send: async () => {
    h.job().status = 'delivered';
    h.job().messageId = 'email-delivered';
    h.job().deliveredAt = initialTime;
    delete h.job().leaseToken;
    return { success: true, messageId: 'email-delivered' };
  } });
  await h.worker.runOnce();
  assert.equal(h.job().status, 'delivered');
  assert.equal(+h.job().deliveredAt, +initialTime);
});

test('provider skips are recorded and terminal outcomes are not sent again', async () => {
  const terminal = ['sent', 'delivered', 'delayed', 'failed', 'bounced', 'suppressed', 'complained', 'skipped', 'uncertain'];
  const h = harness({ jobs: terminal.map((status, index) => notification({ id: `terminal-${index}`, status }))
    .concat(notification()), send: async () => ({ success: true, skipped: true }) });
  await h.worker.runOnce();
  assert.equal(h.sent.length, 1);
  assert.equal(h.orders[0].notifications.at(-1).status, 'skipped');
  await h.worker.runOnce();
  assert.equal(h.sent.length, 1);
});

test('batch size limits work and scheduler wake contains database failures', async () => {
  const h = harness({ maxBatch: 1, jobs: [notification(), notification({ id: 'notification-2', idempotencyKey: 'second' })] });
  assert.equal(await h.worker.runOnce(), 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.job(1).status, 'pending');
  h.faults.claim = () => { throw new Error('Database unavailable'); };
  assert.equal(await h.worker.wake(), 0);
  assert.equal(h.logs.at(-1).event, 'order_notification_worker_error');
  await h.worker.stop();
  assert.equal(await h.worker.wake(), 0);
});

test('a malformed provider success is treated as uncertain rather than falsely sent', async () => {
  const h = harness({ maxAttempts: 1, send: async () => ({ success: true }) });
  await h.worker.runOnce();
  assert.equal(h.job().status, 'uncertain');
  assert.equal(h.job().messageId, undefined);
});

test('a retry-after beyond the retry budget is surfaced instead of retrying too early', async () => {
  const h = harness({ send: async () => ({ success: false, retryable: true, ambiguous: false,
    retryAfterMs: IDEMPOTENCY_WINDOW_MS, error: 'Provider limit exceeded' }) });
  await h.worker.runOnce();
  assert.equal(h.job().status, 'failed');
  assert.equal(h.sent.length, 1);
  h.advance(IDEMPOTENCY_WINDOW_MS);
  assert.equal(await h.worker.runOnce(), 0);
});

test('later rejection cannot erase uncertainty about an earlier accepted request', async () => {
  let attempts = 0;
  const h = harness({ send: async () => ++attempts === 1
    ? { success: false, retryable: true, ambiguous: true, error: 'Lost response' }
    : { success: false, retryable: false, ambiguous: false, error: 'Configuration changed' } });
  await h.worker.runOnce();
  h.advance(60_000);
  await h.worker.runOnce();
  assert.equal(h.job().status, 'uncertain');
  assert.equal(h.job().ambiguous, true);
});

test('shutdown finishes the in-flight send without starting the next notification', async () => {
  const pending = deferred();
  const h = harness({ jobs: [notification(), notification({ id: 'notification-2', idempotencyKey: 'second' })],
    send: () => pending.promise });
  const run = h.worker.runOnce();
  await new Promise(setImmediate);
  const stopped = h.worker.stop();
  pending.resolve({ success: true, messageId: 'email-before-shutdown' });
  await Promise.all([run, stopped]);
  assert.equal(h.sent.length, 1);
  assert.equal(h.job().status, 'sent');
  assert.equal(h.job(1).status, 'pending');
});

test('production Order schema casts claim and completion without removing lease or payload fields', async () => {
  const Order = require('../models/Order');
  const mongoose = require('mongoose');
  const previousClaim = Order.collection.findOneAndUpdate;
  const previousUpdate = Order.collection.updateOne;
  const claims = [], completions = [];
  const orderId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
  try {
    Order.collection.findOneAndUpdate = async (filter, update, options) => {
      claims.push({ filter, update, options });
      if (claims.length < 3) return null;
      const job = notification();
      for (const [key, value] of Object.entries(update.$set)) job[key.replace('notifications.$.', '')] = value;
      job.attempts = 1;
      return { _id: orderId, notifications: [job] };
    };
    Order.collection.updateOne = async (filter, update) => {
      completions.push({ filter, update });
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    };
    const worker = createNotificationWorker({ Order, maxBatch: 1, now: () => initialTime,
      senders: { shipped: async payload => {
        assert.equal(payload.customerInfo.email, 'private@example.test');
        return { success: true, messageId: 'schema-checked-email' };
      } } });
    assert.equal(await worker.runOnce(), 1);
    assert.equal(claims[2].filter.notifications.$elemMatch.firstAttemptAt, null);
    assert(claims[2].filter.notifications.$elemMatch.nextAttemptAt.$lte instanceof Date);
    assert.equal(claims[2].options.returnDocument, 'after');
    assert(claims[2].options.projection.notifications.$elemMatch.leaseToken);
    assert.equal(String(completions[0].filter._id), String(orderId));
    assert.equal(completions[0].filter.notifications.$elemMatch.status, 'sending');
    assert.equal(completions[0].update.$set['notifications.$.messageId'], 'schema-checked-email');
    assert.equal(completions[0].update.$set['notifications.$.status'], 'sent');
  } finally {
    Order.collection.findOneAndUpdate = previousClaim;
    Order.collection.updateOne = previousUpdate;
  }
});
