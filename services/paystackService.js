const https = require('https');

exports.initializePayment = async (email, amount, metadata) => {
  const params = JSON.stringify({
    email,
    amount,
    metadata,
    callback_url: 'https://anjolaestheticsng.com' // Simple - just homepage
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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            return reject(new Error(parsed.message || 'Payment initialization failed'));
          }
          resolve(parsed);
        } catch (error) {
          reject(new Error('Invalid response from payment provider'));
        }
      });
    });
    req.on('error', (error) => reject(error));
    req.write(params);
    req.end();
  });
};

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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            return reject(new Error(parsed.message || 'Payment verification failed'));
          }
          resolve(parsed);
        } catch (error) {
          reject(new Error('Invalid response from payment provider'));
        }
      });
    });
    req.on('error', (error) => reject(error));
    req.end();
  });
};