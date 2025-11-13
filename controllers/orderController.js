const Order = require('../models/Order');
const { initializePayment, verifyPayment } = require('../services/paystackService');
const { sendOrderConfirmation, sendPaymentConfirmation } = require('../services/emailService');

// @desc    Create new order
// @route   POST /api/orders
// @access  Public
exports.createOrder = async (req, res) => {
  try {
    const { customerInfo, items, totalAmount } = req.body;

    // Generate order number
    const orderNumber = `ANJ${Date.now()}`;

    // Create order
    const order = await Order.create({
      user: req.user ? req.user._id : null,
      orderNumber,
      customerInfo,
      items,
      totalAmount,
      status: 'pending',
      paymentStatus: 'pending'
    });

    // Send order confirmation email
    await sendOrderConfirmation({
      customerInfo,
      items,
      totalAmount,
      orderNumber
    });

    res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Server error creating order' });
  }
};

// @desc    Initialize Paystack payment
// @route   POST /api/orders/initialize-payment
// @access  Public
exports.initializePaymentHandler = async (req, res) => {
  try {
    const { email, amount, orderId, customerInfo } = req.body;

    const metadata = {
      orderId,
      customerName: customerInfo.fullName,
      customerPhone: customerInfo.phone
    };

    const response = await initializePayment(email, amount, metadata);

    if (response.status) {
      res.json({
        success: true,
        data: response.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment initialization failed'
      });
    }
  } catch (error) {
    console.error('Payment initialization error:', error);
    res.status(500).json({ message: 'Server error initializing payment' });
  }
};

// @desc    Verify Paystack payment
// @route   GET /api/orders/verify-payment/:reference
// @access  Public
exports.verifyPaymentHandler = async (req, res) => {
  try {
    const { reference } = req.params;

    const response = await verifyPayment(reference);

    if (response.status && response.data.status === 'success') {
      // Update order payment status
      const orderId = response.data.metadata.orderId;
      const order = await Order.findByIdAndUpdate(
        orderId,
        {
          paymentStatus: 'paid',
          paymentReference: reference,
          status: 'processing'
        },
        { new: true }
      );

      // Send payment confirmation email
      await sendPaymentConfirmation({
        customerInfo: order.customerInfo,
        totalAmount: order.totalAmount,
        orderNumber: order.orderNumber,
        paymentReference: reference
      });

      res.json({
        success: true,
        message: 'Payment verified successfully',
        data: response.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ message: 'Server error verifying payment' });
  }
};

// @desc    Get all orders (Admin)
// @route   GET /api/orders
// @access  Private/Admin
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('user', 'name email')
      .populate('items.product')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get user orders
// @route   GET /api/orders/my-orders
// @access  Private
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate('items.product')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (error) {
    console.error('Get my orders error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};