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
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  
  console.log('EMAIL_FROM:', process.env.EMAIL_FROM);
  console.log('API_KEY exists:', !!process.env.RESEND_API_KEY);
  
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: 'scribesoul.a@gmail.com',
      subject: 'Test Email',
      html: '<h1>Hello!</h1>'
    });
    
    console.log('Data:', data);
    console.log('Error:', error);
    
    res.json({ data, error, from: process.env.EMAIL_FROM });
  } catch (err) {
    console.log('Catch error:', err);
    res.json({ caught: err.message });
  }
});

module.exports = router;