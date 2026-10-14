const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes
exports.protect = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;
    const token = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] : undefined;

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch full user
    let user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Fallback in case role changed in DB
    user.role = user.role || decoded.role;

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

// Admin only
exports.adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin only.' });
  }
};
// Guests may checkout, but supplied credentials must be valid.
exports.optionalAuth = (req, res, next) => {
  if (req.headers.authorization === undefined) return next();
  return exports.protect(req, res, next);
};
