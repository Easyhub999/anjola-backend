const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/me', protect, getMe);

module.exports = router;

// =======================================
// TEMPORARY ADMIN CREATION ROUTE
// DELETE AFTER FIRST USE
// =======================================

const User = require('../models/User');

app.get('/api/auth/create-admin', async (req, res) => {
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