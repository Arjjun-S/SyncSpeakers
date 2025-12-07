// Client types
export interface Client {
  clientId: string;
  displayName: string;
  role: "idle" | "host" | "speaker";
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "unstable"
  | "reconnecting";

// Message types
export interface RegisterMessage {
  type: "register";
  roomId: string;
  clientId: string;
  displayName: string;
  role: "idle" | "host";
}

export interface RegisteredMessage {
  type: "registered";
  clientId: string;
  displayName: string;
  role: string;
  roomId: string;
  clients: Client[];
}

export interface ClientsUpdatedMessage {
  type: "clients-updated";
  clients: Client[];
}

export interface InviteMessage {
  type: "invite";
  inviteId: string;
  from: string;
  fromDisplayName: string;
  payload: {
    role: string;
    note?: string;
  };
}

export interface InviteSentMessage {
  type: "invite-sent";
  inviteId: string;
  to: string;
  toDisplayName: string;
}

export interface InviteResponseMessage {
  type: "invite-response";
  from: string;
  fromDisplayName?: string;
  accepted: boolean;
  inviteId?: string;
}

export interface InviteExpiredMessage {
  type: "invite-expired";
  inviteId: string;
  to?: string;
  from?: string;
  reason?: string;
}

export interface InviteCancelledMessage {
  type: "invite-cancelled";
  inviteId: string;
  reason?: string;
}

export interface SignalMessage {
  type: "signal";
  from: string;
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

export interface PlayCommandMessage {
  type: "play-command";
  command: "play" | "pause" | "stop";
  timestamp?: number;
}

export interface HostDisconnectedMessage {
  type: "host-disconnected";
  message: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

// Pong message for heartbeat
export interface PongMessage {
  type: "pong";
}

export type ServerMessage =
  | RegisteredMessage
  | ClientsUpdatedMessage
  | InviteMessage
  | InviteSentMessage
  | InviteResponseMessage
  | InviteExpiredMessage
  | InviteCancelledMessage
  | SignalMessage
  | PlayCommandMessage
  | HostDisconnectedMessage
  | ErrorMessage
  | PongMessage;

// Pending invite tracking
export interface PendingInvite {
  inviteId: string;
  toClientId: string;
  toDisplayName: string;
  sentAt: number;
}

// Animal data
export interface Animal {
  name: string;
  emoji: string;
}

export const ANIMALS: Animal[] = [
  { name: "pig", emoji: "🐷" },
  { name: "dog", emoji: "🐕" },
  { name: "cat", emoji: "🐱" },
  { name: "rabbit", emoji: "🐰" },
  { name: "fox", emoji: "🦊" },
  { name: "owl", emoji: "🦉" },
  { name: "lion", emoji: "🦁" },
  { name: "bear", emoji: "🐻" },
  { name: "wolf", emoji: "🐺" },
  { name: "deer", emoji: "🦌" },
  { name: "eagle", emoji: "🦅" },
  { name: "tiger", emoji: "🐯" },
  { name: "panda", emoji: "🐼" },
  { name: "koala", emoji: "🐨" },
  { name: "penguin", emoji: "🐧" },
  { name: "dolphin", emoji: "🐬" },
];

// Helper to get emoji for an animal name
export function getAnimalEmoji(name: string): string {
  const baseName = name.split("-")[0].toLowerCase();
  const animal = ANIMALS.find((a) => a.name === baseName);
  return animal?.emoji || "🎵";
}
