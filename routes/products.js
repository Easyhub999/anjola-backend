const express = require('express');
const router = express.Router();

const {
  getAllProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  addReview
} = require('../controllers/productController');

const { protect, adminOnly } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');
const { protect, adminOnly } = require('../middleware/auth');

// ======================================================
// 1️⃣ MULTIPLE IMAGE UPLOAD (Admin Only)
// ======================================================
router.post(
  '/upload-images',
  protect,
  adminOnly,
  upload.array('images', 10), // max 10 images
  (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No image files provided' });
      }

      const imageUrls = req.files.map((file) => file.path);

      res.json({
        success: true,
        images: imageUrls,
        count: imageUrls.length,
        message: 'Images uploaded successfully'
      });
    } catch (error) {
      console.error('Image upload error:', error);
      res.status(500).json({ message: 'Error uploading images' });
    }
  }
);

// ================================
// 5️⃣ ADD REVIEW (LOGIN REQUIRED)
// ================================
router.post(
  '/:id/reviews',
  protect,          // user must be logged in
  async (req, res) => {
    try {
      const { rating, comment } = req.body;

      if (!rating || !comment) {
        return res.status(400).json({ message: "Rating and comment required" });
      }

      const product = await Product.findById(req.params.id);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const newReview = {
        userName: req.user.name,   // from logged-in user
        rating,
        comment,
        createdAt: new Date()
      };

      product.reviews.push(newReview);
      await product.save();

      res.status(201).json({
        success: true,
        message: "Review added successfully",
        data: product.reviews
      });

    } catch (error) {
      console.error("Add review error:", error);
      res.status(500).json({ message: "Server error adding review" });
    }
  }
);

// ======================================================
// 2️⃣ PUBLIC ROUTES
// ======================================================
router.get('/', getAllProducts);

// Single product
router.get('/:id', getProduct);

// ======================================================
// 3️⃣ PRODUCT REVIEWS (Public but user required)
// ======================================================
router.post('/:id/review', protect, addReview);

// ======================================================
// 4️⃣ ADMIN CRUD ROUTES
// ======================================================
router.post('/', protect, adminOnly, createProduct);
router.put('/:id', protect, adminOnly, updateProduct);
router.delete('/:id', protect, adminOnly, deleteProduct);

module.exports = router;