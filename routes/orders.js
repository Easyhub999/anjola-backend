const express = require('express');
const router = express.Router();
const {
  createOrder,
  getAllOrders,
  getMyOrders,
  updateOrderStatus,
  initializePaymentHandler,
  verifyPaymentHandler
} = require('../controllers/orderController');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');
const mongoose = require('mongoose');
const notificationController = require('../controllers/notificationController').createNotificationController({
  Order: require('../models/Order'), runTransaction: work => mongoose.connection.transaction(work)
});

// Public routes
router.post('/', optionalAuth, createOrder);
router.post('/initialize-payment', initializePaymentHandler);
router.get('/verify-payment/:reference', verifyPaymentHandler);
router.post('/paystack-webhook', require('../controllers/orderController').paystackWebhook);

// Protected routes
router.get('/my-orders', protect, getMyOrders);

// Admin routes
router.get('/', protect, adminOnly, getAllOrders);
router.get('/:id/notifications', protect, adminOnly, notificationController.getNotifications);
router.post('/:id/notifications', protect, adminOnly, notificationController.sendNotification);
router.post('/:id/notifications/:notificationId/retry', protect, adminOnly, notificationController.retryNotification);
router.patch('/:id/notifications/preferences', protect, adminOnly, notificationController.updatePreferences);
router.post('/:id/record-payment', protect, adminOnly, require('../controllers/orderController').recordManualPayment);
router.put('/:id', protect, adminOnly, updateOrderStatus);
router.post('/manual', protect, adminOnly, require('../controllers/orderController').createManualOrder);

module.exports = router;
