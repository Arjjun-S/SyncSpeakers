import { StatusBadge } from '../components/StatusBadge';
import { getAnimalEmoji, type Client, type ConnectionStatus } from '../types';

interface PreflightChip {
  label: string;
  tone: 'ok' | 'warn' | 'error';
}

interface IdleScreenProps {
  myDisplayName: string;
  badgeStatus: ConnectionStatus;
  latencyMs?: number;
  lastPacketAgeMs?: number;
  status: ConnectionStatus;
  roomCode: string;
  preflightChips: PreflightChip[];
  clients: Client[];
  myClientId: string;
  onReconnect: () => void;
  onLeave: () => void;
}

export function IdleScreen({
  myDisplayName,
  badgeStatus,
  latencyMs,
  lastPacketAgeMs,
  status,
  roomCode,
  preflightChips,
  clients,
  myClientId,
  onReconnect,
  onLeave,
}: IdleScreenProps) {
  return (
    <>
      <div className="flex items-center justify-center gap-4 mb-4">
        <span style={{ fontSize: '2rem' }}>{getAnimalEmoji(myDisplayName)}</span>
        <div>
          <strong>{myDisplayName}</strong>
          <span className="device-role idle ml-2">WAITING</span>
        </div>
        <StatusBadge status={badgeStatus} latencyMs={latencyMs} lastPacketAgeMs={lastPacketAgeMs} />
        {status === 'disconnected' && (
          <button className="btn btn-secondary btn-sm" onClick={onReconnect}>
            🔄 Reconnect
          </button>
        )}
      </div>

      <div className="card">
        <div className="speaker-status">
          <div className="emoji">⏳</div>
          <h2>Waiting for Host</h2>
          <p className="text-muted">
            Room: <strong>{roomCode}</strong>
          </p>
          {preflightChips.length > 0 && (
            <div className="chip-row mt-2">
              {preflightChips.map((chip, idx) => (
                <span key={idx} className={`chip ${chip.tone}`}>
                  {chip.label}
                </span>
              ))}
            </div>
          )}
          <p className="text-muted mt-2">The host will invite you to become a speaker</p>
        </div>
      </div>

      <div className="card">
        <h3>Devices in Room</h3>
        <div className="device-list mt-4">
          {clients.map((client) => (
            <div key={client.clientId} className="device-item">
              <div className="device-info">
                <span className="device-avatar">{getAnimalEmoji(client.displayName)}</span>
                <div>
                  <div className="device-name">
                    {client.displayName}
                    {client.clientId === myClientId && ' (You)'}
                  </div>
                  <span className={`device-role ${client.role}`}>{client.role}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn-danger mt-4" onClick={onLeave}>
        Leave Room
      </button>
    </>
  );
}
