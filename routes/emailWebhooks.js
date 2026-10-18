const express = require('express');
const { verifyResendWebhook } = require('../services/resendWebhook');
const { applyNotificationEvent } = require('../services/notificationEvents');
const Order = require('../models/Order');
const router = express.Router();

router.post('/resend', async (req, res) => {
  try {
    const event = verifyResendWebhook(req.rawBody, req.headers);
    await applyNotificationEvent({ Order, event, eventId: req.headers['svix-id'] });
    res.sendStatus(200);
  } catch (error) {
    if (!error.statusCode) console.error({ event: 'order_notification_webhook_error' });
    res.sendStatus(error.statusCode || 503);
  }
});

module.exports = router;
