const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cors());

// Store active rooms and users
const rooms = new Map();

// Simple user authentication (in production, use a proper database)
const userAccounts = new Map();

// Routes for user authentication
app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  
  if (userAccounts.has(email)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  
  userAccounts.set(email, { name, email, password });
  res.json({ message: 'User created successfully' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!userAccounts.has(email)) {
    return res.status(400).json({ error: 'User not found' });
  }
  
  const user = userAccounts.get(email);
  if (user.password !== password) {
    return res.status(400).json({ error: 'Invalid password' });
  }
  
  res.json({ 
    message: 'Login successful', 
    user: { name: user.name, email: user.email } 
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        createdAt: new Date()
      });
    }
    
    const room = rooms.get(roomId);
    
    // Add user to room
    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      joinedAt: new Date()
    });
    
    socket.join(roomId);
    
    // Notify other users in the room
    socket.to(roomId).emit('user-connected', {
      userId: socket.id,
      userName: userName
    });
    
    // Send current users to the new user
    const usersInRoom = Array.from(room.users.values())
      .filter(user => user.id !== socket.id);
    
    usersInRoom.forEach(user => {
      socket.emit('user-connected', {
        userId: user.id,
        userName: user.name
      });
    });
    
    console.log(`${userName} joined room ${roomId}`);
  });
  
  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });
  
  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });
  
  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove user from all rooms
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        const userName = room.users.get(socket.id).name;
        room.users.delete(socket.id);
        
        socket.to(roomId).emit('user-disconnected', {
          userId: socket.id
        });
        
        console.log(`${userName} left room ${roomId}`);
        
        // Clean up empty rooms
        if (room.users.size === 0) {
          setTimeout(() => {
            if (rooms.get(roomId) && rooms.get(roomId).users.size === 0) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} deleted due to inactivity`);
            }
          }, 300000); // 5 minutes
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
