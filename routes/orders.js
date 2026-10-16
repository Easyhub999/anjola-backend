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

// Public routes
router.post('/', optionalAuth, createOrder);
router.post('/initialize-payment', initializePaymentHandler);
router.get('/verify-payment/:reference', verifyPaymentHandler);
router.post('/paystack-webhook', require('../controllers/orderController').paystackWebhook);

// Protected routes
router.get('/my-orders', protect, getMyOrders);

// Admin routes
router.get('/', protect, adminOnly, getAllOrders);
router.post('/:id/record-payment', protect, adminOnly, require('../controllers/orderController').recordManualPayment);
router.put('/:id', protect, adminOnly, updateOrderStatus);
router.post('/manual', protect, adminOnly, require('../controllers/orderController').createManualOrder);

module.exports = router;