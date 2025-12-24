const mongoose = require('mongoose');

// ===============================
// REVIEW SUB-SCHEMA
// ===============================
const reviewSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  date: { type: Date, default: Date.now }
});

// ===============================
// PRICE VARIATION SUB-SCHEMA
// ===============================
const priceVariationSchema = new mongoose.Schema({
  pieces: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
  label: { type: String } // Optional: "Best Value", "Most Popular", etc.
}, { _id: false });

// ===============================
// MAIN PRODUCT SCHEMA
// ===============================
const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Product description is required']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: 0
  },
  // 🔥 DYNAMIC CATEGORY — NO ENUM ANYMORE
  category: {
    type: String,
    required: true,
    trim: true,
  },
  // ============================
  // MULTIPLE IMAGES
  // ============================
  images: {
    type: [String],
    default: []
  },
  // ============================
  // PRODUCT OPTIONS
  // ============================
  sizes: {
    type: [String],
    default: []
  },
  colors: {
    type: [String],
    default: []
  },
  // ============================
  // 🔥 PRICE VARIATIONS BY PIECES
  // ============================
  priceVariations: {
    type: [priceVariationSchema],
    default: []
  },
  // ============================
  // REVIEWS
  // ============================
  reviews: {
    type: [reviewSchema],
    default: []
  },
  featured: {
    type: Boolean,
    default: false
  },
  // ============================
  // INVENTORY — NEW
  // ============================
  quantity: {
    type: Number,
    default: 0
  },
  lowStockWarningAt: {
    type: Number,
    default: 0
  },
  inStock: {
    type: Boolean,
    default: true
  },
  autoHideWhenZero: {
    type: Boolean,
    default: true
  },
  // ============================
  // VISIBILITY
  // ============================
  visible: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Product', productSchema);