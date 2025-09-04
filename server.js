const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store rooms and users
const rooms = new Map();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle joining a room
  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        audioSessions: new Map()
      });
    }
    
    const room = rooms.get(roomId);
    
    // Add user to room
    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      roomId: roomId
    });
    
    socket.join(roomId);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: userName,
      users: Array.from(room.users.values())
    });
    
    // Send current users to the new user
    socket.emit('users-in-room', {
      users: Array.from(room.users.values())
    });
    
    console.log(`${userName} joined room ${roomId}`);
  });

  // Handle WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    socket.to(data.target).emit('webrtc-offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    socket.to(data.target).emit('webrtc-answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    socket.to(data.target).emit('webrtc-ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Handle chat messages
  socket.on('send-chat-message', (data) => {
    const room = rooms.get(data.roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      io.to(data.roomId).emit('receive-chat-message', {
        message: data.message,
        userName: user.name,
        userId: socket.id,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  });

  // Handle audio session start
  socket.on('audio-start', (data) => {
    const room = rooms.get(data.roomId);
    if (room) {
      room.audioSessions.set(socket.id, {
        userId: socket.id,
        userName: room.users.get(socket.id).name,
        startTime: new Date()
      });
      
      socket.to(data.roomId).emit('user-audio-start', {
        userId: socket.id,
        userName: room.users.get(socket.id).name
      });
    }
  });

  // Handle audio session end
  socket.on('audio-end', (data) => {
    const room = rooms.get(data.roomId);
    if (room && room.audioSessions.has(socket.id)) {
      room.audioSessions.delete(socket.id);
      socket.to(data.roomId).emit('user-audio-end', {
        userId: socket.id
      });
    }
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Find the room the user was in
    for (const [roomId, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        const userName = room.users.get(socket.id).name;
        room.users.delete(socket.id);
        room.audioSessions.delete(socket.id);
        
        // Notify others in the room
        socket.to(roomId).emit('user-left', {
          userId: socket.id,
          userName: userName,
          users: Array.from(room.users.values())
        });
        
        // Remove room if empty
        if (room.users.size === 0) {
          rooms.delete(roomId);
        }
        
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});