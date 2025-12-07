import { useRef, useCallback, useEffect, useState } from "react";

interface UseWebRTCOptions {
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (
    peerId: string,
    state: RTCPeerConnectionState
  ) => void;
}

const normalizeTurnUrl = (url: string) => {
  const trimmed = url.trim();
  if (trimmed.startsWith("turn:") || trimmed.startsWith("turns:"))
    return trimmed;
  return `turn:${trimmed}`;
};

const buildIceServers = (): RTCConfiguration => {
  const stunDefaults: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const turnUrlsRaw = import.meta.env.VITE_TURN_URLS as string | undefined;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_TURN_PASSWORD as
    | string
    | undefined;

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

const ICE_SERVERS = buildIceServers();

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
        console.log(`Peer connection for ${peerId} already exists`);
        return peerConnectionsRef.current.get(peerId)!;
      }

      console.log(`Creating peer connection for ${peerId}`);
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnectionsRef.current.set(peerId, pc);

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(
            `ICE candidate for ${peerId}:`,
            event.candidate.candidate.substring(0, 50)
          );
          sendSignal(event.candidate.toJSON());
        }
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log(`Connection state for ${peerId}: ${pc.connectionState}`);
        setConnectionStates((prev) =>
          new Map(prev).set(peerId, pc.connectionState)
        );
        onConnectionStateChange?.(peerId, pc.connectionState);
      };

      // Handle remote stream
      pc.ontrack = (event) => {
        console.log(`Received remote track from ${peerId}`);
        if (event.streams[0]) {
          onRemoteStream?.(event.streams[0]);
        }
      };

      return pc;
    },
    [onRemoteStream, onConnectionStateChange]
  );

  // Set local audio stream (for Host)
  const setLocalStream = useCallback((stream: MediaStream) => {
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
        console.log(`Created offer for ${peerId}`);
        sendSignal(offer);
      } catch (error) {
        console.error("Error creating offer:", error);
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
            console.log(`Received offer from ${peerId}`);
            await pc.setRemoteDescription(new RTCSessionDescription(signal));

            // Create and send answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log(`Created answer for ${peerId}`);
            sendSignal(answer);
          } else if (signal.type === "answer") {
            console.log(`Received answer from ${peerId}`);
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
          }
        }
        // Check if it's an ICE candidate
        else if ("candidate" in signal) {
          console.log(`Received ICE candidate from ${peerId}`);
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        }
      } catch (error) {
        console.error("Error handling signal:", error);
      }
    },
    [createPeerConnection]
  );

  // Close connection for a specific peer
  const closeConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
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
      closeConnection(peerId);
      await createOffer(peerId, sendSignal);
    },
    [closeConnection, createOffer]
  );

  // Close all connections
  const closeAllConnections = useCallback(() => {
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
