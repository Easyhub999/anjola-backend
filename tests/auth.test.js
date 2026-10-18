const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');

function middleware() {
  const user = { _id: '507f1f77bcf86cd799439011', role: 'user' };
  const context = { exports: {}, process: { env: { JWT_SECRET: 'test-only-secret' } }, console: { error() {} },
    require: name => name === 'jsonwebtoken' ? jwt : { findById: id => ({ select: async () => id === user._id ? user : null }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../middleware/auth'), 'utf8'), context);
  return { ...context.exports, user };
}

test('optional authentication permits guests without querying a user', async () => {
  const { optionalAuth } = middleware(); let next = false;
  await optionalAuth({ headers: {} }, {}, () => { next = true; });
  assert.equal(next, true);
});

test('valid credentials attach the verified user', async () => {
  const { optionalAuth, user } = middleware();
  const token = jwt.sign({ id: user._id }, 'test-only-secret');
  const req = { headers: { authorization: `Bearer ${token}` } }; let next = false;
  await optionalAuth(req, {}, () => { next = true; });
  assert.equal(next, true); assert.equal(req.user._id, user._id);
});

test('invalid, expired, malformed, or deleted-user credentials cannot fall back to guest', async () => {
  const { optionalAuth, user } = middleware();
  const expired = jwt.sign({ id: user._id }, 'test-only-secret', { expiresIn: -1 });
  const deleted = jwt.sign({ id: 'missing' }, 'test-only-secret');
  for (const authorization of ['', 'Basic invalid', 'Bearer invalid', `Bearer ${expired}`, `Bearer ${deleted}`]) {
    let next = false;
    const res = { status(code) { this.code = code; return this; }, json() {} };
    await optionalAuth({ headers: { authorization } }, res, () => { next = true; });
    assert.equal(res.code, 401); assert.equal(next, false);
  }
});

test('order creation route actually installs optional authentication before its handler', () => {
  const routes = []; const optionalAuth = () => {}; const createOrder = () => {};
  const router = new Proxy({}, { get: (_, method) => (...args) => routes.push({ method, args }) });
  const context = { module: {}, require: name => name === 'express' ? { Router: () => router }
    : name.includes('middleware') ? { optionalAuth }
      : name.includes('notificationController') ? { createNotificationController: () => ({}) }
        : name === 'mongoose' ? { connection: {} } : { createOrder } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../routes/orders'), 'utf8'), context);
  const route = routes.find(route => route.method === 'post' && route.args[0] === '/');
  assert.equal(route.args[1], optionalAuth); assert.equal(route.args[2], createOrder);
});

test('all customer notification admin routes require authentication and admin authorization', () => {
  const routes = []; const protect = () => {}; const adminOnly = () => {};
  const notifications = Object.fromEntries(['getNotifications', 'sendNotification', 'retryNotification', 'updatePreferences']
    .map(name => [name, () => {}]));
  const router = Object.fromEntries(['get', 'post', 'put', 'patch'].map(method => [method,
    (...args) => routes.push({ method, args })]));
  const context = { module: {}, require: name => name === 'express' ? { Router: () => router }
    : name.includes('middleware') ? { protect, adminOnly }
      : name.includes('notificationController') ? { createNotificationController: () => notifications }
        : name === 'mongoose' ? { connection: {} } : {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../routes/orders'), 'utf8'), context);
  for (const [method, path, handler] of [
    ['get', '/:id/notifications', 'getNotifications'],
    ['post', '/:id/notifications', 'sendNotification'],
    ['post', '/:id/notifications/:notificationId/retry', 'retryNotification'],
    ['patch', '/:id/notifications/preferences', 'updatePreferences']
  ]) {
    const route = routes.find(value => value.method === method && value.args[0] === path);
    assert(route, `${method} ${path}`);
    assert.equal(route.args[1], protect);
    assert.equal(route.args[2], adminOnly);
    assert.equal(route.args[3], notifications[handler]);
  }
});
