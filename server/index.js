/**
 * SyncSpeakers WebSocket Signaling Server
 * 
 * Handles:
 * - Device registration with animal names
 * - Room management
 * - Host invite flow
 * - Speaker accept/decline flow
 * - WebRTC signaling (SDP/ICE relay)
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;

// Data structures
// rooms: Map<roomId, Map<clientId, ClientInfo>>
// ClientInfo: { ws, clientId, displayName, role, roomId }
// invites: Map<inviteId, { from, to, roomId, expires, payload }>
const rooms = new Map();
const invites = new Map();

// Animal names pool
const ANIMALS = [
  'pig', 'dog', 'cat', 'rabbit', 'fox', 'owl', 'lion', 'bear', 
  'wolf', 'deer', 'eagle', 'tiger', 'panda', 'koala', 'penguin',
  'dolphin', 'whale', 'shark', 'turtle', 'frog', 'duck', 'goose',
  'chicken', 'horse', 'cow', 'sheep', 'goat', 'monkey', 'elephant'
];

// Invite timeout in ms
const INVITE_TIMEOUT_MS = 20000;

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

console.log(`🔊 SyncSpeakers Signaling Server running on port ${PORT}`);

// Helper: Get all clients in a room as array
function getRoomClients(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.values()).map(client => ({
    clientId: client.clientId,
    displayName: client.displayName,
    role: client.role
  }));
}

// Helper: Broadcast to all clients in a room
function broadcastToRoom(roomId, message, excludeClientId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const msgStr = JSON.stringify(message);
  room.forEach((client, clientId) => {
    if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msgStr);
    }
  });
}

// Helper: Send message to specific client
function sendToClient(roomId, clientId, message) {
  const room = rooms.get(roomId);
  if (!room) return false;
  
  const client = room.get(clientId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// Helper: Get host of a room
function getRoomHost(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  
  for (const [clientId, client] of room) {
    if (client.role === 'host') {
      return client;
    }
  }
  return null;
}

// Helper: Generate unique display name
function generateUniqueDisplayName(roomId, baseName) {
  const room = rooms.get(roomId);
  if (!room) return baseName;
  
  const existingNames = Array.from(room.values()).map(c => c.displayName);
  
  if (!existingNames.includes(baseName)) {
    return baseName;
  }
  
  // Add number suffix
  let counter = 2;
  while (existingNames.includes(`${baseName}-${counter}`)) {
    counter++;
  }
  return `${baseName}-${counter}`;
}

// Handle invite timeout
function scheduleInviteTimeout(inviteId) {
  setTimeout(() => {
    const invite = invites.get(inviteId);
    if (invite) {
      // Invite expired - notify host
      sendToClient(invite.roomId, invite.from, {
        type: 'invite-expired',
        inviteId,
        to: invite.to
      });
      
      // Notify target that invite expired
      sendToClient(invite.roomId, invite.to, {
        type: 'invite-expired',
        inviteId,
        from: invite.from
      });
      
      invites.delete(inviteId);
    }
  }, INVITE_TIMEOUT_MS);
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('🔌 New connection');
  
  // Store client info on the ws object
  ws.clientInfo = null;
  
  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }
    
    const { type, roomId, clientId, displayName, role, from, to, payload, accepted, inviteId } = message;
    
    console.log(`📨 Received: ${type} from ${from || clientId || 'unknown'}`);
    
    switch (type) {
      // ==========================================
      // REGISTER - Client joins a room
      // ==========================================
      case 'register': {
        if (!roomId || !clientId) {
          ws.send(JSON.stringify({ type: 'error', message: 'roomId and clientId required' }));
          return;
        }
        
        // Create room if doesn't exist
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Map());
        }
        
        const room = rooms.get(roomId);
        
        // Generate unique display name
        const baseDisplayName = displayName || ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
        const uniqueDisplayName = generateUniqueDisplayName(roomId, baseDisplayName);
        
        // Determine role
        let finalRole = role || 'idle';
        
        // If registering as host, check if room already has one
        if (finalRole === 'host') {
          const existingHost = getRoomHost(roomId);
          if (existingHost && existingHost.clientId !== clientId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room already has a host' }));
            return;
          }
        }
        
        // Store client info
        const clientInfo = {
          ws,
          clientId,
          displayName: uniqueDisplayName,
          role: finalRole,
          roomId
        };
        
        room.set(clientId, clientInfo);
        ws.clientInfo = clientInfo;
        
        console.log(`✅ ${uniqueDisplayName} (${clientId}) joined room ${roomId} as ${finalRole}`);
        
        // Send confirmation to the client
        ws.send(JSON.stringify({
          type: 'registered',
          clientId,
          displayName: uniqueDisplayName,
          role: finalRole,
          roomId,
          clients: getRoomClients(roomId)
        }));
        
        // Broadcast updated client list to everyone in room
        broadcastToRoom(roomId, {
          type: 'clients-updated',
          clients: getRoomClients(roomId)
        }, clientId);
        
        break;
      }
      
      // ==========================================
      // INVITE - Host invites a device to be speaker
      // ==========================================
      case 'invite': {
        if (!roomId || !from || !to) {
          ws.send(JSON.stringify({ type: 'error', message: 'roomId, from, and to required' }));
          return;
        }
        
        const room = rooms.get(roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        
        // Validate sender is the host
        const sender = room.get(from);
        if (!sender || sender.role !== 'host') {
          ws.send(JSON.stringify({ type: 'error', message: 'Only host can send invites' }));
          return;
        }
        
        // Check target exists
        const target = room.get(to);
        if (!target) {
          ws.send(JSON.stringify({ type: 'error', message: 'Target client not found' }));
          return;
        }
        
        // Create invite record
        const newInviteId = uuidv4();
        const invite = {
          inviteId: newInviteId,
          from,
          to,
          roomId,
          payload: payload || {},
          expires: Date.now() + INVITE_TIMEOUT_MS,
          hostDisplayName: sender.displayName
        };
        
        invites.set(newInviteId, invite);
        
        // Send invite to target
        const sent = sendToClient(roomId, to, {
          type: 'invite',
          inviteId: newInviteId,
          from,
          fromDisplayName: sender.displayName,
          payload: payload || { role: 'speaker', note: 'Become my speaker?' }
        });
        
        if (sent) {
          // Confirm to host
          ws.send(JSON.stringify({
            type: 'invite-sent',
            inviteId: newInviteId,
            to,
            toDisplayName: target.displayName
          }));
          
          console.log(`📤 Invite sent from ${sender.displayName} to ${target.displayName}`);
          
          // Schedule timeout
          scheduleInviteTimeout(newInviteId);
        } else {
          invites.delete(newInviteId);
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to send invite' }));
        }
        
        break;
      }
      
      // ==========================================
      // INVITE-RESPONSE - Speaker accepts or declines
      // ==========================================
      case 'invite-response': {
        if (!roomId || !from || !to || accepted === undefined) {
          ws.send(JSON.stringify({ type: 'error', message: 'roomId, from, to, and accepted required' }));
          return;
        }
        
        const room = rooms.get(roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        
        // Find and remove the invite
        let foundInvite = null;
        for (const [id, inv] of invites) {
          if (inv.from === to && inv.to === from && inv.roomId === roomId) {
            foundInvite = inv;
            invites.delete(id);
            break;
          }
        }
        
        const responder = room.get(from);
        const host = room.get(to);
        
        if (accepted) {
          // Update role to speaker
          if (responder) {
            responder.role = 'speaker';
            console.log(`✅ ${responder.displayName} accepted invite and is now a speaker`);
          }
        } else {
          console.log(`❌ ${responder?.displayName || from} declined invite`);
        }
        
        // Notify host
        sendToClient(roomId, to, {
          type: 'invite-response',
          from,
          fromDisplayName: responder?.displayName,
          accepted,
          inviteId: message.inviteId
        });
        
        // If accepted, broadcast updated client list
        if (accepted) {
          broadcastToRoom(roomId, {
            type: 'clients-updated',
            clients: getRoomClients(roomId)
          });
        }
        
        break;
      }
      
      // ==========================================
      // INVITE-CANCEL - Host cancels pending invite
      // ==========================================
      case 'invite-cancel': {
        const targetInviteId = message.inviteId;
        const invite = invites.get(targetInviteId);
        
        if (invite && invite.from === from) {
          invites.delete(targetInviteId);
          
          // Notify target
          sendToClient(invite.roomId, invite.to, {
            type: 'invite-cancelled',
            inviteId: targetInviteId
          });
          
          console.log(`🚫 Invite ${targetInviteId} cancelled`);
        }
        
        break;
      }
      
      // ==========================================
      // SIGNAL - WebRTC signaling (SDP/ICE)
      // ==========================================
      case 'signal': {
        if (!roomId || !from || !to || !payload) {
          ws.send(JSON.stringify({ type: 'error', message: 'roomId, from, to, and payload required' }));
          return;
        }
        
        // Relay signal to target
        const sent = sendToClient(roomId, to, {
          type: 'signal',
          from,
          payload
        });
        
        if (!sent) {
          ws.send(JSON.stringify({ type: 'error', message: 'Target client not available' }));
        }
        
        break;
      }
      
      // ==========================================
      // PLAY-COMMAND - Host sends play/pause to speakers
      // ==========================================
      case 'play-command': {
        if (!roomId || !from) {
          ws.send(JSON.stringify({ type: 'error', message: 'roomId and from required' }));
          return;
        }
        
        const room = rooms.get(roomId);
        if (!room) return;
        
        // Verify sender is host
        const sender = room.get(from);
        if (!sender || sender.role !== 'host') {
          ws.send(JSON.stringify({ type: 'error', message: 'Only host can send play commands' }));
          return;
        }
        
        // Broadcast to all speakers
        room.forEach((client) => {
          if (client.role === 'speaker') {
            sendToClient(roomId, client.clientId, {
              type: 'play-command',
              command: payload?.command || 'play', // play, pause, stop
              timestamp: payload?.timestamp
            });
          }
        });
        
        console.log(`▶️ Play command: ${payload?.command}`);
        
        break;
      }
      
      // ==========================================
      // LEAVE - Client leaves room
      // ==========================================
      case 'leave': {
        if (ws.clientInfo) {
          handleClientDisconnect(ws.clientInfo);
        }
        break;
      }
      
      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${type}` }));
    }
  });
  
  ws.on('close', () => {
    if (ws.clientInfo) {
      handleClientDisconnect(ws.clientInfo);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Handle client disconnect
function handleClientDisconnect(clientInfo) {
  const { clientId, roomId, displayName, role } = clientInfo;
  
  console.log(`👋 ${displayName} (${clientId}) disconnected from room ${roomId}`);
  
  const room = rooms.get(roomId);
  if (!room) return;
  
  // Remove client from room
  room.delete(clientId);
  
  // If host disconnected, notify all speakers
  if (role === 'host') {
    broadcastToRoom(roomId, {
      type: 'host-disconnected',
      message: 'Host has disconnected'
    });
    
    // Optionally: reset all speakers to idle
    room.forEach(client => {
      if (client.role === 'speaker') {
        client.role = 'idle';
      }
    });
  }
  
  // Clean up any pending invites from/to this client
  for (const [inviteId, invite] of invites) {
    if (invite.from === clientId || invite.to === clientId) {
      invites.delete(inviteId);
      
      // Notify the other party
      if (invite.from === clientId) {
        sendToClient(roomId, invite.to, {
          type: 'invite-cancelled',
          inviteId,
          reason: 'Host disconnected'
        });
      } else {
        sendToClient(roomId, invite.from, {
          type: 'invite-expired',
          inviteId,
          to: invite.to,
          reason: 'Target disconnected'
        });
      }
    }
  }
  
  // Broadcast updated client list
  if (room.size > 0) {
    broadcastToRoom(roomId, {
      type: 'clients-updated',
      clients: getRoomClients(roomId)
    });
  } else {
    // Clean up empty room
    rooms.delete(roomId);
    console.log(`🗑️ Room ${roomId} deleted (empty)`);
  }
}

// Periodic cleanup of stale invites
setInterval(() => {
  const now = Date.now();
  for (const [inviteId, invite] of invites) {
    if (invite.expires < now) {
      invites.delete(inviteId);
    }
  }
}, 30000);

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
  console.log('🛑 Server shutting down...');
  wss.clients.forEach(ws => {
    ws.close();
  });
  wss.close(() => {
    process.exit(0);
  });
});
