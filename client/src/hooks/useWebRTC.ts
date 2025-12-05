import { useRef, useCallback, useEffect, useState } from 'react';

interface UseWebRTCOptions {
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

export function useWebRTC({ onRemoteStream, onConnectionStateChange }: UseWebRTCOptions) {
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [connectionStates, setConnectionStates] = useState<Map<string, RTCPeerConnectionState>>(new Map());

  // Create a new peer connection for a specific client
  const createPeerConnection = useCallback((peerId: string, sendSignal: (payload: RTCSessionDescriptionInit | RTCIceCandidateInit) => void) => {
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
        console.log(`ICE candidate for ${peerId}:`, event.candidate.candidate.substring(0, 50));
        sendSignal(event.candidate.toJSON());
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${peerId}: ${pc.connectionState}`);
      setConnectionStates(prev => new Map(prev).set(peerId, pc.connectionState));
      onConnectionStateChange?.(pc.connectionState);
    };

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log(`Received remote track from ${peerId}`);
      if (event.streams[0]) {
        onRemoteStream?.(event.streams[0]);
      }
    };

    return pc;
  }, [onRemoteStream, onConnectionStateChange]);

  // Set local audio stream (for Host)
  const setLocalStream = useCallback((stream: MediaStream) => {
    localStreamRef.current = stream;
  }, []);

  // Create and send offer (Host initiates)
  const createOffer = useCallback(async (peerId: string, sendSignal: (payload: RTCSessionDescriptionInit | RTCIceCandidateInit) => void) => {
    const pc = createPeerConnection(peerId, sendSignal);
    
    // Add local tracks if available
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
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
      console.error('Error creating offer:', error);
    }
  }, [createPeerConnection]);

  // Handle incoming signal (SDP offer/answer or ICE candidate)
  const handleSignal = useCallback(async (
    peerId: string, 
    signal: RTCSessionDescriptionInit | RTCIceCandidateInit,
    sendSignal: (payload: RTCSessionDescriptionInit | RTCIceCandidateInit) => void
  ) => {
    let pc = peerConnectionsRef.current.get(peerId);
    
    // Create connection if it doesn't exist
    if (!pc) {
      pc = createPeerConnection(peerId, sendSignal);
    }

    try {
      // Check if it's an SDP offer/answer
      if ('sdp' in signal && signal.type) {
        if (signal.type === 'offer') {
          console.log(`Received offer from ${peerId}`);
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          
          // Create and send answer
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log(`Created answer for ${peerId}`);
          sendSignal(answer);
        } else if (signal.type === 'answer') {
          console.log(`Received answer from ${peerId}`);
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
        }
      } 
      // Check if it's an ICE candidate
      else if ('candidate' in signal) {
        console.log(`Received ICE candidate from ${peerId}`);
        await pc.addIceCandidate(new RTCIceCandidate(signal));
      }
    } catch (error) {
      console.error('Error handling signal:', error);
    }
  }, [createPeerConnection]);

  // Close connection for a specific peer
  const closeConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerId);
      setConnectionStates(prev => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    }
  }, []);

  // Close all connections
  const closeAllConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((pc, peerId) => {
      pc.close();
    });
    peerConnectionsRef.current.clear();
    setConnectionStates(new Map());
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
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
    closeAllConnections
  };
}
