// backend/controllers/productController.js

const Product = require('../models/Product');
const { validateInventory } = require('../services/inventory');

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
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Server error" });
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
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Server error" });
  }
};

// =====================================================
// CREATE PRODUCT (Admin)
// =====================================================
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
      priceVariations,  // 🔥 ADD THIS
      featured,
      quantity,
      lowStockWarningAt,
      inStock,
      autoHideWhenZero,
      visible
    } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        message: "At least one product image is required",
      });
    }

    validateInventory({ quantity: quantity ?? 0, colors: colors || [], priceVariations: priceVariations || [], lowStockWarningAt: lowStockWarningAt ?? 0 });
    const product = await Product.create({
      name,
      description,
      price,
      category,
      images,
      sizes: sizes || [],
      colors: colors || [],
      priceVariations: priceVariations || [],  // 🔥 ADD THIS
      featured: !!featured,

      // INVENTORY FIELDS
      quantity: quantity ?? 0,
      lowStockWarningAt: lowStockWarningAt ?? 0,
      inStock: inStock ?? (quantity > 0),

      autoHideWhenZero: autoHideWhenZero ?? true,

      // VISIBILITY
      visible: visible ?? true
    });

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Server error" });
  }
};

// =====================================================
// UPDATE PRODUCT (Admin)
// =====================================================
exports.updateProduct = async (req, res) => {
  try {
    const allowed = ['name', 'description', 'price', 'salesPrice', 'category', 'searchCategories', 'images', 'image', 'sizes', 'colors', 'priceVariations', 'featured', 'quantity', 'lowStockWarningAt', 'inStock', 'autoHideWhenZero', 'visible', 'tag', 'displayOrder'];
    const updatedData = Object.fromEntries(allowed.filter(key => Object.hasOwn(req.body, key)).map(key => [key, req.body[key]]));
    validateInventory(updatedData);
    const inventoryEdit = ['quantity', 'colors', 'inStock', 'autoHideWhenZero'].some(key => Object.hasOwn(updatedData, key));
    const filter = { _id: req.params.id };
    if (inventoryEdit) {
      if (typeof req.body.updatedAt !== 'string' || !Number.isFinite(Date.parse(req.body.updatedAt))) {
        return res.status(409).json({ message: 'Reload products before editing stock. This form is missing its saved version.' });
      }
      filter.updatedAt = new Date(req.body.updatedAt);
      const current = await Product.findById(req.params.id);
      if (!current) return res.status(404).json({ message: 'Product not found' });
      validateInventory({ quantity: current.quantity, colors: current.colors, ...updatedData });
    }
    if (Object.hasOwn(updatedData, 'quantity')) updatedData.inStock = updatedData.quantity > 0;
    // An explicit visibility edit overrides automatic hiding ownership.
    delete updatedData.inventoryAutoHidden;
    if (Object.hasOwn(updatedData, 'visible')) updatedData.inventoryAutoHidden = false;

    // Ensure images is always an array
    if (updatedData.images && !Array.isArray(updatedData.images)) {
      return res.status(400).json({ message: "Images must be an array" });
    }

    const product = await Product.findOneAndUpdate(
      filter,
      { $set: updatedData },
      { new: true, runValidators: true }
    );

    if (!product)
      return res.status(409).json({ message: "Product changed or was removed. Reload products and reapply your edit using the latest stock." });

    return res.json({ success: true, data: product });
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Server error" });
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
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Server error" });
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
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Server error" });
  }
};