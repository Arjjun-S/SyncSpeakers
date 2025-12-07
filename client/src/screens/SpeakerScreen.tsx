import { SpeakerView } from '../components/SpeakerView';
import { type ConnectionStatus } from '../types';

interface SpeakerScreenProps {
  displayName: string;
  hostDisplayName: string;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  latencyMs?: number;
  lastPacketAgeMs?: number;
  hostTimestampMs?: number;
  wsStatus: ConnectionStatus;
  onLeave: () => void;
  onReconnect: () => void;
  onRefresh: () => void;
}

export function SpeakerScreen({
  displayName,
  hostDisplayName,
  remoteStream,
  isConnected,
  latencyMs,
  lastPacketAgeMs,
  hostTimestampMs,
  wsStatus,
  onLeave,
  onReconnect,
  onRefresh,
}: SpeakerScreenProps) {
  return (
    <SpeakerView
      displayName={displayName}
      hostDisplayName={hostDisplayName}
      remoteStream={remoteStream}
      isConnected={isConnected}
      onLeave={onLeave}
      wsStatus={wsStatus}
      latencyMs={latencyMs}
      lastPacketAgeMs={lastPacketAgeMs}
      hostTimestampMs={hostTimestampMs}
      onReconnect={onReconnect}
      onRefresh={onRefresh}
    />
  );
}
