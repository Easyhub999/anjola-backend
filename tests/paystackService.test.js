const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(require.resolve('../services/paystackService'), 'utf8');
const callback = 'https://anjolaaestheticsng.com/shop';

// Execute the real service with an isolated environment and mocked HTTPS. No
// Paystack request, real credential or live transaction is used by these tests.
function service(env) {
  let captured;
  const https = {
    request(options, onResponse) {
      const req = new EventEmitter();
      captured = { options, body: '' };
      req.setTimeout = () => {};
      req.write = chunk => { captured.body += chunk; };
      req.end = () => {
        const res = new EventEmitter();
        onResponse(res);
        res.emit('data', JSON.stringify({ status: true, data: { authorization_url: 'https://checkout.paystack.com/test' } }));
        res.emit('end');
      };
      return req;
    }
  };
  const context = { exports: {}, require: name => {
    assert.equal(name, 'https');
    return https;
  }, process: { env } };
  vm.runInNewContext(source, context);
  return { initialize: context.exports.initializePayment, request: () => captured };
}

const configurations = [
  ['a stale localhost URL', 'http://localhost:3000'],
  ['a local network preview', 'http://192.168.0.164:3001'],
  ['the canonical origin', 'https://anjolaaestheticsng.com'],
  ['the www origin', 'https://www.anjolaaestheticsng.com'],
  ['a trailing slash', 'https://anjolaaestheticsng.com/'],
  ['a path, query and fragment', 'https://anjolaaestheticsng.com/checkout?local=1#test'],
  ['an external origin', 'https://example.com'],
  ['a malformed URL', 'not a URL'],
  ['an empty value', ''],
  ['a missing value', undefined]
];

for (const [name, frontendUrl] of configurations) {
  test(`payment initialization returns to the canonical shop with ${name}`, async () => {
    const api = service({ NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'sk_live_mock_only', FRONTEND_URL: frontendUrl });
    const metadata = { orderId: '507f1f77bcf86cd799439012', orderNumber: 'ANJ-test' };
    const result = await api.initialize('customer@example.com', 920000, metadata, 'anj-reference-123');
    const { options, body } = api.request();
    assert.deepEqual(JSON.parse(body), {
      email: 'customer@example.com', amount: 920000, metadata,
      reference: 'anj-reference-123', currency: 'NGN', callback_url: callback
    });
    assert.equal(options.hostname, 'api.paystack.co');
    assert.equal(options.path, '/transaction/initialize');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer sk_live_mock_only');
    assert.equal(result.status, true);
  });
}

for (const nodeEnv of ['development', 'test', 'production', undefined]) {
  for (const secretKey of ['sk_test_mock_only', 'sk_live_mock_only', undefined]) {
    test(`callback stays canonical with ${nodeEnv || 'unset'} environment and ${secretKey ? secretKey.split('_')[1] : 'unset'} key`, async () => {
      const api = service({ NODE_ENV: nodeEnv, PAYSTACK_SECRET_KEY: secretKey, FRONTEND_URL: 'http://localhost:3001' });
      await api.initialize('customer@example.com', 920000, {}, 'anj-reference-123');
      assert.equal(JSON.parse(api.request().body).callback_url, callback);
    });
  }
}
