// TAP Money — Stripe Payment Server (zero dependencies version)
// Uses only Node.js built-in modules — no npm install needed

const http = require('http');
const https = require('https');
const url = require('url');

// Read secret key from environment variable set in cPanel Node.js app
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PORT = process.env.PORT || 3000;

function stripeRequest(method, path, data, callback) {
  const postData = new url.URLSearchParams(data).toString();
  const options = {
    hostname: 'api.stripe.com',
    port: 443,
    path: path,
    method: method,
    headers: {
      'Authorization': 'Basic ' + Buffer.from(STRIPE_SECRET_KEY + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try { callback(null, JSON.parse(body)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(postData);
  req.end();
}

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

const server = http.createServer((req, res) => {
  setCORSHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check — also shows whether key is loaded
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      message: 'TAP payment server is running',
      key_loaded: !!STRIPE_SECRET_KEY,
      key_prefix: STRIPE_SECRET_KEY ? STRIPE_SECRET_KEY.slice(0, 12) + '...' : 'MISSING'
    }));
    return;
  }

  // Create PaymentIntent
  if (req.method === 'POST' && req.url === '/api/create-payment-intent') {
    if (!STRIPE_SECRET_KEY) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Stripe secret key not configured on server' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { amount, currency } = JSON.parse(body);
        if (!amount || amount <= 0) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid amount' }));
          return;
        }
        stripeRequest('POST', '/v1/payment_intents', {
          amount: Math.round(amount),
          currency: (currency || 'gbp').toLowerCase(),
          'automatic_payment_methods[enabled]': 'true'
        }, (err, data) => {
          if (err || data.error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err ? err.message : data.error.message }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({ client_secret: data.client_secret }));
        });
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log('TAP payment server running on port ' + PORT);
  console.log('Stripe key loaded:', !!STRIPE_SECRET_KEY);
});
