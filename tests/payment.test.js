const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { priceOrder, SHIPPING_OPTIONS } = require('../services/orderPricing');
const { createPaymentProcessor } = require('../services/paymentProcessing');
const { createOrderStatusUpdater, changeStock } = require('../services/orderStatus');

const productId = '507f1f77bcf86cd799439011';
const orderId = '507f1f77bcf86cd799439012';
const product = () => ({ _id: productId, name: 'Tote', price: 1000, salesPrice: 800,
  quantity: 10, inStock: true, visible: true, autoHideWhenZero: true, sizes: [], colors: [], priceVariations: [] });
const customer = () => ({ fullName: 'Test Customer', email: 'test@example.com', phone: '08000000000',
  address: 'Test address', city: 'Lagos', state: 'Lagos', shippingMethodId: 'zone1' });
const request = () => ({ customerInfo: customer(), items: [{ product: productId, quantity: 2 }] });
const payment = () => ({ reference: 'anj-test', status: 'success', amount: 720000, currency: 'NGN',
  customer: { email: 'test@example.com' }, metadata: { orderId } });
const order = () => ({ _id: orderId, orderNumber: 'ANJ-test', customerInfo: customer(),
  pricingVersion: 1, expectedAmount: 720000, totalAmount: 7200, currency: 'NGN',
  paymentReference: 'anj-test', paymentStatus: 'pending', status: 'pending', stockDeducted: false,
  items: [{ product: productId, name: 'Tote', price: 800, quantity: 2 }] });

test('prices and shipping come from the server, not submitted item values', async () => {
  const body = request();
  Object.assign(body.items[0], { price: 1, name: 'Forged name', pricePerPiece: 1 });
  body.customerInfo.shippingCost = 0;
  const priced = await priceOrder(body, async () => product());
  assert.equal(priced.expectedAmount, 720000);
  assert.equal(priced.totalAmount, 7200);
  assert.equal(priced.items[0].price, 800);
  assert.equal(priced.items[0].name, 'Tote');
  assert.equal(priced.customerInfo.shippingCost, 5600);
});

test('rejects tampered totals instead of silently changing the payment amount', async () => {
  await assert.rejects(priceOrder({ ...request(), totalAmount: 1 }, async () => product()), /Prices have changed/);
});

test('pack price wins over single-item sale price', async () => {
  const p = product(); p.priceVariations = [{ pieces: 3, price: 2700 }];
  const body = request(); body.items[0].selectedPieces = 3;
  const priced = await priceOrder(body, async () => p);
  assert.equal(priced.items[0].price, 2700);
  assert.equal(priced.expectedAmount, 1100000);
});

test('accepts the existing frontend shipping label for backend-first deployment', async () => {
  const body = request(); delete body.customerInfo.shippingMethodId;
  body.customerInfo.shippingMethod = SHIPPING_OPTIONS[2].label;
  assert.equal((await priceOrder(body, async () => product())).totalAmount, 7200);
});

test('rejects empty carts, invalid quantities, unknown delivery and missing required options', async () => {
  for (const quantity of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER]) {
    const body = request(); body.items[0].quantity = quantity;
    await assert.rejects(priceOrder(body, async () => product()), /quantity/);
  }
  await assert.rejects(priceOrder({ ...request(), items: [] }, async () => product()), /cart/);
  const body = request(); body.customerInfo.shippingMethodId = 'free';
  await assert.rejects(priceOrder(body, async () => product()), /shipping/);
  await assert.rejects(priceOrder(request(), async () => ({ ...product(), sizes: ['M'] })), /size/);
  await assert.rejects(priceOrder(request(), async () => ({ ...product(), colors: [{ name: 'Pink', quantity: 3 }] })), /color/);
  await assert.rejects(priceOrder(request(), async () => ({ ...product(), priceVariations: [{ pieces: 3, price: 2700 }] })), /pack/);
});

test('duplicate cart lines cannot bypass aggregate stock checks', async () => {
  const body = request(); body.items = [body.items[0], { ...body.items[0] }];
  await assert.rejects(priceOrder(body, async () => ({ ...product(), quantity: 3 })), /stock/);
});

// This fake provides transaction isolation/rollback for unit tests, not a replacement for an Atlas integration test.
function database(initialOrder = order(), initialProducts = [product()]) {
  let state = { order: structuredClone(initialOrder), products: structuredClone(initialProducts) };
  let queue = Promise.resolve();
  let failSave = false;
  let writes = 0;
  const query = get => ({ session: async session => get(session) });
  const document = (value, session, isProduct) => {
    if (!value) return null;
    return Object.assign(structuredClone(value), {
      markModified(field) { assert.equal(field, 'colors'); },
      async save({ session: given }) {
        assert.equal(given, session);
        if (isProduct && failSave) { failSave = false; throw new Error('Simulated stock write failure'); }
        const data = Object.fromEntries(Object.entries(this).filter(([, v]) => typeof v !== 'function'));
        if (isProduct) { session.products[session.products.findIndex(p => p._id === data._id)] = data; writes++; }
        else session.order = data;
      }
    });
  };
  const deps = {
    Order: { findById: id => query(session => id === session.order._id ? document(session.order, session, false) : null) },
    Product: { findById: id => query(session => document(session.products.find(p => p._id === id), session, true)) },
    runTransaction: work => {
      const result = queue.then(async () => {
        const session = structuredClone(state);
        const value = await work(session);
        state = session;
        return value;
      });
      queue = result.catch(() => {});
      return result;
    }
  };
  return { deps, process: createPaymentProcessor(deps), state: () => state, writes: () => writes,
    failNextSave: () => { failSave = true; } };
}

test('underpayment, overpayment, currency, reference and customer mismatches do not fulfill', async () => {
  for (const change of [{ amount: 1 }, { amount: 720001 }, { currency: 'USD' }, { reference: 'other' },
    { customer: { email: 'other@example.com' } }, { status: 'failed' }, { metadata: {} }]) {
    const db = database();
    await assert.rejects(db.process({ ...payment(), ...change }));
    assert.equal(db.state().order.paymentStatus, 'pending');
    assert.equal(db.state().products[0].quantity, 10);
    assert.equal(db.writes(), 0);
  }
});

const feeOrder = () => ({ ...order(), expectedAmount: 150000, totalAmount: 1500,
  items: [{ product: productId, name: 'Tote', price: 1500, quantity: 1 }] });
const feePayment = () => ({ ...payment(), amount: 152285, requested_amount: 150000, fees: 2284 });

test('provider-confirmed customer fees accept exact fees and one kobo gross-up rounding', async () => {
  for (const fees of [2284, 2285]) {
    const db = database(feeOrder());
    const result = await db.process({ ...feePayment(), fees });
    assert.equal(result.newlyPaid, true);
    assert.equal(db.state().order.paymentStatus, 'paid');
    assert.equal(db.state().order.expectedAmount, 150000);
    assert.equal(db.state().order.totalAmount, 1500);
    assert.equal(db.state().products[0].quantity, 9);
    assert.equal(db.writes(), 1);
  }
});

test('exact payments retain compatibility with absent, null and matching requested amounts', async () => {
  for (const requested_amount of [undefined, null, 720000]) {
    const db = database();
    await db.process({ ...payment(), requested_amount, fees: 1000 });
    assert.equal(db.state().order.paymentStatus, 'paid');
    assert.equal(db.state().products[0].quantity, 8);
  }
});

test('malformed, underpaid and unexplained excess payments leave order and inventory unchanged', async () => {
  const rejected = [
    { amount: 149999, fees: 1 },
    { amount: 150001, fees: 0 },
    { amount: 152286 }, // More than one kobo beyond the verified fee.
    { amount: 500000 },
    { requested_amount: undefined }, { requested_amount: null },
    { requested_amount: 149999 }, { requested_amount: 150001 },
    { requested_amount: '150000' }, { requested_amount: 150000.5 },
    { requested_amount: NaN }, { requested_amount: Infinity },
    { requested_amount: Number.MAX_SAFE_INTEGER + 1 },
    { fees: undefined }, { fees: null }, { fees: 0 }, { fees: -1 },
    { fees: 2283 }, { fees: 2286 }, { fees: '2285' }, { fees: 2284.5 },
    { fees: NaN }, { fees: Infinity }, { fees: Number.MAX_SAFE_INTEGER + 1 },
    { amount: '152285' }, { amount: 152285.5 }, { amount: NaN },
    { amount: Infinity }, { amount: 0 }, { amount: -1 },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { currency: 'USD' }, { reference: 'wrong-reference' },
    { customer: { email: 'wrong@example.com' } }, { status: 'failed' }, { metadata: {} }
  ];
  for (const change of rejected) {
    const db = database(feeOrder());
    const before = structuredClone(db.state());
    await assert.rejects(db.process({ ...feePayment(), ...change }));
    assert.deepEqual(db.state(), before);
    assert.equal(db.writes(), 0);
  }
});

test('a supplied requested amount must also match when the collected amount is exact', async () => {
  for (const requested_amount of [719999, 720001, '720000', 720000.5, NaN, 0, false]) {
    const db = database();
    const before = structuredClone(db.state());
    await assert.rejects(db.process({ ...payment(), requested_amount }), /requested amount/);
    assert.deepEqual(db.state(), before);
    assert.equal(db.writes(), 0);
  }
});

test('fee-inclusive verification retries deduct once and preserve later fulfillment status', async () => {
  const db = database(feeOrder());
  const results = await Promise.all([db.process(feePayment()), db.process(feePayment()), db.process(feePayment())]);
  assert.equal(results.filter(result => result.newlyPaid).length, 1);
  assert.equal(db.writes(), 1);
  assert.equal(db.state().products[0].quantity, 9);
  const shipped = database({ ...feeOrder(), paymentStatus: 'paid', status: 'shipped', stockDeducted: true });
  assert.equal((await shipped.process(feePayment())).newlyPaid, false);
  assert.equal(shipped.state().order.status, 'shipped');
  assert.equal(shipped.writes(), 0);
});

test('parallel webhook and callback processing only fulfill once', async () => {
  const db = database();
  const results = await Promise.all([db.process(payment()), db.process(payment()), db.process(payment())]);
  assert.equal(results.filter(r => r.newlyPaid).length, 1);
  assert.equal(db.writes(), 1);
  assert.equal(db.state().products[0].quantity, 8);
  assert.equal(db.state().order.paymentStatus, 'paid');
});

test('repeat verification preserves shipped status and stock', async () => {
  const db = database({ ...order(), paymentStatus: 'paid', status: 'shipped', stockDeducted: true });
  assert.equal((await db.process(payment())).newlyPaid, false);
  assert.equal(db.state().order.status, 'shipped');
  assert.equal(db.writes(), 0);
});

test('stock failure rolls back payment and can be retried safely', async () => {
  const db = database(); db.failNextSave();
  await assert.rejects(db.process(payment()), /stock write failure/);
  assert.equal(db.state().order.paymentStatus, 'pending');
  assert.equal(db.state().products[0].quantity, 10);
  await db.process(payment());
  assert.equal(db.state().products[0].quantity, 8);
});

test('color stock is deducted and included in persistence', async () => {
  const o = order(); o.items[0].selectedColor = 'Pink';
  const db = database(o, [{ ...product(), colors: [{ name: 'Pink', quantity: 4 }] }]);
  await db.process(payment());
  assert.equal(db.state().products[0].colors[0].quantity, 2);
});

test('stock shortage records the payment for review without partial stock deductions', async () => {
  const o = order(); o.items.push({ ...o.items[0], quantity: 9 });
  const db = database(o);
  const result = await db.process(payment());
  assert.equal(result.order.paymentStatus, 'paid');
  assert.match(result.order.paymentReviewReason, /stock/);
  assert.equal(result.order.stockDeducted, false);
  assert.equal(db.state().products[0].quantity, 10);
  assert.equal(db.writes(), 0);
  assert.equal((await db.process(payment())).newlyPaid, false);
});

test('late payment on a cancelled order is recorded for review, not shipped', async () => {
  const db = database({ ...order(), status: 'cancelled' });
  await db.process(payment());
  assert.equal(db.state().order.paymentStatus, 'paid');
  assert.equal(db.state().order.status, 'cancelled');
  assert.match(db.state().order.paymentReviewReason, /cancelled/);
  assert.equal(db.writes(), 0);
});

test('untrusted legacy unpaid orders cannot be fulfilled', async () => {
  const old = order(); delete old.pricingVersion;
  const db = database(old);
  await assert.rejects(db.process(payment()), /older order/);
  assert.equal(db.writes(), 0);
});

function controller(overrides = {}, initialOrder = order()) {
  const db = database(initialOrder);
  let emails = 0;
  const dependencies = {
    '../models/Order': db.deps.Order,
    '../models/Product': db.deps.Product,
    '../services/paystackService': { verifyPayment: async () => ({ status: true, data: payment() }) },
    '../services/emailService': { sendPaymentConfirmation: async () => { emails++; return { success: true }; } },
    mongoose: { connection: { transaction: db.deps.runTransaction } },
    ...overrides
  };
  const context = { exports: {}, require: name => dependencies[name] || require(name),
    console: { error() {}, log() {} }, process: { env: { PAYSTACK_SECRET_KEY: 'test-secret' } }, Buffer };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/orderController'), 'utf8'), context);
  return { handlers: context.exports, db, emails: () => emails };
}
function response() {
  return { code: 200, body: null, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, sendStatus(code) { this.code = code; return this; } };
}

test('initialization ignores client amount, email and metadata', async () => {
  let sent;
  const o = order();
  const c = controller({
    '../models/Order': { findById: () => ({ select: async () => o }), updateOne: async () => {} },
    '../services/paystackService': { initializePayment: async (...args) => {
      sent = args; return { status: true, data: { reference: o.paymentReference, authorization_url: 'https://checkout.paystack.com/test' } };
    } }
  });
  const res = response();
  await c.handlers.initializePaymentHandler({ body: { orderId, amount: 1, email: 'attacker@example.com', customerInfo: {} } }, res);
  assert.equal(res.code, 200);
  assert.equal(sent[0], 'test@example.com');
  assert.equal(sent[1], 720000);
  assert.equal(sent[2].orderId, orderId);
  assert.equal(sent[3], 'anj-test');
});

test('webhook signs raw bytes and shares processing with the verification callback', async () => {
  const c = controller();
  const body = { event: 'charge.success', data: payment() };
  const rawBody = Buffer.from(JSON.stringify(body, null, 2));
  const signature = crypto.createHmac('sha512', 'test-secret').update(rawBody).digest('hex');
  const webhook = response(); const callback = response();
  await Promise.all([
    c.handlers.paystackWebhook({ body, rawBody, headers: { 'x-paystack-signature': signature } }, webhook),
    c.handlers.verifyPaymentHandler({ params: { reference: 'anj-test' } }, callback)
  ]);
  assert.equal(webhook.code, 200); assert.equal(callback.code, 200);
  assert.equal(c.emails(), 1); assert.equal(c.db.writes(), 1);
  assert.equal(callback.body.data.amount, 720000);
  assert.equal(callback.body.data.customer, undefined);
});

for (const sparseWebhook of [false, true]) {
test(`signed customer-fee webhook (${sparseWebhook ? 'enriched' : 'complete'}) and callback share one fulfillment`, async () => {
  const verified = feePayment();
  const c = controller({
    '../services/paystackService': { verifyPayment: async () => ({ status: true, data: verified }) }
  }, feeOrder());
  const webhookData = { ...verified };
  if (sparseWebhook) delete webhookData.requested_amount;
  const body = { event: 'charge.success', data: webhookData };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac('sha512', 'test-secret').update(rawBody).digest('hex');
  const webhook = response(); const callback = response();
  await Promise.all([
    c.handlers.paystackWebhook({ body, rawBody, headers: { 'x-paystack-signature': signature } }, webhook),
    c.handlers.verifyPaymentHandler({ params: { reference: verified.reference } }, callback)
  ]);
  assert.equal(webhook.code, 200); assert.equal(callback.code, 200);
  assert.equal(c.emails(), 1); assert.equal(c.db.writes(), 1);
  assert.equal(c.db.state().products[0].quantity, 9);
  assert.equal(callback.body.data.amount, 152285);
  assert.equal(callback.body.data.needsReview, false);
  assert.equal(callback.body.data.customer, undefined);
});
}

test('invalid webhook signatures cannot change an order', async () => {
  const c = controller(); const res = response();
  await c.handlers.paystackWebhook({ body: { event: 'charge.success', data: payment() }, rawBody: Buffer.from('{}'),
    headers: { 'x-paystack-signature': '0'.repeat(128) } }, res);
  assert.equal(res.code, 401); assert.equal(c.db.writes(), 0); assert.equal(c.emails(), 0);
});

test('paid legacy orders are not deducted again when their original reference is revisited', async () => {
  const old = { ...order(), paymentStatus: 'paid', status: 'delivered' }; delete old.pricingVersion;
  const db = database(old);
  assert.equal((await db.process(payment())).newlyPaid, false);
  assert.equal(db.state().order.status, 'delivered');
  assert.equal(db.writes(), 0);
});

test('reinitialization reuses the existing payment URL without a second Paystack request', async () => {
  const o = { ...order(), paymentAuthorizationUrl: 'https://checkout.paystack.com/existing' };
  const c = controller({
    '../models/Order': { findById: () => ({ select: async () => o }) },
    '../services/paystackService': { initializePayment: async () => { assert.fail('Unexpected second initialization'); } }
  });
  const res = response();
  await c.handlers.initializePaymentHandler({ body: { orderId } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.data.authorization_url, o.paymentAuthorizationUrl);
});

test('malformed inventory fails closed rather than allowing unbounded stock', async () => {
  await assert.rejects(priceOrder(request(), async () => ({ ...product(), quantity: NaN })), /unavailable/);
  const o = order(); o.items[0].selectedColor = 'Pink';
  const db = database(o, [{ ...product(), colors: [{ name: 'Pink' }] }]);
  await db.process(payment());
  assert.equal(db.state().order.stockDeducted, false);
  assert.match(db.state().order.paymentReviewReason, /color/);
});

test('payment email recognizes provider error responses instead of claiming success', async () => {
  let providerResult = { data: null, error: { message: 'Provider rejected email' } };
  const context = { exports: {}, module: {}, process: { env: {} }, console: { log() {}, error() {} },
    require: () => ({ Resend: class { constructor() { this.emails = { send: async () => providerResult }; } } }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/emailService'), 'utf8'), context);
  const result = await context.exports.sendPaymentConfirmation(order());
  assert.equal(result.success, false);
  providerResult = { data: { id: 'email-test' }, error: null };
  const success = await context.exports.sendPaymentConfirmation(order());
  assert.equal(success.success, true);
  assert.equal(success.messageId, 'email-test');
});

test('concurrent cancellations restore paid stock exactly once', async () => {
  const db = database({ ...order(), paymentStatus: 'paid', status: 'processing', stockDeducted: true }, [{ ...product(), quantity: 8 }]);
  const update = createOrderStatusUpdater(db.deps);
  const results = await Promise.all([update(orderId, 'cancelled'), update(orderId, 'cancelled')]);
  assert.equal(results.filter(r => r.changed).length, 1);
  assert.equal(db.state().products[0].quantity, 10);
  assert.equal(db.state().order.stockDeducted, false);
  assert.equal(db.state().order.status, 'cancelled');
  assert.equal(db.writes(), 1);
});

test('cancelling an unpaid or stock-review order never creates inventory', async () => {
  for (const paid of [false, true]) {
    const db = database({ ...order(), paymentStatus: paid ? 'paid' : 'pending', stockDeducted: false });
    await createOrderStatusUpdater(db.deps)(orderId, 'cancelled');
    assert.equal(db.state().products[0].quantity, 10);
    assert.equal(db.writes(), 0);
  }
});

test('legacy paid orders are cancelled with an inventory review notice instead of guessing', async () => {
  const old = { ...order(), paymentStatus: 'paid', status: 'processing' }; delete old.stockDeducted;
  const db = database(old);
  await createOrderStatusUpdater(db.deps)(orderId, 'cancelled');
  assert.match(db.state().order.inventoryReviewReason, /history is unknown/);
  assert.equal(db.writes(), 0);
});

test('failed restoration rolls back cancellation and a retry restores once', async () => {
  const db = database({ ...order(), paymentStatus: 'paid', status: 'processing', stockDeducted: true }, [{ ...product(), quantity: 8 }]);
  const update = createOrderStatusUpdater(db.deps); db.failNextSave();
  await assert.rejects(update(orderId, 'cancelled'), /stock write failure/);
  assert.equal(db.state().order.status, 'processing');
  assert.equal(db.state().products[0].quantity, 8);
  await update(orderId, 'cancelled');
  assert.equal(db.state().products[0].quantity, 10);
});

test('restores the selected color and preserves intentionally hidden products', async () => {
  const o = { ...order(), paymentStatus: 'paid', status: 'processing', stockDeducted: true };
  o.items[0].selectedColor = 'Pink';
  const db = database(o, [{ ...product(), quantity: 8, visible: false, colors: [{ name: 'Pink', quantity: 2 }, { name: 'Blue', quantity: 6 }] }]);
  await createOrderStatusUpdater(db.deps)(orderId, 'cancelled');
  const p = db.state().products[0];
  assert.equal(p.colors[0].quantity, 4); assert.equal(p.colors[1].quantity, 6);
  assert.equal(p.quantity, 10); assert.equal(p.visible, false);
});

test('restocking a product hidden automatically makes it visible again', async () => {
  const db = database({ ...order(), paymentStatus: 'paid', stockDeducted: true }, [{ ...product(), quantity: 0, visible: false, inventoryAutoHidden: true }]);
  await createOrderStatusUpdater(db.deps)(orderId, 'cancelled');
  assert.equal(db.state().products[0].visible, true);
  assert.equal(db.state().products[0].inventoryAutoHidden, false);
});

test('missing products or removed colors do not produce partial restoration', async () => {
  for (const products of [[], [{ ...product(), colors: [] }]]) {
    const o = { ...order(), paymentStatus: 'paid', stockDeducted: true }; o.items[0].selectedColor = 'Removed';
    const db = database(o, products);
    await assert.rejects(createOrderStatusUpdater(db.deps)(orderId, 'cancelled'));
    assert.equal(db.state().order.status, 'pending');
    assert.equal(db.writes(), 0);
  }
});

test('cancelled orders cannot be reopened and invalid statuses are rejected', async () => {
  const db = database({ ...order(), status: 'cancelled' });
  const update = createOrderStatusUpdater(db.deps);
  await assert.rejects(update(orderId, 'processing'), /Cannot change/);
  await assert.rejects(update(orderId, 'invalid'), /Invalid order status/);
  assert.equal(db.writes(), 0);
});

test('payment and cancellation racing never double-restore or fulfill a cancelled order', async () => {
  for (const paymentFirst of [true, false]) {
    const db = database(); const update = createOrderStatusUpdater(db.deps);
    await Promise.all(paymentFirst ? [db.process(payment()), update(orderId, 'cancelled')] : [update(orderId, 'cancelled'), db.process(payment())]);
    assert.equal(db.state().products[0].quantity, 10);
    assert.equal(db.state().order.status, 'cancelled');
    assert.equal(db.state().order.paymentStatus, 'paid');
    assert.equal(db.state().order.stockDeducted, false);
  }
});

test('manual stock deductions reject shortages and are transaction-bound', async () => {
  const db = database();
  await assert.rejects(db.deps.runTransaction(session => changeStock([{ product: productId, quantity: 11 }], -1, db.deps.Product, session)), /Insufficient stock/);
  assert.equal(db.state().products[0].quantity, 10);
  await db.deps.runTransaction(session => changeStock(order().items, -1, db.deps.Product, session));
  assert.equal(db.state().products[0].quantity, 8);
});

test('gift details survive pricing and the order schema, with a bounded message', async () => {
  const body = request(); body.customerInfo.isGift = true; body.customerInfo.giftMessage = '  Happy birthday!  ';
  const priced = await priceOrder(body, async () => product());
  const OrderModel = require('../models/Order');
  const saved = new OrderModel({ ...priced, orderNumber: 'gift-test' }).toObject();
  assert.equal(saved.customerInfo.isGift, true);
  assert.equal(saved.customerInfo.giftMessage, 'Happy birthday!');
  body.customerInfo.giftMessage = 'x'.repeat(501);
  await assert.rejects(priceOrder(body, async () => product()), /500 characters/);
  body.customerInfo.giftMessage = 'discard'; body.customerInfo.isGift = false;
  assert.equal((await priceOrder(body, async () => product())).customerInfo.giftMessage, '');
});

test('new orders use the authenticated identity, never a submitted user ID or email match', async () => {
  for (const user of [undefined, { _id: '507f1f77bcf86cd799439099' }]) {
    let created;
    const c = controller({
      '../models/Product': { findById: async () => product() },
      '../models/Order': { create: async value => { created = value; return value; } }
    });
    const res = response();
    await c.handlers.createOrder({ body: { ...request(), user: 'forged-user' }, user }, res);
    assert.equal(res.code, 201);
    assert.equal(created.user, user?._id || null);
  }
});

test('shipping saves tracking, corrections persist, and repeats send no new notification', async () => {
  const db = database({ ...order(), paymentStatus: 'paid', status: 'processing', stockDeducted: true });
  const update = createOrderStatusUpdater(db.deps);
  await update(orderId, 'shipped', ' TRACK-123 ');
  assert.equal(db.state().order.trackingNumber, 'TRACK-123');
  assert.equal((await update(orderId, 'shipped', 'TRACK-123')).changed, false);
  assert.equal((await update(orderId, 'shipped', 'TRACK-456')).changed, true);
  assert.equal(db.state().order.trackingNumber, 'TRACK-456');
  await assert.rejects(update(orderId, 'shipped', 'x'.repeat(201)), /Invalid tracking/);
  await assert.rejects(update(orderId, 'shipped', '<b>bad</b>'), /Invalid tracking/);
  assert.equal(db.writes(), 0);
});

test('shipping notification receives the saved tracking number', async () => {
  const db = database({ ...order(), paymentStatus: 'paid', status: 'processing' });
  const notifications = [];
  const c = controller({
    '../models/Order': db.deps.Order, '../models/Product': db.deps.Product,
    mongoose: { connection: { transaction: db.deps.runTransaction } },
    '../services/emailService': { sendShippedNotification: async value => notifications.push(value.trackingNumber) }
  });
  for (let i = 0; i < 2; i++) {
    const res = response();
    await c.handlers.updateOrderStatus({ params: { id: orderId }, body: { status: 'shipped', trackingNumber: 'SHIP-123' } }, res);
    assert.equal(res.code, 200);
  }
  assert.deepEqual(notifications, ['SHIP-123']);
});

test('packs reserve pieces across duplicate lines and reject insufficient color pieces', async () => {
  const p = { ...product(), priceVariations: [{ pieces: 3, price: 2700 }], colors: [{ name: 'Pink', quantity: 5 }] };
  const body = request(); Object.assign(body.items[0], { selectedPieces: 3, selectedColor: 'Pink' });
  await assert.rejects(priceOrder(body, async () => p), /stock/);
  p.colors[0].quantity = 10;
  const priced = await priceOrder(body, async () => p);
  assert.equal(priced.items[0].stockQuantity, 6);
  body.items.push({ ...body.items[0] });
  await assert.rejects(priceOrder(body, async () => p), /stock/);
});

test('new packs deduct and restore exact pieces once while old packs retain their original units', async () => {
  for (const stockQuantity of [undefined, 6]) {
    const o = order(); Object.assign(o.items[0], { selectedPieces: 3, selectedColor: 'Pink', stockQuantity });
    const p = { ...product(), colors: [{ name: 'Pink', quantity: 10 }] };
    const db = database(o, [p]);
    await db.process(payment()); await db.process(payment());
    const expected = stockQuantity ?? 2;
    assert.equal(db.state().products[0].quantity, 10 - expected);
    assert.equal(db.state().products[0].colors[0].quantity, 10 - expected);
    const cancel = createOrderStatusUpdater(db.deps);
    await cancel(orderId, 'cancelled'); await cancel(orderId, 'cancelled');
    assert.equal(db.state().products[0].quantity, 10);
    assert.equal(db.state().products[0].colors[0].quantity, 10);
  }
});

test('paid packs with too few pieces enter review without changing stock', async () => {
  const o = order(); o.items[0].stockQuantity = 12;
  const db = database(o);
  await db.process(payment());
  assert.equal(db.state().products[0].quantity, 10);
  assert.equal(db.state().order.stockDeducted, false);
  assert.match(db.state().order.paymentReviewReason, /stock/);
});

test('manual pricing validates variants and preserves explicit shipping charges', async () => {
  const body = request(); body.customerInfo.shippingCost = 1500;
  const p = { ...product(), sizes: ['M'], priceVariations: [{ pieces: 3, price: 2700 }] };
  await assert.rejects(priceOrder(body, async () => p, true), /size/);
  Object.assign(body.items[0], { selectedSize: 'M', selectedPieces: 3, stockQuantity: 1 });
  const priced = await priceOrder(body, async () => p, true);
  assert.equal(priced.totalAmount, 6900);
  assert.equal(priced.items[0].stockQuantity, 6);
  const db = database(order(), [p]);
  await db.deps.runTransaction(session => changeStock(priced.items, -1, db.deps.Product, session));
  assert.equal(db.state().products[0].quantity, 4);
});

test('gift packaging adds a server-owned fee once per order, not per item or pack', async () => {
  const body = request();
  body.customerInfo.isGift = true;
  body.customerInfo.giftPackagingFee = 1;
  body.giftPackagingFee = 0;
  body.items = [{ product: productId, quantity: 2, selectedPieces: 3 }, { product: productId, quantity: 1, selectedPieces: 3 }];
  const priced = await priceOrder(body, async () => ({ ...product(), priceVariations: [{ pieces: 3, price: 2700 }] }));
  assert.equal(priced.customerInfo.giftPackagingFee, 2000);
  assert.equal(priced.totalAmount, 8100 + 5600 + 2000);
  assert.equal(priced.expectedAmount, 1570000);
  assert.equal(priced.items.reduce((sum, item) => sum + item.stockQuantity, 0), 9);
});

test('ordinary orders do not pay gift packaging even when a client submits a fee or message', async () => {
  for (const isGift of [undefined, false]) {
    const body = request();
    Object.assign(body.customerInfo, { isGift, giftPackagingFee: 2000, giftMessage: 'Leftover message' });
    const priced = await priceOrder(body, async () => product());
    assert.equal(priced.customerInfo.giftPackagingFee, 0);
    assert.equal(priced.customerInfo.giftMessage, '');
    assert.equal(priced.totalAmount, 7200);
  }
});

test('gift checkout rejects stale fee-free totals and accepts the amount shown by the new checkout', async () => {
  const body = request(); body.customerInfo.isGift = true;
  await assert.rejects(priceOrder({ ...body, totalAmount: 7200 }, async () => product()), error => error.statusCode === 409);
  const priced = await priceOrder({ ...body, totalAmount: 9200 }, async () => product());
  assert.equal(priced.expectedAmount, 920000);
  body.customerInfo.isGift = 'true';
  await assert.rejects(priceOrder(body, async () => product()), /Invalid gift selection/);
});

test('gift charges persist for new orders without changing historical order charges', async () => {
  const OrderModel = require('../models/Order');
  const body = request(); body.customerInfo.isGift = true;
  const priced = await priceOrder(body, async () => product());
  const saved = new OrderModel({ ...priced, orderNumber: 'gift-charge-test' }).toObject();
  assert.equal(saved.customerInfo.giftPackagingFee, 2000);
  assert.equal(saved.totalAmount, 9200);
  const historical = new OrderModel({ ...order(), customerInfo: { ...customer(), isGift: true } }).toObject();
  assert.equal(historical.customerInfo.giftPackagingFee, undefined);
  assert.equal(historical.totalAmount, 7200);
  const db = database({ ...order(), customerInfo: { ...customer(), isGift: true } });
  await db.process(payment());
  assert.equal(db.state().order.totalAmount, 7200);
  assert.equal(db.state().order.customerInfo.giftPackagingFee, undefined);
});

test('manual gift orders use the same fixed packaging fee', async () => {
  const body = request(); Object.assign(body.customerInfo, { isGift: true, shippingCost: 1500, giftPackagingFee: 0 });
  const priced = await priceOrder({ ...body, totalAmount: 5100 }, async () => product(), true);
  assert.equal(priced.customerInfo.giftPackagingFee, 2000);
  assert.equal(priced.totalAmount, 5100);
});

test('payment initialization and verification include the saved packaging fee', async () => {
  const body = request(); body.customerInfo.isGift = true;
  const priced = await priceOrder(body, async () => product());
  const saved = { ...order(), ...priced };
  let sent;
  const c = controller({
    '../models/Order': { findById: () => ({ select: async () => saved }), updateOne: async () => {} },
    '../services/paystackService': { initializePayment: async (...args) => {
      sent = args; return { status: true, data: { reference: saved.paymentReference, authorization_url: 'https://checkout.paystack.com/test' } };
    } }
  });
  const res = response();
  await c.handlers.initializePaymentHandler({ body: { orderId, amount: 720000 } }, res);
  assert.equal(res.code, 200);
  assert.equal(sent[1], 920000);
  const db = database(saved);
  await assert.rejects(db.process(payment()), /amount or currency/);
  assert.equal(db.writes(), 0);
  await db.process({ ...payment(), amount: 920000 });
  assert.equal(db.state().order.paymentStatus, 'paid');
  assert.equal(db.state().products[0].quantity, 8);
});

test('receipt emails list saved packaging fees and never infer them for old gift orders', async () => {
  let sent;
  const context = { exports: {}, module: {}, process: { env: {} }, console: { log() {}, error() {} },
    require: () => ({ Resend: class { constructor() { this.emails = { send: async message => { sent = message; return { data: { id: 'test-email' }, error: null }; } }; } } }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/emailService'), 'utf8'), context);
  for (const name of ['sendOrderConfirmation', 'sendPaymentConfirmation', 'sendShippedNotification', 'sendDeliveredNotification', 'sendCancelledNotification']) {
    await context.exports[name]({ ...order(), totalAmount: 9200, customerInfo: { ...customer(), isGift: true, giftPackagingFee: 2000, shippingCost: 5600 } });
    assert.match(sent.html, /Gift packaging/);
    assert.match(sent.html, /₦2,000/);
    assert.match(sent.html, /₦9,200/);
    await context.exports[name]({ ...order(), customerInfo: { ...customer(), isGift: true } });
    assert.match(sent.html, /Not recorded/);
    assert.doesNotMatch(sent.html, /₦2,000/);
    await context.exports[name]({ ...order(), customerInfo: { ...customer(), isGift: false, giftPackagingFee: 0 } });
    assert.doesNotMatch(sent.html, /Gift packaging/);
  }
});
