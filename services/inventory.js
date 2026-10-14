const { checkoutError } = require('./orderPricing');
function validateInventory(data) {
  for (const key of ['quantity', 'lowStockWarningAt']) {
    if (data[key] !== undefined && (!Number.isSafeInteger(data[key]) || data[key] < 0)) throw checkoutError(`${key} must be a non-negative whole number`);
  }
  if (data.colors !== undefined) {
    if (!Array.isArray(data.colors)) throw checkoutError('Invalid colors');
    const names = new Set();
    let total = 0;
    for (const color of data.colors) {
      const name = typeof color === 'string' ? color : color?.name;
      if (typeof name !== 'string' || !name.trim() || names.has(name)) throw checkoutError('Colors must have unique names');
      names.add(name);
      if (typeof color !== 'string') {
        if (!Number.isSafeInteger(color.quantity) || color.quantity < 0) throw checkoutError('Color stock must be a non-negative whole number');
        total += color.quantity;
      }
    }
    if (!Number.isSafeInteger(total)) throw checkoutError('Stock is too large');
    if (data.colors.length && data.colors.every(c => typeof c !== 'string') && data.quantity !== total) throw checkoutError('Total stock must equal the sum of color stock');
  }
  if (data.priceVariations !== undefined) {
    if (!Array.isArray(data.priceVariations)) throw checkoutError('Invalid packs');
    const sizes = new Set();
    for (const pack of data.priceVariations) {
      if (!Number.isSafeInteger(pack?.pieces) || pack.pieces < 1 || sizes.has(pack.pieces) || typeof pack.price !== 'number' || !Number.isFinite(pack.price) || pack.price < 0) throw checkoutError('Packs need unique positive whole-number sizes and valid prices');
      sizes.add(pack.pieces);
    }
  }
}
module.exports = { validateInventory };
