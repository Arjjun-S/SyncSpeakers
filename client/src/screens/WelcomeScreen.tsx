import { AnimalSelector } from '../components/AnimalSelector';
import { type Animal } from '../types';

interface WelcomeScreenProps {
  selectedRole: 'host' | 'speaker' | null;
  onSelectRole: (role: 'host' | 'speaker') => void;
  selectedAnimal: Animal | null;
  onSelectAnimal: (animal: Animal) => void;
  customName: string;
  onCustomNameChange: (name: string) => void;
  joinRoomCode: string;
  onJoinRoomCodeChange: (code: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function WelcomeScreen({
  selectedRole,
  onSelectRole,
  selectedAnimal,
  onSelectAnimal,
  customName,
  onCustomNameChange,
  joinRoomCode,
  onJoinRoomCodeChange,
  onContinue,
  onBack,
}: WelcomeScreenProps) {
  return (
    <div className="grid grid-two">
      <div className="card">
        <h2>Step 1: Choose role</h2>
        <p className="text-muted mb-3">Pick how this device participates.</p>
        <div className="role-grid">
          <button
            className={`role-card glass ${selectedRole === 'host' ? 'selected' : ''}`}
            onClick={() => onSelectRole('host')}
          >
            <div className="role-top">
              <span className="role-chip">Host</span>
              <span className="role-emoji" aria-hidden>
                🎙️
              </span>
            </div>
            <div className="role-body">
              <div className="role-title">Capture and send audio</div>
              <div className="role-text">Share a browser tab and stream it to everyone.</div>
            </div>
            <div className="role-foot">Best for: laptop or desktop running the show.</div>
          </button>
          <button
            className={`role-card glass ${selectedRole === 'speaker' ? 'selected' : ''}`}
            onClick={() => onSelectRole('speaker')}
          >
            <div className="role-top">
              <span className="role-chip alt">Speaker</span>
              <span className="role-emoji" aria-hidden>
                🔊
              </span>
            </div>
            <div className="role-body">
              <div className="role-title">Receive and play audio</div>
              <div className="role-text">Syncs playback with the host—just pick a device and listen.</div>
            </div>
            <div className="role-foot">Best for: phones, tablets, smart displays.</div>
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Step 2: Profile</h2>
        <p className="text-muted mb-3">Pick a name and icon for this device.</p>
        <div className="input-group">
          <label htmlFor="name-input">Display name</label>
          <input
            id="name-input"
            className="input"
            type="text"
            placeholder="e.g. LivingRoom"
            value={customName}
            onChange={(e) => onCustomNameChange(e.target.value)}
          />
        </div>
        <AnimalSelector selectedAnimal={selectedAnimal} onSelect={onSelectAnimal} />

        {selectedRole === 'speaker' && (
          <div className="input-group">
            <label htmlFor="room-code-input">Room code</label>
            <input
              id="room-code-input"
              className="input"
              type="text"
              placeholder="ABC123"
              value={joinRoomCode}
              onChange={(e) => onJoinRoomCodeChange(e.target.value.toUpperCase())}
              maxLength={6}
              autoComplete="off"
            />
          </div>
        )}

        <div className="flex gap-3">
          {selectedRole && (
            <button className="btn btn-secondary" onClick={onBack}>
              ◀ Back
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={onContinue}
            disabled={!selectedRole || (selectedRole === 'speaker' && !joinRoomCode)}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
