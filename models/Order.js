const mongoose = require('mongoose');

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
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    isGift: { type: Boolean, default: false },
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
  paymentReviewReason: String,
  paidAt: Date,
  paymentAuthorizationUrl: { type: String, select: false },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Order', orderSchema);