// TAP Money — Payment + WebRTC Signaling Server
// Run: npm install socket.io   (only needed once)

const http = require('http');
const https = require('https');
const url = require('url');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PORT = process.env.PORT || 3000;

// ── HTTP REQUEST HANDLER ──
const requestHandler = (req, res) => {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsed = url.parse(req.url, true);

  if (req.method === 'POST' && parsed.pathname === '/api/create-payment-intent') {
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
};

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

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

// ── CREATE HTTP SERVER ──
const server = http.createServer(requestHandler);

// ── ATTACH WEBRTC SIGNALING ──
const { Server } = require('socket.io');
const io = new Server(server, {
  path: '/signal',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

const rooms = {};
io.on('connection', socket => {
  let currentRoom = null;
  socket.on('join', roomId => {
    currentRoom = roomId;
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = new Set();
    rooms[roomId].add(socket.id);
    const peers = [...rooms[roomId]].filter(id => id !== socket.id);
    socket.emit('room-info', { peers });
    socket.to(roomId).emit('peer-joined', socket.id);
    console.log('[TAP] ' + socket.id + ' joined ' + roomId + ' (' + rooms[roomId].size + ' peers)');
  });
  socket.on('offer',  d => io.to(d.to).emit('offer',  { from: socket.id, offer:  d.offer  }));
  socket.on('answer', d => io.to(d.to).emit('answer', { from: socket.id, answer: d.answer }));
  socket.on('ice',    d => io.to(d.to).emit('ice',    { from: socket.id, candidate: d.candidate }));
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].delete(socket.id);
      socket.to(currentRoom).emit('peer-left', socket.id);
      if (rooms[currentRoom].size === 0) delete rooms[currentRoom];
    }
  });
});
console.log('[TAP] WebRTC signaling ready at /signal');

// ── START ──
server.listen(PORT, () => {
  console.log('TAP payment server running on port ' + PORT);
  console.log('Stripe key loaded:', !!STRIPE_SECRET_KEY);
});
