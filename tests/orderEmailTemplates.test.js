const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { renderOrderEmail } = require('../services/orderEmailTemplates');

const types = ['order_confirmation', 'payment_confirmation', 'payment_review', 'shipped', 'delivered', 'cancelled'];
const storefront = 'https://www.anjolaaestheticsng.com';
const supportEmail = 'anjolaaestheticsng@gmail.com';
const whatsapp = 'https://wa.me/2347065943625';

const order = (changes = {}) => ({
  orderNumber: 'ANJ-EMAIL-123',
  status: 'processing',
  paymentStatus: 'paid',
  notificationYear: 2026,
  createdAt: '2026-10-20T12:00:00.000Z',
  customerInfo: {
    fullName: 'Ada Customer',
    email: 'ada@example.com',
    address: '12 Test Road',
    city: 'Abeokuta',
    state: 'Ogun',
    phone: '08000000000',
    shippingMethod: 'Doorstep delivery',
    shippingCost: 1500
  },
  items: [{
    name: 'Everyday Tote',
    quantity: 2,
    price: 4500,
    selectedSize: 'Large',
    selectedColor: 'Blush',
    selectedPieces: 3,
    pricePerPiece: 1500
  }],
  totalAmount: 10500,
  paymentReference: 'PAY-EMAIL-123',
  trackingNumber: 'TRACK-EMAIL-123',
  ...changes
});

// 2 × ₦4,500 + ₦5,600 shipping + ₦2,000 gift packaging: every figure differs.
const gift = (changes = {}) => order({
  items: [{ name: 'Everyday Tote', quantity: 2, price: 4500, selectedColor: 'Blush' }],
  customerInfo: { ...order().customerInfo, shippingMethod: 'Lagos, Akure, Ado-Ekiti, Ibadan, Ogbomosho, Oshogbo, Ota, Ilorin',
    shippingCost: 5600, isGift: true, giftPackagingFee: 2000 },
  totalAmount: 16600,
  ...changes
});

// Read visible table text without tying the tests to a particular layout.
const visible = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const hrefs = html => [...html.matchAll(/\bhref=(["'])(.*?)\1/g)].map(match =>
  match[2].replace(/&amp;/g, '&'));
const buttons = html => [...html.matchAll(/<a class="email-button" href="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
  .map(match => ({ href: match[1].replace(/&amp;/g, '&'), label: match[2] }));
const textOf = (html, pattern) => html.match(pattern)?.[1];
const preheaderOf = html => textOf(html, /<div style="display:none[^>]*>([^<&]*)/);

test('every order email has a readable plain-text alternative and fixed brand support links', () => {
  for (const type of types) {
    const message = renderOrderEmail(type, order());
    assert.match(message.subject, /ANJ-EMAIL-123/, type);
    assert.match(message.html, /Anjola/, type);
    assert.match(message.text, /ANJ-EMAIL-123/, type);
    assert.match(message.text, /Everyday Tote/, type);
    assert.equal(message.replyTo, supportEmail, type);
    const links = hrefs(message.html);
    for (const expected of [
      `${storefront}/shipping-policy`, `${storefront}/returns-policy`,
      `mailto:${supportEmail}`
    ]) assert(links.includes(expected), `${type}: missing ${expected}`);
    assert(links.some(link => link === storefront || link === `${storefront}/` ||
      link === `${storefront}/shop`), `${type}: missing storefront link`);
    assert.match(message.html, new RegExp(`src="${storefront}/apple-touch-icon\\.png"`), `${type}: logo must be a real PNG without a redirect`);
    assert.doesNotMatch(message.text, /<\/?(?:table|tr|td|div|span|p)\b/i, type);
  }
});

test('each email uses its approved subject, preview text, heading, status label, stage and single button', () => {
  const cases = [
    { type: 'order_confirmation', changes: { status: 'pending', paymentStatus: 'pending' },
      subject: 'Order received — your Anjola order #ANJ-EMAIL-123', preheader: 'Thank you for your order. Here’s what happens next.',
      label: 'ORDER RECEIVED · AWAITING PAYMENT', title: 'Order received.', subtitle: 'Thank you for choosing a little joy.',
      next: 'Paid', button: 'Get help with this order' },
    { type: 'payment_confirmation', changes: {},
      subject: 'Payment received — your Anjola order #ANJ-EMAIL-123', preheader: 'Thank you. We’re preparing your order with care.',
      label: 'PAID · PREPARING YOUR ORDER', title: 'Payment received.', subtitle: 'A little joy is in the making.',
      stage: 'Preparing', button: 'Get help with this order' },
    { type: 'payment_review', changes: { status: 'pending' },
      subject: 'Payment received — order #ANJ-EMAIL-123 under review',
      preheader: 'Payment received—we’re reviewing your order. Please do not make another payment.',
      label: 'PAYMENT RECEIVED · ORDER UNDER REVIEW', title: 'Payment received.', subtitle: 'We’re reviewing your order.',
      button: 'Get help with this order' },
    { type: 'shipped', changes: { status: 'shipped' },
      subject: 'Your Anjola order #ANJ-EMAIL-123 is on its way', preheader: 'Your parcel has been dispatched. Here are the delivery details.',
      label: 'ORDER SHIPPED', title: 'Your order is on its way.', stage: 'Shipped', button: 'Get delivery help' },
    { type: 'delivered', changes: { status: 'delivered' },
      subject: 'Delivery update — Anjola order #ANJ-EMAIL-123', preheader: 'Your order has been marked as delivered.',
      label: 'ORDER MARKED AS DELIVERED', title: 'A little joy, delivered.', stage: 'Delivered',
      button: 'Explore the collection', href: `${storefront}/shop` },
    { type: 'cancelled', changes: { status: 'cancelled', paymentStatus: 'pending' },
      subject: 'Order cancelled — Anjola order #ANJ-EMAIL-123', preheader: 'Your order has been cancelled. Here are the details.',
      label: 'ORDER CANCELLED', title: 'Your order has been cancelled.', button: 'Get help with this order' }
  ];
  for (const expected of cases) {
    const { type } = expected;
    const message = renderOrderEmail(type, order(expected.changes));
    assert.equal(message.subject, expected.subject, type);
    assert.equal(preheaderOf(message.html), expected.preheader, type);
    assert.equal(textOf(message.html, /class="status-label"[^>]*>([^<]*)</), expected.label, type);
    assert.equal(textOf(message.html, /<h1[^>]*>([^<]*)<\/h1>/), expected.title, type);
    assert.equal(textOf(message.html, /class="email-subtitle"[^>]*>([^<]*)</), expected.subtitle, type);
    assert.equal(textOf(message.html, />(Paid|Preparing|Shipped|Delivered)<br><span[^>]*>Current stage</), expected.stage, type);
    assert.equal(textOf(message.html, />(Paid|Preparing|Shipped|Delivered)<br><span[^>]*>Next step</), expected.next, type);
    const cta = buttons(message.html);
    assert.equal(cta.length, 1, `${type}: exactly one prominent button`);
    assert.equal(cta[0].label, expected.button, type);
    if (expected.href) assert.equal(cta[0].href, expected.href, type);
    else assert(cta[0].href.startsWith(`${whatsapp}?text=`), type);
    assert.doesNotMatch(message.html, /Track parcel/i, type);
    assert(message.text.includes(expected.title), type);
  }
});

test('amounts are exact in the payment intro, receipt rows and highlighted total', () => {
  const message = renderOrderEmail('payment_confirmation', gift());
  const body = visible(message.html);
  assert(body.includes('We’ve received your payment of ₦16,600 for order #ANJ-EMAIL-123. We’re preparing your items and will email you when they’re on their way.'));
  assert(body.includes('2 items × ₦4,500 each'));
  for (const row of ['Items subtotal ₦9,000', 'Shipping ₦5,600', 'Gift packaging ₦2,000', 'Total paid ₦16,600']) assert(body.includes(row), row);
  for (const row of ['Items subtotal: ₦9,000', 'Shipping: ₦5,600', 'Gift packaging: ₦2,000', 'Total paid: ₦16,600']) assert(message.text.includes(row), row);
});

test('emails sent without a recorded payment never call the total "Total paid"', () => {
  for (const [type, changes] of [
    ['order_confirmation', { status: 'pending', paymentStatus: 'pending' }],
    ['order_confirmation', { status: 'pending', paymentStatus: 'pending', isManualOrder: true, sendCustomerEmail: true, paymentMethod: 'bank_transfer' }],
    ['cancelled', { status: 'cancelled', paymentStatus: 'pending' }]
  ]) {
    const message = renderOrderEmail(type, gift(changes));
    for (const body of [visible(message.html), message.text]) {
      assert.doesNotMatch(body, /Total paid/, type);
      assert.match(body, /Order total:? ₦16,600/, type);
    }
  }
  const paid = renderOrderEmail('cancelled', gift({ status: 'cancelled', paymentStatus: 'paid' }));
  assert(visible(paid.html).includes('Total paid ₦16,600'));
});

test('order confirmation is truthful for website and manual orders that may already be paid', () => {
  const website = renderOrderEmail('order_confirmation', gift({ status: 'pending', paymentStatus: 'pending' }));
  const manual = renderOrderEmail('order_confirmation', gift({ status: 'pending', paymentStatus: 'pending',
    isManualOrder: true, sendCustomerEmail: true, paymentMethod: 'cash' }));
  const web = visible(website.html), direct = visible(manual.html);
  assert(web.includes('Thank you for your order #ANJ-EMAIL-123. We’ll start preparing your items once your payment is confirmed, and we’ll email your receipt.'));
  assert(web.includes('Already paid? Please don’t pay again — your payment confirmation comes in a separate email.'));
  assert(direct.includes('once your payment has been recorded'));
  assert(direct.includes('Already paid? Please don’t pay again — we’ll email your receipt once your payment has been recorded.'));
  for (const body of [web, direct, website.text, manual.text]) {
    assert.doesNotMatch(body, /pay online|payment link|complete (?:your )?payment|(?:items|stock|order) (?:is|are) (?:reserved|held)|reserved for you|we.ve received your payment/i);
    assert.match(body, /Please check your delivery details/);
  }
});

test('the order confirmation shows the gift message so the customer can check it', () => {
  const source = gift({ status: 'pending', paymentStatus: 'pending' });
  source.customerInfo.giftMessage = 'Happy birthday <3 & love';
  const message = renderOrderEmail('order_confirmation', source);
  assert.match(message.html, /Happy birthday &lt;3 &amp; love/);
  assert.match(message.text, /Happy birthday <3 & love/);
  assert.match(visible(message.html), /Please check your gift message carefully/);
  for (const type of types.filter(type => type !== 'order_confirmation')) {
    assert.doesNotMatch(renderOrderEmail(type, source).text, /Happy birthday/, type);
  }
});

test('cancellation explains payment and refunds using only the published policy', () => {
  const unpaid = renderOrderEmail('cancelled', gift({ status: 'cancelled', paymentStatus: 'pending' }));
  const paid = renderOrderEmail('cancelled', gift({ status: 'cancelled', paymentStatus: 'paid' }));
  assert(visible(unpaid.html).includes('Our records show no payment for this order, so there’s nothing more you need to do.'));
  assert.doesNotMatch(visible(unpaid.html), /Payment reference/);
  assert(visible(paid.html).includes('Your payment for this order is recorded. A cancellation and a refund are separate steps — we’ll explain any refund due.'));
  assert(visible(paid.html).includes('Payment reference: PAY-EMAIL-123'));
  for (const message of [unpaid, paid]) {
    assert(hrefs(message.html).includes(`${storefront}/returns-policy#cancellations`));
    for (const body of [visible(message.html), message.text]) {
      assert.doesNotMatch(body, /refund (?:will be|has been|is being) (?:issued|processed|sent)|automatically refund|within \d|business days|because|reason/i);
      assert.doesNotMatch(body, /TRACK-EMAIL-123/);
    }
  }
});

test('the greeting uses the first name, not a title or the typed casing', () => {
  for (const [fullName, greeting] of [
    ['Mrs. Ada Obi', 'Hi Ada,'], ['Dr Ngozi Okafor', 'Hi Ngozi,'], ['Chief Mrs Funke Adeyemi', 'Hi Funke,'],
    ['TOLU BAKARE', 'Hi Tolu,'], ['chioma eze', 'Hi Chioma,'], ['ADE-OLA KUTI', 'Hi Ade-Ola,'],
    ['McKenzie Obi', 'Hi McKenzie,'], ['🌸 Ada Obi', 'Hi Ada,'], ['Mrs', 'Hi there,'], ['', 'Hi there,']
  ]) {
    const message = renderOrderEmail('shipped', order({ customerInfo: { ...order().customerInfo, fullName } }));
    assert(message.text.split('\n\n').includes(greeting), `${fullName} -> ${greeting}`);
  }
});

test('the park transport note appears only for park delivery, after the total', () => {
  for (const shippingMethod of ['Park Delivery (Lagos, Ogun, Ilorin, Oyo, Osun, Ondo, Ekiti)', 'Park Delivery']) {
    const source = order({ status: 'shipped', totalAmount: 9000 });
    source.customerInfo = { ...source.customerInfo, shippingMethod, shippingCost: 0 };
    assert(visible(renderOrderEmail('payment_confirmation', source).html).includes('Shipping Paid to driver'), shippingMethod);
    const shipped = visible(renderOrderEmail('shipped', source).html);
    const total = shipped.indexOf('Order total ₦9,000'), note = shipped.indexOf('Transport fare is payable separately');
    assert(total > -1 && note > total, shippingMethod);
  }
  const source = order({ totalAmount: 12000 });
  source.customerInfo = { ...source.customerInfo, shippingMethod: 'Rider to Ikeja City Mall car park', shippingCost: 3000 };
  for (const type of types) {
    assert.doesNotMatch(visible(renderOrderEmail(type, source).html), /Transport fare|Paid to driver/, type);
  }
});

test('large and fractional amounts stay readable', () => {
  const message = renderOrderEmail('payment_confirmation', order({
    totalAmount: 1000000,
    items: [{ name: 'Gift box', quantity: 1, price: 1250.5, selectedPieces: 4, pricePerPiece: 312.5 }]
  }));
  assert.match(message.html, /class="total-amount" style="[^"]*white-space:nowrap[^"]*">₦1,000,000</);
  assert.match(message.text, /₦1,250\.50 \/ pack/);
  assert.match(message.text, /₦312\.50 per piece/);
});

test('delivered email thanks the customer first and keeps the parcel-problem link visible', () => {
  const body = visible(renderOrderEmail('delivered', order({ status: 'delivered' })).html);
  assert(body.indexOf('Thank you for shopping with Anjola Aesthetics.') < body.indexOf('Your order, at a glance'));
  assert(body.includes('Haven’t received your parcel or noticed a problem? Contact us.'));
});

test('rendering works without Node 20 string APIs and survives malformed Unicode', () => {
  const original = Object.getOwnPropertyDescriptor(String.prototype, 'toWellFormed');
  delete String.prototype.toWellFormed;
  try {
    for (const type of types) {
      const message = renderOrderEmail(type, order({ orderNumber: 'ANJ-\uD800-123' }));
      assert(hrefs(message.html).find(link => link.startsWith(whatsapp)).includes('%EF%BF%BD'), type);
    }
  } finally {
    if (original) Object.defineProperty(String.prototype, 'toWellFormed', original);
  }
});

test('prepared messages keep the plain-text part and support reply-to for every order email', async () => {
  const context = { exports: {}, module: {}, process: { env: { EMAIL_FROM: 'Anjola <orders@example.com>' } },
    console: { log() {}, error() {} },
    require: name => name === './orderEmailTemplates' ? { renderOrderEmail }
      : ({ Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'email-1' }, error: null }) }; } } }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/emailService'), 'utf8'), context);
  for (const type of types) {
    const prepared = await context.exports.prepareNotification(type, order({ orderId: 'order_1', notificationId: 'notification_1' }));
    assert.equal(prepared.success, true, type);
    assert.equal(prepared.message.subject, renderOrderEmail(type, order()).subject, type);
    assert.equal(prepared.message.replyTo, supportEmail, type);
    assert.match(prepared.message.text, /ANJ-EMAIL-123/, type);
    assert.match(prepared.message.html, /^<!doctype html>/, type);
  }
});

test('customer and product data cannot inject HTML or change support-link destinations', () => {
  const malicious = order({
    orderNumber: 'ANJ-"><script>alert(1)</script>&next=https://attacker.example',
    customerInfo: {
      ...order().customerInfo,
      fullName: 'Ada<script>alert(2)</script>',
      address: '<img/src=x/onerror=alert(3)>',
      shippingMethod: '<svg/onload=alert(4)>',
      isGift: true,
      giftMessage: '<script>alert(9)</script>'
    },
    items: [{
      name: '<script>alert(5)</script>',
      price: 4500,
      quantity: 1,
      selectedSize: '<b>Large</b>',
      selectedColor: '<svg/onload=alert(6)>',
      image: 'javascript:alert(7)',
      images: ['https://attacker.example/product.png']
    }],
    trackingNumber: '<script>alert(8)</script>'
  });

  for (const type of types) {
    const message = renderOrderEmail(type, malicious);
    assert.doesNotMatch(message.html, /<script\b|<svg\b|<img\/src|javascript:/i, type);
    assert.match(message.html, /Ada&lt;script&gt;/, type);
    assert.match(message.html, /&lt;script&gt;alert\(5\)&lt;\/script&gt;/, type);
    assert.match(message.html, /&lt;b&gt;Large&lt;\/b&gt;/, type);
    assert.match(message.text, /Ada<script>alert\(2\)<\/script>/, type);
    assert.match(message.text, /<script>alert\(5\)<\/script>/, type);
    assert.doesNotMatch(message.text, /&lt;script&gt;/, type);
    assert.doesNotMatch(message.subject, /[\r\n]/, type);

    const links = hrefs(message.html);
    assert(links.every(link => {
      const url = new URL(link);
      return url.protocol === 'mailto:' && url.pathname === supportEmail ||
        url.protocol === 'https:' &&
        ['anjolaaestheticsng.com', 'www.anjolaaestheticsng.com', 'wa.me'].includes(url.hostname);
    }), `${type}: only fixed brand destinations may be linked`);
    const help = links.filter(link => new URL(link).hostname === 'wa.me');
    assert(help.length > 0, `${type}: missing WhatsApp help`);
    for (const link of help) {
      const url = new URL(link);
      assert.equal(url.pathname, '/2347065943625');
      assert.deepEqual([...url.searchParams.keys()], ['text']);
      assert(url.searchParams.get('text').includes(malicious.orderNumber));
    }
    if (type === 'shipped') {
      assert.match(message.html, /&lt;script&gt;alert\(8\)&lt;\/script&gt;/);
      assert.match(message.text, /<script>alert\(8\)<\/script>/);
    }
    if (type === 'order_confirmation') assert.match(message.html, /&lt;script&gt;alert\(9\)&lt;\/script&gt;/);
  }
});

test('untrusted order identifiers cannot add subject header lines', () => {
  for (const type of types) {
    const message = renderOrderEmail(type, order({
      orderNumber: 'ANJ-123\r\nBcc: other@example.com\u0000'
    }));
    assert.doesNotMatch(message.subject, /[\r\n\u0000]/, type);
  }
});

test('payment receipt preserves recorded zero charges, variants and bundle line totals', () => {
  const source = order();
  source.customerInfo = { ...source.customerInfo, shippingCost: 0, isGift: true, giftPackagingFee: 0 };
  source.totalAmount = 9000;
  const message = renderOrderEmail('payment_confirmation', source);
  for (const body of [visible(message.html), message.text]) {
    assert.match(body, /Shipping\s*:?\s*₦0(?:\.00)?/i);
    assert.match(body, /Gift packaging\s*:?\s*₦0(?:\.00)?/i);
    assert.match(body, /Large/);
    assert.match(body, /Blush/);
    assert.match(body, /3\s*(?:pieces|pcs)/i);
    assert.match(body, /₦1,500/);
    assert.match(body, /₦4,500/);
    assert.match(body, /₦9,000/);
    assert.doesNotMatch(body, /₦27,000/);
  }
});

test('legacy gift orders show unknown saved fees without adopting a new fee', () => {
  const source = order();
  source.customerInfo = { ...source.customerInfo, isGift: true };
  delete source.customerInfo.shippingCost;
  delete source.customerInfo.giftPackagingFee;
  const message = renderOrderEmail('payment_confirmation', source);
  for (const body of [visible(message.html), message.text]) {
    assert.match(body, /Gift packaging\s*:?\s*Not recorded/i);
    assert.doesNotMatch(body, /Gift packaging\s*:?\s*₦/i);
    assert.doesNotMatch(body, /Shipping\s*:?\s*₦0(?:\.00)?/i);
  }
});

test('park delivery receipt distinguishes the recorded online charge from the separate transport fare', () => {
  const source = order();
  source.customerInfo = {
    ...source.customerInfo,
    shippingMethod: 'Park Delivery (Lagos, Ogun, Ilorin, Oyo, Osun, Ondo, Ekiti)',
    shippingCost: 0
  };
  source.totalAmount = 9000;
  for (const type of ['payment_confirmation', 'payment_review']) {
    const message = renderOrderEmail(type, source);
    for (const body of [visible(message.html), message.text]) {
      assert.doesNotMatch(body, /free (?:shipping|delivery|transport)/i);
      assert.match(body, /(?:transport fare|transport fee).{0,100}(?:separate|driver)/i);
      assert.match(body, /₦9,000/);
    }
  }
});

test('shipping shows a recorded reference without inventing a tracking URL or arrival date', () => {
  const source = order({ status: 'shipped', trackingNumber: 'TRACK-ONLY-987' });
  const message = renderOrderEmail('shipped', source);
  assert.match(message.html, /TRACK-ONLY-987/);
  assert.match(message.text, /TRACK-ONLY-987/);
  assert.match(message.text, /Doorstep delivery/);
  assert.match(message.text, /12 Test Road/);
  assert(hrefs(message.html).every(link => !link.includes('TRACK-ONLY-987')));
  for (const body of [visible(message.html), message.text]) {
    assert.doesNotMatch(body, /Track parcel|Estimated arrival|Expected delivery|business days|arriv(?:e|ing) (?:by|on)/i);
  }
  for (const trackingNumber of [undefined, null, '', '   ']) {
    const missing = renderOrderEmail('shipped', order({ status: 'shipped', trackingNumber }));
    assert.doesNotMatch(missing.html, /TRACK-EMAIL-123|Tracking (?:reference|number)/i);
    assert.doesNotMatch(missing.text, /TRACK-EMAIL-123|Tracking (?:reference|number)/i);
  }
});

test('delivered email describes the recorded status and keeps missing-parcel support visible', () => {
  const message = renderOrderEmail('delivered', order({ status: 'delivered' }));
  for (const body of [visible(message.html), message.text]) {
    assert.match(body, /marked as delivered/i);
    assert.match(body, /(?:haven.t received|not received|missing parcel)/i);
    assert.match(body, /(?:contact|help|support)/i);
    assert.match(body, /Explore the collection/i);
  }
  assert(hrefs(message.html).includes(`${storefront}/shop`));
});

test('payment review acknowledges payment without promising preparation or asking for another payment', () => {
  const message = renderOrderEmail('payment_review', order());
  for (const body of [visible(message.html), message.text]) {
    assert.match(body, /payment received|received your payment/i);
    assert.match(body, /reviewing your order/i);
    assert.match(body, /Please do not make another payment/i);
    assert.doesNotMatch(body, /we.re preparing|we are preparing|preparing your items|paid.{0,5}processing|order is now being processed/i);
  }
  assert.doesNotMatch(message.html, /Current stage|Next step/);
});

test('recovered receipts for shipped, delivered and cancelled orders do not promise preparation', () => {
  for (const status of ['shipped', 'delivered', 'cancelled']) {
    const message = renderOrderEmail('payment_confirmation', order({ status }));
    for (const body of [visible(message.html), message.text]) {
      assert.match(body, /payment receipt/i, status);
      assert.doesNotMatch(body, /we.re preparing|we are preparing|preparing your items|will email you when|little joy is in the making/i, status);
    }
  }
});

test('missing legacy data and non-finite amounts render safely without invented charges', () => {
  for (const type of types) {
    for (const source of [
      {},
      { customerInfo: null, items: null, totalAmount: undefined },
      { customerInfo: { fullName: '', shippingCost: NaN, isGift: true, giftPackagingFee: Infinity },
        items: [{ name: 'Legacy item', quantity: undefined, price: NaN }], totalAmount: Infinity }
    ]) {
      const message = renderOrderEmail(type, source);
      for (const field of ['subject', 'html', 'text']) {
        assert.equal(typeof message[field], 'string', `${type}: ${field}`);
        assert.doesNotMatch(message[field], /\b(?:undefined|NaN|Infinity)\b/, `${type}: ${field}`);
      }
    }
  }
});

test('rendering is deterministic for the frozen notification data and does not mutate it', () => {
  const source = order();
  const snapshot = JSON.stringify(source);
  for (const type of types) {
    assert.deepEqual(renderOrderEmail(type, source), renderOrderEmail(type, source), type);
    assert.equal(JSON.stringify(source), snapshot, type);
  }
});
