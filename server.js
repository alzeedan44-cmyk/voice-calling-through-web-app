const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

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
    const { roomName, userName } = data;
    
    // Create room if it doesn't exist
    if (!rooms.has(roomName)) {
      rooms.set(roomName, {
        users: new Map(),
      });
    }
    
    const room = rooms.get(roomName);
    
    // Check if room is full (max 10 users)
    if (room.users.size >= 10) {
      socket.emit('room-full');
      return;
    }
    
    // Add user to room
    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      roomName: roomName,
      audioStatus: 'unmuted'
    });
    
    socket.join(roomName);
    
    // Notify others in the room
    socket.to(roomName).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });
    
    // Send current users to the new user
    const usersInRoom = Array.from(room.users.values()).filter(user => user.id !== socket.id);
    usersInRoom.forEach(user => {
      socket.emit('user-joined', {
        userId: user.id,
        userName: user.name
      });
    });
    
    console.log(`${userName} joined room ${roomName}`);
  });

  // Handle WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // Handle audio status changes
  socket.on('audio-change', (data) => {
    const room = rooms.get(data.roomName);
    if (room && room.users.has(socket.id)) {
      room.users.get(socket.id).audioStatus = data.audioStatus;
      socket.to(data.roomName).emit('user-audio-changed', {
        userId: socket.id,
        audioStatus: data.audioStatus
      });
    }
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Find the room the user was in
    for (const [roomName, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        const userName = room.users.get(socket.id).name;
        room.users.delete(socket.id);
        
        // Notify others in the room
        socket.to(roomName).emit('user-left', {
          userId: socket.id,
          userName: userName
        });
        
        // Remove room if empty
        if (room.users.size === 0) {
          rooms.delete(roomName);
        }
        
        break;
      }
    }
  });

  // Handle leaving a room
  socket.on('leave-room', (data) => {
    const { roomName } = data;
    const room = rooms.get(roomName);
    
    if (room && room.users.has(socket.id)) {
      const userName = room.users.get(socket.id).name;
      room.users.delete(socket.id);
      
      // Notify others in the room
      socket.to(roomName).emit('user-left', {
        userId: socket.id,
        userName: userName
      });
      
      // Remove room if empty
      if (room.users.size === 0) {
        rooms.delete(roomName);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});