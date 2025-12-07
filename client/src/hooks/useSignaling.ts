import { useEffect, useRef, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  Client,
  ConnectionStatus,
  ServerMessage,
  InviteMessage,
  PendingInvite,
} from "../types";

// Get WebSocket URL - enforce secure protocol in production
const getWsUrl = () => {
  const envUrlRaw = import.meta.env.VITE_WS_URL as string | undefined;
  const envPort = (import.meta.env as Record<string, string | undefined>)
    .VITE_WS_PORT;
  const isBrowser = typeof window !== "undefined";
  const isHttps = isBrowser ? window.location.protocol === "https:" : false;

  const normalizeProtocol = (url: string) => {
    if (url.startsWith("http://")) return url.replace("http://", "ws://");
    if (url.startsWith("https://")) return url.replace("https://", "wss://");
    if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
    return `${isHttps ? "wss://" : "ws://"}${url}`;
  };

  if (envUrlRaw) {
    const normalized = normalizeProtocol(envUrlRaw.trim());
    console.log("Using env WS URL:", normalized);
    return normalized;
  }

  if (isBrowser && window.location.hostname.includes("onrender.com")) {
    const wsUrl = "wss://syncspeakers.onrender.com";
    console.log("Using hardcoded Render WS URL:", wsUrl);
    return wsUrl;
  }

  const host = isBrowser ? window.location.hostname : "localhost";
  const port = envPort || "8080";
  const url = `${isHttps ? "wss" : "ws"}://${host}${port ? `:${port}` : ""}`;
  console.log("Using fallback WS URL:", url);
  return url;
};

// Helpers
export const generateRoomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const getOrCreateClientId = () => {
  const key = "syncspeakers_client_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(key, id);
  }
  return id;
};

export const getStoredDisplayName = () =>
  localStorage.getItem("syncspeakers_display_name");
export const storeDisplayName = (name: string) =>
  localStorage.setItem("syncspeakers_display_name", name);

interface UseSignalingOptions {
  roomId: string;
  clientId: string;
  displayName: string;
  role: "idle" | "host";
  onInvite?: (invite: InviteMessage) => void;
  onInviteResponse?: (from: string, accepted: boolean) => void;
  onInviteExpired?: (inviteId: string) => void;
  onInviteCancelled?: () => void;
  onSignal?: (
    from: string,
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit
  ) => void;
  onPlayCommand?: (
    command: "play" | "pause" | "stop",
    timestamp?: number
  ) => void;
  onHostDisconnected?: () => void;
  onError?: (message: string) => void;
}

export function useSignaling(options: UseSignalingOptions) {
  const { roomId, clientId, displayName, role } = options;

  // Refs for stable access
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const lastPingRef = useRef<number | null>(null);
  const lastMessageAtRef = useRef<number | null>(null);
  const isIntentionalCloseRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const mountedRef = useRef(true);

  // Store callbacks in refs to avoid dependency issues
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [myDisplayName, setMyDisplayName] = useState(displayName);
  const [myRole, setMyRole] = useState<"idle" | "host" | "speaker">(role);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);

  // Cleanup helper
  const cleanup = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    lastPingRef.current = null;
  }, []);

  // Core connect function - stable, no deps that change
  const connect = useCallback(() => {
    // Don't connect if unmounted
    if (!mountedRef.current) return;

    // Already connected or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("✓ Already connected");
      return;
    }
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log("⏳ Connection in progress...");
      return;
    }

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    cleanup();

    const wsUrl = getWsUrl();
    console.log("🔌 Connecting to:", wsUrl);
    setStatus("connecting");

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;

        console.log("✅ WebSocket connected");
        setStatus("connected");
        reconnectCountRef.current = 0;
        lastPingRef.current = null;

        // Start heartbeat with RTT measurement
        const sendPing = () => {
          if (ws.readyState === WebSocket.OPEN) {
            lastPingRef.current = Date.now();
            ws.send(JSON.stringify({ type: "ping", ts: lastPingRef.current }));
          }
        };
        sendPing();
        heartbeatRef.current = window.setInterval(sendPing, 15000);

        // Register with server
        const opts = callbacksRef.current;
        ws.send(
          JSON.stringify({
            type: "register",
            roomId: opts.roomId,
            clientId: opts.clientId,
            displayName: opts.displayName,
            role: opts.role,
          })
        );
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const message: ServerMessage = JSON.parse(event.data);
          const opts = callbacksRef.current;
          const now = Date.now();
          lastMessageAtRef.current = now;
          setLastMessageAt(now);

          if (message.type === "pong") {
            if (lastPingRef.current) {
              const rtt = Date.now() - lastPingRef.current;
              setLatencyMs((prev) =>
                prev ? Math.round(prev * 0.7 + rtt * 0.3) : rtt
              );
            }
            return; // Heartbeat response
          }

          switch (message.type) {
            case "registered":
              setClients(message.clients);
              setMyDisplayName(message.displayName);
              setMyRole(message.role as "idle" | "host" | "speaker");
              break;

            case "clients-updated":
              setClients(message.clients);
              break;

            case "invite":
              opts.onInvite?.(message);
              break;

            case "invite-sent":
              setPendingInvites((prev) => [
                ...prev,
                {
                  inviteId: message.inviteId,
                  toClientId: message.to,
                  toDisplayName: message.toDisplayName,
                  sentAt: Date.now(),
                },
              ]);
              break;

            case "invite-response":
              setPendingInvites((prev) =>
                prev.filter((inv) => inv.toClientId !== message.from)
              );
              opts.onInviteResponse?.(message.from, message.accepted);
              break;

            case "invite-expired":
              if (message.to) {
                setPendingInvites((prev) =>
                  prev.filter((inv) => inv.inviteId !== message.inviteId)
                );
              }
              opts.onInviteExpired?.(message.inviteId);
              break;

            case "invite-cancelled":
              opts.onInviteCancelled?.();
              break;

            case "signal":
              opts.onSignal?.(message.from, message.payload);
              break;

            case "play-command":
              opts.onPlayCommand?.(message.command, message.timestamp);
              break;

            case "host-disconnected":
              opts.onHostDisconnected?.();
              break;

            case "error":
              console.error("Server error:", message.message);
              opts.onError?.(message.message);
              break;
          }
        } catch (e) {
          console.error("Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;

        console.log("🔌 WebSocket closed");
        cleanup();
        wsRef.current = null;
        setStatus("disconnected");
        setLatencyMs(null);

        // Don't auto-reconnect if intentional
        if (isIntentionalCloseRef.current) {
          console.log("Intentional close - not reconnecting");
          isIntentionalCloseRef.current = false;
          return;
        }

        // Auto-reconnect with backoff (max 10 attempts, max 10 second delay)
        if (reconnectCountRef.current < 10) {
          const baseDelay = Math.min(
            3000 * Math.pow(1.3, reconnectCountRef.current),
            10000
          );
          const jitter = 0.7 + Math.random() * 0.6; // 0.7x - 1.3x
          const delay = Math.round(baseDelay * jitter);
          reconnectCountRef.current++;
          console.log(
            `🔄 Reconnecting in ${Math.round(delay / 1000)}s (attempt ${
              reconnectCountRef.current
            }/10)`
          );
          setStatus("connecting");

          reconnectTimeoutRef.current = window.setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        } else {
          console.log("❌ Max reconnect attempts reached");
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        // onclose will handle reconnection
      };
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
      setStatus("disconnected");
    }
  }, [cleanup]);

  // Manual reconnect - resets counter and reconnects
  const manualReconnect = useCallback(() => {
    console.log("🔄 Manual reconnect");
    isIntentionalCloseRef.current = false;
    reconnectCountRef.current = 0;

    // Close existing if any
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent auto-reconnect
      wsRef.current.close();
      wsRef.current = null;
    }

    cleanup();
    setStatus("connecting");

    // Small delay before connecting
    setTimeout(() => {
      if (mountedRef.current) {
        connect();
      }
    }, 300);
  }, [connect, cleanup]);

  // Send helper
  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    console.warn("Cannot send - not connected");
    return false;
  }, []);

  // Actions
  const invite = useCallback(
    (targetClientId: string) => {
      send({
        type: "invite",
        roomId,
        from: clientId,
        to: targetClientId,
        payload: { role: "speaker", note: "Become my speaker?" },
      });
    },
    [send, roomId, clientId]
  );

  const respondToInvite = useCallback(
    (hostId: string, accepted: boolean) => {
      send({
        type: "invite-response",
        roomId,
        from: clientId,
        to: hostId,
        accepted,
      });
      if (accepted) setMyRole("speaker");
    },
    [send, roomId, clientId]
  );

  const cancelInvite = useCallback(
    (inviteId: string) => {
      send({ type: "invite-cancel", inviteId, from: clientId });
      setPendingInvites((prev) =>
        prev.filter((inv) => inv.inviteId !== inviteId)
      );
    },
    [send, clientId]
  );

  const sendSignal = useCallback(
    (
      targetClientId: string,
      payload: RTCSessionDescriptionInit | RTCIceCandidateInit
    ) => {
      send({
        type: "signal",
        roomId,
        from: clientId,
        to: targetClientId,
        payload,
      });
    },
    [send, roomId, clientId]
  );

  const sendPlayCommand = useCallback(
    (command: "play" | "pause" | "stop") => {
      send({
        type: "play-command",
        roomId,
        from: clientId,
        payload: { command, timestamp: Date.now() },
      });
    },
    [send, roomId, clientId]
  );

  const leave = useCallback(() => {
    console.log("👋 Leaving room");
    isIntentionalCloseRef.current = true;
    cleanup();
    send({ type: "leave", roomId, from: clientId });

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus("disconnected");
    setLatencyMs(null);
    setClients([]);
    setPendingInvites([]);
  }, [cleanup, send, roomId, clientId]);

  // Connect when roomId is set
  useEffect(() => {
    mountedRef.current = true;
    isIntentionalCloseRef.current = false; // Reset on new connection attempt

    if (roomId) {
      // Small delay to batch any rapid updates
      const timer = setTimeout(() => {
        if (mountedRef.current && roomId) {
          connect();
        }
      }, 100);

      return () => {
        clearTimeout(timer);
        // Don't mark as intentional here - let reconnect logic work
      };
    }
  }, [roomId]); // Only depend on roomId, not connect

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      isIntentionalCloseRef.current = true;
      cleanup();

      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [cleanup]);

  return {
    status,
    latencyMs,
    lastMessageAt,
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
    manualReconnect,
  };
}
