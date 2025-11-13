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
const { protect, adminOnly } = require('../middleware/auth');

// Public routes
router.post('/', createOrder);
router.post('/initialize-payment', initializePaymentHandler);
router.get('/verify-payment/:reference', verifyPaymentHandler);

// Protected routes
router.get('/my-orders', protect, getMyOrders);

// Admin routes
router.get('/', protect, adminOnly, getAllOrders);
router.put('/:id', protect, adminOnly, updateOrderStatus);

module.exports = router;