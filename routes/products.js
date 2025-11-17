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

// ================================
// IMAGE UPLOAD ROUTE (PLACE FIRST)
// ================================
router.post('/upload-image', protect, adminOnly, upload.single('image'), (req, res) => {
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
});

// ================================
// PUBLIC ROUTES
// ================================
router.get('/', getAllProducts);
router.get('/:id', getProduct);

// ================================
// ADMIN ROUTES
// ================================
router.post('/', protect, adminOnly, createProduct);
router.put('/:id', protect, adminOnly, updateProduct);
router.delete('/:id', protect, adminOnly, deleteProduct);

module.exports = router;