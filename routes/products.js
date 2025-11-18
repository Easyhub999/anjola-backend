const express = require('express');
const router = express.Router();

const {
  getAllProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct
} = require('../controllers/productController');

const { protect, adminOnly } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');


// ======================================
// 1️⃣ MULTIPLE IMAGE UPLOAD (Admin Only)
// ======================================
router.post(
  '/upload-image',
  protect,
  adminOnly,
  upload.single('image'),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No image file provided' });
      }

      res.json({
        success: true,
        imageUrl: req.file.path,
        publicId: req.file.filename,
        message: 'Image uploaded successfully'
      });
    } catch (error) {
      console.error('Image upload error:', error);
      res.status(500).json({ message: 'Error uploading image' });
    }
  }
);


// ================================
// 2️⃣ PUBLIC ROUTES
// ================================
router.get('/', getAllProducts);

// ================================
// 3️⃣ SINGLE PRODUCT ROUTE
// ================================
router.get('/product/:id', getProduct);

// ================================
// 4️⃣ ADMIN PRODUCT CRUD
// ================================
router.post('/', protect, adminOnly, createProduct);
router.put('/:id', protect, adminOnly, updateProduct);
router.delete('/:id', protect, adminOnly, deleteProduct);

module.exports = router;