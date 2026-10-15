const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const canonical = () => ({ reference: 'anj-fee-fixture', status: 'success', amount: 152285,
  requested_amount: 150000, fees: 2284, currency: 'NGN',
  customer: { email: 'fixture@example.com' }, metadata: { orderId: '507f1f77bcf86cd799439012' } });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const response = () => ({ code: null, body: null, sends: 0,
  status(code) { this.code = code; return this; },
  json(body) { this.code ||= 200; this.body = body; this.sends++; return this; },
  sendStatus(code) { this.code = code; this.sends++; return this; } });

function harness({ verify, receipt, processPayment } = {}) {
  const verified = [], processed = [], emailed = [];
  const dependencies = {
    '../models/Order': {}, '../models/Product': {}, mongoose: { connection: {} },
    '../services/paystackService': { verifyPayment: async reference => {
      verified.push(reference);
      return verify ? verify(reference) : { status: true, data: canonical() };
    } },
    '../services/paymentProcessing': { createPaymentProcessor: () => async payment => {
      processed.push(payment);
      return processPayment ? processPayment(payment) : {
        order: { orderNumber: 'ANJ-fixture', paymentReviewReason: '' }, newlyPaid: true
      };
    } },
    '../services/orderStatus': { createOrderStatusUpdater: () => {} },
    '../services/emailService': { sendPaymentConfirmation: async order => {
      emailed.push(order);
      return receipt ? receipt(order) : { success: true };
    } }
  };
  const context = { exports: {}, require: name => dependencies[name] || require(name),
    console: { error() {} }, process: { env: { PAYSTACK_SECRET_KEY: 'fixture-secret' } }, Buffer };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/orderController'), 'utf8'), context);
  return { handlers: context.exports, verified, processed, emailed };
}
function signedWebhook(data) {
  const body = { event: 'charge.success', data };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac('sha512', 'fixture-secret').update(rawBody).digest('hex');
  return { body, rawBody, headers: { 'x-paystack-signature': signature } };
}

test('signed webhook without requested_amount processes the canonical Paystack verification', async () => {
  const h = harness(); const res = response();
  const sparse = { ...canonical(), amount: 1, customer: null }; delete sparse.requested_amount;
  await h.handlers.paystackWebhook(signedWebhook(sparse), res);
  assert.equal(res.code, 200);
  assert.deepEqual(h.verified, ['anj-fee-fixture']);
  assert.deepEqual(h.processed, [canonical()]);
  assert.equal(h.emailed.length, 1);
});

test('complete signed fee payload uses the shared processor without another network lookup', async () => {
  const h = harness(); const res = response();
  await h.handlers.paystackWebhook(signedWebhook(canonical()), res);
  assert.equal(res.code, 200); assert.equal(h.verified.length, 0);
  assert.deepEqual(h.processed, [canonical()]);
});

test('unavailable or mismatched upstream verification leaves webhook unacknowledged and unprocessed', async () => {
  for (const verify of [
    async () => { throw new Error('Paystack unavailable'); },
    async () => ({ status: false, data: canonical() }),
    async () => ({ status: 'true', data: canonical() }),
    async () => ({ status: true, data: { ...canonical(), reference: 'another-reference' } }),
    async () => null
  ]) {
    const h = harness({ verify }); const res = response();
    const sparse = canonical(); delete sparse.requested_amount;
    await h.handlers.paystackWebhook(signedWebhook(sparse), res);
    assert(res.code >= 400);
    assert.equal(h.processed.length, 0); assert.equal(h.emailed.length, 0);
  }
});

test('signature and reference validation happen before webhook enrichment', async () => {
  const h = harness();
  const badSignature = signedWebhook(canonical()); badSignature.headers['x-paystack-signature'] = '0'.repeat(128);
  const invalid = response();
  await h.handlers.paystackWebhook(badSignature, invalid);
  assert.equal(invalid.code, 401);
  const sparse = { ...canonical(), reference: '../unsafe' }; delete sparse.requested_amount;
  const badReference = response();
  await h.handlers.paystackWebhook(signedWebhook(sparse), badReference);
  assert.equal(badReference.code, 400);
  assert.equal(h.verified.length, 0); assert.equal(h.processed.length, 0);
});

test('customer confirmation responds after payment processing without waiting for a slow receipt', async () => {
  const email = deferred(); const h = harness({ receipt: () => email.promise }); const res = response();
  const work = h.handlers.verifyPaymentHandler({ params: { reference: 'anj-fee-fixture' } }, res);
  await new Promise(setImmediate);
  assert.equal(h.processed.length, 1); assert.equal(h.emailed.length, 1);
  assert.equal(res.code, 200); assert.equal(res.body.success, true);
  assert.equal(res.body.data.amount, 152285); assert.equal(res.body.data.customer, undefined);
  email.resolve({ success: false }); await work;
  assert.equal(res.sends, 1); assert.equal(res.code, 200);
});

test('webhook acknowledges committed payment without waiting for receipt delivery', async () => {
  const email = deferred(); const h = harness({ receipt: () => email.promise }); const res = response();
  const work = h.handlers.paystackWebhook(signedWebhook(canonical()), res);
  await new Promise(setImmediate);
  assert.equal(h.processed.length, 1); assert.equal(h.emailed.length, 1); assert.equal(res.code, 200);
  email.resolve({ success: true }); await work;
  assert.equal(res.sends, 1);
});

test('failed payment commit never returns success or dispatches a receipt', async () => {
  const h = harness({ processPayment: async () => { throw new Error('Database transaction failed'); } });
  const callback = response(), webhook = response();
  await h.handlers.verifyPaymentHandler({ params: { reference: 'anj-fee-fixture' } }, callback);
  await h.handlers.paystackWebhook(signedWebhook(canonical()), webhook);
  assert.equal(callback.code, 500); assert.equal(callback.body.success, false);
  assert.equal(webhook.code, 500); assert.equal(h.emailed.length, 0);
});
