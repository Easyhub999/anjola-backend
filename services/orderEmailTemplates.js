// Pure rendering only. The notification worker persists this output before sending,
// so retries keep the original message even after a later template deployment.
const SITE = 'https://www.anjolaaestheticsng.com';
const SUPPORT = 'anjolaaestheticsng@gmail.com';
const WHATSAPP = 'https://wa.me/2347065943625';
const COLORS = { paper: '#faf6f1', blush: '#f2e2df', wine: '#753049', ink: '#30212a', muted: '#75626a', line: '#e8ddd7' };
const FONT = "Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const TYPES = ['order_confirmation', 'payment_confirmation', 'payment_review', 'shipped', 'delivered', 'cancelled'];
const STAGES = ['Paid', 'Preparing', 'Shipped', 'Delivered'];
// A leading title is not a first name: "Mrs. Ada Obi" is greeted as "Hi Ada,".
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'madam', 'chief', 'engr', 'pastor', 'rev', 'alhaji', 'alhaja', 'barr', 'hon']);
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const escape = value => clean(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
// Same result as String.prototype.toWellFormed, which needs Node 20+. A lone surrogate
// would otherwise make encodeURIComponent throw.
const wellFormed = value => value.replace(/[\uD800-\uDFFF]/gu, '�');
const recordedAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
// Whole naira show no decimals; kobo amounts always show two (₦6,000.50).
const money = value => recordedAmount(value) ? `₦${value.toLocaleString('en-NG', Number.isInteger(value)
  ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Not recorded';
const quantityOf = item => Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : null;
const piecesOf = item => Number.isInteger(item.selectedPieces) && item.selectedPieces > 1 ? item.selectedPieces : null;
// Checkout saves "Park Delivery (…)" and manual orders "Park Delivery". Other text that
// mentions a park ("…car park") must not tell the customer a driver fare is still owed.
const isPark = method => /^park delivery\b/i.test(clean(method));
const paragraph = text => `<p style="margin:0 0 18px;font-family:${FONT};font-size:15px;line-height:26px;color:${COLORS.ink};">${escape(text)}</p>`;
const heading = text => `<h2 style="margin:28px 0 14px;font-family:${SERIF};font-size:23px;line-height:30px;font-weight:400;color:${COLORS.ink};">${escape(text)}</h2>`;
const table = (content, fixed = true) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;${fixed ? 'table-layout:fixed;' : ''}">${content}</table>`;
const spacer = height => table(`<tr><td height="${height}" style="height:${height}px;line-height:${height}px;font-size:0;">&nbsp;</td></tr>`);
const fine = lines => `<p style="margin:12px 0 0;font-size:12px;line-height:21px;color:${COLORS.muted};word-break:break-all;">${lines.map(escape).join('<br>')}</p>`;
// The one thing the customer must not miss, such as not paying twice.
const callout = (lead, rest = '') => table(`<tr><td style="padding:16px 20px;background:${COLORS.paper};border-left:3px solid ${COLORS.wine};font-size:14px;line-height:23px;color:${COLORS.ink};"><strong style="color:${COLORS.wine};">${escape(lead)}</strong>${rest ? ` ${escape(rest)}` : ''}</td></tr>`) + spacer(18);

function firstNameOf(fullName) {
  const words = clean(fullName).split(/\s+/).filter(word => /\p{L}/u.test(word));
  while (words.length && TITLES.has(words[0].toLowerCase().replace(/\.+$/, ''))) words.shift();
  const name = words[0];
  if (!name) return 'there';
  // Only names typed entirely in one case are normalised ("ADA", "chioma"); "McKenzie" is kept.
  return name === name.toUpperCase() || name === name.toLowerCase()
    ? name.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (match, start, letter) => start + letter.toUpperCase())
    : name;
}

function paymentDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(+date) ? date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos'
  }) : '';
}

function itemLines(item, priced) {
  const quantity = quantityOf(item);
  const pieces = piecesOf(item);
  const variants = [item.selectedSize && `Size: ${clean(item.selectedSize)}`,
    item.selectedColor && `Colour: ${clean(item.selectedColor)}`].filter(Boolean).join(' · ');
  const units = pieces ? `pack${quantity === 1 ? '' : 's'} of ${pieces} pieces` : `item${quantity === 1 ? '' : 's'}`;
  const count = quantity ? `${quantity} ${units}` : 'Quantity not recorded';
  const details = [count];
  if (priced) {
    const price = recordedAmount(item.price) ? `${money(item.price)}${pieces ? ' / pack' : ' each'}` : 'Price not recorded';
    details[0] = quantity && recordedAmount(item.price) ? `${count} × ${price}` : `${count} · ${price}`;
    if (pieces && recordedAmount(item.pricePerPiece)) details.push(`${money(item.pricePerPiece)} per piece`);
  }
  return { name: clean(item.name) || 'Product name not recorded', variants, details };
}

function itemsBlock(items, priced) {
  const missing = 'Item details were not recorded for this order.';
  if (!items.length) return { html: paragraph(missing), text: missing };
  const lineTotal = item => quantityOf(item) && recordedAmount(item.price) ? item.quantity * item.price : undefined;
  return {
    html: table(items.map(item => {
      const lines = itemLines(item, priced);
      return `<tr>
        <td valign="top" style="padding:17px 12px 17px 0;border-bottom:1px solid ${COLORS.line};word-wrap:break-word;overflow-wrap:anywhere;">
          <p style="margin:0 0 5px;font-size:15px;line-height:22px;font-weight:600;">${escape(lines.name)}</p>
          ${lines.variants ? `<p style="margin:0 0 5px;font-size:12px;line-height:19px;color:${COLORS.muted};">${escape(lines.variants)}</p>` : ''}
          <p style="margin:0;font-size:12px;line-height:19px;color:${COLORS.muted};">${lines.details.map(escape).join('<br>')}</p>
        </td>
        ${priced ? `<td width="110" valign="top" align="right" style="width:110px;padding:17px 0;border-bottom:1px solid ${COLORS.line};font-size:14px;line-height:22px;font-weight:600;white-space:nowrap;">${escape(money(lineTotal(item)))}</td>` : ''}
      </tr>`;
    }).join('')),
    text: items.map(item => {
      const lines = itemLines(item, priced);
      return [lines.name, lines.variants, ...lines.details,
        priced ? `Line total: ${money(lineTotal(item))}` : ''].filter(Boolean).join('\n');
    }).join('\n\n')
  };
}

function chargeRows(order, items, totalLabel) {
  const customer = order.customerInfo || {};
  const subtotal = items.length && items.every(item => quantityOf(item) && recordedAmount(item.price))
    ? items.reduce((sum, item) => sum + item.quantity * item.price, 0) : undefined;
  const rows = [];
  if (recordedAmount(subtotal)) rows.push(['Items subtotal', money(subtotal)]);
  if (recordedAmount(customer.shippingCost)) {
    // Matches checkout: park transport is paid to the driver, not collected online.
    rows.push(['Shipping', customer.shippingCost === 0 && isPark(customer.shippingMethod) ? 'Paid to driver' : money(customer.shippingCost)]);
  }
  if (customer.isGift || recordedAmount(customer.giftPackagingFee) && customer.giftPackagingFee > 0) rows.push(['Gift packaging', money(customer.giftPackagingFee)]);
  const total = money(order.totalAmount);
  // Auto layout and nowrap keep large totals (₦1,000,000 and above) on one line.
  return {
    html: table(rows.map(([label, amount]) => `<tr>
      <td width="100%" style="padding:8px 12px 8px 0;font-size:13px;color:${COLORS.muted};">${escape(label)}</td>
      <td align="right" style="padding:8px 0;font-size:13px;white-space:nowrap;">${escape(amount)}</td>
    </tr>`).join('') + `<tr>
      <td width="100%" style="padding:17px 12px 17px 0;border-top:1px solid ${COLORS.line};font-size:15px;font-weight:600;">${escape(totalLabel)}</td>
      <td align="right" class="total-amount" style="padding:17px 0;border-top:1px solid ${COLORS.line};font-family:${SERIF};font-size:25px;line-height:30px;color:${COLORS.wine};white-space:nowrap;">${escape(total)}</td>
    </tr>`, false),
    text: [...rows.map(([label, amount]) => `${label}: ${amount}`), `${totalLabel}: ${total}`].join('\n')
  };
}

function deliveryBlock(customer, tracking) {
  const lines = [customer.fullName, customer.address,
    [customer.city, customer.state].map(clean).filter(Boolean).join(', '),
    customer.phone && `Phone: ${clean(customer.phone)}`,
    customer.shippingMethod && `Shipping method: ${clean(customer.shippingMethod)}`]
    .map(clean).filter(Boolean);
  const recorded = lines.length ? lines : ['Delivery details were not recorded.'];
  // The tracking reference shares the card with the address and shipping method.
  const trackingHtml = tracking ? `<p style="margin:16px 0 0;padding:14px 0 0;border-top:1px solid ${COLORS.line};font-size:11px;line-height:18px;color:${COLORS.muted};">Tracking reference</p>
    <p style="margin:2px 0 0;font-size:18px;font-weight:600;line-height:26px;color:${COLORS.wine};word-break:break-all;">${escape(tracking)}</p>` : '';
  return {
    html: table(`<tr><td style="background:${COLORS.paper};padding:20px;border:1px solid ${COLORS.line};font-size:13px;line-height:23px;word-wrap:break-word;overflow-wrap:anywhere;">${recorded.map(escape).join('<br>')}${trackingHtml}</td></tr>`),
    text: [...recorded, tracking && `Tracking reference: ${tracking}`].filter(Boolean).join('\n')
  };
}

// current: the stage reached (-1 for none yet); next: an upcoming stage to point out.
function progress(current, next) {
  return table(`<tr>${STAGES.map((label, index) => {
    const reached = index <= current;
    const marker = index === current ? 'Current stage' : index === next ? 'Next step' : '';
    return `<td width="25%" valign="top" style="width:25%;padding:0 3px;">
    ${table(`<tr><td height="3" style="height:3px;line-height:3px;background:${reached ? COLORS.wine : COLORS.line};font-size:0;">&nbsp;</td></tr>
    <tr><td align="center" style="padding:10px 0 0;font-size:11px;line-height:17px;font-weight:${index === current ? '700' : '400'};color:${reached || marker ? COLORS.wine : COLORS.muted};">${label}${marker ? `<br><span style="font-size:10px;font-weight:400;">${marker}</span>` : ''}</td></tr>`)}
  </td>`;
  }).join('')}</tr>`);
}

function button(label, href) {
  return table(`<tr><td align="center" bgcolor="${COLORS.wine}" style="background:${COLORS.wine};border:1px solid ${COLORS.wine};border-radius:4px;mso-padding-alt:16px 24px;">
    <a class="email-button" href="${escape(href)}" style="display:block;padding:16px 24px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;text-decoration:none;color:#ffffff;">${escape(label)}</a>
  </td></tr>`);
}

function layout({ order, title, subtitle, label, preheader, strip, html, action, helpUrl }) {
  const year = Number.isInteger(order.notificationYear) ? order.notificationYear
    : order.createdAt && Number.isFinite(+new Date(order.createdAt)) ? new Date(order.createdAt).getUTCFullYear() : '';
  const orderNumber = clean(order.orderNumber) || 'Not recorded';
  const link = (href, text, color = COLORS.wine) => `<a href="${escape(href)}" style="color:${color};text-decoration:underline;">${escape(text)}</a>`;
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escape(title)} | Anjola Aesthetics</title>
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}img{border:0;outline:none;text-decoration:none}
@media only screen and (max-width:620px){.outer{padding:12px 8px!important}.pad{padding-left:22px!important;padding-right:22px!important}.email-title{font-size:32px!important;line-height:38px!important}.brand-name{font-size:30px!important}.total-amount{font-size:22px!important;line-height:28px!important}}
</style></head>
<body style="margin:0;padding:0;width:100%;background:${COLORS.paper};color:${COLORS.ink};font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.paper};">${escape(preheader)}${'&zwnj;&nbsp;'.repeat(80)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.paper}" style="width:100%;background:${COLORS.paper};"><tr>
<td class="outer" align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${COLORS.line};table-layout:fixed;">
<tr><td height="4" bgcolor="${COLORS.wine}" style="height:4px;font-size:0;line-height:4px;background:${COLORS.wine};">&nbsp;</td></tr>
<tr><td class="pad" style="padding:30px 40px 26px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
    <td width="48" style="width:48px;padding-right:13px;"><a href="${SITE}" style="text-decoration:none;"><img src="${SITE}/apple-touch-icon.png" width="48" height="48" alt="" style="display:block;width:48px;height:48px;border:0;border-radius:8px;"></a></td>
    <td><a href="${SITE}" style="text-decoration:none;color:${COLORS.wine};"><span class="brand-name" style="font-family:${SERIF};font-size:35px;line-height:36px;">Anjola</span><br><span style="font-family:${FONT};font-size:10px;line-height:18px;letter-spacing:4px;color:${COLORS.ink};">AESTHETICS</span></a></td>
  </tr></table>
  <p style="margin:20px 0 0;text-align:center;font-size:12px;line-height:19px;color:${COLORS.muted};">Beautiful finds. Thoughtful gifts. Little joys.</p>
</td></tr>
<tr><td class="pad" bgcolor="${COLORS.blush}" style="padding:30px 40px;background:${COLORS.blush};">
  <p class="status-label" style="margin:0 0 18px;font-size:11px;font-weight:600;line-height:16px;letter-spacing:1.8px;color:${COLORS.wine};">${escape(label.toUpperCase())}</p>
  <h1 class="email-title" style="margin:0;font-family:${SERIF};font-size:39px;line-height:46px;font-weight:400;letter-spacing:-1px;color:${COLORS.ink};">${escape(title)}</h1>
  ${subtitle ? `<p class="email-subtitle" style="margin:13px 0 0;font-family:${SERIF};font-size:21px;line-height:29px;font-style:italic;color:${COLORS.wine};">${escape(subtitle)}</p>` : ''}
  <p style="margin:20px 0 0;font-size:12px;line-height:19px;color:${COLORS.muted};word-break:break-all;">Order #${escape(orderNumber)}</p>
</td></tr>
${strip ? `<tr><td class="pad" style="padding:25px 37px 0;">${progress(strip.current ?? -1, strip.next ?? -1)}</td></tr>` : ''}
<tr><td class="pad" style="padding:28px 40px 34px;font-family:${FONT};color:${COLORS.ink};word-wrap:break-word;overflow-wrap:anywhere;">
  ${html}
  ${spacer(28)}${button(action.label, action.href)}
</td></tr>
<tr><td class="pad" bgcolor="${COLORS.paper}" style="padding:26px 40px;background:${COLORS.paper};border-top:1px solid ${COLORS.line};text-align:center;">
  <p style="margin:0 0 6px;font-size:13px;line-height:21px;color:${COLORS.ink};">A little assistance, whenever you need it.</p>
  <p style="margin:0 0 12px;font-size:12px;line-height:22px;color:${COLORS.muted};">${link(helpUrl, 'WhatsApp support')} &nbsp;·&nbsp; ${link(`mailto:${SUPPORT}`, SUPPORT)}</p>
  <p style="margin:0 0 12px;font-size:11px;line-height:20px;color:${COLORS.muted};">${link(`${SITE}/shipping-policy`, 'Shipping policy', COLORS.muted)} &nbsp;·&nbsp; ${link(`${SITE}/returns-policy`, 'Returns policy', COLORS.muted)}</p>
  <p style="margin:0;font-size:11px;line-height:19px;color:${COLORS.muted};">Abeokuta, Nigeria<br>&copy; ${year ? `${year} ` : ''}Anjola Aesthetics Ng. All rights reserved.</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

function renderOrderEmail(type, input = {}) {
  if (!TYPES.includes(type)) throw new Error('Unsupported order email template');
  const order = input || {};
  const customer = order.customerInfo || {};
  const items = Array.isArray(order.items) ? order.items.filter(item => item && typeof item === 'object') : [];
  const orderNumber = clean(order.orderNumber) || 'Not recorded';
  const status = clean(order.status);
  const helpText = `Hi Anjola Aesthetics, I need help with order #${orderNumber}.`;
  const helpUrl = `${WHATSAPP}?text=${encodeURIComponent(wellFormed(helpText))}`;
  const park = isPark(customer.shippingMethod);
  const parkNote = 'Transport fare is payable separately to the driver and is not included in your order total.';
  const greeting = `Hi ${firstNameOf(customer.fullName)},`;
  const content = [paragraph(greeting)], text = [greeting];
  const add = (html, plain) => { content.push(html); text.push(plain); };
  const say = copy => add(paragraph(copy), copy);
  const after = copy => add(spacer(16) + paragraph(copy), copy);
  const section = title => add(heading(title), title);
  const priced = totalLabel => {
    const lines = itemsBlock(items, true);
    add(lines.html, lines.text);
    const charges = chargeRows(order, items, totalLabel);
    add(charges.html, charges.text);
  };
  const summary = () => {
    const lines = itemsBlock(items, false);
    add(lines.html, lines.text);
    if (recordedAmount(order.totalAmount)) add(`<p style="margin:15px 0 0;font-size:13px;line-height:22px;color:${COLORS.muted};">Order total <strong style="color:${COLORS.ink};">${escape(money(order.totalAmount))}</strong></p>`, `Order total: ${money(order.totalAmount)}`);
  };
  const delivery = tracking => {
    section('Delivery details');
    const block = deliveryBlock(customer, tracking);
    add(block.html, block.text);
  };
  let subject, preheader, label, title, subtitle = '', strip = null;
  let action = { label: 'Get help with this order', href: helpUrl };

  if (type === 'order_confirmation') {
    // Sent before payment. Stock is not held, and payment may finish before this arrives.
    const manual = order.isManualOrder === true;
    subject = `Order received — your Anjola order #${orderNumber}`;
    preheader = 'Thank you for your order. Here’s what happens next.';
    label = 'Order received · Awaiting payment';
    title = 'Order received.';
    subtitle = 'Thank you for choosing a little joy.';
    strip = { current: -1, next: 0 };
    say(`Thank you for your order #${orderNumber}. We’ll start preparing your items once your payment ${manual ? 'has been recorded' : 'is confirmed'}, and we’ll email your receipt.`);
    // Manual orders are paid directly with us, never through the website.
    const rest = manual ? 'Please don’t pay again — we’ll email your receipt once your payment has been recorded.'
      : 'Please don’t pay again — your payment confirmation comes in a separate email. If it doesn’t arrive, contact us with your order number.';
    add(callout('Already paid?', rest), `Already paid? ${rest}`);
    section('Your order');
    priced('Order total');
    if (park) after(parkNote);
    const giftMessage = customer.isGift ? clean(customer.giftMessage) : '';
    if (giftMessage) {
      section('Your gift message');
      add(table(`<tr><td style="padding:18px 20px;background:${COLORS.blush};font-family:${SERIF};font-size:17px;line-height:27px;font-style:italic;color:${COLORS.ink};word-wrap:break-word;overflow-wrap:anywhere;">“${escape(giftMessage)}”</td></tr>`), `“${giftMessage}”`);
      after('Please check your gift message carefully — contact us straight away if anything needs changing.');
    }
    delivery();
    after('Please check your delivery details — contact us promptly if anything needs correcting.');
  } else if (type === 'payment_confirmation' || type === 'payment_review') {
    const review = type === 'payment_review';
    const preparing = !review && status === 'processing';
    const cancelled = status === 'cancelled';
    subject = review ? `Payment received — order #${orderNumber} under review` : `Payment received — your Anjola order #${orderNumber}`;
    title = 'Payment received.';
    if (review) {
      label = 'Payment received · Order under review';
      subtitle = 'We’re reviewing your order.';
      preheader = 'Payment received—we’re reviewing your order. Please do not make another payment.';
    } else {
      label = preparing ? 'Paid · Preparing your order' : 'Payment receipt';
      subtitle = preparing ? 'A little joy is in the making.' : 'Your payment receipt, all in one place.';
      preheader = preparing ? 'Thank you. We’re preparing your order with care.'
        : cancelled ? 'Your payment receipt. This order has been cancelled.' : 'Your payment is confirmed. Keep this email as your receipt.';
      // A review never shows a stage: it must not imply that preparation has started.
      if (!cancelled) strip = { current: status === 'delivered' ? 3 : status === 'shipped' ? 2 : preparing ? 1 : 0 };
    }
    say(`We’ve received your payment${recordedAmount(order.totalAmount) ? ` of ${money(order.totalAmount)}` : ''} for order #${orderNumber}.${preparing ? ' We’re preparing your items and will email you when they’re on their way.' : ''}`);
    if (review) {
      add(callout('Please do not make another payment for this order.'), 'Please do not make another payment for this order.');
      say(cancelled ? 'This order is cancelled, so our team is reviewing your payment and will contact you about the next steps.'
        : 'Our team is reviewing your order before it can proceed. We will contact you with an update.');
    } else if (!preparing) {
      say(status === 'shipped' ? 'Your order is on its way. Contact us if you need a delivery update.'
        : status === 'delivered' ? 'Your order has been marked as delivered. Contact us if you need help with your delivery.'
          : cancelled ? 'This order has been cancelled. A cancellation and a refund are separate steps — we’ll explain any refund due.'
            : 'Shipment and delivery updates are sent separately from this payment receipt.');
    }
    section('Your payment receipt');
    priced('Total paid');
    if (park) after(parkNote);
    const references = [order.paymentReference && `Payment reference: ${clean(order.paymentReference)}`,
      paymentDate(order.paidAt) && `Payment received: ${paymentDate(order.paidAt)}`].filter(Boolean);
    if (references.length) add(fine(references), references.join('\n'));
    delivery();
  } else if (type === 'shipped') {
    subject = `Your Anjola order #${orderNumber} is on its way`;
    preheader = 'Your parcel has been dispatched. Here are the delivery details.';
    label = 'Order shipped';
    title = 'Your order is on its way.';
    strip = { current: 2 };
    say(`Your order #${orderNumber} has been dispatched. Thank you for letting us bring a little joy your way.`);
    delivery(clean(order.trackingNumber));
    section('Inside your parcel');
    summary();
    if (park) after(parkNote);
    action.label = 'Get delivery help';
  } else if (type === 'delivered') {
    subject = `Delivery update — Anjola order #${orderNumber}`;
    preheader = 'Your order has been marked as delivered.';
    label = 'Order marked as delivered';
    title = 'A little joy, delivered.';
    strip = { current: 3 };
    say(`Your order #${orderNumber} has been marked as delivered. We hope your new finds bring something lovely to your everyday.`);
    say('Thank you for shopping with Anjola Aesthetics.');
    section('Your order, at a glance');
    summary();
    const issue = 'Haven’t received your parcel or noticed a problem?';
    add(spacer(20) + table(`<tr><td style="padding:18px 20px;background:${COLORS.paper};border-left:3px solid ${COLORS.wine};font-size:14px;line-height:23px;">${escape(issue)} <a href="${escape(helpUrl)}" style="color:${COLORS.wine};font-weight:600;text-decoration:underline;">Contact us.</a></td></tr>`), `${issue} Contact us: ${helpUrl}`);
    action = { label: 'Explore the collection', href: `${SITE}/shop` };
  } else {
    // No cancellation reason is recorded, and refunds follow the published policy only.
    const paid = order.paymentStatus === 'paid';
    subject = `Order cancelled — Anjola order #${orderNumber}`;
    preheader = 'Your order has been cancelled. Here are the details.';
    label = 'Order cancelled';
    title = 'Your order has been cancelled.';
    say(`Your order #${orderNumber} has been cancelled.`);
    say(paid ? 'Your payment for this order is recorded. A cancellation and a refund are separate steps — we’ll explain any refund due.'
      : 'Our records show no payment for this order, so there’s nothing more you need to do. If you’ve already paid, please contact us with your payment reference and we’ll look into it.');
    section('Cancelled order');
    priced(paid ? 'Total paid' : 'Order total');
    const reference = paid && clean(order.paymentReference);
    if (reference) add(fine([`Payment reference: ${reference}`]), `Payment reference: ${reference}`);
    const policy = `${SITE}/returns-policy#cancellations`;
    add(spacer(16) + `<p style="margin:0 0 18px;font-size:13px;line-height:22px;"><a href="${policy}" style="color:${COLORS.wine};text-decoration:underline;">Read about cancellations and refunds</a></p>`, `Read about cancellations and refunds: ${policy}`);
    say('We hope to welcome you back soon.');
  }

  return {
    subject,
    html: layout({ order, title, subtitle, label, preheader, strip, html: content.join('\n'), action, helpUrl }),
    text: ['Anjola Aesthetics', 'Beautiful finds. Thoughtful gifts. Little joys.', label, title,
      subtitle, `Order #${orderNumber}`, ...text, `${action.label}: ${action.href}`,
      `WhatsApp support: ${helpUrl}`, `Email: ${SUPPORT}`,
      `Shipping policy: ${SITE}/shipping-policy`, `Returns policy: ${SITE}/returns-policy`,
      'Anjola Aesthetics Ng · Abeokuta, Nigeria'].filter(Boolean).join('\n\n'),
    replyTo: SUPPORT
  };
}

module.exports = { renderOrderEmail };
