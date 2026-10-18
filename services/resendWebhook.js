const { Resend } = require('resend');

const webhookError = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

// Signature verification uses only the webhook secret. The SDK requires a
// constructor key even though this operation does not make any API request.
const verifier = new Resend('webhook-verification-only');

const verifyResendWebhook = (rawBody, headers, secret = process.env.RESEND_WEBHOOK_SECRET) => {
  if (!secret) throw webhookError('Email delivery webhook is not configured', 'webhook_not_configured', 503);
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') {
    throw webhookError('The original webhook body is required', 'invalid_webhook_body');
  }
  const header = name => headers?.[name] ?? headers?.get?.(name);
  const id = header('svix-id');
  const timestamp = header('svix-timestamp');
  const signature = header('svix-signature');
  if (![id, timestamp, signature].every(value => typeof value === 'string' && value.length > 0)) {
    throw webhookError('Invalid email delivery webhook signature', 'invalid_webhook_signature');
  }
  let event;
  try {
    event = verifier.webhooks.verify({
      payload: Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody,
      headers: { id, timestamp, signature },
      webhookSecret: secret
    });
  } catch {
    throw webhookError('Invalid email delivery webhook signature', 'invalid_webhook_signature');
  }
  if (!event || typeof event.type !== 'string' || !event.data || typeof event.data !== 'object') {
    throw webhookError('Invalid email delivery webhook event', 'invalid_webhook_event');
  }
  return event;
};

module.exports = { verifyResendWebhook };
