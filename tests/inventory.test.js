const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateInventory } = require('../services/inventory');
test('inventory rejects invalid counts, duplicate variants and inconsistent color totals', () => {
  for (const quantity of [-1, 1.5, '3', Infinity]) assert.throws(() => validateInventory({ quantity }));
  assert.throws(() => validateInventory({ quantity: 3, colors: [{ name: 'Pink', quantity: 2 }] }));
  assert.throws(() => validateInventory({ priceVariations: [{ pieces: 1.5, price: 10 }] }));
  assert.throws(() => validateInventory({ colors: ['Pink', 'Pink'] }));
  validateInventory({ quantity: 3, colors: [{ name: 'Pink', quantity: 3 }], priceVariations: [{ pieces: 3, price: 10 }] });
});
test('stock edits use an atomic saved-version filter; missing or stale versions cannot overwrite stock', async () => {
  const current = { _id: 'product', quantity: 7, updatedAt: new Date('2026-10-14T20:00:00Z') };
  let writes = 0;
  const Product = { async findById() { return current; }, async findOneAndUpdate(filter, update) {
    if (filter.updatedAt && +filter.updatedAt !== +current.updatedAt) return null;
    Object.assign(current, update.$set); writes++; return current;
  } };
  const context = { exports: {}, console: { error() {} }, require: name => name.includes('models/Product') ? Product : { validateInventory } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/productController'), 'utf8'), context);
  const send = async body => {
    const res = { code: 200, status(n) { this.code = n; return this; }, json(data) { this.body = data; return this; } };
    await context.exports.updateProduct({ params: { id: 'product' }, body }, res); return res;
  };
  assert.equal((await send({ quantity: 10 })).code, 409);
  assert.equal((await send({ quantity: 10, updatedAt: '2026-10-14T19:00:00Z' })).code, 409);
  assert.equal(current.quantity, 7); assert.equal(writes, 0);
  assert.equal((await send({ quantity: 9, updatedAt: current.updatedAt.toISOString() })).code, 200);
  assert.equal(current.quantity, 9);
  assert.equal((await send({ visible: false, $set: { quantity: 100 } })).code, 200);
  assert.equal(current.quantity, 9);
});

test('product creation persists sale price, badge and search keywords', async () => {
  let saved;
  const Product = { create: async value => { saved = value; return value; } };
  const context = { exports: {}, console: { error() {} }, require: name => name.includes('models/Product') ? Product : { validateInventory } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/productController'), 'utf8'), context);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
  await context.exports.createProduct({ body: { name: 'Tote', description: 'Everyday bag', price: 2000, salesPrice: 1500, category: 'Bags', images: ['/bag.jpg'], quantity: 5, tag: 'new', searchCategories: ['gifts'] } }, res);
  assert.equal(res.code, 201);
  assert.equal(saved.salesPrice, 1500);
  assert.equal(saved.tag, 'new');
  assert.deepEqual(saved.searchCategories, ['gifts']);
});
