const test = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');
const { createNotificationController } = require('../controllers/notificationController');
const { queueOrderNotification, canRetry, notificationSummary, orderView,
  supersedeNotifications, IDEMPOTENCY_WINDOW_MS } = require('../services/orderNotifications');

const orderId = '507f1f77bcf86cd799439012';
const adminId = '507f1f77bcf86cd799439013';
const timestamp = new Date('2026-10-18T12:00:00.000Z');
const baseOrder = extra => ({
  _id: orderId, orderNumber: 'ANJ-notifications', status: 'shipped', paymentStatus: 'paid',
  customerInfo: { email: 'customer@example.com', fullName: 'Test Customer', address: 'Test Road', city: 'Lagos', state: 'Lagos', phone: '08000000000' },
  items: [{ product: '507f1f77bcf86cd799439011', name: 'Tote', price: 1500, quantity: 1 }],
  totalAmount: 1500, trackingNumber: 'TRACK-123', internalNotes: 'Internal contact instructions',
  paymentAuthorizationUrl: 'https://payments.example/private', notifications: [], ...extra
});

const stored = value => JSON.parse(JSON.stringify(value.toObject ? value.toObject() : value));

// Serial transactions model rollback/concurrent admin requests. Real Mongoose
// documents retain casting behavior so embedded outbox mutations are exercised.
function fixture(initial = baseOrder()) {
  let state = initial && stored(initial);
  let chain = Promise.resolve();
  let failNextCommit = false;
  let saves = 0;
  const document = (source, session) => {
    if (!source) return null;
    const order = new Order(source);
    order.save = async ({ session: supplied }) => {
      assert.equal(supplied, session);
      saves++;
      session.order = stored(order);
    };
    return order;
  };
  const deps = {
    Order: {
      findById: id => ({
        session: async session => id === orderId ? document(session.order, session) : null,
        then: (resolve, reject) => Promise.resolve(id === orderId ? document(state) : null).then(resolve, reject)
      })
    },
    runTransaction: work => {
      const result = chain.then(async () => {
        const session = { order: state && structuredClone(state) };
        const value = await work(session);
        if (failNextCommit) { failNextCommit = false; throw new Error('Private transaction failure details'); }
        state = session.order;
        return value;
      });
      chain = result.catch(() => {});
      return result;
    },
    now: () => new Date(timestamp)
  };
  const handlers = createNotificationController(deps);
  return {
    state: () => state,
    saves: () => saves,
    failNextCommit: () => { failNextCommit = true; },
    call: async (method, body = {}, params = {}) => {
      const response = {
        code: 200,
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; }
      };
      await handlers[method]({ params: { id: orderId, ...params }, body, user: { _id: adminId } }, response);
      return response;
    }
  };
}

function withJob(changes = {}, orderChanges = {}) {
  const order = baseOrder(orderChanges);
  const job = queueOrderNotification(order, 'shipped', { now: timestamp });
  Object.assign(job, { status: 'failed', lastError: 'Sender domain requires verification', errorCode: 'validation_error', ...changes });
  return { order, job };
}

test('queue returns the actual embedded Mongoose notification for persisted follow-up mutations', () => {
  const order = new Order(baseOrder());
  const job = queueOrderNotification(order, 'shipped', { now: timestamp });
  job.retryRequestedBy = adminId;
  assert.equal(order.notifications[0].retryRequestedBy, adminId);
});

test('retry eligibility blocks accepted, ambiguous, superseded and obsolete notifications', () => {
  const { order, job } = withJob();
  assert.equal(canRetry(job, order), true);
  for (const changes of [
    { ambiguous: true }, { messageId: 'email-accepted' }, { status: 'sent' },
    { status: 'delivered' }, { status: 'bounced' }, { status: 'uncertain' },
    { status: 'skipped', skipReason: 'A newer order update replaced this message.' }
  ]) assert.equal(canRetry({ ...job, ...changes }, order), false, JSON.stringify(changes));
  assert.equal(canRetry(job, { ...order, status: 'delivered' }), false);
  assert.equal(canRetry(job, { ...order, isManualOrder: true, sendCustomerEmail: false }), false);
  assert.equal(canRetry(job, { ...order, customerInfo: { ...order.customerInfo, email: '' } }), false);
});

test('concurrent explicit retries reset a definite rejection once and retain the failure history', async () => {
  const { order, job } = withJob({ attempts: 5, totalAttempts: 8, renderedMessage: { html: 'Frozen request body' } });
  const db = fixture(order);
  const responses = await Promise.all([
    db.call('retryNotification', {}, { notificationId: job.id }),
    db.call('retryNotification', {}, { notificationId: job.id })
  ]);
  for (const response of responses) assert.equal(response.code, 202);
  assert.equal(db.state().notifications.length, 1);
  assert.equal(db.saves(), 1);
  const actual = db.state().notifications[0];
  assert.equal(actual.status, 'pending');
  assert.equal(actual.attempts, 0);
  assert.notEqual(actual.idempotencyKey, job.idempotencyKey);
  assert.equal(actual.renderedMessage, undefined);
  assert.equal(actual.totalAttempts, 8);
  assert.equal(actual.lastError, job.lastError);
  assert.equal(actual.errorCode, job.errorCode);
  assert.equal(responses[0].body.data.notifications[0].attempts, 8);
  assert.equal(responses[0].body.data.notifications[0].lastError, job.lastError);
  assert.equal(responses[0].body.data.notifications[0].id, responses[1].body.data.notifications[0].id);
  assert.equal(actual.retryRequestedBy, adminId);
});

test('explicit retry of a sender rejection regenerates the message with corrected configuration', async () => {
  const { prepareNotification } = require('../services/emailService');
  const previousSender = process.env.EMAIL_FROM;
  try {
    process.env.EMAIL_FROM = 'Unverified <old@example.com>';
    const initial = withJob({ firstAttemptAt: new Date(timestamp.getTime() - 1000) });
    const prepared = await prepareNotification('shipped', initial.job.payload);
    assert.equal(prepared.success, true);
    initial.job.renderedMessage = prepared.message;
    process.env.EMAIL_FROM = 'Anjola <corrected@example.com>';
    const db = fixture(initial.order);
    assert.equal((await db.call('retryNotification', {}, { notificationId: initial.job.id })).code, 202);
    const actual = db.state().notifications[0];
    assert.notEqual(actual.idempotencyKey, initial.job.idempotencyKey);
    assert.equal(actual.renderedMessage, undefined);
    assert.equal(actual.firstAttemptAt, undefined);
    const corrected = await prepareNotification(actual.type, actual.payload);
    assert.equal(corrected.success, true);
    assert.equal(corrected.message.from, 'Anjola <corrected@example.com>');
    assert.equal(corrected.message.to, initial.order.customerInfo.email);
    assert.equal(corrected.message.tags.find(tag => tag.name === 'notification_id').value, actual.id);
    assert.equal(initial.job.renderedMessage.from, 'Unverified <old@example.com>');
  } finally {
    if (previousSender === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previousSender;
  }
});

test('definite rejection can rotate an expired key, while uncertain requests never can', async () => {
  const firstAttemptAt = new Date(timestamp.getTime() - IDEMPOTENCY_WINDOW_MS - 1000);
  const { order, job } = withJob({ firstAttemptAt });
  const db = fixture(order);
  const response = await db.call('retryNotification', {}, { notificationId: job.id });
  assert.equal(response.code, 202);
  assert.notEqual(db.state().notifications[0].idempotencyKey, job.idempotencyKey);
  assert.equal(db.state().notifications[0].firstAttemptAt, undefined);
  for (const extra of [{ ambiguous: true }, { messageId: 'accepted-123' }]) {
    const failed = withJob({ firstAttemptAt, ...extra });
    const rejected = fixture(failed.order);
    const result = await rejected.call('retryNotification', {}, { notificationId: failed.job.id });
    assert.equal(result.code, 409);
    assert.equal(rejected.state().notifications[0].idempotencyKey, failed.job.idempotencyKey);
    assert.equal(rejected.saves(), 0);
  }
});

test('legacy recovery creates only the requested current message and cannot replay its history', async () => {
  const db = fixture();
  const response = await db.call('sendNotification', { type: 'shipped' });
  assert.equal(response.code, 202);
  assert.equal(db.state().notifications.length, 1);
  const job = db.state().notifications[0];
  assert.equal(job.type, 'shipped');
  assert.equal(job.status, 'pending');
  assert.equal(job.retryRequestedBy, adminId);
  assert.equal(job.retryRequestedAt, timestamp.toISOString());
  assert.equal((await db.call('sendNotification', { type: 'shipped' })).code, 409);
  assert.equal((await db.call('sendNotification', { type: 'order_confirmation' })).code, 409);
  assert.equal((await db.call('sendNotification', { type: 'delivered' })).code, 409);
  assert.equal(db.state().notifications.length, 1);
});

test('transaction failure leaves no notification, audit marker or changed preference committed', async () => {
  const db = fixture();
  db.failNextCommit();
  const response = await db.call('sendNotification', { type: 'shipped' });
  assert.equal(response.code, 500);
  assert.equal(response.body.success, false);
  assert.doesNotMatch(response.body.message, /Private transaction/);
  assert.equal(db.state().notifications.length, 0);
  assert.equal((await db.call('sendNotification', { type: 'shipped' })).code, 202);
  assert.equal(db.state().notifications.length, 1);
  const manual = fixture(baseOrder({ isManualOrder: true, sendCustomerEmail: false }));
  manual.failNextCommit();
  assert.equal((await manual.call('updatePreferences', { enabled: true })).code, 500);
  assert.equal(manual.state().sendCustomerEmail, false);
});

test('manual opt-in followed by skipped retry refreshes the frozen customer preference', async () => {
  const order = baseOrder({ isManualOrder: true, sendCustomerEmail: false });
  const job = queueOrderNotification(order, 'shipped', { now: timestamp });
  assert.equal(job.status, 'skipped');
  assert.equal(job.payload.sendCustomerEmail, false);
  const db = fixture(order);
  assert.equal((await db.call('retryNotification', {}, { notificationId: job.id })).code, 409);
  assert.equal((await db.call('updatePreferences', { enabled: true })).code, 200);
  assert.equal((await db.call('retryNotification', {}, { notificationId: job.id })).code, 202);
  const actual = db.state().notifications[0];
  assert.equal(actual.status, 'pending');
  assert.equal(actual.payload.sendCustomerEmail, true);
  assert.equal(actual.payload.notificationId, actual.id);
  assert.equal(actual.skipReason, '');
});

test('disabling manual updates stops unsent work without erasing ambiguous acceptance evidence', async () => {
  const order = baseOrder({ isManualOrder: true, sendCustomerEmail: true });
  const pending = queueOrderNotification(order, 'shipped', { now: timestamp });
  const ambiguous = queueOrderNotification(order, 'payment_confirmation', { now: timestamp });
  Object.assign(ambiguous, { status: 'retry', ambiguous: true });
  const sending = queueOrderNotification(order, 'shipped', { now: timestamp });
  sending.status = 'sending';
  const db = fixture(order);
  assert.equal((await db.call('updatePreferences', { enabled: false })).code, 200);
  const jobs = db.state().notifications;
  assert.equal(jobs.find(job => job.id === pending.id).status, 'skipped');
  assert.equal(jobs.find(job => job.id === ambiguous.id).status, 'uncertain');
  assert.equal(jobs.find(job => job.id === ambiguous.id).ambiguous, true);
  assert.equal(jobs.find(job => job.id === sending.id).status, 'sending');
});

test('customer order views omit private outbox data; admin views expose metadata only', async () => {
  const { order, job } = withJob({ renderedMessage: { html: 'SECRET_HTML' }, leaseToken: 'SECRET_LEASE',
    idempotencyKey: 'SECRET_KEY', retryRequestedBy: adminId });
  const publicView = orderView(new Order(order));
  assert.equal(publicView.notifications, undefined);
  assert.equal(publicView.internalNotes, undefined);
  assert.equal(publicView.paymentAuthorizationUrl, undefined);
  const adminView = orderView(new Order(order), true);
  assert.equal(adminView.internalNotes, order.internalNotes);
  assert.equal(adminView.notifications[0].id, job.id);
  assert.equal(adminView.notifications[0].canRetry, true);
  const db = fixture(order);
  const response = await db.call('getNotifications');
  assert.equal(response.code, 200);
  for (const value of [adminView.notifications[0], notificationSummary(job, order), response.body.data[0]]) {
    for (const privateField of ['payload', 'renderedMessage', 'idempotencyKey', 'leaseToken', 'retryRequestedBy', 'messageId']) {
      assert.equal(value[privateField], undefined, privateField);
    }
    assert.doesNotMatch(JSON.stringify(value), /SECRET_HTML|SECRET_LEASE|SECRET_KEY|customer@example.com/);
  }
});

test('superseding notifications preserves accepted or ambiguous evidence and blocks old instructions', () => {
  const order = baseOrder();
  const ordinary = queueOrderNotification(order, 'order_confirmation', { now: timestamp });
  const accepted = queueOrderNotification(order, 'order_confirmation', { now: timestamp });
  Object.assign(accepted, { status: 'retry', messageId: 'accepted-123' });
  const uncertain = queueOrderNotification(order, 'order_confirmation', { now: timestamp });
  Object.assign(uncertain, { status: 'retry', ambiguous: true });
  supersedeNotifications(order, ['order_confirmation']);
  assert.equal(ordinary.status, 'skipped');
  assert.equal(canRetry(ordinary, order), false);
  assert.equal(accepted.status, 'retry');
  assert.equal(uncertain.status, 'retry');
});

test('invalid IDs/types and missing orders produce useful API errors without writes', async () => {
  const db = fixture();
  for (const method of ['getNotifications', 'sendNotification', 'retryNotification', 'updatePreferences']) {
    const body = method === 'updatePreferences' ? { enabled: true } : { type: 'shipped' };
    const result = await db.call(method, body, { id: 'bad-id', notificationId: '12345678-1234-1234-1234-123456789012' });
    assert.equal(result.code, 400, method);
    assert.equal(result.body.success, false);
  }
  assert.equal((await db.call('sendNotification', { type: 'marketing' })).code, 400);
  assert.equal((await db.call('retryNotification', {}, { notificationId: 'bad-id' })).code, 400);
  assert.equal((await db.call('retryNotification', {}, { notificationId: '12345678-1234-1234-1234-123456789012' })).code, 404);
  assert.equal((await db.call('updatePreferences', { enabled: 'true' })).code, 400);
  assert.equal((await db.call('updatePreferences', { enabled: false })).code, 409);
  assert.equal(db.saves(), 0);
  const missing = fixture(null);
  assert.equal((await missing.call('getNotifications')).code, 404);
  assert.equal((await missing.call('sendNotification', { type: 'shipped' })).code, 404);
  const manual = fixture(baseOrder({ isManualOrder: true, sendCustomerEmail: false, customerInfo: { email: '' } }));
  assert.equal((await manual.call('updatePreferences', { enabled: true })).code, 409);
});

test('retry cooldown rejects rapid repeated failures without changing the job', async () => {
  const { order, job } = withJob({ retryRequestedAt: new Date(timestamp.getTime() - 1000) });
  const db = fixture(order);
  const result = await db.call('retryNotification', {}, { notificationId: job.id });
  assert.equal(result.code, 429);
  assert.equal(db.saves(), 0);
  assert.equal(db.state().notifications[0].status, 'failed');
});
