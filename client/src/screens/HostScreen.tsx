import { AudioCapture } from '../components/AudioCapture';
import { DeviceList } from '../components/DeviceList';
import { RoomInfo } from '../components/RoomInfo';
import { StatusBadge } from '../components/StatusBadge';
import { getAnimalEmoji, type Client, type PendingInvite, type ConnectionStatus } from '../types';

interface PreflightChip {
  label: string;
  tone: 'ok' | 'warn' | 'error';
}

interface HostScreenProps {
  myDisplayName: string;
  badgeStatus: ConnectionStatus;
  latencyMs?: number;
  lastPacketAgeMs?: number;
  status: ConnectionStatus;
  roomCode: string;
  clients: Client[];
  pendingInvites: PendingInvite[];
  myClientId: string;
  preflightChips: PreflightChip[];
  onInvite: (clientId: string) => void;
  onCancelInvite: (inviteId: string) => void;
  onStreamReady: (stream: MediaStream) => void;
  onRefreshLinks: () => void;
  onLeave: () => void;
  onReconnect: () => void;
}

export function HostScreen({
  myDisplayName,
  badgeStatus,
  latencyMs,
  lastPacketAgeMs,
  status,
  roomCode,
  clients,
  pendingInvites,
  myClientId,
  preflightChips,
  onInvite,
  onCancelInvite,
  onStreamReady,
  onRefreshLinks,
  onLeave,
  onReconnect,
}: HostScreenProps) {
  return (
    <div className="dashboard-grid">
      <div className="card compact host-card">
        <div className="host-meta">
          <span style={{ fontSize: '2rem' }}>{getAnimalEmoji(myDisplayName)}</span>
          <div>
            <div className="label">Host</div>
            <div className="title-sm">{myDisplayName}</div>
          </div>
        </div>
        <div className="host-status">
          <StatusBadge status={badgeStatus} latencyMs={latencyMs} lastPacketAgeMs={lastPacketAgeMs} />
          {status === 'disconnected' && (
            <button className="btn btn-secondary btn-sm" onClick={onReconnect}>
              🔄 Reconnect
            </button>
          )}
        </div>
      </div>

      <div className="card compact action-card">
        <div className="action-row">
          <button className="btn btn-secondary" onClick={onRefreshLinks}>
            🔁 Refresh audio links
          </button>
          <button className="btn btn-danger" onClick={onLeave}>
            End Session
          </button>
        </div>
      </div>

      <RoomInfo roomCode={roomCode} />

      <DeviceList
        clients={clients}
        pendingInvites={pendingInvites}
        myClientId={myClientId}
        isHost={true}
        onInvite={onInvite}
        onCancelInvite={onCancelInvite}
      />

      {preflightChips.length > 0 && (
        <div className="card compact full-span">
          <div className="label mb-2">Preflight</div>
          <div className="chip-row dense">
            {preflightChips.map((chip, idx) => (
              <span key={idx} className={`chip ${chip.tone}`}>
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="full-span">
        <AudioCapture onStreamReady={onStreamReady} />
      </div>
    </div>
  );
}
