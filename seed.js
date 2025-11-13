const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('./models/Product');

dotenv.config();

const products = [
  {
    name: 'Luxury Tote Bag',
    price: 45000,
    image: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=500',
    category: 'bags',
    description: 'Premium leather tote bag perfect for everyday elegance',
    featured: true,
    inStock: true
  },
  {
    name: 'Under Eye Patches',
    price: 8500,
    image: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=500',
    category: 'skincare',
    description: 'Hydrating collagen patches to reduce dark circles',
    featured: true,
    inStock: true
  },
  {
    name: '3-in-1 Bottle Set',
    price: 12000,
    image: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=500',
    category: 'accessories',
    description: 'Travel-friendly bottles for your beauty essentials',
    featured: true,
    inStock: true
  },
  {
    name: 'Organic Cotton Pads',
    price: 3500,
    image: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=500',
    category: 'skincare',
    description: 'Reusable eco-friendly cotton pads (Pack of 20)',
    featured: false,
    inStock: true
  },
  {
    name: 'Designer Crossbody Bag',
    price: 38000,
    image: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=500',
    category: 'bags',
    description: 'Chic crossbody bag for the modern woman',
    featured: true,
    inStock: true
  },
  {
    name: 'Satin Sleep Mask',
    price: 5500,
    image: 'https://images.unsplash.com/photo-1584308972272-9e4e7685e80f?w=500',
    category: 'accessories',
    description: 'Luxurious satin sleep mask for beauty rest',
    featured: false,
    inStock: true
  }
];

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected...');

    // Clear existing products
    await Product.deleteMany();
    console.log('Cleared existing products');

    // Insert new products
    await Product.insertMany(products);
    console.log('✅ Products seeded successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();