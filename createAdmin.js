require('dotenv').config();
const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: String
});

// Hash password method
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

const User = mongoose.model('User', userSchema);

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');

    // Check if admin exists
    const existingAdmin = await User.findOne({ email: 'anjolaaestheticsng@gmail.com' });
    
    if (existingAdmin) {
      console.log('ℹ  Admin already exists!');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Create admin
    const admin = await User.create({
      name: 'Anjola Admin',
      email: 'anjolaaestheticsng@gmail.com',
      password: 'admin123',
      role: 'admin'
    });

    console.log('✅ Admin user created!');
    console.log('📧 Email: anjolaaestheticsng@gmail.com');
    console.log('🔑 Password: admin123');

    await mongoose.disconnect();
    console.log('👋 Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createAdmin();