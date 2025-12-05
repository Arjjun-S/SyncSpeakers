
import { getAnimalEmoji } from '../types';

interface InviteModalProps {
  hostDisplayName: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function InviteModal({ hostDisplayName, onAccept, onDecline }: InviteModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-icon">{getAnimalEmoji(hostDisplayName)}</div>
        <h2>Speaker Request</h2>
        <p>
          <strong>{hostDisplayName}</strong> is requesting you to join as a Speaker
        </p>
        <div className="timeout-progress">
          <div className="timeout-bar" />
        </div>
        <p className="text-muted mt-2" style={{ fontSize: '0.875rem' }}>
          This request will expire in 20 seconds
        </p>
        <div className="modal-buttons mt-4">
          <button className="btn btn-secondary" onClick={onDecline}>
            Decline
          </button>
          <button className="btn btn-success" onClick={onAccept}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
