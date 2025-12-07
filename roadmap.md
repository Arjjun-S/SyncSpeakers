# SyncSpeakers Improvement Roadmap

A simple, reliable checklist for reducing lag, staying alive during sleep, and working across different networks. Mark steps with [x] as you finish them.

## Connectivity & Signaling

- [x] Step 1: Harden signaling
  - [x] Normalize WS URL config (`VITE_WS_URL`, `WS_PORT`); enforce `wss://` in production.
  - [x] Add reconnect backoff with jitter and a user-facing "Reconnect" button.
  - [x] Add ping/pong latency measurement and surface in status badge.
- [x] Step 2: Cross-network support
  - [x] Stand up TURN (coturn) with UDP/TCP/TLS on 3478/5349.
  - [x] Pipe TURN creds via env vars into client ICE config.
  - [x] Verify LTE ↔ Wi‑Fi join works.

## Audio Quality & Lag

- [x] Step 3: Host capture tuning
  - [x] Use Opus constraints: `sampleRate 48000`, `channelCount 1`, `echoCancellation true`, `noiseSuppression true`, `autoGainControl false`.
  - [x] Set sender `maxBitrate ~64kbps`, `priority high`, `degradationPreference maintain-framerate`.
- [x] Step 4: Speaker playback smoothing
  - [x] Play remote audio through Web Audio with a small jitter buffer (80–150 ms).
  - [x] Add fast catch-up when buffer grows; expose a safe default.
  - [x] Add drift correction using host timestamp in play commands.

## Resilience & Sleep

- [ ] Step 5: Stay alive on sleep
  - [ ] Request Wake Lock when hosting/playing; re-request on `visibilitychange`.
  - [ ] Fallback keep-alive tick (silent oscillator) if Wake Lock unavailable.
  - [ ] Persist session (roomId/clientId/role) and auto-rejoin on resume.
- [ ] Step 6: Reconnect & renegotiate
  - [ ] On WS reconnect, resync role/pending invites and renegotiate WebRTC if ICE/DTLS failed.
  - [ ] Add manual "Refresh audio link" button to rebuild the peer connection without leaving the room.

## UX & Structure

- [ ] Step 7: Network-quality UX
  - [ ] Status badges: `connected / unstable / reconnecting`, show RTT and last packet age.
  - [ ] Toast on invite expiry/cancel; auto-clear stale modals.
  - [ ] Preflight: mic permission, HTTPS+autoplay readiness, TURN reachability test.
- [ ] Step 8: Code structure
  - [ ] Split `App.tsx` into `WelcomeScreen`, `HostScreen`, `IdleScreen`, `SpeakerScreen`.
  - [ ] Organize folders: `components/`, `hooks/` (`useSignaling`, `useWebRTC`, `useWakeLock`, `useLatency`), `services/` (`signalingClient`, `turnConfig`, `timeSync`), `types/`, `utils/`.

## Server Hardening

- [ ] Step 9: Signaling server safeguards
  - [ ] Rate limit messages per client; validate roomId format; guard duplicate hosts.
  - [ ] Add health endpoint and room cleanup timers.
  - [ ] (Optional) Redis presence if scaling horizontally.

## PWA & Testing

- [ ] Step 10: PWA basics (optional)
  - [ ] Add manifest + service worker for shell caching (exclude WS/TURN).
  - [ ] Provide install prompt and icon assets.
- [ ] Step 11: Testing & metrics
  - [ ] Integration tests for invite flow, expiry, cancel, reconnect.
  - [ ] Log join time, offer/answer round-trip, audio start time.
  - [ ] Manual matrix: same Wi‑Fi, different Wi‑Fi, LTE↔Wi‑Fi, screen-off, background tab.
