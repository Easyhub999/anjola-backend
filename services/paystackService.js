const https = require('https');

// Initialize Paystack payment
exports.initializePayment = async (email, amount, metadata) => {
  const params = JSON.stringify({
    email,
    amount,
    metadata,
    // Redirect user back to your site after payment
    callback_url: process.env.FRONTEND_URL 
      ? `${process.env.FRONTEND_URL}/shop`
      : 'https://anjolaaestheticsng.com/shop'
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
    path: `/transaction/verify/${reference}`,
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

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
};