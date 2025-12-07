import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { buildIceServers, hasTurnServers, useWebRTC } from "./useWebRTC";

describe("buildIceServers", () => {
  it("returns only STUN servers when TURN env is absent", () => {
    const config = buildIceServers({});
    expect(hasTurnServers(config)).toBe(false);

    const turnUrls = (config.iceServers || [])
      .flatMap((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.filter((u): u is string => typeof u === "string");
      })
      .filter((url) => url.startsWith("turn:") || url.startsWith("turns:"));

    expect(turnUrls.length).toBe(0);
  });

  it("normalizes TURN URLs and preserves credentials", () => {
    const config = buildIceServers({
      VITE_TURN_URLS: "turn.example.com, turns:secure.example.com",
      VITE_TURN_USERNAME: "alice",
      VITE_TURN_PASSWORD: "secret",
    });

    expect(hasTurnServers(config)).toBe(true);

    const turnServers = (config.iceServers || []).filter((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some(
        (url) =>
          typeof url === "string" &&
          (url.startsWith("turn:") || url.startsWith("turns:"))
      );
    });

    expect(turnServers.length).toBeGreaterThan(0);
    expect(turnServers[0]?.username).toBe("alice");
    expect(turnServers[0]?.credential).toBe("secret");

    const urls = turnServers.flatMap((server) => {
      const value = server.urls;
      return Array.isArray(value) ? value : [value];
    });

    expect(urls).toContain("turn:turn.example.com");
    expect(urls).toContain("turns:secure.example.com");
  });
});

describe("useWebRTC ontrack handling", () => {
  const OriginalRTCPeerConnection = global.RTCPeerConnection;
  const OriginalMediaStream = global.MediaStream;
  const OriginalRTCSessionDescription = global.RTCSessionDescription;
  const OriginalRTCIceCandidate = global.RTCIceCandidate;

  class FakeMediaStream {
    private tracks: MediaStreamTrack[];
    constructor(tracks: MediaStreamTrack[] = []) {
      this.tracks = tracks;
    }
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks.filter((t) => t.kind === "audio");
    }
  }

  class FakeRTCPeerConnection {
    static lastInstance: FakeRTCPeerConnection | null = null;
    onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    ontrack: ((ev: RTCTrackEvent) => void) | null = null;

    constructor() {
      FakeRTCPeerConnection.lastInstance = this;
    }

    getSenders() {
      return [];
    }

    addTrack() {
      return {} as RTCRtpSender;
    }

    async createOffer() {
      return { type: "offer", sdp: "fake-offer" } as RTCSessionDescriptionInit;
    }

    async setLocalDescription() {
      return;
    }

    async createAnswer() {
      return {
        type: "answer",
        sdp: "fake-answer",
      } as RTCSessionDescriptionInit;
    }

    async setRemoteDescription() {
      return;
    }

    async addIceCandidate() {
      return;
    }

    close() {
      return;
    }

    emitTrack(track: MediaStreamTrack, streams: MediaStream[] = []) {
      this.ontrack?.({ track, streams } as unknown as RTCTrackEvent);
    }
  }

  beforeEach(() => {
    (global as any).MediaStream = FakeMediaStream;
    (global as any).RTCPeerConnection = FakeRTCPeerConnection;
    (global as any).RTCSessionDescription = function (
      init: RTCSessionDescriptionInit
    ) {
      return { ...init } as any;
    };
    (global as any).RTCIceCandidate = function (init: RTCIceCandidateInit) {
      return { ...init } as any;
    };
  });

  afterEach(() => {
    (global as any).MediaStream = OriginalMediaStream;
    (global as any).RTCPeerConnection = OriginalRTCPeerConnection;
    (global as any).RTCSessionDescription = OriginalRTCSessionDescription;
    (global as any).RTCIceCandidate = OriginalRTCIceCandidate;
    FakeRTCPeerConnection.lastInstance = null;
  });

  it("emits a stream when ontrack provides only a track", async () => {
    const onRemoteStream = vi.fn();
    const { result } = renderHook(() =>
      useWebRTC({
        onRemoteStream,
      })
    );

    const sendSignal = vi.fn();

    await act(async () => {
      await result.current.createOffer("peer-a", sendSignal);
    });

    const pc = FakeRTCPeerConnection.lastInstance;
    expect(pc).toBeTruthy();

    const audioTrack = { kind: "audio", id: "t1" } as MediaStreamTrack;
    pc?.emitTrack(audioTrack, []); // No streams array provided from the event

    expect(onRemoteStream).toHaveBeenCalledTimes(1);
    const receivedStream = onRemoteStream.mock.calls[0][0] as any;
    expect(receivedStream.getTracks?.()).toContain(audioTrack);
  });
});
