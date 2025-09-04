document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const loginCard = document.getElementById('login-card');
    const roomCard = document.getElementById('room-card');
    const joinBtn = document.getElementById('join-btn');
    const nameInput = document.getElementById('name');
    const roomInput = document.getElementById('room');
    const roomIdDisplay = document.getElementById('room-id-display');
    const userCount = document.getElementById('user-count');
    const userList = document.getElementById('user-list');
    const talkBtn = document.getElementById('talk-btn');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    
    // Application state
    let socket = null;
    let localStream = null;
    let roomId = null;
    let userName = null;
    let peers = new Map();
    let isTalking = false;
    
    // Initialize
    nameInput.value = 'User' + Math.floor(Math.random() * 1000);
    roomInput.value = Math.floor(1000 + Math.random() * 9000);
    
    // Join room
    joinBtn.addEventListener('click', joinRoom);
    
    function joinRoom() {
        userName = nameInput.value.trim();
        roomId = roomInput.value.trim();
        
        if (userName === '' || roomId === '') {
            alert('Please enter your name and room PIN');
            return;
        }
        
        // Connect to server
        socket = io();
        
        // Set up socket event handlers
        socket.on('connect', () => {
            console.log('Connected to server');
            
            // Join the room
            socket.emit('join-room', {
                roomId: roomId,
                userName: userName
            });
        });
        
        socket.on('users-in-room', (data) => {
            loginCard.classList.add('hidden');
            roomCard.classList.remove('hidden');
            roomIdDisplay.textContent = roomId;
            
            // Clear user list and add current users
            userList.innerHTML = '';
            addUserToList(userName, socket.id, true);
            
            data.users.forEach(user => {
                if (user.id !== socket.id) {
                    addUserToList(user.name, user.id, false);
                    createPeerConnection(user.id);
                }
            });
            
            updateUserCount(data.users.length);
        });
        
        socket.on('user-joined', (data) => {
            addUserToList(data.userName, data.userId, false);
            updateUserCount(data.users.length);
            addMessage('system', `${data.userName} joined the room`);
            
            // Create peer connection for the new user
            createPeerConnection(data.userId);
        });
        
        socket.on('user-left', (data) => {
            removeUserFromList(data.userId);
            updateUserCount(data.users.length);
            addMessage('system', `${data.userName} left the room`);
            
            // Close peer connection
            if (peers.has(data.userId)) {
                peers.get(data.userId).close();
                peers.delete(data.userId);
            }
        });
        
        socket.on('receive-chat-message', (data) => {
            const messageType = data.userId === socket.id ? 'self' : 'other';
            addMessage(messageType, `${data.userName}: ${data.message}`);
        });
        
        socket.on('user-audio-start', (data) => {
            setUserTalking(data.userId, true);
            if (data.userId !== socket.id) {
                addMessage('system', `${data.userName} started talking`);
            }
        });
        
        socket.on('user-audio-end', (data) => {
            setUserTalking(data.userId, false);
        });
        
        socket.on('webrtc-offer', async (data) => {
            if (peers.has(data.sender)) {
                const peer = peers.get(data.sender);
                await peer.setRemoteDescription(data.offer);
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                
                socket.emit('webrtc-answer', {
                    target: data.sender,
                    answer: answer
                });
            }
        });
        
        socket.on('webrtc-answer', async (data) => {
            if (peers.has(data.sender)) {
                const peer = peers.get(data.sender);
                await peer.setRemoteDescription(data.answer);
            }
        });
        
        socket.on('webrtc-ice-candidate', async (data) => {
            if (peers.has(data.sender)) {
                const peer = peers.get(data.sender);
                await peer.addIceCandidate(data.candidate);
            }
        });
        
        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            alert('Disconnected from server. Please refresh the page.');
        });
        
        // Initialize audio
        initAudio();
    }
    
    // Initialize audio
    async function initAudio() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            console.log('Audio access granted');
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Could not access your microphone. Please check permissions.');
        }
    }
    
    // Create peer connection
    function createPeerConnection(userId) {
        if (peers.has(userId)) return;
        
        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        // Add local stream to peer connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peer.addTrack(track, localStream);
            });
        }
        
        // Handle incoming stream
        peer.ontrack = (event) => {
            const audio = document.createElement('audio');
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            audio.volume = 1.0;
            document.body.appendChild(audio);
        };
        
        // Handle ICE candidates
        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };
        
        peers.set(userId, peer);
        
        // Create offer
        createOffer(userId);
    }
    
    // Create offer
    async function createOffer(userId) {
        const peer = peers.get(userId);
        if (!peer) return;
        
        try {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            
            socket.emit('webrtc-offer', {
                target: userId,
                offer: offer
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }
    
    // Talk button functionality
    talkBtn.addEventListener('mousedown', startTalking);
    talkBtn.addEventListener('touchstart', startTalking);
    talkBtn.addEventListener('mouseup', stopTalking);
    talkBtn.addEventListener('touchend', stopTalking);
    talkBtn.addEventListener('mouseleave', stopTalking);
    
    function startTalking(e) {
        e.preventDefault();
        if (isTalking) return;
        
        isTalking = true;
        talkBtn.classList.add('active');
        talkBtn.innerHTML = '<i class="fas fa-microphone"></i> TALKING...';
        
        // Enable audio tracks
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = true;
            });
        }
        
        // Notify others
        socket.emit('audio-start', { roomId: roomId });
        
        setUserTalking(socket.id, true);
        addMessage('self', 'Started transmitting...');
    }
    
    function stopTalking() {
        if (!isTalking) return;
        
        isTalking = false;
        talkBtn.classList.remove('active');
        talkBtn.innerHTML = '<i class="fas fa-microphone"></i> PRESS TO TALK';
        
        // Disable audio tracks
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }
        
        // Notify others
        socket.emit('audio-end', { roomId: roomId });
        
        setUserTalking(socket.id, false);
        addMessage('self', 'Stopped transmitting');
    }
    
    // Send chat message
    sendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });
    
    function sendChatMessage() {
        const message = chatInput.value.trim();
        if (message === '') return;
        
        socket.emit('send-chat-message', {
            roomId: roomId,
            message: message
        });
        
        chatInput.value = '';
    }
    
    // Helper functions
    function addUserToList(name, id, isSelf) {
        const li = document.createElement('li');
        li.id = `user-${id}`;
        li.innerHTML = `<i class="fas fa-user"></i> ${isSelf ? 'You' : name}`;
        userList.appendChild(li);
    }
    
    function removeUserFromList(id) {
        const userElement = document.getElementById(`user-${id}`);
        if (userElement) {
            userElement.remove();
        }
    }
    
    function setUserTalking(id, talking) {
        const userElement = document.getElementById(`user-${id}`);
        if (userElement) {
            if (talking) {
                userElement.classList.add('talking');
                userElement.innerHTML = `<i class="fas fa-microphone"></i> ${id === socket.id ? 'You' : 'User'} (Talking)`;
            } else {
                userElement.classList.remove('talking');
                userElement.innerHTML = `<i class="fas fa-user"></i> ${id === socket.id ? 'You' : 'User'}`;
            }
        }
    }
    
    function updateUserCount(count) {
        userCount.textContent = count;
    }
    
    function addMessage(type, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        messageDiv.classList.add(type);
        messageDiv.textContent = text;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});