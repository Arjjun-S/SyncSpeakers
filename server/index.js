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

const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const ANIMALS = [
  "pig",
  "dog",
  "cat",
  "rabbit",
  "fox",
  "owl",
  "lion",
  "bear",
  "wolf",
  "deer",
  "eagle",
  "tiger",
  "panda",
  "koala",
  "penguin",
  "dolphin",
  "whale",
  "shark",
  "turtle",
  "frog",
  "duck",
  "goose",
  "chicken",
  "horse",
  "cow",
  "sheep",
  "goat",
  "monkey",
  "elephant",
];

const INVITE_TIMEOUT_MS = 20000;
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX_MESSAGES = 60; // generous but bounded
// Accept 4-12 uppercase letters/digits to align with tests and client generator
const ROOM_ID_REGEX = /^[A-Z0-9]{4,12}$/;

function createSignalingServer(options = {}) {
  const portOption = options.port ?? process.env.PORT ?? 8080;
  const rooms = new Map();
  const invites = new Map();
  const rateLimits = new WeakMap();

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocket.Server({ server });

  server.listen(portOption, () => {
    console.log(
      `🔊 SyncSpeakers Signaling Server running on port ${
        server.address().port
      }`
    );
  });

  const pruneInterval = setInterval(() => {
    // Clean up expired invites
    const now = Date.now();
    invites.forEach((inv, id) => {
      if (inv.expires && inv.expires < now) {
        invites.delete(id);
      }
    });

    // Remove empty rooms defensively (should be cleared on disconnect already)
    rooms.forEach((roomClients, roomId) => {
      if (!roomClients || roomClients.size === 0) {
        rooms.delete(roomId);
      }
    });
  }, 60_000);

  function getRoomClients(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.values()).map((client) => ({
      clientId: client.clientId,
      displayName: client.displayName,
      role: client.role,
    }));
  }

  function isValidRoomId(roomId) {
    return typeof roomId === "string" && ROOM_ID_REGEX.test(roomId);
  }

  function broadcastToRoom(roomId, message, excludeClientId = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    const msgStr = JSON.stringify(message);
    room.forEach((client, clientId) => {
      if (
        clientId !== excludeClientId &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        client.ws.send(msgStr);
      }
    });
  }

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

  function getRoomHost(roomId) {
    const room = rooms.get(roomId);
    if (!room) return null;

    for (const [, client] of room) {
      if (client.role === "host") {
        return client;
      }
    }
    return null;
  }

  function generateUniqueDisplayName(roomId, baseName) {
    const room = rooms.get(roomId);
    if (!room) return baseName;

    const existingNames = Array.from(room.values()).map((c) => c.displayName);

    if (!existingNames.includes(baseName)) {
      return baseName;
    }

    let counter = 2;
    while (existingNames.includes(`${baseName}-${counter}`)) {
      counter++;
    }
    return `${baseName}-${counter}`;
  }

  function scheduleInviteTimeout(inviteId) {
    setTimeout(() => {
      const invite = invites.get(inviteId);
      if (invite) {
        sendToClient(invite.roomId, invite.from, {
          type: "invite-expired",
          inviteId,
          to: invite.to,
        });

        sendToClient(invite.roomId, invite.to, {
          type: "invite-expired",
          inviteId,
          from: invite.from,
        });

        invites.delete(inviteId);
      }
    }, INVITE_TIMEOUT_MS);
  }

  function checkRateLimit(ws) {
    const now = Date.now();
    let bucket = rateLimits.get(ws);

    if (!bucket) {
      bucket = { count: 0, windowStart: now };
      rateLimits.set(ws, bucket);
    }

    if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
      bucket.windowStart = now;
      bucket.count = 0;
    }

    bucket.count += 1;
    if (bucket.count > RATE_LIMIT_MAX_MESSAGES) {
      return false;
    }
    return true;
  }

  wss.on("connection", (ws) => {
    console.log("🔌 New connection");

    ws.clientInfo = null;

    ws.on("message", (data) => {
      if (!checkRateLimit(ws)) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Rate limit exceeded. Please slow down.",
          })
        );
        return;
      }

      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      const {
        type,
        roomId,
        clientId,
        displayName,
        role,
        from,
        to,
        payload,
        accepted,
      } = message;

      if (type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      console.log(`📨 Received: ${type} from ${from || clientId || "unknown"}`);

      switch (type) {
        case "register": {
          if (!roomId || !clientId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "roomId and clientId required",
              })
            );
            return;
          }

          if (!isValidRoomId(roomId)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid roomId format",
              })
            );
            return;
          }

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
          }

          const room = rooms.get(roomId);

          const baseDisplayName =
            displayName || ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
          const uniqueDisplayName = generateUniqueDisplayName(
            roomId,
            baseDisplayName
          );

          let finalRole = role || "idle";

          if (finalRole === "host") {
            const existingHost = getRoomHost(roomId);
            if (existingHost && existingHost.clientId !== clientId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Room already has a host",
                })
              );
              return;
            }
          }

          const clientInfo = {
            ws,
            clientId,
            displayName: uniqueDisplayName,
            role: finalRole,
            roomId,
          };

          room.set(clientId, clientInfo);
          ws.clientInfo = clientInfo;

          console.log(
            `✅ ${uniqueDisplayName} (${clientId}) joined room ${roomId} as ${finalRole}`
          );

          ws.send(
            JSON.stringify({
              type: "registered",
              clientId,
              displayName: uniqueDisplayName,
              role: finalRole,
              roomId,
              clients: getRoomClients(roomId),
            })
          );

          broadcastToRoom(
            roomId,
            {
              type: "clients-updated",
              clients: getRoomClients(roomId),
            },
            clientId
          );

          break;
        }

        case "invite": {
          if (!roomId || !from || !to) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "roomId, from, and to required",
              })
            );
            return;
          }

          if (!isValidRoomId(roomId)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid roomId format",
              })
            );
            return;
          }

          const room = rooms.get(roomId);
          if (!room) {
            ws.send(
              JSON.stringify({ type: "error", message: "Room not found" })
            );
            return;
          }

          const sender = room.get(from);
          if (!sender || sender.role !== "host") {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Only host can send invites",
              })
            );
            return;
          }

          const target = room.get(to);
          if (!target) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Target client not found",
              })
            );
            return;
          }

          const newInviteId = uuidv4();
          const invite = {
            inviteId: newInviteId,
            from,
            to,
            roomId,
            payload: payload || {},
            expires: Date.now() + INVITE_TIMEOUT_MS,
            hostDisplayName: sender.displayName,
          };

          invites.set(newInviteId, invite);

          const sent = sendToClient(roomId, to, {
            type: "invite",
            inviteId: newInviteId,
            from,
            fromDisplayName: sender.displayName,
            payload: payload || { role: "speaker", note: "Become my speaker?" },
          });

          if (sent) {
            ws.send(
              JSON.stringify({
                type: "invite-sent",
                inviteId: newInviteId,
                to,
                toDisplayName: target.displayName,
              })
            );

            console.log(
              `📤 Invite sent from ${sender.displayName} to ${target.displayName}`
            );

            scheduleInviteTimeout(newInviteId);
          } else {
            invites.delete(newInviteId);
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Failed to send invite",
              })
            );
          }

          break;
        }

        case "invite-response": {
          if (!roomId || !from || !to || accepted === undefined) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "roomId, from, to, and accepted required",
              })
            );
            return;
          }

          if (!isValidRoomId(roomId)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid roomId format",
              })
            );
            return;
          }

          const room = rooms.get(roomId);
          if (!room) {
            ws.send(
              JSON.stringify({ type: "error", message: "Room not found" })
            );
            return;
          }

          for (const [id, inv] of invites) {
            if (inv.from === to && inv.to === from && inv.roomId === roomId) {
              invites.delete(id);
              break;
            }
          }

          const responder = room.get(from);

          if (accepted) {
            if (responder) {
              responder.role = "speaker";
              console.log(
                `✅ ${responder.displayName} accepted invite and is now a speaker`
              );
            }
          } else {
            console.log(`❌ ${responder?.displayName || from} declined invite`);
          }

          sendToClient(roomId, to, {
            type: "invite-response",
            from,
            fromDisplayName: responder?.displayName,
            accepted,
            inviteId: message.inviteId,
          });

          if (accepted) {
            broadcastToRoom(roomId, {
              type: "clients-updated",
              clients: getRoomClients(roomId),
            });
          }

          break;
        }

        case "invite-cancel": {
          const targetInviteId = message.inviteId;
          const invite = invites.get(targetInviteId);

          if (invite && invite.from === from) {
            invites.delete(targetInviteId);

            sendToClient(invite.roomId, invite.to, {
              type: "invite-cancelled",
              inviteId: targetInviteId,
            });

            console.log(`🚫 Invite ${targetInviteId} cancelled`);
          }

          break;
        }

        case "signal": {
          if (!roomId || !from || !to || !payload) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "roomId, from, to, and payload required",
              })
            );
            return;
          }

          if (!isValidRoomId(roomId)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid roomId format",
              })
            );
            return;
          }

          const sent = sendToClient(roomId, to, {
            type: "signal",
            from,
            payload,
          });

          if (!sent) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Target client not available",
              })
            );
          }

          break;
        }

        case "play-command": {
          if (!roomId || !from || !payload?.command) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "roomId, from, and payload.command required",
              })
            );
            return;
          }

          if (!isValidRoomId(roomId)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid roomId format",
              })
            );
            return;
          }

          broadcastToRoom(
            roomId,
            {
              type: "play-command",
              command: payload.command,
              timestamp: payload.timestamp || Date.now(),
            },
            from
          );

          break;
        }

        case "leave": {
          if (!roomId || !from) return;

          if (!isValidRoomId(roomId)) return;

          const room = rooms.get(roomId);
          if (!room) return;

          room.delete(from);
          invites.forEach((inv, id) => {
            if (inv.from === from || inv.to === from) {
              invites.delete(id);
            }
          });

          console.log(`👋 ${from} left room ${roomId}`);

          broadcastToRoom(roomId, {
            type: "clients-updated",
            clients: getRoomClients(roomId),
          });

          break;
        }
      }
    });

    ws.on("close", () => {
      const info = ws.clientInfo;
      if (!info) return;

      const { roomId, clientId } = info;
      console.log(`🔌 Client ${clientId} disconnected from room ${roomId}`);

      const room = rooms.get(roomId);
      if (room) {
        room.delete(clientId);
        if (room.size === 0) {
          rooms.delete(roomId);
        }
      }

      invites.forEach((inv, id) => {
        if (inv.from === clientId || inv.to === clientId) {
          invites.delete(id);
        }
      });

      broadcastToRoom(
        roomId,
        {
          type: "clients-updated",
          clients: getRoomClients(roomId),
        },
        clientId
      );
    });
  });

  const close = () =>
    new Promise((resolve) => {
      clearInterval(pruneInterval);
      // Terminate any active clients so the server can close promptly (used in tests)
      wss.clients.forEach((client) => {
        try {
          client.terminate();
        } catch (err) {
          // ignore
        }
      });

      wss.close(() => {
        server.close(() => resolve());
      });
    });

  return { wss, port: server.address().port, close };
}

if (require.main === module) {
  createSignalingServer({ port: process.env.PORT || 8080 });
}

module.exports = { createSignalingServer };
