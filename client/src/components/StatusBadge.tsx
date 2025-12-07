
import { ConnectionStatus } from '../types';

interface StatusBadgeProps {
  status: ConnectionStatus;
  latencyMs?: number | null;
}

export function StatusBadge({ status, latencyMs }: StatusBadgeProps) {
  const labels: Record<ConnectionStatus, string> = {
    connected: 'Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected'
  };

  const latencyText = typeof latencyMs === 'number' ? `${Math.max(0, Math.round(latencyMs))} ms` : null;

  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {labels[status]}
      {latencyText ? ` • ${latencyText}` : ''}
    </span>
  );
}
