const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const productId = '507f1f77bcf86cd799439011';

function createHandler(findById) {
  const context = {
    exports: {},
    console: { error() {} },
    require: name => name.includes('models/Product') ? { findById } : {},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/productController'), 'utf8'), context);
  return async (id = productId) => {
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await context.exports.getProduct({ params: { id } }, res);
    return res;
  };
}

test('malformed public product IDs return 404 without querying the database', async () => {
  let queries = 0;
  const request = createHandler(async () => { queries++; });
  for (const id of ['', 'undefined', 'null', '507f1f77bcf86cd79943901', 'z'.repeat(24), null, 123, { $ne: null }]) {
    const response = await request(id);
    assert.equal(response.code, 404);
    assert.equal(response.body.message, 'Product not found');
    assert.equal(response.body.data, undefined);
  }
  assert.equal(queries, 0);
});

test('unknown and deleted public product IDs return 404', async () => {
  const request = createHandler(async id => {
    assert.equal(id, productId);
    return null;
  });
  const response = await request();
  assert.equal(response.code, 404);
  assert.equal(response.body.message, 'Product not found');
});

test('hidden products cannot be read through a direct public product link', async () => {
  const request = createHandler(async () => ({ _id: productId, visible: false, name: 'Unpublished product' }));
  const response = await request();
  assert.equal(response.code, 404);
  assert.equal(response.body.message, 'Product not found');
  assert.equal(response.body.data, undefined);
});

test('visible sold-out products remain available through their public links', async () => {
  const product = { _id: productId, visible: true, inStock: false, quantity: 0, name: 'Gift box' };
  const response = await createHandler(async () => product)();
  assert.equal(response.code, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data, product);
});

test('legacy products without a visibility field still have public links', async () => {
  const product = { _id: productId, name: 'Tote bag' };
  const response = await createHandler(async id => {
    assert.equal(id, productId.toUpperCase());
    return product;
  })(productId.toUpperCase());
  assert.equal(response.code, 200);
  assert.equal(response.body.data, product);
});

test('database failures return 500 without exposing internal error details', async () => {
  const response = await createHandler(async () => { throw new Error('Database connection failed'); })();
  assert.equal(response.code, 500);
  assert.equal(response.body.message, 'Server error');
  assert.equal(response.body.data, undefined);
});
