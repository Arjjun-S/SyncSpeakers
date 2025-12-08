# SyncSpeakers

SyncSpeakers is a lightweight WebRTC experience that lets a host capture audio on one device and play it in sync across invited speaker devices. The project pairs a React + Vite progressive web app (PWA) with a Node.js WebSocket signaling server that handles rooms, invitations, and media negotiation.

## Features

- Room-based sessions so hosts can spin up six-character room codes instantly.
- Friendly animal identities for every device to keep the room list readable.
- Host-controlled speaker flow with invite, cancel, expire, and cleanup behavior when roles change.
- WebRTC peer connections that stream the host's captured audio to all accepted speakers.
- Auto-healing WebSocket signaling with heartbeats, exponential backoff reconnect logic, and manual reconnect controls in the UI.
- Render blueprint (`render.yaml`) that provisions both the signaling server and static client in one deploy.

## Repository Structure

```
SyncSpeakers/
|-- client/            # React + TypeScript PWA (Vite)
|   |-- src/components # UI building blocks (DeviceList, SpeakerView, etc.)
|   |-- src/hooks      # WebSocket signaling + WebRTC helpers
|   |-- public/        # Static assets and manifest
|-- server/            # Node WebSocket signaling bridge
|   |-- index.js       # Room management, invites, signaling relay
|-- render.yaml        # Render.com blueprint for server + client
```

## Prerequisites

- Node.js 18+
- npm 9+
- A modern browser with WebRTC and `getUserMedia` support (for testing the client)

## Quick Start

1. Clone and install dependencies.
   ```bash
   git clone https://github.com/Arjjun-S/SyncSpeakers.git
   cd SyncSpeakers
   npm install --prefix server
   npm install --prefix client
   ```
2. Start the signaling server.
   ```bash
   cd server
   npm start
   ```
   The server listens on `ws://localhost:8080` by default.
3. Start the Vite client.
   ```bash
   cd client
   npm run dev
   ```
   When running locally, Vite serves the app at `http://localhost:5173`. Set `VITE_WS_URL=ws://localhost:8080` in `.env` (or export it in your shell) so the client points to the local server.

## Environment

| Variable      | Location | Description                                                                                                                                                            |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_WS_URL` | client   | WebSocket endpoint used by the PWA. Required in production. Defaults to `ws://localhost:8080` for local development and falls back to the Render URL in hosted builds. |

## Available Scripts

### Client (`client/package.json`)

- `npm run dev` - Start the Vite dev server with hot reloading.
- `npm run build` - Type-check with `tsc` and produce an optimized production build.
- `npm run preview` - Preview the production build locally.

### Server (`server/package.json`)

- `npm start` - Launch the signaling server (production and local use).
- `npm run dev` - Alias for `npm start`.

## Deployment

Render users can deploy both services automatically:

1. Push the repository to GitHub.
2. In Render, select **New > Blueprint**, point it at this repo, and pick the `render.yaml` file.
3. Render provisions two services:
   - `syncspeakers-server` - Node service that runs `npm install && npm start` inside `/server`.
   - `syncspeakers-client` - Static site that runs `npm install && npm run build` inside `/client` and publishes `dist/`.
4. Update `VITE_WS_URL` in the Render dashboard if your signaling endpoint changes.

## How It Works

1. **Device identity** - every browser stores a UUID plus an animal display name in `localStorage` for easy recognition.
2. **Hosting a room** - the host generates a six-character code, registers as `host`, and captures audio with `getUserMedia`.
3. **Inviting devices** - hosts see all connected clients, send invites, and the server enforces a 20-second expiration with cancel handling.
4. **WebRTC negotiation** - accepted speakers trigger SDP offers, the WebSocket server relays signaling messages, and peers exchange ICE candidates via Google STUN servers.
5. **Playback** - speaker devices auto-play the remote stream, expose manual play and volume controls, and surface connection status via `StatusBadge`.
6. **Failure handling** - heartbeats, reconnect UI, and host-disconnect broadcasts keep state consistent even when network links drop.

## Troubleshooting

- **Autoplay blocked** - some browsers need a user gesture; tap "Start Playback" in the speaker view to resume audio.
- **No audio devices** - ensure the host granted microphone permissions; use the browser's site settings to reset permissions if needed.
- **WebSocket disconnects** - click the reconnect button in the UI or verify `VITE_WS_URL` points to a reachable TLS (`wss://`) endpoint in production.

## License

This project is distributed under the [CC BY-NC 4.0](LICENSE).
