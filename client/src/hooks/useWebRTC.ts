import { useRef, useCallback, useEffect, useState } from "react";

interface UseWebRTCOptions {
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

const ENABLE_STATS_LOGS = import.meta.env.VITE_DEBUG_STATS === "true";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
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
  const statsHistoryRef = useRef<
    Map<
      string,
      {
        timestamp: number;
        bytesSent?: number;
        bytesReceived?: number;
        packetsLost?: number;
        packetsReceived?: number;
      }
    >
  >(new Map());

  const removeConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.oniceconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }

    setConnectionStates((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

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
        onConnectionStateChange?.(pc.connectionState);
      };

      // Clean up failed/closed connections proactively
      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        console.log(`ICE state for ${peerId}: ${iceState}`);
        if (iceState === "failed" || iceState === "closed") {
          removeConnection(peerId);
        }
      };

      // Handle remote stream
      pc.ontrack = (event) => {
        console.log(`Received remote track from ${peerId}`);

        // Nudge WebRTC toward low-latency playout when supported
        if ((event as any).receiver?.playoutDelayHint !== undefined) {
          (event as any).receiver.playoutDelayHint = 0.02; // target ~20ms playout buffer
        }

        if (event.streams[0]) {
          onRemoteStream?.(event.streams[0]);
        }
      };

      return pc;
    },
    [onRemoteStream, onConnectionStateChange, removeConnection]
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
          // Hint to browsers that this is speech to prefer lower latency
          track.contentHint = track.contentHint || "speech";
          if (localStreamRef.current) {
            pc.addTrack(track, localStreamRef.current);
          }
        });
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
  const closeConnection = useCallback(
    (peerId: string) => {
      removeConnection(peerId);
    },
    [removeConnection]
  );

  // Close all connections
  const closeAllConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((_, peerId) => {
      removeConnection(peerId);
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  }, [removeConnection]);

  // Lightweight stats logging for debugging
  useEffect(() => {
    if (!ENABLE_STATS_LOGS) return;

    const intervalId = window.setInterval(async () => {
      const entries = Array.from(peerConnectionsRef.current.entries());

      for (const [peerId, pc] of entries) {
        try {
          const report = await pc.getStats();

          let outboundAudio: any;
          let inboundAudio: any;
          let candidatePair: any;

          report.forEach((stat) => {
            if (
              stat.type === "outbound-rtp" &&
              (stat as any).mediaType === "audio"
            )
              outboundAudio = stat;
            if (
              stat.type === "inbound-rtp" &&
              (stat as any).mediaType === "audio"
            )
              inboundAudio = stat;
            if (stat.type === "candidate-pair" && (stat as any).nominated)
              candidatePair = stat;
          });

          const now = Date.now();
          const prev = statsHistoryRef.current.get(peerId);
          let bitrateKbps = 0;
          let lossPct = 0;
          const rttMs = candidatePair?.currentRoundTripTime
            ? Math.round(candidatePair.currentRoundTripTime * 1000)
            : 0;
          const direction = outboundAudio
            ? "send"
            : inboundAudio
            ? "recv"
            : "unknown";

          if (outboundAudio?.bytesSent != null && prev?.bytesSent != null) {
            const deltaBytes = outboundAudio.bytesSent - prev.bytesSent;
            const deltaMs = now - prev.timestamp;
            if (deltaMs > 0) bitrateKbps = (deltaBytes * 8) / deltaMs;
          } else if (
            inboundAudio?.bytesReceived != null &&
            prev?.bytesReceived != null
          ) {
            const deltaBytes = inboundAudio.bytesReceived - prev.bytesReceived;
            const deltaMs = now - prev.timestamp;
            if (deltaMs > 0) bitrateKbps = (deltaBytes * 8) / deltaMs;
          }

          if (
            inboundAudio?.packetsLost != null &&
            inboundAudio?.packetsReceived != null &&
            prev
          ) {
            const deltaLost =
              inboundAudio.packetsLost - (prev.packetsLost ?? 0);
            const deltaRecv =
              inboundAudio.packetsReceived - (prev.packetsReceived ?? 0);
            const total = deltaLost + deltaRecv;
            if (total > 0) {
              lossPct = (deltaLost / total) * 100;
            }
          }

          statsHistoryRef.current.set(peerId, {
            timestamp: now,
            bytesSent: outboundAudio?.bytesSent,
            bytesReceived: inboundAudio?.bytesReceived,
            packetsLost: inboundAudio?.packetsLost,
            packetsReceived: inboundAudio?.packetsReceived,
          });

          if (direction !== "unknown") {
            console.log(
              `[RTC stats][${peerId}] dir=${direction} bitrate=${bitrateKbps.toFixed(
                1
              )} kbps rtt=${rttMs} ms loss=${lossPct.toFixed(1)}%`
            );
          }
        } catch (error) {
          console.warn(`Stats poll failed for ${peerId}:`, error);
        }
      }
    }, 8000);

    return () => {
      clearInterval(intervalId);
    };
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
  };
}
