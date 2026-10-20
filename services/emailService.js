const { Resend } = require('resend');
const { renderOrderEmail } = require('./orderEmailTemplates');

// Construct lazily: missing provider configuration must not stop orders being saved.
let resend;
const getResend = () => resend || (resend = new Resend(process.env.RESEND_API_KEY));
const REQUEST_TIMEOUT_MS = 15000;

const retryDelay = headers => {
  const value = headers?.['retry-after'] ?? headers?.get?.('retry-after');
  if (value === undefined || value === null || value === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
};

const emailFailure = (error, { transport = false, headers } = {}) => {
  const status = Number(error?.statusCode || error?.status) || undefined;
  let errorCode = error?.code || error?.name || 'email_error';
  const message = error?.message || 'Email could not be sent';
  if (/missing api key/i.test(message)) errorCode = 'missing_api_key';
  const permanentCodes = new Set(['missing_api_key', 'invalid_api_key', 'restricted_api_key',
    'suspended_api_key', 'invalid_from_address', 'validation_error', 'invalid_parameter',
    'missing_required_field', 'invalid_idempotency_key', 'invalid_idempotent_request']);
  const networkFailure = transport && !status && !permanentCodes.has(errorCode);
  const retryable = !permanentCodes.has(errorCode) && (networkFailure || status === 408 ||
    status === 429 || status >= 500 || ['concurrent_idempotent_requests', 'resource_locked'].includes(errorCode));
  return {
    success: false,
    error: message,
    errorCode,
    retryable: Boolean(retryable),
    // Unknown acceptance requires the same idempotency key, never a blind new send.
    ambiguous: Boolean(networkFailure || status === 408 || status >= 500 ||
      ['concurrent_idempotent_requests', 'invalid_idempotent_request'].includes(errorCode)),
    retryAfterMs: retryDelay(headers)
  };
};

const sendEmail = async (payload, options = {}) => {
  try {
    if (options.prepareOnly) return { success: true, message: payload };
    // resend 6.x passes these options through to fetch, including AbortSignal.
    const requestOptions = { idempotencyKey: options.idempotencyKey };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      requestOptions.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    }
    const result = await getResend().emails.send(payload, requestOptions);
    if (result?.error) return emailFailure(result.error, { transport: true, headers: result.headers });
    if (!result?.data?.id) return emailFailure({
      code: 'missing_message_id', message: 'Email provider returned no message ID; acceptance is unknown'
    }, { transport: true });
    return { success: true, messageId: result.data.id };
  } catch (error) {
    return emailFailure(error, { transport: true });
  }
};

// Every order email uses the shared brand templates and plain-text alternative.
// Sending and preparation still go through the existing idempotent provider path.
const sendBrandedNotification = async (type, orderData, options = {}) => {
  try {
    if (orderData.isManualOrder && (!orderData.customerInfo?.email || !orderData.sendCustomerEmail)) return { success: true, skipped: true };
    return await sendEmail({
      from: process.env.EMAIL_FROM,
      to: orderData.customerInfo.email,
      ...renderOrderEmail(type, orderData)
    }, options);
  } catch (error) {
    // Identify the failed template without logging customer details.
    console.error({ event: 'order_notification_render_failed', type, errorName: error?.name });
    return emailFailure(error);
  }
};

exports.sendOrderConfirmation = (orderData, options = {}) =>
  sendBrandedNotification('order_confirmation', orderData, options);
exports.sendPaymentConfirmation = (orderData, options = {}) =>
  sendBrandedNotification('payment_confirmation', orderData, options);
// A received payment under review must not promise that preparation has started.
exports.sendPaymentReviewNotification = (orderData, options = {}) =>
  sendBrandedNotification('payment_review', orderData, options);
exports.sendShippedNotification = (orderData, options = {}) =>
  sendBrandedNotification('shipped', orderData, options);
exports.sendDeliveredNotification = (orderData, options = {}) =>
  sendBrandedNotification('delivered', orderData, options);
exports.sendCancelledNotification = (orderData, options = {}) =>
  sendBrandedNotification('cancelled', orderData, options);

// Render once and persist the complete request before sending. Idempotent retries
// must keep the exact body even if templates or sender settings subsequently change.
exports.prepareNotification = async (type, orderData) => {
  const senders = {
    order_confirmation: exports.sendOrderConfirmation,
    payment_confirmation: exports.sendPaymentConfirmation,
    payment_review: exports.sendPaymentReviewNotification,
    shipped: exports.sendShippedNotification,
    delivered: exports.sendDeliveredNotification,
    cancelled: exports.sendCancelledNotification
  };
  const sender = senders[type];
  if (!sender) return emailFailure({ code: 'invalid_notification_type', message: 'Unknown order notification type' });
  const prepared = await sender(orderData, { prepareOnly: true });
  if (!prepared.success || prepared.skipped) return prepared;
  if (!prepared.message.from || typeof prepared.message.from !== 'string') {
    return emailFailure({ code: 'missing_sender_configuration', message: 'EMAIL_FROM is not configured' });
  }
  const tags = [];
  for (const [name, value] of [['notification_id', orderData.notificationId], ['order_id', orderData.orderId]]) {
    if (value === undefined || value === null) continue;
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(String(value))) {
      return emailFailure({ code: 'invalid_notification_tag', message: 'Invalid order notification identifier' });
    }
    tags.push({ name, value: String(value) });
  }
  if (tags.length) prepared.message.tags = tags;
  return prepared;
};

exports.sendPreparedEmail = (message, options = {}) => sendEmail(message, options);

module.exports = exports;
