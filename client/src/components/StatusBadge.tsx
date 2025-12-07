
import { ConnectionStatus } from '../types';

interface StatusBadgeProps {
  status: ConnectionStatus;
  latencyMs?: number | null;
  lastPacketAgeMs?: number | null;
}

export function StatusBadge({ status, latencyMs, lastPacketAgeMs }: StatusBadgeProps) {
  const labels: Record<ConnectionStatus, string> = {
    connected: 'Connected',
    unstable: 'Unstable',
    reconnecting: 'Reconnecting...',
    connecting: 'Connecting...',
    disconnected: 'Disconnected'
  };

  const latencyText = typeof latencyMs === 'number' ? `${Math.max(0, Math.round(latencyMs))} ms` : null;
  const packetText = typeof lastPacketAgeMs === 'number' ? `last packet ${Math.round(lastPacketAgeMs / 1000)}s ago` : null;

  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {labels[status]}
      {latencyText ? ` • ${latencyText}` : ''}
      {packetText ? ` • ${packetText}` : ''}
    </span>
  );
}
