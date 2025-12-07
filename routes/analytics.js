const express = require('express');
const router = express.Router();
const {
  getRevenueAnalytics,
  getMonthlyBreakdown,
  getTopProducts,
  getOrderStatusBreakdown,
  getPaymentStatusBreakdown
} = require('../controllers/analyticsController');
const { protect, adminOnly } = require('../middleware/auth');

// All routes are protected and admin only
router.use(protect);
router.use(adminOnly);

router.get('/revenue', getRevenueAnalytics);
router.get('/monthly-breakdown', getMonthlyBreakdown);
router.get('/top-products', getTopProducts);
router.get('/order-status', getOrderStatusBreakdown);
router.get('/payment-status', getPaymentStatusBreakdown);

module.exports = router;