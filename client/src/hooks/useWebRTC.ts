import { useRef, useCallback, useEffect, useState } from "react";

type TurnEnv = {
  VITE_TURN_URLS?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_PASSWORD?: string;
};

interface UseWebRTCOptions {
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (
    peerId: string,
    state: RTCPeerConnectionState
  ) => void;
}

const log = (...args: unknown[]) => console.log("[webrtc]", ...args);

const normalizeTurnUrl = (url: string) => {
  const trimmed = url.trim();
  if (trimmed.startsWith("turn:") || trimmed.startsWith("turns:"))
    return trimmed;
  return `turn:${trimmed}`;
};

const hasTurnPrefix = (url: string) =>
  url.startsWith("turn:") || url.startsWith("turns:");

export const hasTurnServers = (config: RTCConfiguration) => {
  const { iceServers } = config || {};
  if (!iceServers || iceServers.length === 0) return false;

  return iceServers.some((server) => {
    if (!server.urls) return false;
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(
      (url) => typeof url === "string" && hasTurnPrefix(url.trim())
    );
  });
};

const getEnv = (): TurnEnv => {
  const meta = (import.meta as any)?.env ?? {};
  return meta as TurnEnv;
};

export const buildIceServers = (env: TurnEnv = getEnv()): RTCConfiguration => {
  const stunDefaults: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const turnUrlsRaw = env.VITE_TURN_URLS;
  const turnUsername = env.VITE_TURN_USERNAME;
  const turnCredential = env.VITE_TURN_PASSWORD;

  const turnUrls = turnUrlsRaw
    ? turnUrlsRaw
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean)
        .map(normalizeTurnUrl)
    : [];

  const hasCreds = Boolean(turnUsername) && Boolean(turnCredential);

  const turnServers: RTCIceServer[] = turnUrls.map((url) =>
    hasCreds
      ? { urls: url, username: turnUsername, credential: turnCredential }
      : { urls: url }
  );

  return { iceServers: [...turnServers, ...stunDefaults] };
};

export const ICE_SERVERS = buildIceServers();

const applySenderParams = async (pc: RTCPeerConnection) => {
  const senders = pc.getSenders();
  await Promise.all(
    senders.map(async (sender) => {
      const params = sender.getParameters();
      params.degradationPreference = "maintain-framerate";

      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      params.encodings = params.encodings.map((enc) => ({
        ...enc,
        maxBitrate: 64_000,
        priority: "high",
        degradationPreference: "maintain-framerate",
      }));

      try {
        await sender.setParameters(params);
      } catch (err) {
        console.warn("Failed to apply sender params", err);
      }
    })
  );
};

export function useWebRTC({
  onRemoteStream,
  onConnectionStateChange,
}: UseWebRTCOptions) {
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [connectionStates, setConnectionStates] = useState<
    Map<string, RTCPeerConnectionState>
  >(new Map());

  // Create a new peer connection for a specific client
  const createPeerConnection = useCallback(
    (
      peerId: string,
      sendSignal: (
        payload: RTCSessionDescriptionInit | RTCIceCandidateInit
      ) => void
    ) => {
      if (peerConnectionsRef.current.has(peerId)) {
        log(`pc:${peerId} already exists`);
        return peerConnectionsRef.current.get(peerId)!;
      }

      log(`pc:${peerId} create`, {
        iceServers: ICE_SERVERS.iceServers?.length ?? 0,
      });
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnectionsRef.current.set(peerId, pc);

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          log(`pc:${peerId} ice-candidate`, {
            type: event.candidate.type,
            protocol: event.candidate.protocol,
            address: event.candidate.address,
            port: event.candidate.port,
            foundation: event.candidate.foundation,
          });
          sendSignal(event.candidate.toJSON());
        }
      };

      pc.onicegatheringstatechange = () => {
        log(`pc:${peerId} ice-gathering`, pc.iceGatheringState);
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        log(`pc:${peerId} state`, pc.connectionState);
        setConnectionStates((prev) =>
          new Map(prev).set(peerId, pc.connectionState)
        );
        onConnectionStateChange?.(peerId, pc.connectionState);
      };

      // Handle remote stream
      pc.ontrack = (event) => {
        log(`pc:${peerId} ontrack`, {
          trackId: event.track?.id,
          kind: event.track?.kind,
          streams: event.streams?.length ?? 0,
        });
        const stream =
          event.streams?.[0] ??
          (event.track ? new MediaStream([event.track]) : null);
        if (stream) {
          onRemoteStream?.(stream);
        }
      };

      return pc;
    },
    [onRemoteStream, onConnectionStateChange]
  );

  // Set local audio stream (for Host)
  const setLocalStream = useCallback((stream: MediaStream) => {
    const audioTracks = stream.getAudioTracks().length;
    const videoTracks = stream.getVideoTracks().length;
    log("setLocalStream", { audioTracks, videoTracks });
    localStreamRef.current = stream;
  }, []);

  // Create and send offer (Host initiates)
  const createOffer = useCallback(
    async (
      peerId: string,
      sendSignal: (
        payload: RTCSessionDescriptionInit | RTCIceCandidateInit
      ) => void
    ) => {
      const pc = createPeerConnection(peerId, sendSignal);

      // Add local tracks if available
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          if (localStreamRef.current) {
            pc.addTrack(track, localStreamRef.current);
          }
        });
        await applySenderParams(pc);
      }

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        log(`pc:${peerId} created offer`);
        sendSignal(offer);
      } catch (error) {
        console.error("[webrtc] Error creating offer", error);
      }
    },
    [createPeerConnection]
  );

  // Handle incoming signal (SDP offer/answer or ICE candidate)
  const handleSignal = useCallback(
    async (
      peerId: string,
      signal: RTCSessionDescriptionInit | RTCIceCandidateInit,
      sendSignal: (
        payload: RTCSessionDescriptionInit | RTCIceCandidateInit
      ) => void
    ) => {
      let pc = peerConnectionsRef.current.get(peerId);

      // Create connection if it doesn't exist
      if (!pc) {
        pc = createPeerConnection(peerId, sendSignal);
      }

      try {
        // Check if it's an SDP offer/answer
        if ("sdp" in signal && signal.type) {
          if (signal.type === "offer") {
            log(`pc:${peerId} received offer`);
            await pc.setRemoteDescription(new RTCSessionDescription(signal));

            // Create and send answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            log(`pc:${peerId} created answer`);
            sendSignal(answer);
          } else if (signal.type === "answer") {
            log(`pc:${peerId} received answer`);
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
          }
        }
        // Check if it's an ICE candidate
        else if ("candidate" in signal) {
          log(`pc:${peerId} received candidate`);
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        }
      } catch (error) {
        console.error("[webrtc] Error handling signal", error);
      }
    },
    [createPeerConnection]
  );

  // Close connection for a specific peer
  const closeConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      log(`pc:${peerId} close`);
      pc.close();
      peerConnectionsRef.current.delete(peerId);
      setConnectionStates((prev) => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    }
  }, []);

  // Force renegotiation by rebuilding the peer connection and sending a fresh offer
  const renegotiate = useCallback(
    async (
      peerId: string,
      sendSignal: (
        payload: RTCSessionDescriptionInit | RTCIceCandidateInit
      ) => void
    ) => {
      log(`pc:${peerId} renegotiate`);
      closeConnection(peerId);
      await createOffer(peerId, sendSignal);
    },
    [closeConnection, createOffer]
  );

  // Close all connections
  const closeAllConnections = useCallback(() => {
    log("close all peer connections");
    peerConnectionsRef.current.forEach((pc) => {
      pc.close();
    });
    peerConnectionsRef.current.clear();
    setConnectionStates(new Map());

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closeAllConnections();
    };
  }, [closeAllConnections]);

  return {
    connectionStates,
    setLocalStream,
    createOffer,
    handleSignal,
    closeConnection,
    closeAllConnections,
    renegotiate,
  };
}
