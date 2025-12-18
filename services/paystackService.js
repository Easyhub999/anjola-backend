const https = require('https');

// Initialize Paystack payment
exports.initializePayment = async (email, amount, metadata) => {
  const params = JSON.stringify({
    email,
    amount: amount * 100,
    metadata,
    callback_url: `${process.env.FRONTEND_URL}/payment/callback`
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
        resolve(JSON.parse(data));
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
        const parsed = JSON.parse(data);

        // 🔥 CRITICAL: handle Paystack HTTP errors explicitly
        if (res.statusCode !== 200) {
          return reject({
            statusCode: res.statusCode,
            paystackResponse: parsed
          });
        }

        resolve(parsed);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
};