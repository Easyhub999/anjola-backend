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
router.post('/paystack-webhook', require('../controllers/orderController').paystackWebhook);

// Protected routes
router.get('/my-orders', protect, getMyOrders);

// Admin routes
router.get('/', protect, adminOnly, getAllOrders);
router.put('/:id', protect, adminOnly, updateOrderStatus);
router.post('/manual', protect, adminOnly, require('../controllers/orderController').createManualOrder);

// TEMPORARY TEST - Delete after testing
router.get('/test-email', async (req, res) => {
  const { sendPaymentConfirmation } = require('../services/emailService');
  
  try {
    const result = await sendPaymentConfirmation({
      customerInfo: {
        fullName: 'Test User',
        email: 'xvong91@gmail.com', // 👈 Put your actual email
        phone: '08012345678',
        address: 'Test Address',
        city: 'Lagos',
        state: 'Lagos'
      },
      totalAmount: 5000,
      orderNumber: 'TEST123',
      paymentReference: 'test_ref_123',
      items: [{ name: 'Test Product', price: 5000, quantity: 1 }]
    });
    
    res.json({ success: true, result });
  } catch (error) {
    res.json({ success: false, error: error.message, stack: error.stack });
  }
});

module.exports = router;