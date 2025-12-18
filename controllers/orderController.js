const Order = require('../models/Order');
const { initializePayment, verifyPayment } = require('../services/paystackService');
const { sendOrderConfirmation, sendPaymentConfirmation } = require('../services/emailService');
const crypto = require('crypto');

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

    console.log('🔍 Verifying payment reference:', reference);

    const response = await verifyPayment(reference);

    console.log('✅ Paystack response received:', JSON.stringify(response, null, 2));

    if (response.status && response.data.status === 'success') {
      const orderId = response.data.metadata.orderId;
      
      console.log('💾 Updating order:', orderId);
      
      const order = await Order.findByIdAndUpdate(
        orderId,
        {
          paymentStatus: 'paid',
          paymentReference: reference,
          status: 'processing'
        },
        { new: true }
      );

      if (!order) {
        console.error('❌ Order not found:', orderId);
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      console.log('📧 Sending confirmation email...');

      // Send payment confirmation email
      try {
        await sendPaymentConfirmation({
          customerInfo: order.customerInfo,
          totalAmount: order.totalAmount,
          orderNumber: order.orderNumber,
          paymentReference: reference
        });
        console.log('✅ Email sent successfully');
      } catch (emailError) {
        console.error('⚠️ Email sending failed (non-critical):', emailError.message);
        // Continue even if email fails
      }

      res.json({
        success: true,
        message: 'Payment verified successfully',
        data: response.data
      });
    } else {
      console.error('❌ Payment not successful:', response);
      res.status(400).json({
        success: false,
        message: 'Payment verification failed - payment status not successful'
      });
    }
  } catch (error) {
    console.error('💥 Payment verification error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error verifying payment: ' + error.message 
    });
  }
};

// @desc    Paystack Webhook Handler
// @route   POST /api/orders/paystack-webhook
// @access  Public (verified by signature)
exports.paystackWebhook = async (req, res) => {
  try {
    // Verify webhook signature
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.log('❌ Invalid webhook signature');
      return res.sendStatus(401);
    }

    const event = req.body;
    console.log('📥 Webhook event received:', event.event);

    // Handle successful charge
    if (event.event === 'charge.success') {
      const orderId = event.data.metadata.orderId;
      const reference = event.data.reference;
      
      console.log('💰 Payment successful for order:', orderId);
      
      // Update order
      const order = await Order.findByIdAndUpdate(
        orderId,
        {
          paymentStatus: 'paid',
          paymentReference: reference,
          status: 'processing'
        },
        { new: true }
      );
      
      if (order) {
        console.log('✅ Order updated:', order.orderNumber);
        
        // Send payment confirmation email
        try {
          await sendPaymentConfirmation({
            customerInfo: order.customerInfo,
            totalAmount: order.totalAmount,
            orderNumber: order.orderNumber,
            paymentReference: reference,
            items: order.items
          });
          console.log('📧 Order confirmation email sent!');
        } catch (emailError) {
          console.error('⚠️ Email error:', emailError);
        }
      } else {
        console.error('❌ Order not found:', orderId);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('💥 Webhook error:', error);
    res.sendStatus(500);
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

// @desc    Create manual order
// @route   POST /api/orders/manual
// @access  Private/Admin
exports.createManualOrder = async (req, res) => {
  try {
    const { customerInfo, items, totalAmount, paymentStatus, status, isManualOrder } = req.body;

    // Generate order number with MAN prefix for manual orders
    const orderNumber = `MAN${Date.now().toString().slice(-8)}`;

    const order = await Order.create({
      user: req.user ? req.user._id : null,
      orderNumber,
      customerInfo,
      items,
      totalAmount,
      paymentStatus: paymentStatus || 'pending',
      status: status || 'pending',
      isManualOrder: isManualOrder || true
    });

    res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Create manual order error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error creating manual order',
      error: error.message 
    });
  }
};