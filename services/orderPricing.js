// A single packaging charge per gift order, independent of item or pack quantity.
const GIFT_PACKAGING_FEE = 2000;
const SHIPPING_OPTIONS = [
  { id: 'abeokuta', label: 'Delivery Within Abeokuta', price: 0 },
  { id: 'park', label: 'Park Delivery (Lagos, Ogun, Ilorin, Oyo, Osun, Ondo, Ekiti)', price: 0 },
  { id: 'zone1', label: 'Lagos, Akure, Ado-Ekiti, Ibadan, Ogbomosho, Oshogbo, Ota, Ilorin', price: 5600 },
  { id: 'zone2', label: 'Aba, Asaba, Enugu, Onitsha, Owerri, Umuahia, Abuja, Benin, Calabar, Port-Harcourt, Uyo, Warri, Yenagoa', price: 7000 },
  { id: 'zone3', label: 'Lafia, Lokoja, Makurdi, Minna, Bauchi, Jalingo, Jos, Gombe, Maiduguri, Damaturu, Yola, Kaduna, Katsina, Dutse, Birnin Kebbi, Sokoto, Kano', price: 8500 }
];

function checkoutError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function toKobo(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw checkoutError('Invalid price');
  }
  const amount = Math.round(value * 100);
  if (!Number.isSafeInteger(amount)) throw checkoutError('Amount is too large');
  return amount;
}

// Never accept names, prices, delivery charges or totals as authoritative input.
async function priceOrder(body, findProduct, manualShipping = false) {
  const input = body?.customerInfo;
  const customerInfo = {};
  for (const field of ['fullName', 'email', 'phone', 'address', 'city', 'state']) {
    if (manualShipping && field === 'email' && (input?.email == null || input.email === '')) { customerInfo.email = ''; continue; }
    if (typeof input?.[field] !== 'string' || !input[field].trim() || input[field].length > 500) {
      throw checkoutError(`Please provide a valid ${field}`);
    }
    customerInfo[field] = input[field].trim();
  }
  if (input.isGift !== undefined && typeof input.isGift !== 'boolean') throw checkoutError('Invalid gift selection');
  if (input.giftMessage !== undefined && (typeof input.giftMessage !== 'string' || input.giftMessage.length > 500)) {
    throw checkoutError('Gift messages must be 500 characters or fewer');
  }
  customerInfo.isGift = input.isGift === true;
  customerInfo.giftPackagingFee = customerInfo.isGift ? GIFT_PACKAGING_FEE : 0;
  customerInfo.giftMessage = customerInfo.isGift ? (input.giftMessage || '').trim() : '';
  customerInfo.email = customerInfo.email.toLowerCase();
  if (customerInfo.email && !/^\S+@\S+\.\S+$/.test(customerInfo.email)) throw checkoutError('Please provide a valid email');
  // Accept existing storefront labels during a backend-first deployment.
  const shipping = manualShipping ? { label: input.shippingMethod || 'Manual delivery', price: input.shippingCost ?? 0 } : SHIPPING_OPTIONS.find(option => option.id === input.shippingMethodId || option.label === input.shippingMethod);
  if (!shipping) throw checkoutError('Please select a valid shipping method');
  Object.assign(customerInfo, { shippingMethod: shipping.label, shippingCost: shipping.price });
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    throw checkoutError('Your cart must contain between 1 and 100 items');
  }

  const items = [];
  const products = new Map();
  const quantities = new Map();
  const colorQuantities = new Map();
  let amount = toKobo(shipping.price) + toKobo(customerInfo.giftPackagingFee);
  for (const item of body.items) {
    if (!item || typeof item.product !== 'string' || !/^[a-f\d]{24}$/i.test(item.product)) {
      throw checkoutError('Invalid product');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) {
      throw checkoutError('Invalid quantity');
    }
    const id = item.product.toLowerCase();
    if (!products.has(id)) products.set(id, await findProduct(id));
    const product = products.get(id);
    if (!product || product.visible === false || product.inStock === false || !Number.isSafeInteger(product.quantity) || product.quantity <= 0) {
      throw checkoutError('A product in your cart is unavailable', 409);
    }
    const size = item.selectedSize || null;
    const color = item.selectedColor || null;
    const sizes = product.sizes || [];
    const colors = product.colors || [];
    if (!Array.isArray(colors)) throw checkoutError('Product options need updating', 409);
    if ((sizes.length && !sizes.includes(size)) || (!sizes.length && size)) {
      throw checkoutError(`Please select a valid size for ${product.name}`);
    }
    const colorOption = colors.find(option => (typeof option === 'string' ? option : option.name) === color);
    if ((colors.length && !colorOption) || (!colors.length && color)) {
      throw checkoutError(`Please select a valid color for ${product.name}`);
    }
    const variations = product.priceVariations || [];
    let pieces = item.selectedPieces ?? 1;
    let price;
    if (variations.length) {
      const variation = variations.find(option => option.pieces === pieces);
      if (!variation) throw checkoutError(`Please select a valid pack for ${product.name}`);
      price = variation.price;
    } else {
      if (pieces !== 1) throw checkoutError('Invalid pack size');
      price = product.salesPrice != null && product.salesPrice < product.price ? product.salesPrice : product.price;
    }
    if (!Number.isSafeInteger(pieces) || pieces < 1) throw checkoutError('Invalid pack size');
    const stockQuantity = item.quantity * pieces;
    if (!Number.isSafeInteger(stockQuantity)) throw checkoutError('Invalid quantity');
    const unitAmount = toKobo(price);
    amount += unitAmount * item.quantity;
    if (!Number.isSafeInteger(amount)) throw checkoutError('Amount is too large');
    quantities.set(id, (quantities.get(id) || 0) + stockQuantity);
    if (quantities.get(id) > product.quantity) throw checkoutError(`Not enough stock for ${product.name}`, 409);
    if (colorOption && typeof colorOption !== 'string') {
      const key = `${id}:${color}`;
      colorQuantities.set(key, (colorQuantities.get(key) || 0) + stockQuantity);
      if (!Number.isSafeInteger(colorOption.quantity) || colorQuantities.get(key) > colorOption.quantity) throw checkoutError(`Not enough ${color} stock`, 409);
    }
    items.push({ product: product._id, name: product.name, price: unitAmount / 100,
      quantity: item.quantity, stockQuantity, selectedSize: size, selectedColor: color,
      selectedPieces: pieces, pricePerPiece: unitAmount / 100 / pieces });
  }
  if (amount <= 0) throw checkoutError('Order total must be greater than zero');
  // A stale storefront must not silently redirect a customer to a different charge.
  if (body.totalAmount !== undefined && toKobo(body.totalAmount) !== amount) {
    throw checkoutError('Prices have changed. Refresh the shop and update your cart before paying.', 409);
  }
  return { customerInfo, items, totalAmount: amount / 100, expectedAmount: amount, currency: 'NGN', pricingVersion: 1 };
}

module.exports = { priceOrder, toKobo, checkoutError, SHIPPING_OPTIONS, GIFT_PACKAGING_FEE };
