const Order = require('../models/Order');

// Helper: Calculate date ranges
const getDateRange = (period) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  switch (period) {
    case 'today':
      return { start: today, end: new Date() };
    
    case 'week':
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 7);
      return { start: weekStart, end: new Date() };
    
    case 'month':
      const monthStart = new Date(today);
      monthStart.setDate(today.getDate() - 30);
      return { start: monthStart, end: new Date() };
    
    case 'year':
      const yearStart = new Date(today);
      yearStart.setFullYear(today.getFullYear() - 1);
      return { start: yearStart, end: new Date() };
    
    default:
      return { start: new Date(0), end: new Date() };
  }
};

// @desc    Get revenue analytics
// @route   GET /api/analytics/revenue
// @access  Private/Admin
exports.getRevenueAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Calculate all time periods
    const periods = ['today', 'week', 'month', 'year', 'all'];
    const analytics = {};
    
    for (const period of periods) {
      const range = getDateRange(period);
      
      // Gross Revenue (all paid orders)
      const grossOrders = await Order.find({
        paymentStatus: 'paid',
        createdAt: { $gte: range.start, $lte: range.end }
      });
      
      const grossRevenue = grossOrders.reduce((sum, order) => sum + order.totalAmount, 0);
      
      // Net Revenue (excluding cancelled)
      const netOrders = await Order.find({
        paymentStatus: 'paid',
        status: { $ne: 'cancelled' },
        createdAt: { $gte: range.start, $lte: range.end }
      });
      
      const netRevenue = netOrders.reduce((sum, order) => sum + order.totalAmount, 0);
      
      analytics[period] = {
        grossRevenue,
        netRevenue,
        orderCount: grossOrders.length,
        cancelledRevenue: grossRevenue - netRevenue
      };
    }
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching analytics' 
    });
  }
};

// @desc    Get monthly revenue breakdown (for charts)
// @route   GET /api/analytics/monthly-breakdown
// @access  Private/Admin
exports.getMonthlyBreakdown = async (req, res) => {
  try {
    const { months = 12 } = req.query;
    
    const monthlyData = [];
    const now = new Date();
    
    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      
      const orders = await Order.find({
        paymentStatus: 'paid',
        createdAt: { $gte: monthStart, $lte: monthEnd }
      });
      
      const netOrders = orders.filter(o => o.status !== 'cancelled');
      
      monthlyData.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        grossRevenue: orders.reduce((sum, o) => sum + o.totalAmount, 0),
        netRevenue: netOrders.reduce((sum, o) => sum + o.totalAmount, 0),
        orders: orders.length
      });
    }
    
    res.json({
      success: true,
      data: monthlyData
    });
  } catch (error) {
    console.error('Monthly breakdown error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
};

// @desc    Get top selling products
// @route   GET /api/analytics/top-products
// @access  Private/Admin
exports.getTopProducts = async (req, res) => {
  try {
    const { limit = 10, period = 'all' } = req.query;
    const range = getDateRange(period);
    
    const orders = await Order.find({
      paymentStatus: 'paid',
      status: { $ne: 'cancelled' },
      createdAt: { $gte: range.start, $lte: range.end }
    });
    
    // Aggregate product sales
    const productStats = {};
    
    orders.forEach(order => {
      order.items.forEach(item => {
        const key = item.name;
        if (!productStats[key]) {
          productStats[key] = {
            name: item.name,
            totalQuantity: 0,
            totalRevenue: 0
          };
        }
        productStats[key].totalQuantity += item.quantity;
        productStats[key].totalRevenue += item.price * item.quantity;
      });
    });
    
    // Sort by revenue
    const topProducts = Object.values(productStats)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, parseInt(limit));
    
    res.json({
      success: true,
      data: topProducts
    });
  } catch (error) {
    console.error('Top products error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
};

// @desc    Get order status breakdown
// @route   GET /api/analytics/order-status
// @access  Private/Admin
exports.getOrderStatusBreakdown = async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    const range = getDateRange(period);
    
    const orders = await Order.find({
      createdAt: { $gte: range.start, $lte: range.end }
    });
    
    const statusBreakdown = {
      pending: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0
    };
    
    orders.forEach(order => {
      if (statusBreakdown.hasOwnProperty(order.status)) {
        statusBreakdown[order.status]++;
      }
    });
    
    res.json({
      success: true,
      data: statusBreakdown
    });
  } catch (error) {
    console.error('Order status error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
};

// @desc    Get payment status breakdown
// @route   GET /api/analytics/payment-status
// @access  Private/Admin
exports.getPaymentStatusBreakdown = async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    const range = getDateRange(period);
    
    const orders = await Order.find({
      createdAt: { $gte: range.start, $lte: range.end }
    });
    
    const paymentBreakdown = {
      paid: 0,
      pending: 0,
      failed: 0
    };
    
    orders.forEach(order => {
      if (paymentBreakdown.hasOwnProperty(order.paymentStatus)) {
        paymentBreakdown[order.paymentStatus]++;
      }
    });
    
    res.json({
      success: true,
      data: paymentBreakdown
    });
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
};