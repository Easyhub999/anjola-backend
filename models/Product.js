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

  category: {
    type: String,
    required: true,
    enum: [
      'bags',
      'self care essentials',
      'hair accessories',
      'jewelries',
      'sunglasses',
      'totes bag',
      'curated gift boxed package'
    ]
  },

  // ============================
  // MULTIPLE IMAGES
  // ============================
  images: {
    type: [String],   // Array of image URLs
    default: []
  },

  // (For old single-image compatibility)
  image: {
    type: String,
    default: ""
  },

  // ============================
  // PRODUCT OPTIONS
  // ============================
  sizes: {
    type: [String],   // e.g. ["S", "M", "L"]
    default: []
  },

  colors: {
    type: [String],   // e.g. ["Black", "Pink", "Gold"]
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

  inStock: {
    type: Boolean,
    default: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});


module.exports = mongoose.model('Product', productSchema);