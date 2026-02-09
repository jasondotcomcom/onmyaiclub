const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  },
});

// ========== KONAMI CODE TRACKING ==========
let konamiActivations = 0;
const lastKonamiActivation = new Map(); // Per-user debounce: oderId oderId oderId userId -> timestamp

// ========== SONG SYNC CONFIG ==========
const SONG_DURATION = 21.0; // Duration of the loop in seconds (adjust to match your audio)
const serverStartTime = Date.now(); // When server started = when song "started"

// Get elapsed time since server started (the master clock)
function getElapsedTime() {
  return (Date.now() - serverStartTime) / 1000;
}

// Calculate current position in the song loop
function getCurrentSongTime() {
  return getElapsedTime() % SONG_DURATION;
}

function getLoopCount() {
  return Math.floor(getElapsedTime() / SONG_DURATION);
}

// ========== USER MANAGEMENT ==========
const users = new Map(); // oderId oderId userId -> { oderId oderId id, color, x, y }

// Generate random vibrant color
function generateColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 80%, 60%)`;
}

// ========== SOCKET HANDLERS ==========
io.on('connection', (socket) => {
  const userId = socket.id;
  const userColor = generateColor();

  // Create user entry
  users.set(userId, {
    id: userId,
    color: userColor,
    x: 0.5, // Normalized 0-1
    y: 0.5,
  });

  console.log(`User connected: ${userId} (${users.size} total)`);

  // Send initial sync data to new user
  // Include serverNow for latency calculation
  socket.emit('sync', {
    serverStartTime: serverStartTime, // Unix timestamp when server started
    serverNow: Date.now(),            // Current server time (for latency calc)
    songDuration: SONG_DURATION,      // So client knows loop length
    songTime: getCurrentSongTime(),   // Current position (for reference/logging)
    loopCount: getLoopCount(),        // Current loop count (for reference/logging)
    userId: userId,
    userColor: userColor,
    users: Array.from(users.values()),
    userCount: users.size,
  });

  console.log(`Sent sync to ${userId}: serverStartTime=${serverStartTime}, elapsed=${getElapsedTime().toFixed(2)}s, songTime=${getCurrentSongTime().toFixed(2)}s`);

  // Notify others of new user
  socket.broadcast.emit('userJoined', {
    user: users.get(userId),
    userCount: users.size,
  });

  // Handle cursor movement
  socket.on('cursorMove', (data) => {
    const user = users.get(userId);
    if (user) {
      user.x = data.x;
      user.y = data.y;
      // Broadcast to others
      socket.broadcast.emit('cursorUpdate', {
        userId: userId,
        x: data.x,
        y: data.y,
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    users.delete(userId);
    console.log(`User disconnected: ${userId} (${users.size} remaining)`);
    io.emit('userLeft', {
      userId: userId,
      userCount: users.size,
    });
  });

  // Handle sync request (client can request re-sync)
  socket.on('requestSync', () => {
    socket.emit('sync', {
      serverStartTime: serverStartTime,
      serverNow: Date.now(),
      songDuration: SONG_DURATION,
      songTime: getCurrentSongTime(),
      loopCount: getLoopCount(),
      userId: userId,
      userColor: userColor,
      users: Array.from(users.values()),
      userCount: users.size,
    });
    console.log(`Re-sync sent to ${userId}: elapsed=${getElapsedTime().toFixed(2)}s`);
  });

  // Handle ping for latency measurement
  socket.on('ping', (clientTime) => {
    socket.emit('pong', {
      clientTime: clientTime,
      serverTime: Date.now(),
      songTime: getCurrentSongTime(),
      loopCount: getLoopCount(),
    });
  });

  // Handle Konami code activation - with per-user debounce
  socket.on('konamiActivated', () => {
    const now = Date.now();
    const lastActivation = lastKonamiActivation.get(userId) || 0;

    // Debounce: ignore if same user activated within 1 second
    if (now - lastActivation < 1000) {
      console.log(`[KONAMI] Debounced duplicate from ${userId}`);
      return;
    }
    lastKonamiActivation.set(userId, now);

    konamiActivations++;
    console.log(`[KONAMI] User ${userId} activated! Total: ${konamiActivations}`);
    socket.emit('konamiCount', { count: konamiActivations });
  });
});

// Broadcast time sync heartbeat every 2 seconds
setInterval(() => {
  if (users.size > 0) {
    io.emit('heartbeat', {
      serverNow: Date.now(),
      serverStartTime: serverStartTime,
      songTime: getCurrentSongTime(),
      loopCount: getLoopCount(),
    });
  }
}, 2000);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    songTime: getCurrentSongTime(),
    loopCount: getLoopCount(),
    userCount: users.size,
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🎵 Music sync server running on port ${PORT}`);
  console.log(`   Song duration: ${SONG_DURATION}s`);
  console.log(`   Server start time: ${new Date(serverStartTime).toISOString()}`);
});
