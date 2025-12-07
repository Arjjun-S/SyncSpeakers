import { RoomInfo } from './RoomInfo';
import { StatusBadge } from './StatusBadge';
import type { ConnectionStatus } from '../types';

interface SessionPanelProps {
  role: 'host' | 'speaker' | null;
  myDisplayName: string;
  roomCode: string;
  joinCode: string;
  status: ConnectionStatus;
  onJoinCodeChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onLeave: () => void;
}

export function SessionPanel({
  role,
  myDisplayName,
  roomCode,
  joinCode,
  status,
  onJoinCodeChange,
  onCreateRoom,
  onJoinRoom,
  onLeave
}: SessionPanelProps) {
  const actionDisabled = !role;

  return (
    <div className="card">
      <div className="card-heading row-between">
        <div>
          <p className="eyebrow">Session</p>
          <h2>{role === 'host' ? 'Host your room' : role === 'speaker' ? 'Join a room' : 'Choose a role to continue'}</h2>
          <p className="text-muted">Status: <StatusBadge status={status} /></p>
        </div>
        {roomCode && (
          <div className="chip">{myDisplayName}</div>
        )}
      </div>

      {role === 'host' && (
        <div className="grid-2">
          <button className="btn btn-primary" onClick={onCreateRoom} disabled={actionDisabled}>
            🚀 Start hosting
          </button>
        </div>
      )}

      {role === 'speaker' && (
        <div className="grid-2">
          <div className="input-group">
            <label htmlFor="join-code">Room code</label>
            <input
              id="join-code"
              className="input"
              type="text"
              placeholder="ABC123"
              value={joinCode}
              onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase())}
              maxLength={6}
            />
          </div>
          <div className="join-actions">
            <button className="btn btn-primary" onClick={onJoinRoom} disabled={actionDisabled || !joinCode}>
              🔗 Join room
            </button>
            <button className="btn btn-secondary" onClick={onLeave} disabled={!roomCode}>
              ✋ Leave
            </button>
          </div>
        </div>
      )}

      {roomCode && (
        <div className="room-stack">
          <RoomInfo roomCode={roomCode} />
        </div>
      )}
    </div>
  );
}
