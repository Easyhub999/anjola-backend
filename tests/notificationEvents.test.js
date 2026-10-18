const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { applyNotificationEvent } = require('../services/notificationEvents');
const { createNotificationWorker } = require('../services/notificationWorker');
const { verifyResendWebhook } = require('../services/resendWebhook');

const notificationId = 'b45b2bf8-e1cb-4d08-a325-b030cc104df8';
const baseTime = new Date('2026-10-18T12:00:00Z');
const clone = value => structuredClone(value);
const event = (type = 'email.delivered', offset = 0, data = {}) => ({
  type, created_at: new Date(+baseTime + offset).toISOString(),
  data: { email_id: 'provider-message-1', tags: [{ name: 'notification_id', value: notificationId }], ...data }
});

function matches(value, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$and') return expected.every(part => matches(value, part));
    if (key === '$or') return expected.some(part => matches(value, part));
    const actual = value[key];
    if (expected === null) return actual == null;
    if (expected?._bsontype === 'ObjectId') return String(actual) === String(expected);
    if (expected instanceof Date) return +actual === +expected;
    if (expected && typeof expected === 'object') {
      return Object.entries(expected).every(([operator, operand]) => {
        if (operator === '$elemMatch') return actual?.some(item => matches(item, operand));
        if (operator === '$in') return operand.includes(actual);
        if (operator === '$ne') return operand === null ? actual != null : actual !== operand;
        if (operator === '$exists') return (actual !== undefined) === operand;
        if (operator === '$lte') return actual != null && +new Date(actual) <= +new Date(operand);
        throw new Error(`Unimplemented Mongo predicate: ${operator}`);
      });
    }
    return actual === expected;
  });
}

// Use the production Mongoose model so schema casting is exercised, and replace
// only collection methods. No Mongo connection, provider call or real email.
async function withStore(overrides, work) {
  const previousUpdate = Order.collection.updateOne;
  const previousClaim = Order.collection.findOneAndUpdate;
  const order = { _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'), notifications: [{
    id: notificationId, type: 'shipped', status: 'sending', attempts: 1,
    idempotencyKey: `order-email/${notificationId}`, nextAttemptAt: baseTime,
    firstAttemptAt: baseTime, leaseToken: 'active-worker', leaseUntil: new Date(+baseTime + 90_000),
    payload: { orderNumber: 'ANJ-test', customerInfo: { email: 'private@example.test' } },
    ...overrides
  }] };
  const calls = [], logs = [];
  let databaseError;
  const job = () => order.notifications[0];
  function mutate(filter, update) {
    if (!matches(order, filter)) return false;
    const item = order.notifications.find(value => matches(value, filter.notifications.$elemMatch));
    assert(item);
    for (const [operator, fields] of Object.entries(update)) {
      for (const [path, value] of Object.entries(fields)) {
        assert(path.startsWith('notifications.$.'), 'updates must affect only the matched notification');
        const key = path.slice('notifications.$.'.length);
        if (operator === '$set') item[key] = clone(value);
        else if (operator === '$unset') delete item[key];
        else if (operator === '$inc') item[key] = (item[key] || 0) + value;
        else throw new Error(`Unimplemented Mongo update: ${operator}`);
      }
    }
    return true;
  }
  Order.collection.updateOne = async (filter, update) => {
    calls.push({ filter, update });
    if (databaseError) throw databaseError;
    const updated = mutate(filter, update);
    return { acknowledged: true, matchedCount: Number(updated), modifiedCount: Number(updated) };
  };
  Order.collection.findOneAndUpdate = async (filter, update, options) => {
    if (databaseError) throw databaseError;
    if (!mutate(filter, update)) return null;
    return { _id: order._id, notifications: clone(order.notifications.filter(value =>
      matches(value, options.projection.notifications.$elemMatch))) };
  };
  const logger = { error: entry => logs.push(entry) };
  let eventIndex = 0;
  const apply = (value, id = `event-${++eventIndex}`) => applyNotificationEvent({ Order, event: value, eventId: id, logger });
  try {
    await work({ job, calls, logs, apply, logger, fail: error => { databaseError = error; } });
  } finally {
    Order.collection.updateOne = previousUpdate;
    Order.collection.findOneAndUpdate = previousClaim;
  }
}

test('signed correlation tags record delivery before the send response and cast atomic update fields', async () => {
  for (const tags of [[{ name: 'notification_id', value: notificationId }], { notification_id: notificationId }]) {
    await withStore({}, async h => {
      assert.equal((await h.apply(event('email.delivered', 0, { tags }))).updated, true);
      assert.equal(h.job().status, 'delivered');
      assert.equal(h.job().messageId, 'provider-message-1');
      assert.equal(+h.job().deliveredAt, +baseTime);
      assert.equal(h.job().leaseToken, undefined);
      assert.equal(h.job().leaseUntil, undefined);
      assert.equal(h.calls[0].filter.notifications.$elemMatch.id, notificationId);
      assert(h.calls[0].update.$set['notifications.$.lastProviderEventAt'] instanceof Date);
      assert.equal(h.calls[0].update.$unset['notifications.$.leaseToken'], '');
    });
  }
});

test('missing or invalid tags correlate only by an already saved provider message ID', async () => {
  for (const tags of [undefined, [], { notification_id: 'invalid-id' }]) {
    await withStore({ messageId: 'provider-message-1', status: 'sent' }, async h => {
      assert.equal((await h.apply(event('email.delivered', 0, { tags }))).updated, true);
      assert.equal(h.calls[0].filter.notifications.$elemMatch.messageId, 'provider-message-1');
      assert.equal(h.calls[0].filter.notifications.$elemMatch.id, undefined);
    });
    await withStore({}, async h => {
      assert.equal((await h.apply(event('email.delivered', 0, { tags }))).updated, false);
      assert.equal(h.job().status, 'sending');
    });
  }
});

test('a matching notification tag cannot replace a conflicting provider message ID', async () => {
  await withStore({ messageId: 'another-provider-message', status: 'sent' }, async h => {
    assert.equal((await h.apply(event())).updated, false);
    assert.equal(h.job().messageId, 'another-provider-message');
    assert.equal(h.job().status, 'sent');
  });
});

test('duplicate provider events and older timestamps cannot change newer delivery evidence', async () => {
  await withStore({}, async h => {
    const delayed = event('email.delivery_delayed', 3000);
    assert.equal((await h.apply(delayed, 'same-event')).updated, true);
    const afterDelay = clone(h.job());
    assert.equal((await h.apply(delayed, 'same-event')).updated, false);
    assert.deepEqual(h.job(), afterDelay);
    assert.equal((await h.apply(event('email.delivered', 2000))).updated, false);
    assert.equal(h.job().status, 'delayed');
    assert.equal((await h.apply(event('email.sent', 4000))).updated, false);
    assert.equal((await h.apply(event('email.delivered', 5000))).updated, true);
    assert.equal((await h.apply(event('email.delivery_delayed', 6000))).updated, false);
    assert.equal(h.job().status, 'delivered');
  });
});

test('provider-confirmed failure cannot regress to sent or delayed but explicit delivery can correct it', async () => {
  await withStore({}, async h => {
    await h.apply(event('email.failed', 1000, { failed: { reason: 'Recipient rejected message' } }));
    assert.equal(h.job().status, 'failed');
    for (const type of ['email.sent', 'email.delivery_delayed']) {
      assert.equal((await h.apply(event(type, 2000))).updated, false);
      assert.equal(h.job().status, 'failed');
    }
    assert.equal((await h.apply(event('email.delivered', 3000))).updated, true);
    assert.equal(h.job().status, 'delivered');
    assert.equal(h.job().lastError, '');
  });
});

test('late provider acceptance resolves pre-send failure or uncertain response without another send', async () => {
  for (const status of ['failed', 'uncertain', 'retry']) {
    await withStore({ status, ambiguous: true }, async h => {
      assert.equal((await h.apply(event('email.sent'))).updated, true);
      assert.equal(h.job().status, 'sent');
      assert.equal(h.job().ambiguous, false);
      assert.equal(h.job().messageId, 'provider-message-1');
    });
  }
});

test('bounce, suppression and complaint outcomes cannot regress through sent, delayed or delivered events', async () => {
  for (const terminal of ['bounced', 'suppressed', 'complained']) {
    await withStore({}, async h => {
      await h.apply(event(`email.${terminal}`, 1000));
      for (const type of ['sent', 'delivery_delayed', 'delivered']) {
        assert.equal((await h.apply(event(`email.${type}`, 2000))).updated, false);
      }
      assert.equal(h.job().status, terminal);
    });
  }
});

test('delivery failures preserve bounded detail for admins and alert without recipient data', async () => {
  await withStore({}, async h => {
    await h.apply(event('email.bounced', 0, { bounce: { message: `private@example.test\n${'x'.repeat(600)}` } }));
    assert.equal(h.job().lastError.length, 500);
    assert(!h.job().lastError.includes('\n'));
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].event, 'order_notification_delivery_issue');
    assert(!JSON.stringify(h.logs).includes('private@example.test'));
    await h.apply(event('email.bounced'), 'event-1');
    assert.equal(h.logs.length, 1);
  });
});

test('unknown events do nothing while malformed delivery events fail before database access', async () => {
  await withStore({}, async h => {
    assert.deepEqual(await h.apply({ type: 'email.opened', data: {} }), { ignored: true });
    for (const malformed of [event('email.sent', 0, { email_id: '' }), { ...event(), created_at: 'invalid' }]) {
      await assert.rejects(h.apply(malformed), error => error.statusCode === 400);
    }
    assert.equal(h.calls.length, 0);
  });
});

test('database failures propagate so the webhook sender retries instead of losing delivery evidence', async () => {
  await withStore({}, async h => {
    h.fail(new Error('Database unavailable'));
    await assert.rejects(h.apply(event()), /Database unavailable/);
    assert.equal(h.job().status, 'sending');
  });
});

test('a delivery webhook arriving inside the provider call wins over worker completion', async () => {
  await withStore({ status: 'pending', firstAttemptAt: undefined, attempts: 0 }, async h => {
    const worker = createNotificationWorker({ Order, maxBatch: 1, now: () => baseTime, logger: h.logger,
      senders: { shipped: async () => {
        await h.apply(event('email.delivered'));
        return { success: true, messageId: 'provider-message-1' };
      } } });
    assert.equal(await worker.runOnce(), 1);
    assert.equal(h.job().status, 'delivered');
    assert.equal(+h.job().deliveredAt, +baseTime);
    assert.equal(h.job().attempts, 1);
    assert.equal(h.job().totalAttempts, 1);
    const completion = h.calls.at(-1);
    assert.equal(completion.filter.notifications.$elemMatch.status, 'sending');
  });
});

const webhookSecret = `whsec_${Buffer.from('notification-webhook-test-secret').toString('base64')}`;
function signedRequest(value) {
  const rawBody = Buffer.from(JSON.stringify(value, null, 2));
  const id = 'webhook-delivery-fixture', timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', Buffer.from(webhookSecret.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${rawBody.toString('utf8')}`).digest('base64');
  return { rawBody, body: { untrusted: 'The parsed body must not override the signed bytes' },
    headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } };
}
function routeHandler({ configured = true } = {}) {
  let handler;
  const router = { post(path, value) { assert.equal(path, '/resend'); handler = value; } };
  const dependencies = {
    express: { Router: () => router }, '../models/Order': Order,
    '../services/resendWebhook': { verifyResendWebhook: (raw, headers) => verifyResendWebhook(raw, headers, configured ? webhookSecret : '') },
    '../services/notificationEvents': { applyNotificationEvent: options => applyNotificationEvent({ ...options, logger: { error() {} } }) }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../routes/emailWebhooks'), 'utf8'), {
    require: name => dependencies[name] || require(name), module: { exports: {} }, console: { error() {} }
  });
  return handler;
}
const response = () => ({ code: null, sendStatus(code) { this.code = code; return this; } });

test('webhook route verifies authentic raw bytes then records the delivery and acknowledges replays', async () => {
  await withStore({}, async h => {
    const handler = routeHandler();
    const req = signedRequest(event());
    const first = response(), repeat = response();
    await handler(req, first);
    await handler(req, repeat);
    assert.equal(first.code, 200); assert.equal(repeat.code, 200);
    assert.equal(h.job().status, 'delivered');
    assert.equal(h.job().lastProviderEventId, req.headers['svix-id']);
  });
});

test('webhook route rejects tampered or missing raw bytes before touching delivery state', async () => {
  await withStore({}, async h => {
    const handler = routeHandler();
    const tampered = signedRequest(event());
    tampered.rawBody = Buffer.from('{}');
    const missing = signedRequest(event()); delete missing.rawBody;
    for (const req of [tampered, missing]) {
      const res = response();
      await handler(req, res);
      assert.equal(res.code, 400);
    }
    assert.equal(h.calls.length, 0);
    assert.equal(h.job().status, 'sending');
  });
});

test('webhook route returns a retryable response for database failure or missing signing configuration', async () => {
  await withStore({}, async h => {
    const req = signedRequest(event());
    const unconfigured = response();
    await routeHandler({ configured: false })(req, unconfigured);
    assert.equal(unconfigured.code, 503);
    assert.equal(h.calls.length, 0);
    h.fail(new Error('Database unavailable'));
    const unavailable = response();
    await routeHandler()(req, unavailable);
    assert.equal(unavailable.code, 503);
    assert.equal(h.job().status, 'sending');
  });
});

function serverFixture(env) {
  let jsonOptions, resolveConnection, starts = 0;
  const logs = [], mounted = [];
  const connection = new Promise(resolve => { resolveConnection = resolve; });
  const app = { use(...args) { mounted.push(args); }, get() {}, listen(port, callback) {
    callback(); return { close(done) { done(); } };
  } };
  const express = () => app;
  express.json = options => { jsonOptions = options; return 'json-middleware'; };
  express.urlencoded = () => 'urlencoded-middleware';
  const dependencies = {
    express, mongoose: { connect: () => connection, disconnect: async () => {} },
    cors: () => 'cors-middleware', dotenv: { config() {} },
    './services/notificationWorker': { createNotificationWorker: () => ({ start() { starts++; }, stop: async () => {} }) },
    './services/emailService': { prepareNotification() {}, sendPreparedEmail() {} },
    './models/Order': {}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../server'), 'utf8'), {
    require: name => name.startsWith('./routes/') ? name : dependencies[name],
    process: { env, on() {}, exit() {} }, console: { log() {}, error: message => logs.push(message) },
    setTimeout, clearTimeout
  });
  return { resolveConnection, starts: () => starts, verifyBody: (...args) => jsonOptions.verify(...args), mounted, logs };
}

test('server preserves exact delivery webhook bytes and starts the worker only after database readiness', async () => {
  const h = serverFixture({ RESEND_API_KEY: 'fixture-key', EMAIL_FROM: 'shop@example.test', RESEND_WEBHOOK_SECRET: webhookSecret });
  assert.equal(h.starts(), 0);
  const raw = Buffer.from('{ "signed": "exact bytes" }');
  for (const originalUrl of ['/api/email-webhooks/resend', '/api/email-webhooks/resend/', '/API/EMAIL-WEBHOOKS/RESEND', '/api/email-webhooks/resend?source=provider', '/api/orders/paystack-webhook']) {
    const req = { originalUrl };
    h.verifyBody(req, {}, raw);
    assert.equal(req.rawBody, raw);
  }
  const ordinary = { originalUrl: '/api/orders' };
  h.verifyBody(ordinary, {}, raw);
  assert.equal(ordinary.rawBody, undefined);
  assert(h.mounted.some(args => args[0] === '/api/email-webhooks' && args[1] === './routes/emailWebhooks'));
  h.resolveConnection();
  await new Promise(setImmediate);
  assert.equal(h.starts(), 1);
});

test('missing sender configuration keeps queued work intact and emits a configuration alert', async () => {
  for (const env of [{ RESEND_API_KEY: 'fixture-key' }, { EMAIL_FROM: 'shop@example.test' }]) {
    const h = serverFixture(env);
    h.resolveConnection();
    await new Promise(setImmediate);
    assert.equal(h.starts(), 0);
    assert(h.logs.some(entry => entry.event === 'order_notification_configuration_missing'));
    assert(h.logs.some(entry => entry.event === 'order_notification_delivery_tracking_not_configured'));
  }
});
