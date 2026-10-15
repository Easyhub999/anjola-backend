const https = require('https');

// Payments must return to the storefront, even if a deployment retained a local
// FRONTEND_URL. Keep /shop compatible with already-deployed payment verification.
const PAYMENT_CALLBACK_URL = 'https://anjolaaestheticsng.com/shop';

// Initialize Paystack payment
exports.initializePayment = async (email, amount, metadata, reference) => {
  const params = JSON.stringify({
    email,
    amount,
    metadata,
    reference,
    currency: 'NGN',
    callback_url: PAYMENT_CALLBACK_URL
  });

  const options = {
    hostname: 'api.paystack.co',
    port: 443,
    path: '/transaction/initialize',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error('Invalid response from Paystack'));
        }
      });
    });

    req.setTimeout(15000, () => req.destroy(new Error('Paystack request timed out')));
    req.on('error', (error) => {
      reject(error);
    });

    req.write(params);
    req.end();
  });
};

// Verify Paystack payment
exports.verifyPayment = async (reference) => {
  const options = {
    hostname: 'api.paystack.co',
    port: 443,
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error('Invalid response from Paystack'));
        }
      });
    });

    req.setTimeout(15000, () => req.destroy(new Error('Paystack request timed out')));
    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
};
