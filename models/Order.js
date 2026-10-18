const mongoose = require('mongoose');
const { TYPES, STATUSES } = require('../services/orderNotifications');

// The outbox lives in the order document so order creation and each lifecycle
// change cannot commit without also committing its required notification.
const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, enum: TYPES, required: true },
  status: { type: String, enum: STATUSES, required: true },
  payload: mongoose.Schema.Types.Mixed,
  renderedMessage: mongoose.Schema.Types.Mixed,
  idempotencyKey: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  totalAttempts: { type: Number, default: 0 },
  createdAt: Date, nextAttemptAt: Date, firstAttemptAt: Date, lastAttemptAt: Date,
  sentAt: Date, deliveredAt: Date, leaseUntil: Date, leaseToken: String,
  messageId: String, lastError: String, errorCode: String, skipReason: String,
  ambiguous: { type: Boolean, default: false },
  lastProviderEventAt: Date, lastProviderEventId: String,
  retryRequestedAt: Date, retryRequestedBy: String
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  orderNumber: {
    type: String,
    required: true,
    unique: true
  },
  customerInfo: {
    fullName: { type: String, required: true },
    email: { type: String, required: function () { return !this.isManualOrder; } },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    isGift: { type: Boolean, default: false },
    // No default: historical orders must not acquire a charge they never paid.
    giftPackagingFee: { type: Number, min: 0 },
    giftMessage: { type: String, maxlength: 500, default: '' },
    shippingMethod: { type: String },
    shippingCost: { type: Number, default: 0 }
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    name: String,
    price: Number,
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    // No default: older orders deducted quantity, regardless of pack size.
    stockQuantity: { type: Number, min: 1 },
    selectedSize: {
      type: String,
      default: null
    },
    selectedColor: {
      type: String,
      default: null
    },
    // 🔥 NEW: For price variation products
    selectedPieces: {
      type: Number,
      default: null
    },
    pricePerPiece: {
      type: Number,
      default: null
    }
  }],
  totalAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    default: 'paystack'
  },
  paymentReference: {
    type: String
  },
  // No defaults: legacy orders must not be treated as server-priced orders.
  pricingVersion: Number,
  expectedAmount: Number,
  currency: String,
  stockDeducted: Boolean,
  stockRestoredAt: Date,
  inventoryReviewReason: String,
  trackingNumber: String,
  isManualOrder: Boolean,
  orderSource: { type: String, enum: ['whatsapp', 'instagram', 'phone', 'in_person', 'other'] },
  internalNotes: { type: String, maxlength: 2000 },
  sendCustomerEmail: Boolean,
  paymentReviewReason: String,
  paidAt: Date,
  notifications: { type: [notificationSchema], default: [] },
  paymentAuthorizationUrl: { type: String, select: false },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

orderSchema.index({ 'notifications.status': 1, 'notifications.nextAttemptAt': 1 });
orderSchema.index({ 'notifications.status': 1, 'notifications.leaseUntil': 1 });
orderSchema.index({ 'notifications.messageId': 1 });
orderSchema.index({ 'notifications.id': 1 });

module.exports = mongoose.model('Order', orderSchema);
