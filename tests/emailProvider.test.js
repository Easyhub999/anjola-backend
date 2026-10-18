const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { verifyResendWebhook } = require('../services/resendWebhook');

const order = () => ({
  orderId: 'order_123', notificationId: 'notification_123', orderNumber: 'ANJ-123',
  createdAt: '2025-12-31T10:00:00.000Z',
  customerInfo: { email: 'customer@example.com', fullName: 'Test Customer', address: 'Test Road', city: 'Lagos', state: 'Lagos', phone: '08000000000' },
  items: [{ name: 'Test product', quantity: 1, price: 1500 }],
  totalAmount: 1500, paymentReference: 'PAY-123', trackingNumber: 'TRACK-123'
});

function loadEmailService(send = async () => ({ data: { id: 'email-123' }, error: null }), construct) {
  const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Anjola <orders@example.com>' };
  const context = {
    exports: {}, module: {}, process: { env }, AbortSignal,
    console: { log() {}, error() {} },
    require: () => ({ Resend: class {
      constructor(key) {
        if (construct) construct(key);
        this.emails = { send };
      }
    } })
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/emailService'), 'utf8'), context);
  return { service: context.module.exports, env };
}

const types = ['order_confirmation', 'payment_confirmation', 'payment_review', 'shipped', 'delivered', 'cancelled'];
const senders = ['sendOrderConfirmation', 'sendPaymentConfirmation', 'sendPaymentReviewNotification', 'sendShippedNotification', 'sendDeliveredNotification', 'sendCancelledNotification'];

test('every order sender forwards stable idempotency keys and an abort signal', async () => {
  const calls = [];
  const { service } = loadEmailService(async (message, options) => {
    calls.push({ message, options });
    return { data: { id: 'accepted-123' }, error: null };
  });
  for (const name of senders) {
    const result = await service[name](order(), { idempotencyKey: 'notification-123' });
    assert.equal(result.success, true);
    assert.equal(result.messageId, 'accepted-123');
  }
  assert.equal(calls.length, senders.length);
  for (const { message, options } of calls) {
    assert.equal(message.to, 'customer@example.com');
    assert.equal(options.idempotencyKey, 'notification-123');
    assert(options.signal instanceof AbortSignal);
  }
});

test('provider failures retain retry classification and explicit Retry-After delay', async () => {
  const cases = [
    { error: { name: 'rate_limit_exceeded', statusCode: 429 }, retryable: true, ambiguous: false },
    { error: { name: 'daily_quota_exceeded', statusCode: 429 }, retryable: true, ambiguous: false },
    { error: { name: 'application_error', statusCode: 500 }, retryable: true, ambiguous: true },
    { error: { name: 'application_error', statusCode: null }, retryable: true, ambiguous: true },
    { error: { name: 'concurrent_idempotent_requests', statusCode: 409 }, retryable: true, ambiguous: true },
    { error: { name: 'invalid_idempotent_request', statusCode: 409 }, retryable: false, ambiguous: true },
    { error: { name: 'validation_error', statusCode: 403 }, retryable: false, ambiguous: false },
    { error: { name: 'invalid_api_key', statusCode: 403 }, retryable: false, ambiguous: false }
  ];
  for (const expected of cases) {
    const { service } = loadEmailService(async () => ({
      data: null, error: { ...expected.error, message: 'Provider rejected request' }, headers: { 'retry-after': '12' }
    }));
    const result = await service.sendShippedNotification(order());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, expected.error.name);
    assert.equal(result.error, 'Provider rejected request');
    assert.equal(result.retryable, expected.retryable, expected.error.name);
    assert.equal(result.ambiguous, expected.ambiguous, expected.error.name);
    assert.equal(result.retryAfterMs, 12000);
  }
});

test('network exceptions and missing provider message IDs have unknown acceptance', async () => {
  for (const send of [async () => { throw new TypeError('fetch failed'); }, async () => ({ data: {}, error: null })]) {
    const { service } = loadEmailService(send);
    const result = await service.sendShippedNotification(order());
    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.equal(result.ambiguous, true);
  }
});

test('installed Resend SDK network failures remain retryable and ambiguous with request timeout and key intact', async () => {
  const { Resend } = require('resend');
  const originalFetch = global.fetch;
  let captured;
  try {
    global.fetch = async (url, options) => {
      captured = { url, options };
      throw new TypeError('Simulated network unavailable');
    };
    const context = {
      exports: {}, module: {}, process: { env: { RESEND_API_KEY: 're_test_only' } },
      AbortSignal, console: { log() {}, error() {} }, require: () => ({ Resend })
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../services/emailService'), 'utf8'), context);
    const result = await context.exports.sendPreparedEmail({
      from: 'Test <test@example.com>', to: 'customer@example.com', subject: 'Test', html: '<p>Test</p>'
    }, { idempotencyKey: 'network-test-key' });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'application_error');
    assert.equal(result.retryable, true);
    assert.equal(result.ambiguous, true);
    assert.match(result.error, /Unable to fetch data/);
    assert.equal(captured.options.headers.get('Idempotency-Key'), 'network-test-key');
    assert(captured.options.signal instanceof AbortSignal);
  } finally {
    global.fetch = originalFetch;
  }
});

test('missing API configuration fails a notification without failing module import', async () => {
  let initialized = false;
  const { service } = loadEmailService(undefined, () => {
    initialized = true;
    throw new Error('Missing API key. Pass it to the constructor');
  });
  assert.equal(initialized, false);
  const result = await service.sendShippedNotification(order());
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'missing_api_key');
  assert.equal(result.retryable, false);
  assert.equal(result.ambiguous, false);
});

test('prepared messages require no provider call and remain unchanged across sender changes', async () => {
  const calls = [];
  const { service, env } = loadEmailService(async (message, options) => {
    calls.push({ message, options });
    return { data: { id: 'accepted-123' }, error: null };
  });
  for (const type of types) {
    const prepared = await service.prepareNotification(type, order());
    assert.equal(prepared.success, true, type);
    assert.equal(calls.length, 0);
    assert.equal(prepared.message.tags.find(tag => tag.name === 'notification_id').value, 'notification_123');
    assert.equal(prepared.message.tags.find(tag => tag.name === 'order_id').value, 'order_123');
  }
  const prepared = await service.prepareNotification('shipped', order());
  const serialized = JSON.stringify(prepared.message);
  env.EMAIL_FROM = 'Changed <changed@example.com>';
  await service.sendPreparedEmail(prepared.message, { idempotencyKey: 'stable-key' });
  await service.sendPreparedEmail(prepared.message, { idempotencyKey: 'stable-key' });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(JSON.stringify(call.message), serialized);
    assert.equal(call.options.idempotencyKey, 'stable-key');
  }
  assert.match(prepared.message.html, /2025 Anjola/);
  assert.equal((await service.prepareNotification('unknown', order())).success, false);
});

test('preparation uses the saved notification year and remains deterministic without sending', async () => {
  let sends = 0;
  const { service } = loadEmailService(async () => { sends++; });
  const input = { ...order(), notificationYear: 2024 };
  for (const type of types) {
    const first = await service.prepareNotification(type, input);
    const second = await service.prepareNotification(type, input);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    if (type !== 'payment_review') assert.match(first.message.html, /2024 Anjola/);
  }
  assert.equal(sends, 0);
});

test('manual opt-out stays skipped for preparation and sending', async () => {
  let calls = 0;
  const { service } = loadEmailService(async () => { calls++; });
  for (const type of types) {
    const result = await service.prepareNotification(type, { ...order(), isManualOrder: true, sendCustomerEmail: false });
    assert.equal(result.skipped, true);
  }
  for (const name of senders) {
    const result = await service[name]({ ...order(), isManualOrder: true, sendCustomerEmail: false });
    assert.equal(result.skipped, true);
  }
  assert.equal(calls, 0);
});

test('missing sender cannot be frozen into a prepared request', async () => {
  const { service, env } = loadEmailService();
  delete env.EMAIL_FROM;
  const result = await service.prepareNotification('shipped', order());
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'missing_sender_configuration');
  assert.equal(result.retryable, false);
  assert.equal(result.ambiguous, false);
  env.EMAIL_FROM = 'Recovered <orders@example.com>';
  const prepared = await service.prepareNotification('shipped', order());
  assert.equal(prepared.success, true);
  assert.equal(prepared.message.from, env.EMAIL_FROM);
});

test('payment review receipt is truthful and escapes interpolated HTML', async () => {
  const { service } = loadEmailService();
  const input = order();
  input.customerInfo.fullName = '<img src=x onerror=alert(1)>';
  input.orderNumber = 'ANJ-<script>alert(1)</script>';
  input.paymentReference = '<b>reference</b>';
  const result = await service.prepareNotification('payment_review', input);
  assert.equal(result.success, true);
  assert.match(result.message.html, /reviewing your order/);
  assert.match(result.message.html, /Please do not make another payment/);
  assert.doesNotMatch(result.message.html, /Paid & Processing|order is now being processed/);
  assert.doesNotMatch(result.message.html, /<img|<script>|<b>reference/);
  assert.match(result.message.html, /&lt;img/);
});

test('historical payment receipt does not promise processing for fulfilled or cancelled orders', async () => {
  const { service } = loadEmailService();
  for (const status of ['shipped', 'delivered', 'cancelled']) {
    const prepared = await service.prepareNotification('payment_confirmation', { ...order(), status });
    assert.equal(prepared.success, true);
    assert.match(prepared.message.html, /payment receipt/);
    assert.doesNotMatch(prepared.message.html, /Paid & Processing|order is now being processed|We'll send a shipment update/);
  }
});

function signedWebhook(body, secondsAgo = 0) {
  const key = Buffer.from('a-test-secret-for-webhook-signing');
  const secret = `whsec_${key.toString('base64')}`;
  const id = 'msg_test123';
  const timestamp = String(Math.floor(Date.now() / 1000) - secondsAgo);
  const signature = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { secret, headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } };
}

test('Resend webhook helper verifies authentic raw bytes and parses only after signature verification', () => {
  const event = { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'email-123' } };
  const rawBody = JSON.stringify(event, null, 2);
  const { headers, secret } = signedWebhook(rawBody);
  assert.deepEqual(verifyResendWebhook(Buffer.from(rawBody), headers, secret), event);
  assert.throws(() => verifyResendWebhook(JSON.stringify(event), headers, secret), /signature/);
  assert.throws(() => verifyResendWebhook(rawBody.replace('email-123', 'other-email'), headers, secret), /signature/);
  assert.throws(() => verifyResendWebhook(event, headers, secret), /original webhook body/);
  assert.throws(() => verifyResendWebhook(rawBody, {}, secret), /signature/);
});

test('webhook verification rejects stale timestamps, missing secret and malformed signed events', () => {
  const rawBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email-123' } });
  const stale = signedWebhook(rawBody, 600);
  assert.throws(() => verifyResendWebhook(rawBody, stale.headers, stale.secret), /signature/);
  assert.throws(() => verifyResendWebhook(rawBody, stale.headers, ''), error => error.statusCode === 503);
  const malformed = signedWebhook('{}');
  assert.throws(() => verifyResendWebhook('{}', malformed.headers, malformed.secret), /Invalid email delivery webhook event/);
});
