const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  date: { type: Date, default: Date.now }
});

const priceVariationSchema = new mongoose.Schema({
  pieces: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
  label: { type: String }
}, { _id: false });

// 🔥 Color schema - but we'll use Mixed type for backward compatibility
const colorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, default: 0 }
}, { _id: false });

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: 0
  },
  description: {
    type: String,
    required: [true, 'Description is required']
  },
  category: {
    type: String,
    required: [true, 'Category is required']
  },
  searchCategories: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  images: [{
    type: String
  }],
  image: {
    type: String
  },
  sizes: [{
    type: String
  }],
  // 🔥 MIXED TYPE - Accepts both old ["string"] and new [{name, quantity}] formats
  colors: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  priceVariations: [priceVariationSchema],
  reviews: [reviewSchema],
  featured: {
    type: Boolean,
    default: false
  },
  quantity: {
    type: Number,
    default: 0,
    min: 0
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
  visible: {
    type: Boolean,
    default: true
  },
  tag: {
    type: String,
    enum: ['', 'best-seller', 'hot', 'new', 'recommended', 'trending', 'popular', 'limited', 'sale'],
    default: ''
  },
  displayOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for search
productSchema.index({ name: 'text', description: 'text', category: 'text' });

module.exports = mongoose.model('Product', productSchema);