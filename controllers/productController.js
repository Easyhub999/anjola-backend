const mongoose = require('mongoose');

// Review Schema
const reviewSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Product Schema
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
    required: true
  },

  // MULTIPLE IMAGES SUPPORT
  images: {
    type: [String],   // Array of image URLs
    required: true
  },

  // OPTIONS
  sizes: {
    type: [String], 
    default: []      // e.g. ["S", "M", "L"]
  },

  colors: {
    type: [String],
    default: []      // e.g. ["Black", "Gold"]
  },

  // CUSTOMER REVIEWS
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