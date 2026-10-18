const Order = require('../models/Order');
const Product = require('../models/Product');
const { initializePayment, verifyPayment } = require('../services/paystackService');
const { queueOrderNotification, orderView } = require('../services/orderNotifications');
const crypto = require('crypto');
const { paymentDetails, createManualPaymentRecorder } = require('../services/manualPayment');
const mongoose = require('mongoose');
const recordManualPayment = createManualPaymentRecorder({ Order, Product, runTransaction: work => mongoose.connection.transaction(work) });
const { priceOrder, checkoutError } = require('../services/orderPricing');
const { createPaymentProcessor } = require('../services/paymentProcessing');
const { changeStock, createOrderStatusUpdater } = require('../services/orderStatus');
const updateStatus = createOrderStatusUpdater({ Order, Product, runTransaction: work => mongoose.connection.transaction(work) });

const processPayment = createPaymentProcessor({
  Order, Product,
  runTransaction: work => mongoose.connection.transaction(work)
});

const paymentError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.statusCode ? error.message : 'Unable to process payment. Please try again or contact support.'
});

// Public checkout always creates a server-priced snapshot.
exports.createOrder = async (req, res) => {
  try {
    const priced = await priceOrder(req.body, id => Product.findById(id));
    const draft = {
      ...priced,
      user: req.user ? req.user._id : null,
      orderNumber: `ANJ${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      paymentReference: `anj-${crypto.randomUUID()}`,
      status: 'pending', paymentStatus: 'pending', stockDeducted: false
    };
    queueOrderNotification(draft, 'order_confirmation');
    const order = await Order.create(draft);
    res.status(201).json({ success: true, data: orderView(order) });
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
    // The payment and its email task have committed together. A worker sends it.
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
      await processPayment(payment);
    }
    res.sendStatus(200);
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
      .select('-notifications.payload -notifications.renderedMessage -notifications.leaseToken -notifications.idempotencyKey')
      .populate('user', 'name email')
      .populate('items.product')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: orders.length,
      notificationHealth: {
        sendingConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
        deliveryTrackingConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET)
      },
      data: orders.map(order => orderView(order, true))
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
      .select('-notifications')
      .populate('items.product')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: orders.length,
      data: orders.map(order => orderView(order))
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
    const { order } = await updateStatus(req.params.id, status, trackingNumber);
    res.json({ success: true, data: orderView(order, true) });
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

    const orderNumber = `MAN${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const orderSource = req.body.orderSource || 'other';
    if (!['whatsapp', 'instagram', 'phone', 'in_person', 'other'].includes(orderSource)) throw checkoutError('Invalid order source');
    const internalNotes = req.body.internalNotes || '';
    if (typeof internalNotes !== 'string' || internalNotes.length > 2000) throw checkoutError('Notes must be 2,000 characters or fewer');
    if (req.body.sendCustomerEmail !== undefined && typeof req.body.sendCustomerEmail !== 'boolean') throw checkoutError('Invalid email selection');
    if (req.body.sendCustomerEmail && (typeof customerInfo?.email !== 'string' || !customerInfo.email.trim())) throw checkoutError('Enter an email address to send a confirmation');
    const details = paymentDetails({ paymentMethod: req.body.paymentMethod || 'other', paymentReference: req.body.paymentReference });
    if (paymentStatus && !['pending', 'paid'].includes(paymentStatus)) throw checkoutError('Choose unpaid or paid');

    const order = await mongoose.connection.transaction(async session => {
      if (!Array.isArray(items) || !items.length) throw checkoutError('Please add at least one product');
      const initialStatus = status || (paymentStatus === 'paid' ? 'processing' : 'pending');
      const paid = paymentStatus === 'paid';
      if (initialStatus !== (paid ? 'processing' : 'pending')) {
        throw checkoutError('Create unpaid orders as pending and paid orders as processing. Update fulfilment from the order details.');
      }
      const priced = await priceOrder({ customerInfo, items, totalAmount }, id => Product.findById(id).session(session), true);
      const draft = {
        user: null, orderNumber, customerInfo: priced.customerInfo, items: priced.items, totalAmount: priced.totalAmount,
        paymentStatus: paymentStatus || 'pending', status: initialStatus,
        isManualOrder: true, stockDeducted: paid, orderSource, internalNotes: internalNotes.trim(),
        ...details, paidAt: paid ? new Date() : undefined, sendCustomerEmail: req.body.sendCustomerEmail === true
      };
      queueOrderNotification(draft, paid ? 'payment_confirmation' : 'order_confirmation');
      const [created] = await Order.create([draft], { session });
      if (paid) await changeStock(created.items, -1, Product, session);
      return created;
    });

    const emailStatus = order.notifications?.[0]?.status;
    res.status(201).json({ success: true, data: orderView(order, true),
      emailConfirmation: { success: true, queued: emailStatus === 'pending', skipped: emailStatus === 'skipped' } });
  } catch (error) {
    console.error('Create manual order error:', error);
    res.status(error.statusCode || 500).json({ 
      success: false,
      message: error.statusCode ? error.message : 'Server error creating manual order',
      error: error.message 
    });
  }
};

exports.recordManualPayment = async (req, res) => {
  try {
    const result = await recordManualPayment(req.params.id, req.body);
    res.json({ success: true, data: orderView(result.order, true) });
  } catch (error) {
    paymentError(res, error);
  }
};
