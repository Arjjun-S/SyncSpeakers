import { useEffect, useRef, useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { 
  Client, 
  ConnectionStatus, 
  ServerMessage, 
  InviteMessage,
  PendingInvite 
} from '../types';

// Get WebSocket URL from environment or default to localhost
const getWsUrl = () => {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  // In production, use the same host with wss
  if (window.location.protocol === 'https:') {
    return `wss://${window.location.host}`;
  }
  return 'ws://localhost:8080';
};

interface UseSignalingOptions {
  roomId: string;
  clientId: string;
  displayName: string;
  role: 'idle' | 'host';
  onInvite?: (invite: InviteMessage) => void;
  onInviteResponse?: (from: string, accepted: boolean) => void;
  onInviteExpired?: (inviteId: string) => void;
  onInviteCancelled?: () => void;
  onSignal?: (from: string, payload: RTCSessionDescriptionInit | RTCIceCandidateInit) => void;
  onPlayCommand?: (command: 'play' | 'pause' | 'stop', timestamp?: number) => void;
  onHostDisconnected?: () => void;
  onError?: (message: string) => void;
}

export function useSignaling({
  roomId,
  clientId,
  displayName,
  role,
  onInvite,
  onInviteResponse,
  onInviteExpired,
  onInviteCancelled,
  onSignal,
  onPlayCommand,
  onHostDisconnected,
  onError
}: UseSignalingOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [clients, setClients] = useState<Client[]>([]);
  const [myDisplayName, setMyDisplayName] = useState(displayName);
  const [myRole, setMyRole] = useState(role);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    setStatus('connecting');
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('🔌 WebSocket connected');
      setStatus('connected');
      
      // Register with the server
      ws.send(JSON.stringify({
        type: 'register',
        roomId,
        clientId,
        displayName,
        role
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data);
        console.log('📨 Received:', message.type, message);

        switch (message.type) {
          case 'registered':
            setClients(message.clients);
            setMyDisplayName(message.displayName);
            setMyRole(message.role as 'idle' | 'host' | 'speaker');
            break;
          
          case 'clients-updated':
            setClients(message.clients);
            break;
          
          case 'invite':
            onInvite?.(message);
            break;
          
          case 'invite-sent':
            setPendingInvites(prev => [...prev, {
              inviteId: message.inviteId,
              toClientId: message.to,
              toDisplayName: message.toDisplayName,
              sentAt: Date.now()
            }]);
            break;
          
          case 'invite-response':
            setPendingInvites(prev => 
              prev.filter(inv => inv.toClientId !== message.from)
            );
            onInviteResponse?.(message.from, message.accepted);
            break;
          
          case 'invite-expired':
            if (message.to) {
              setPendingInvites(prev => 
                prev.filter(inv => inv.inviteId !== message.inviteId)
              );
            }
            onInviteExpired?.(message.inviteId);
            break;
          
          case 'invite-cancelled':
            onInviteCancelled?.();
            break;
          
          case 'signal':
            onSignal?.(message.from, message.payload);
            break;
          
          case 'play-command':
            onPlayCommand?.(message.command, message.timestamp);
            break;
          
          case 'host-disconnected':
            onHostDisconnected?.();
            break;
          
          case 'error':
            console.error('Server error:', message.message);
            onError?.(message.message);
            break;
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      console.log('🔌 WebSocket disconnected');
      setStatus('disconnected');
      wsRef.current = null;
      
      // Attempt to reconnect after 3 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (roomId) {
          console.log('🔄 Attempting to reconnect...');
          connect();
        }
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      onError?.('Connection error');
    };
  }, [roomId, clientId, displayName, role, onInvite, onInviteResponse, onInviteExpired, onInviteCancelled, onSignal, onPlayCommand, onHostDisconnected, onError]);

  useEffect(() => {
    if (roomId) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [roomId, connect]);

  // Send a message
  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  // Invite a client to become a speaker
  const invite = useCallback((targetClientId: string) => {
    send({
      type: 'invite',
      roomId,
      from: clientId,
      to: targetClientId,
      payload: { role: 'speaker', note: 'Become my speaker?' }
    });
  }, [send, roomId, clientId]);

  // Respond to an invite
  const respondToInvite = useCallback((hostId: string, accepted: boolean) => {
    send({
      type: 'invite-response',
      roomId,
      from: clientId,
      to: hostId,
      accepted
    });
    
    if (accepted) {
      setMyRole('speaker');
    }
  }, [send, roomId, clientId]);

  // Cancel a pending invite
  const cancelInvite = useCallback((inviteId: string) => {
    send({
      type: 'invite-cancel',
      inviteId,
      from: clientId
    });
    setPendingInvites(prev => prev.filter(inv => inv.inviteId !== inviteId));
  }, [send, clientId]);

  // Send WebRTC signal
  const sendSignal = useCallback((targetClientId: string, payload: RTCSessionDescriptionInit | RTCIceCandidateInit) => {
    send({
      type: 'signal',
      roomId,
      from: clientId,
      to: targetClientId,
      payload
    });
  }, [send, roomId, clientId]);

  // Send play command to all speakers
  const sendPlayCommand = useCallback((command: 'play' | 'pause' | 'stop') => {
    send({
      type: 'play-command',
      roomId,
      from: clientId,
      payload: { command, timestamp: Date.now() }
    });
  }, [send, roomId, clientId]);

  // Leave the room
  const leave = useCallback(() => {
    send({ type: 'leave', roomId, from: clientId });
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setClients([]);
    setStatus('disconnected');
  }, [send, roomId, clientId]);

  return {
    status,
    clients,
    myDisplayName,
    myRole,
    pendingInvites,
    invite,
    respondToInvite,
    cancelInvite,
    sendSignal,
    sendPlayCommand,
    leave
  };
}

// Helper to generate a room code
export function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Helper to get or create client ID
export function getOrCreateClientId(): string {
  const stored = localStorage.getItem('syncSpeakers_clientId');
  if (stored) return stored;
  
  const newId = uuidv4();
  localStorage.setItem('syncSpeakers_clientId', newId);
  return newId;
}

// Helper to get stored display name
export function getStoredDisplayName(): string | null {
  return localStorage.getItem('syncSpeakers_displayName');
}

// Helper to store display name
export function storeDisplayName(name: string): void {
  localStorage.setItem('syncSpeakers_displayName', name);
}
