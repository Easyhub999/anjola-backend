const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const contactRoutes = require('./routes/contact');
const analyticsRoutes = require('./routes/analytics');
const emailWebhookRoutes = require('./routes/emailWebhooks');
const { createNotificationWorker } = require('./services/notificationWorker');
const { prepareNotification, sendPreparedEmail } = require('./services/emailService');
const notificationWorker = createNotificationWorker({
  Order: require('./models/Order'), prepare: prepareNotification, sendPrepared: sendPreparedEmail
});

// Initialize Express app
const app = express();

// ===============================
// FIXED CORS CONFIGURATION
// ===============================
app.use(cors({
  origin: [
    "https://anjolaaestheticsng.com",     // NEW DOMAIN
    "https://www.anjolaaestheticsng.com", // WWW version
    "https://anjola-frontend.vercel.app", // OLD FRONTEND
    "http://localhost:3001"               // DEV
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Middleware
app.use(express.json({
  verify: (req, res, buffer) => {
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '').toLowerCase();
    if (['/api/orders/paystack-webhook', '/api/email-webhooks/resend'].includes(path)) req.rawBody = buffer;
  }
}));
app.use(express.urlencoded({ extended: true }));

// ===============================
// DATABASE CONNECTION
// ===============================
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ MongoDB Connected Successfully');
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) notificationWorker.start();
  else console.error({ event: 'order_notification_configuration_missing', message: 'Email tasks remain queued until RESEND_API_KEY and EMAIL_FROM are configured and the service restarts.' });
  if (!process.env.RESEND_WEBHOOK_SECRET) console.error({ event: 'order_notification_delivery_tracking_not_configured' });
})
.catch((err) => console.error('❌ MongoDB Connection Error:', err));

// ===============================
// ROUTES
// ===============================
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/email-webhooks', emailWebhookRoutes);

// Health Check
app.get("/", (req, res) => {
  res.send("Anjola Backend is Running Successfully");
});

// ===============================
// ERROR HANDLER
// ===============================
app.use((err, req, res, next) => {
  console.error("🔥 ERROR:", err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Stop accepting requests, let the current bounded email request settle, and
  // leave any remaining durable tasks for the next instance to claim.
  const closed = new Promise(resolve => server.close(resolve));
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();
  await Promise.all([notificationWorker.stop(), closed]);
  await mongoose.disconnect();
  clearTimeout(deadline);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
