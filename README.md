<<<<<<< HEAD
# SyncSpeakers
=======
# SyncSpeakers

🔊 **Synchronized audio playback across multiple devices** — A WebRTC-based PWA that lets you stream audio from a host device to multiple speaker devices.

## Features

- **Animal Device Names**: Each device gets a friendly animal name (Pig, Dog, Cat, etc.)
- **Room-based Sessions**: Create or join rooms with simple 6-character codes
- **Invite/Accept Flow**: Host can invite specific devices; speakers must accept to join
- **Real-time Audio Streaming**: WebRTC-based low-latency audio from host to speakers
- **QR Code Sharing**: Easy room sharing via QR codes
- **PWA Support**: Install as a native app on mobile devices

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SyncSpeakers System                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐     WebSocket      ┌──────────────────────┐   │
│  │   Host   │◄──────────────────►│   Render Server      │   │
│  │  (Pig)   │    Signaling       │   (Node.js + WS)     │   │
│  └────┬─────┘                    └──────────┬───────────┘   │
│       │                                     │               │
│       │ WebRTC (Audio)                      │ WebSocket     │
│       │                                     │               │
│       ▼                                     ▼               │
│  ┌──────────┐                         ┌──────────┐         │
│  │ Speaker  │◄────────────────────────│ Speaker  │         │
│  │  (Dog)   │                         │  (Cat)   │         │
│  └──────────┘                         └──────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Message Flow

### 1. Registration
```json
{ "type": "register", "roomId": "ABC123", "clientId": "uuid", "displayName": "dog", "role": "idle" }
```

### 2. Host Invites Speaker
```json
{ "type": "invite", "roomId": "ABC123", "from": "host-id", "to": "speaker-id", "payload": { "role": "speaker" } }
```

### 3. Speaker Accepts
```json
{ "type": "invite-response", "roomId": "ABC123", "from": "speaker-id", "to": "host-id", "accepted": true }
```

### 4. WebRTC Signaling
```json
{ "type": "signal", "roomId": "ABC123", "from": "host-id", "to": "speaker-id", "payload": { "sdp": "..." } }
```

## Local Development
# SyncSpeakers

🔊 **Synchronized audio playback across multiple devices** — A WebRTC-based PWA that lets you stream audio from a host device to multiple speaker devices.

## Features

- **Animal Device Names**: Each device gets a friendly animal name (Pig, Dog, Cat, etc.)
- **Room-based Sessions**: Create or join rooms with simple 6-character codes
- **Invite/Accept Flow**: Host can invite specific devices; speakers must accept to join
- **Real-time Audio Streaming**: WebRTC-based low-latency audio from host to speakers
- **QR Code Sharing**: Easy room sharing via QR codes
- **PWA Support**: Install as a native app on mobile devices

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SyncSpeakers System                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐     WebSocket      ┌──────────────────────┐   │
│  │   Host   │◄──────────────────►│   Render Server      │   │
│  │  (Pig)   │    Signaling       │   (Node.js + WS)     │   │
│  └────┬─────┘                    └──────────┬───────────┘   │
│       │                                     │               │
│       │ WebRTC (Audio)                      │ WebSocket     │
│       │                                     │               │
│       ▼                                     ▼               │
│  ┌──────────┐                         ┌──────────┐         │
│  │ Speaker  │◄────────────────────────│ Speaker  │         │
│  │  (Dog)   │                         │  (Cat)   │         │
│  └──────────┘                         └──────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Message Flow

### 1. Registration
```json
{ "type": "register", "roomId": "ABC123", "clientId": "uuid", "displayName": "dog", "role": "idle" }
```

### 2. Host Invites Speaker
```json
{ "type": "invite", "roomId": "ABC123", "from": "host-id", "to": "speaker-id", "payload": { "role": "speaker" } }
```

### 3. Speaker Accepts
```json
{ "type": "invite-response", "roomId": "ABC123", "from": "speaker-id", "to": "host-id", "accepted": true }
```

### 4. WebRTC Signaling
```json
{ "type": "signal", "roomId": "ABC123", "from": "host-id", "to": "speaker-id", "payload": { "sdp": "..." } }
```

## Local Development

### Start the Server
```bash
cd server
npm install
npm start
# Server runs on ws://localhost:8080
```

### Start the Client
```bash
cd client
npm install
npm run dev
# Client runs on http://localhost:3000
```

## Deploy to Render

1. Push this repo to GitHub
2. Create a new Blueprint on Render
3. Connect your GitHub repo
4. Render will auto-deploy both services using `render.yaml`

Or deploy manually:

### Server
1. Create a new Web Service on Render
2. Connect your repo, set root directory to `server`
3. Build command: `npm install`
4. Start command: `npm start`

### Client
1. Create a new Static Site on Render
2. Connect your repo, set root directory to `client`
3. Build command: `npm install && npm run build`
4. Publish directory: `dist`
5. Add env var: `VITE_WS_URL=wss://your-server.onrender.com`

## User Flow

### Host (Creating a Room)
1. Open the app
2. Select an animal name (e.g., Pig)
3. Click "Create Room (Host)"
4. Share the room code or QR with other devices
5. Select an audio file to play
6. Invite connected devices to become speakers
7. Control playback for all speakers

### Speaker (Joining a Room)
1. Open the app (or scan QR code)
2. Select an animal name (e.g., Dog)
3. Enter the room code and join
4. Wait for host to send an invite
5. Accept the invite to become a speaker
6. Audio will start playing automatically

## Testing Checklist

- [ ] Device registers with animal name and appears in host's device list
- [ ] Host can invite idle devices
- [ ] Invited device sees modal with Accept/Decline
- [ ] On accept, device role updates to "speaker"
- [ ] WebRTC connection establishes between host and speaker
- [ ] Audio plays on speaker device
- [ ] Invite timeout works (20 seconds)
- [ ] Decline flow notifies host
- [ ] Multiple speakers can be invited simultaneously
- [ ] Host disconnect notifies all speakers
- [ ] Speaker disconnect updates host's device list

## Security Notes

- Uses secure WebSocket (wss://) in production
- Room codes are short-lived
- Only hosts can send invites (server-validated)
- Display names are sanitized
- No personal data stored

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: CSS (custom, no framework)
- **PWA**: vite-plugin-pwa
- **Backend**: Node.js + ws (WebSocket)
- **Real-time Audio**: WebRTC
- **Hosting**: Render (free tier compatible)

## License

MIT
