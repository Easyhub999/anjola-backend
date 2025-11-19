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


// =========================================================
// 1️⃣ UPLOAD SINGLE PRODUCT IMAGE (Admin Only)
// =========================================================
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

      return res.json({
        success: true,
        imageUrl: req.file.path,
        publicId: req.file.filename,
        message: 'Image uploaded successfully'
      });
    } catch (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ message: 'Error uploading image' });
    }
  }
);


// =========================================================
// 2️⃣ PUBLIC ROUTES
// =========================================================
router.get('/', getAllProducts);

// Get single product
router.get('/:id', getProduct);


// =========================================================
// 3️⃣ ADD REVIEW (User must login)
// =========================================================
router.post('/:id/review', protect, addReview);


// =========================================================
// 4️⃣ ADMIN: CREATE / UPDATE / DELETE PRODUCT
// =========================================================
router.post('/', protect, adminOnly, createProduct);

router.put('/:id', protect, adminOnly, updateProduct);

router.delete('/:id', protect, adminOnly, deleteProduct);


module.exports = router;