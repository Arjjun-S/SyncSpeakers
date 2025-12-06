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
  // Prefer explicit environment variable
  if (import.meta.env.VITE_WS_URL) {
    const url = import.meta.env.VITE_WS_URL;
    // Ensure it's a WebSocket URL
    if (url.startsWith('http://')) {
      return url.replace('http://', 'ws://');
    }
    if (url.startsWith('https://')) {
      return url.replace('https://', 'wss://');
    }
    return url;
  }
  
  // In production, try to derive from current location
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    // For Render: static site is syncspeakers.onrender.com, server is syncspeakers-server.onrender.com
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Assume server is at -server subdomain
    const hostname = window.location.hostname.replace('.onrender.com', '-server.onrender.com');
    return `${protocol}//${hostname}`;
  }
  
  return 'ws://localhost:8080';
};

// Connection settings
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 3000;  // Start with 3 seconds
const MAX_RECONNECT_DELAY = 10000;     // Cap at 10 seconds (user requested)
const HEARTBEAT_INTERVAL = 25000;      // Send ping every 25 seconds to keep connection alive
const CONNECTION_DEBOUNCE = 1000;      // Minimum time between connection attempts

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
  const heartbeatIntervalRef = useRef<number>();
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const lastConnectAttemptRef = useRef(0);
  
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [clients, setClients] = useState<Client[]>([]);
  const [myDisplayName, setMyDisplayName] = useState(displayName);
  const [myRole, setMyRole] = useState<'idle' | 'host' | 'speaker'>(role);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);

  // Start heartbeat to keep connection alive
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    
    heartbeatIntervalRef.current = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Send a ping message to keep connection alive
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
        console.log('💓 Heartbeat sent');
      }
    }, HEARTBEAT_INTERVAL);
  }, []);

  // Stop heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = undefined;
    }
  }, []);

  const connect = useCallback(() => {
    // Debounce rapid connection attempts
    const now = Date.now();
    if (now - lastConnectAttemptRef.current < CONNECTION_DEBOUNCE) {
      console.log('⏳ Connection attempt debounced');
      return;
    }
    lastConnectAttemptRef.current = now;
    
    // Prevent multiple simultaneous connection attempts
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING ||
        isConnectingRef.current) {
      console.log('⚠️ Already connected or connecting');
      return;
    }
    
    // Reset manual disconnect flag only if not already connecting
    manualDisconnectRef.current = false;
    
    // Check max reconnection attempts (but allow manual reconnect to bypass)
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('❌ Max reconnection attempts reached. Use manual reconnect.');
      setStatus('disconnected');
      return;
    }
    
    isConnectingRef.current = true;
    setStatus('connecting');
    
    const wsUrl = getWsUrl();
    console.log('🔌 Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('🔌 WebSocket connected');
      setStatus('connected');
      isConnectingRef.current = false;
      reconnectAttemptsRef.current = 0; // Reset on successful connection
      
      // Start heartbeat
      startHeartbeat();
      
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
        
        // Handle pong silently
        if (message.type === 'pong') {
          console.log('💓 Heartbeat received');
          return;
        }
        
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
      isConnectingRef.current = false;
      stopHeartbeat();
      
      // Don't auto-reconnect if manually disconnected
      if (manualDisconnectRef.current) {
        console.log('Manual disconnect - not reconnecting');
        return;
      }
      
      // Auto-reconnect with exponential backoff
      if (roomId && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(1.5, reconnectAttemptsRef.current),
          MAX_RECONNECT_DELAY
        );
        reconnectAttemptsRef.current++;
        console.log(`🔄 Reconnecting in ${Math.round(delay/1000)}s (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
        
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      console.error('WebSocket error');
      isConnectingRef.current = false;
      onError?.('Connection error');
    };
  }, [roomId, clientId, displayName, role, onInvite, onInviteResponse, onInviteExpired, onInviteCancelled, onSignal, onPlayCommand, onHostDisconnected, onError, startHeartbeat, stopHeartbeat]);

  // Manual reconnect - resets attempt counter
  const manualReconnect = useCallback(() => {
    console.log('🔄 Manual reconnect requested');
    
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Reset counters
    reconnectAttemptsRef.current = 0;
    isConnectingRef.current = false;
    manualDisconnectRef.current = false;
    
    // Connect after a brief delay
    setTimeout(() => {
      connect();
    }, 500);
  }, [connect]);

  useEffect(() => {
    if (roomId) {
      connect();
    }

    return () => {
      stopHeartbeat();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        manualDisconnectRef.current = true;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [roomId, connect, stopHeartbeat]);

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

  // Leave the room (manual disconnect)
  const leave = useCallback(() => {
    manualDisconnectRef.current = true;
    stopHeartbeat();
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    send({ type: 'leave', roomId, from: clientId });
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setClients([]);
    setStatus('disconnected');
    reconnectAttemptsRef.current = 0;
  }, [send, roomId, clientId, stopHeartbeat]);

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
    leave,
    manualReconnect // New: expose manual reconnect
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
