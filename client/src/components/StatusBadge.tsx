import React from 'react';
import { ConnectionStatus } from '../types';

interface StatusBadgeProps {
  status: ConnectionStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const labels: Record<ConnectionStatus, string> = {
    connected: 'Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected'
  };

  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {labels[status]}
    </span>
  );
}
