const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Increase server timeout for stable connections
server.timeout = 30000;
server.keepAliveTimeout = 30000;

// Configure Socket.IO with better performance settings
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8,
  allowEIO3: true
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Enable CORS for all routes
app.use(cors());

// Add compression for better performance
const compression = require('compression');
app.use(compression());

// Store rooms and users
const rooms = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    rooms: Array.from(rooms.keys()),
    totalUsers: Array.from(rooms.values()).reduce((acc, room) => acc + room.users.size, 0),
    uptime: process.uptime()
  });
});

// Get room statistics
app.get('/stats', (req, res) => {
  const roomStats = Array.from(rooms.entries()).map(([roomName, room]) => ({
    roomName,
    userCount: room.users.size,
    users: Array.from(room.users.values()).map(user => ({
      id: user.id,
      name: user.name
    }))
  }));

  res.status(200).json({
    totalRooms: rooms.size,
    totalUsers: roomStats.reduce((acc, room) => acc + room.userCount, 0),
    rooms: roomStats,
    serverTime: new Date().toISOString()
  });
});

// Main route - serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware to log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - ${req.ip}`);
  next();
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Set a longer timeout for this socket
  socket.conn.transport.on("poll", () => {
    socket.conn.transport.polling = setTimeout;
  });

  // Handle joining a room
  socket.on('join-room', (data) => {
    const { roomName, userName } = data;
    
    // Validate input
    if (!roomName || !userName) {
      socket.emit('error', { message: 'Room name and user name are required' });
      return;
    }

    // Create room if it doesn't exist
    if (!rooms.has(roomName)) {
      rooms.set(roomName, {
        users: new Map(),
        createdAt: new Date()
      });
      console.log(`Created new room: ${roomName}`);
    }
    
    const room = rooms.get(roomName);
    
    // Check if room is full (max 10 users)
    if (room.users.size >= 10) {
      socket.emit('room-full', { roomName });
      console.log(`Room ${roomName} is full, rejecting ${userName}`);
      return;
    }

    // Check if username already exists in room
    const existingUser = Array.from(room.users.values()).find(user => user.name === userName);
    if (existingUser) {
      socket.emit('error', { message: 'Username already taken in this room' });
      return;
    }
    
    // Add user to room
    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      roomName: roomName,
      audioStatus: 'unmuted',
      joinedAt: new Date()
    });
    
    socket.join(roomName);
    
    // Notify others in the room
    socket.to(roomName).emit('user-joined', {
      userId: socket.id,
      userName: userName,
      users: Array.from(room.users.values()).filter(user => user.id !== socket.id)
    });
    
    // Send current users to the new user
    const usersInRoom = Array.from(room.users.values()).filter(user => user.id !== socket.id);
    socket.emit('users-in-room', {
      users: usersInRoom,
      roomName: roomName
    });

    // Send success message
    socket.emit('joined-room', {
      roomName: roomName,
      userName: userName,
      userId: socket.id
    });
    
    console.log(`${userName} joined room ${roomName}. Total users: ${room.users.size}`);
  });

  // Handle WebRTC signaling - Offer
  socket.on('offer', (data) => {
    console.log(`Forwarding offer from ${socket.id} to ${data.to}`);
    socket.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id,
      userName: data.userName || 'Unknown User'
    });
  });

  // Handle WebRTC signaling - Answer
  socket.on('answer', (data) => {
    console.log(`Forwarding answer from ${socket.id} to ${data.to}`);
    socket.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id,
      userName: data.userName || 'Unknown User'
    });
  });

  // Handle WebRTC signaling - ICE Candidate
  socket.on('ice-candidate', (data) => {
    console.log(`Forwarding ICE candidate from ${socket.id} to ${data.to}`);
    socket.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id,
      userName: data.userName || 'Unknown User'
    });
  });

  // Handle audio status changes
  socket.on('audio-change', (data) => {
    const room = rooms.get(data.roomName);
    if (room && room.users.has(socket.id)) {
      room.users.get(socket.id).audioStatus = data.audioStatus;
      socket.to(data.roomName).emit('user-audio-changed', {
        userId: socket.id,
        userName: data.userName,
        audioStatus: data.audioStatus
      });
      console.log(`${data.userName} ${data.audioStatus} audio in room ${data.roomName}`);
    }
  });

  // Handle chat messages
  socket.on('chat-message', (data) => {
    const room = rooms.get(data.roomName);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      socket.to(data.roomName).emit('chat-message', {
        userId: socket.id,
        userName: user.name,
        message: data.message,
        timestamp: new Date().toISOString()
      });
      console.log(`Chat message from ${user.name} in ${data.roomName}`);
    }
  });

  // Handle user disconnection
  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
    
    // Find the room the user was in
    for (const [roomName, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        const userName = room.users.get(socket.id).name;
        room.users.delete(socket.id);
        
        // Notify others in the room
        socket.to(roomName).emit('user-left', {
          userId: socket.id,
          userName: userName,
          users: Array.from(room.users.values())
        });
        
        // Remove room if empty
        if (room.users.size === 0) {
          rooms.delete(roomName);
          console.log(`Deleted empty room: ${roomName}`);
        } else {
          console.log(`${userName} left room ${roomName}. Remaining users: ${room.users.size}`);
        }
        
        break;
      }
    }
  });

  // Handle leaving a room explicitly
  socket.on('leave-room', (data) => {
    const { roomName } = data;
    const room = rooms.get(roomName);
    
    if (room && room.users.has(socket.id)) {
      const userName = room.users.get(socket.id).name;
      room.users.delete(socket.id);
      
      // Notify others in the room
      socket.to(roomName).emit('user-left', {
        userId: socket.id,
        userName: userName,
        users: Array.from(room.users.values())
      });
      
      // Remove room if empty
      if (room.users.size === 0) {
        rooms.delete(roomName);
        console.log(`Deleted empty room: ${roomName}`);
      }
      
      console.log(`${userName} left room ${roomName}`);
      
      // Send confirmation to user
      socket.emit('left-room', { roomName });
    }
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });

  // Handle ping from clients
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  🚀 Server running on port ${PORT}
  📊 Health check: http://localhost:${PORT}/health
  📈 Statistics: http://localhost:${PORT}/stats
  💬 WebRTC Voice Chat: http://localhost:${PORT}
  `);
});

module.exports = app;