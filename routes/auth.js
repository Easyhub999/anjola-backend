const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const User = require('../models/User');

// =============================
// PUBLIC ROUTES
// =============================
router.post('/register', register);
router.post('/login', login);

// =============================
// PROTECTED ROUTE
// =============================
router.get('/me', protect, getMe);

// =============================
// TEMPORARY ADMIN CREATION ROUTE
// VISIT ONLY ONCE: /api/auth/create-admin
// =============================
router.get('/create-admin', async (req, res) => {
  try {
    const existing = await User.findOne({ email: "admin@anjola.com" });
    
    if (existing) {
      return res.json({ message: "Admin already exists", admin: existing });
    }

    const admin = await User.create({
      name: "Anjola Admin",
      email: "admin@anjola.com",
      password: "Admin1234",
      role: "admin",
    });

    res.json({
      success: true,
      message: "Admin created successfully",
      admin,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating admin" });
  }
});

module.exports = router;