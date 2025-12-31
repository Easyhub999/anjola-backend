const Order = require('../models/Order');
const Product = require('../models/Product');
const { initializePayment, verifyPayment } = require('../services/paystackService');
const { 
  sendOrderConfirmation, 
  sendPaymentConfirmation,
  sendShippedNotification,
  sendDeliveredNotification,
  sendCancelledNotification
} = require('../services/emailService');
const crypto = require('crypto');

// 🔥 HELPER: Deduct stock from products after successful payment
const deductStockFromOrder = async (orderItems) => {
  console.log('📦 Deducting stock for order items...');
  
  for (const item of orderItems) {
    try {
      const product = await Product.findById(item.product);
      if (!product) {
        console.warn(`⚠️ Product not found: ${item.product}`);
        continue;
      }

      const qtyToDeduct = item.quantity || 1;

      // 🔥 Check if product has color-based inventory
      if (product.colors && product.colors.length > 0 && item.selectedColor) {
        // Find the specific color
        const colorIndex = product.colors.findIndex(c => 
          c.name && c.name.toLowerCase() === item.selectedColor.toLowerCase()
        );

        if (colorIndex !== -1) {
          // Deduct from specific color
          const currentColorQty = product.colors[colorIndex].quantity || 0;
          product.colors[colorIndex].quantity = Math.max(0, currentColorQty - qtyToDeduct);
          
          console.log(`✅ Deducted ${qtyToDeduct} from ${product.name} (${item.selectedColor}): ${currentColorQty} → ${product.colors[colorIndex].quantity}`);
          
          // Recalculate total product quantity from all colors
          product.quantity = product.colors.reduce((sum, c) => sum + (c.quantity || 0), 0);
        } else {
          // Color not found, deduct from total quantity
          console.warn(`⚠️ Color "${item.selectedColor}" not found in ${product.name}, deducting from total`);
          product.quantity = Math.max(0, (product.quantity || 0) - qtyToDeduct);
        }
      } else {
        // No color-based inventory, deduct from total quantity
        product.quantity = Math.max(0, (product.quantity || 0) - qtyToDeduct);
        console.log(`✅ Deducted ${qtyToDeduct} from ${product.name}: now ${product.quantity}`);
      }

      // Update inStock status
      product.inStock = product.quantity > 0;

      // 🔥 Auto-hide if enabled and quantity is 0
      if (product.autoHideWhenZero && product.quantity <= 0) {
        product.visible = false;
        console.log(`👁️ Auto-hiding ${product.name} (out of stock)`);
      }

      await product.save();
    } catch (err) {
      console.error(`❌ Error deducting stock for product ${item.product}:`, err);
    }
  }
  
  console.log('✅ Stock deduction complete');
};

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

    // Email will be sent after payment confirmation

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

      // 🔥 DEDUCT STOCK FROM PRODUCTS
      await deductStockFromOrder(order.items);

      console.log('📧 Sending confirmation email...');

      // Send payment confirmation email
      try {
        await sendPaymentConfirmation({
          customerInfo: order.customerInfo,
          totalAmount: order.totalAmount,
          orderNumber: order.orderNumber,
          paymentReference: reference,
          items: order.items
        });
        console.log('✅ Email sent successfully');
      } catch (emailError) {
        console.error('⚠️ Email sending failed (non-critical):', emailError.message);
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
        message: 'Payment verification failed'
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
      
      // Check if order already processed (prevent double processing)
      const existingOrder = await Order.findById(orderId);
      if (existingOrder && existingOrder.paymentStatus === 'paid') {
        console.log('⚠️ Order already processed, skipping...');
        return res.sendStatus(200);
      }
      
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
        
        // 🔥 DEDUCT STOCK FROM PRODUCTS
        await deductStockFromOrder(order.items);
        
        // Send payment confirmation email
        try {
          await sendPaymentConfirmation({
            customerInfo: order.customerInfo,
            totalAmount: order.totalAmount,
            orderNumber: order.orderNumber,
            paymentReference: reference,
            items: order.items
          });
          console.log('📧 Payment confirmation email sent!');
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

// @desc    Update order status (WITH EMAIL NOTIFICATIONS)
// @route   PUT /api/orders/:id
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, trackingNumber } = req.body;
    
    const updateData = { status };
    if (trackingNumber) {
      updateData.trackingNumber = trackingNumber;
    }
    
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Send appropriate email notification based on status
    try {
      if (status === 'shipped') {
        await sendShippedNotification({
          customerInfo: order.customerInfo,
          orderNumber: order.orderNumber,
          trackingNumber: trackingNumber || order.trackingNumber
        });
        console.log('📧 Shipped notification sent');
      } else if (status === 'delivered') {
        await sendDeliveredNotification({
          customerInfo: order.customerInfo,
          orderNumber: order.orderNumber
        });
        console.log('📧 Delivered notification sent');
      } else if (status === 'cancelled') {
        // 🔥 RESTORE STOCK when order is cancelled
        await restoreStockFromOrder(order.items);
        
        await sendCancelledNotification({
          customerInfo: order.customerInfo,
          orderNumber: order.orderNumber,
          refundInfo: 'Your refund will be processed within 5-7 business days.'
        });
        console.log('📧 Cancelled notification sent');
      }
    } catch (emailError) {
      console.error('⚠️ Email notification error:', emailError);
      // Don't fail the status update if email fails
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

// 🔥 HELPER: Restore stock when order is cancelled
const restoreStockFromOrder = async (orderItems) => {
  console.log('📦 Restoring stock for cancelled order...');
  
  for (const item of orderItems) {
    try {
      const product = await Product.findById(item.product);
      if (!product) {
        console.warn(`⚠️ Product not found: ${item.product}`);
        continue;
      }

      const qtyToRestore = item.quantity || 1;

      // Check if product has color-based inventory
      if (product.colors && product.colors.length > 0 && item.selectedColor) {
        const colorIndex = product.colors.findIndex(c => 
          c.name && c.name.toLowerCase() === item.selectedColor.toLowerCase()
        );

        if (colorIndex !== -1) {
          product.colors[colorIndex].quantity = (product.colors[colorIndex].quantity || 0) + qtyToRestore;
          console.log(`✅ Restored ${qtyToRestore} to ${product.name} (${item.selectedColor})`);
          
          // Recalculate total
          product.quantity = product.colors.reduce((sum, c) => sum + (c.quantity || 0), 0);
        } else {
          product.quantity = (product.quantity || 0) + qtyToRestore;
        }
      } else {
        product.quantity = (product.quantity || 0) + qtyToRestore;
        console.log(`✅ Restored ${qtyToRestore} to ${product.name}`);
      }

      // Update inStock and visibility
      product.inStock = product.quantity > 0;
      if (product.quantity > 0) {
        product.visible = true; // Make visible again if stock restored
      }

      await product.save();
    } catch (err) {
      console.error(`❌ Error restoring stock for product ${item.product}:`, err);
    }
  }
  
  console.log('✅ Stock restoration complete');
};

// @desc    Create manual order
// @route   POST /api/orders/manual
// @access  Private/Admin
exports.createManualOrder = async (req, res) => {
  try {
    const { customerInfo, items, totalAmount, paymentStatus, status, isManualOrder } = req.body;

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

    // 🔥 If manual order is marked as paid, deduct stock
    if (paymentStatus === 'paid') {
      await deductStockFromOrder(items);
    }

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