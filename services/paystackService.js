const https = require('https');

// Initialize Payment
exports.initializePayment = async (email, amount, metadata) => {
  const params = JSON.stringify({
    email,
    amount,
    metadata,
    // ✅ Redirect back to checkout with success=true
    callback_url: 'https://anjolaestheticsng.com/checkout?payment=success'
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
          const parsed = JSON.parse(data);

          console.log('Paystack initialization response:', {
            statusCode: res.statusCode,
            data: parsed
          });

          if (res.statusCode !== 200) {
            console.error('Paystack initialization error:', parsed);
            return reject(new Error(parsed.message || 'Payment initialization failed'));
          }

          resolve(parsed);
        } catch (error) {
          console.error('Failed to parse Paystack response:', error);
          reject(new Error('Invalid response from payment provider'));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Paystack request error:', error);
      reject(error);
    });

    req.write(params);
    req.end();
  });
};

// Verify Payment
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
          const parsed = JSON.parse(data);

          console.log('Paystack verification response:', {
            statusCode: res.statusCode,
            data: parsed
          });

          if (res.statusCode !== 200) {
            console.error('Paystack verification failed:', {
              statusCode: res.statusCode,
              message: parsed.message,
              response: parsed
            });
            return reject(new Error(parsed.message || `Payment verification failed with status ${res.statusCode}`));
          }

          if (!parsed.status) {
            console.error('Paystack returned unsuccessful status:', parsed);
            return reject(new Error(parsed.message || 'Payment verification was not successful'));
          }

          resolve(parsed);
        } catch (error) {
          console.error('Failed to parse Paystack verification response:', error);
          reject(new Error('Invalid response from payment provider'));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Paystack verification request error:', error);
      reject(error);
    });

    req.end();
  });
};