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
const mongoose = require('mongoose');
const { priceOrder, checkoutError } = require('../services/orderPricing');
const { createPaymentProcessor } = require('../services/paymentProcessing');
const { changeStock, createOrderStatusUpdater } = require('../services/orderStatus');
const updateStatus = createOrderStatusUpdater({ Order, Product, runTransaction: work => mongoose.connection.transaction(work) });

const processPayment = createPaymentProcessor({
  Order, Product,
  runTransaction: work => mongoose.connection.transaction(work)
});

const sendPaymentReceipt = async ({ order, newlyPaid }) => {
  if (!newlyPaid) return;
  if (order.paymentReviewReason) {
    console.error('Payment requires manual review:', order.orderNumber, order.paymentReviewReason);
    return;
  }
  try {
    const result = await sendPaymentConfirmation(order);
    if (!result?.success) console.error('Payment email failed for order:', order.orderNumber);
  } catch (error) {
    console.error('Payment email failed for order:', order.orderNumber);
  }
};

const paymentError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.statusCode ? error.message : 'Unable to process payment. Please try again or contact support.'
});

// Public checkout always creates a server-priced snapshot.
exports.createOrder = async (req, res) => {
  try {
    const priced = await priceOrder(req.body, id => Product.findById(id));
    const order = await Order.create({
      ...priced,
      user: req.user ? req.user._id : null,
      orderNumber: `ANJ${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      paymentReference: `anj-${crypto.randomUUID()}`,
      status: 'pending', paymentStatus: 'pending', stockDeducted: false
    });
    res.status(201).json({ success: true, data: order });
    // Send only after the order is saved; email failure must not undo checkout.
    try {
      const result = await sendOrderConfirmation(order);
      if (!result?.success) console.error('Order confirmation failed:', order.orderNumber, result?.error);
    } catch (error) {
      console.error('Order confirmation failed:', order.orderNumber, error.message);
    }
  } catch (error) {
    console.error('Create order error:', error.message);
    paymentError(res, error);
  }
};

exports.initializePaymentHandler = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (typeof orderId !== 'string' || !/^[a-f\d]{24}$/i.test(orderId)) throw checkoutError('Invalid order');
    const order = await Order.findById(orderId).select('+paymentAuthorizationUrl');
    if (!order) throw checkoutError('Order not found', 404);
    if (order.pricingVersion !== 1) throw checkoutError('Please start a new checkout for this older order.', 409);
    if (order.paymentStatus !== 'pending' || order.status !== 'pending') throw checkoutError('This order is no longer awaiting payment', 409);
    if (order.paymentAuthorizationUrl) {
      return res.json({ success: true, data: { authorization_url: order.paymentAuthorizationUrl, reference: order.paymentReference } });
    }
    const response = await initializePayment(order.customerInfo.email, order.expectedAmount, {
      orderId: String(order._id),
      customerName: order.customerInfo.fullName,
      customerPhone: order.customerInfo.phone
    }, order.paymentReference);
    if (!response.status || !response.data?.authorization_url || response.data.reference !== order.paymentReference) {
      throw checkoutError('Payment initialization failed. Please try again.', 502);
    }
    await Order.updateOne({ _id: order._id }, { $set: { paymentAuthorizationUrl: response.data.authorization_url } });
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Payment initialization error:', error.message);
    paymentError(res, error);
  }
};

exports.verifyPaymentHandler = async (req, res) => {
  try {
    const { reference } = req.params;
    if (!/^[a-zA-Z0-9.=-]{1,200}$/.test(reference)) throw checkoutError('Invalid payment reference');
    const response = await verifyPayment(reference);
    if (response?.status !== true || response.data?.reference !== reference) throw checkoutError('Payment verification failed');
    const result = await processPayment(response.data);
    // Do not return Paystack card authorizations or customer details to this public endpoint.
    res.json({ success: true, data: {
      reference, amount: response.data.amount,
      currency: response.data.currency,
      needsReview: Boolean(result.order.paymentReviewReason)
    } });
    // Payment has committed. Receipt delivery must not delay customer confirmation.
    await sendPaymentReceipt(result);
  } catch (error) {
    console.error('Payment verification error:', error.message);
    paymentError(res, error);
  }
};

exports.paystackWebhook = async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.sendStatus(503);
    const signature = req.headers['x-paystack-signature'];
    if (!Buffer.isBuffer(req.rawBody) || typeof signature !== 'string' || !/^[a-f\d]{128}$/i.test(signature)) {
      return res.sendStatus(401);
    }
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(req.rawBody).digest();
    if (!crypto.timingSafeEqual(hash, Buffer.from(signature, 'hex'))) return res.sendStatus(401);
    let result;
    if (req.body.event === 'charge.success') {
      let payment = req.body.data;
      // Older webhook payloads can omit the original requested amount. Obtain it
      // from Paystack before deciding whether a higher charge is a customer fee.
      if (payment?.requested_amount == null) {
        if (typeof payment?.reference !== 'string' || !/^[a-zA-Z0-9.=-]{1,200}$/.test(payment.reference)) {
          throw checkoutError('Invalid payment reference');
        }
        const response = await verifyPayment(payment.reference);
        if (response?.status !== true || response.data?.reference !== payment.reference) throw checkoutError('Payment verification failed');
        payment = response.data;
      }
      result = await processPayment(payment);
    }
    res.sendStatus(200);
    if (result) await sendPaymentReceipt(result);
  } catch (error) {
    console.error('Payment webhook error:', error.message);
    res.sendStatus(error.statusCode || 500);
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

// Status and stock changes commit together; repeat requests have no side effects.
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, trackingNumber } = req.body;
    const { order, changed } = await updateStatus(req.params.id, status, trackingNumber);
    if (changed) {
      try {
        if (status === 'shipped') await sendShippedNotification(order);
        else if (status === 'delivered') await sendDeliveredNotification(order);
        else if (status === 'cancelled') await sendCancelledNotification({
          customerInfo: order.customerInfo, orderNumber: order.orderNumber,
          items: order.items, totalAmount: order.totalAmount,
          refundInfo: order.paymentStatus === 'paid'
            ? 'Please contact us to confirm your refund arrangements. Cancellation does not automatically issue a refund.'
            : undefined
        });
      } catch (error) { console.error('Order notification failed:', order.orderNumber); }
    }
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false,
      message: error.statusCode ? error.message : 'Unable to update order. No partial inventory update was committed.' });
  }
};

// @desc    Create manual order
// @route   POST /api/orders/manual
// @access  Private/Admin
exports.createManualOrder = async (req, res) => {
  try {
    const { customerInfo, items, totalAmount, paymentStatus, status } = req.body;

    const orderNumber = `MAN${Date.now().toString().slice(-8)}`;

    const order = await mongoose.connection.transaction(async session => {
      if (!Array.isArray(items) || !items.length) throw checkoutError('Please add at least one product');
      const initialStatus = status || 'pending';
      const paid = paymentStatus === 'paid';
      if (initialStatus === 'cancelled' || (!paid && initialStatus !== 'pending')) {
        throw checkoutError('Create unpaid orders as pending, and cancel existing orders through order management');
      }
      const priced = await priceOrder({ customerInfo, items, totalAmount }, id => Product.findById(id).session(session), true);
      const [created] = await Order.create([{
        user: null, orderNumber, customerInfo: priced.customerInfo, items: priced.items, totalAmount: priced.totalAmount,
        paymentStatus: paymentStatus || 'pending', status: initialStatus,
        isManualOrder: true, stockDeducted: paid
      }], { session });
      if (paid) await changeStock(created.items, -1, Product, session);
      return created;
    });

    res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Create manual order error:', error);
    res.status(error.statusCode || 500).json({ 
      success: false,
      message: error.statusCode ? error.message : 'Server error creating manual order',
      error: error.message 
    });
  }
};
