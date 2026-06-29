/**
 * TAP Money — Signaling + Payment Server
 * Render deployment: https://tap-payment-server-9cc5.onrender.com
 * GitHub: github.com/ilevelmusic-web/Tap2025
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const app    = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://tap.tamalavzw.org',
  'http://localhost:3000',
  'http://localhost:5500',
  'null',          // local file:// in browser
];

app.use(cors({
  origin: function(origin, cb){
    if(!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) cb(null, true);
    else cb(new Error('CORS: origin not allowed — ' + origin));
  },
  credentials: true
}));
app.use(express.json());

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET','POST'],
    credentials: true
  }
});

// ── In-memory registries ──────────────────────────────────────────────────────
//  tapCode  →  socket.id   (who is currently online)
const onlineUsers = {};

//  roomId  →  { callerId: socket.id, calleeId: socket.id | null }
const activeRooms = {};

// ─────────────────────────────────────────────────────────────────────────────
//  /signal  namespace  —  WebRTC signaling + call coordination
// ─────────────────────────────────────────────────────────────────────────────
const signal = io.of('/signal');

signal.on('connection', function(socket){
  console.log('[signal] connected:', socket.id);

  // ── Register this device under a TAP code ─────────────────────────────────
  // Emitted by the client on app open / after login.
  // { code: "AMA1K9F" }
  socket.on('register', function(data){
    var code = (data && data.code) ? String(data.code).toUpperCase() : null;
    if(!code) return;
    socket.tapCode = code;
    onlineUsers[code] = socket.id;
    console.log('[signal] registered:', code, '->', socket.id);
  });

  // ── Outgoing call request ─────────────────────────────────────────────────
  // Caller emits this; server forwards call-incoming to the callee if online.
  // { room, callerName, callerCode, targetCode }
  socket.on('call-request', function(data){
    var room       = data.room;
    var callerName = data.callerName || 'Someone';
    var callerCode = data.callerCode || socket.tapCode;
    var targetCode = data.targetCode ? String(data.targetCode).toUpperCase() : null;

    // Record room
    activeRooms[room] = { callerId: socket.id, calleeId: null };
    socket.join(room);

    if(!targetCode || !onlineUsers[targetCode]){
      // Target not online — notify caller
      socket.emit('call-unavailable', { message: 'User is not available right now' });
      return;
    }

    var targetSocketId = onlineUsers[targetCode];
    activeRooms[room].calleeId = targetSocketId;

    // Tell the target they have an incoming call
    signal.to(targetSocketId).emit('call-incoming', {
      room:       room,
      callerName: callerName,
      callerCode: callerCode
    });

    console.log('[signal] call-request', callerCode, '->', targetCode, 'room:', room);
  });

  // ── Callee accepts ────────────────────────────────────────────────────────
  // { room }
  socket.on('call-accept', function(data){
    var room = data.room;
    socket.join(room);
    if(activeRooms[room]) activeRooms[room].calleeId = socket.id;
    socket.to(room).emit('call-accepted', { room: room });
    console.log('[signal] call-accepted room:', room);
  });

  // ── Callee declines ───────────────────────────────────────────────────────
  // { room }
  socket.on('call-decline', function(data){
    var room = data.room;
    socket.to(room).emit('call-declined', { room: room });
    delete activeRooms[room];
    console.log('[signal] call-declined room:', room);
  });

  // ── Either party ends the call ────────────────────────────────────────────
  // { room }
  socket.on('call-end', function(data){
    var room = data.room;
    socket.to(room).emit('call-ended', { room: room });
    delete activeRooms[room];
    console.log('[signal] call-ended room:', room);
  });

  // ── WebRTC offer (caller → callee) ────────────────────────────────────────
  // { room, sdp }
  socket.on('webrtc-offer', function(data){
    socket.to(data.room).emit('webrtc-offer', { room: data.room, sdp: data.sdp });
  });

  // ── WebRTC answer (callee → caller) ──────────────────────────────────────
  // { room, sdp }
  socket.on('webrtc-answer', function(data){
    socket.to(data.room).emit('webrtc-answer', { room: data.room, sdp: data.sdp });
  });

  // ── ICE candidates (both directions) ─────────────────────────────────────
  // { room, candidate }
  socket.on('webrtc-ice', function(data){
    socket.to(data.room).emit('webrtc-ice', { room: data.room, candidate: data.candidate });
  });

  // ── Disconnect cleanup ────────────────────────────────────────────────────
  socket.on('disconnect', function(){
    console.log('[signal] disconnected:', socket.id, socket.tapCode || '(unregistered)');

    // Remove from online registry
    if(socket.tapCode && onlineUsers[socket.tapCode] === socket.id){
      delete onlineUsers[socket.tapCode];
    }

    // End any room this socket was part of
    Object.keys(activeRooms).forEach(function(room){
      var r = activeRooms[room];
      if(r.callerId === socket.id || r.calleeId === socket.id){
        signal.to(room).emit('call-ended', { room: room });
        delete activeRooms[room];
      }
    });
  });
});

// ── Health + debug routes ─────────────────────────────────────────────────────
app.get('/', function(req, res){
  res.json({
    status: 'ok',
    service: 'TAP Money Server',
    online: Object.keys(onlineUsers).length,
    activeCalls: Object.keys(activeRooms).length
  });
});

app.get('/online', function(req, res){
  // Returns list of online TAP codes (useful for testing)
  res.json({ online: Object.keys(onlineUsers) });
});

// ─────────────────────────────────────────────────────────────────────────────
//  EXISTING STRIPE / PAYMENT ROUTES
//  ↓  Paste your existing Stripe webhook and payment intent routes below here.
//  Nothing above this line should need changing.
// ─────────────────────────────────────────────────────────────────────────────




// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, function(){
  console.log('TAP Money server running on port', PORT);
});
