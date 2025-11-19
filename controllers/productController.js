// backend/controllers/productController.js

const Product = require('../models/Product');

// =====================================================
// GET ALL PRODUCTS
// =====================================================
exports.getAllProducts = async (req, res) => {
  try {
    const { category, search, featured } = req.query;
    let query = {};

    if (category && category !== "all") query.category = category;
    if (featured === "true") query.featured = true;
    if (search) query.name = { $regex: search, $options: "i" };

    const products = await Product.find(query).sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error("Get products error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// =====================================================
// GET SINGLE PRODUCT
// =====================================================
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product)
      return res.status(404).json({ message: "Product not found" });

    return res.json({ success: true, data: product });
  } catch (error) {
    console.error("Get product error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// =====================================================
// CREATE PRODUCT (Admin)
// =====================================================
exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      images,
      sizes,
      colors,
      featured,
      inStock,
    } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        message: "At least one product image is required",
      });
    }

    const product = await Product.create({
      name,
      description,
      price,
      category,
      images,
      sizes: sizes || [],
      colors: colors || [],
      featured: !!featured,
      inStock: inStock ?? true,
    });

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// =====================================================
// UPDATE PRODUCT (Admin)
// =====================================================
exports.updateProduct = async (req, res) => {
  try {
    const updatedData = req.body;

    if (updatedData.images && !Array.isArray(updatedData.images)) {
      return res.status(400).json({ message: "Images must be an array" });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updatedData,
      { new: true, runValidators: true }
    );

    if (!product)
      return res.status(404).json({ message: "Product not found" });

    return res.json({ success: true, data: product });
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// =====================================================
// DELETE PRODUCT (Admin)
// =====================================================
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product)
      return res.status(404).json({ message: "Product not found" });

    return res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// =====================================================
// ADD REVIEW  (No login required – uses name from body)
// =====================================================
exports.addReview = async (req, res) => {
  try {
    const { name, rating, comment } = req.body;

    if (!name || !rating || !comment) {
      return res.status(400).json({
        message: "Name, rating and comment are required",
      });
    }

    const product = await Product.findById(req.params.id);
    if (!product)
      return res.status(404).json({ message: "Product not found" });

    const newReview = {
      name,
      rating,
      comment,
      date: new Date(),
    };

    product.reviews.push(newReview);
    await product.save();

    return res.json({
      success: true,
      message: "Review added successfully",
      data: product,
    });
  } catch (error) {
    console.error("Add review error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};