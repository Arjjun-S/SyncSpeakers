interface RoleSelectorProps {
  role: 'host' | 'speaker' | null;
  onChange: (role: 'host' | 'speaker') => void;
}

export function RoleSelector({ role, onChange }: RoleSelectorProps) {
  return (
    <div className="card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Step 1</p>
          <h2>Choose how you want to join</h2>
          <p className="text-muted">Pick host to broadcast or speaker to listen</p>
        </div>
      </div>
      <div className="role-toggle">
        <button
          className={`pill ${role === 'host' ? 'pill-active' : ''}`}
          onClick={() => onChange('host')}
        >
          <span className="pill-icon">🛰️</span>
          <div>
            <div className="pill-title">Host</div>
            <div className="pill-sub">Start a room and broadcast</div>
          </div>
        </button>
        <button
          className={`pill ${role === 'speaker' ? 'pill-active' : ''}`}
          onClick={() => onChange('speaker')}
        >
          <span className="pill-icon">🎧</span>
          <div>
            <div className="pill-title">Speaker</div>
            <div className="pill-sub">Join a room to sync audio</div>
          </div>
        </button>
      </div>
    </div>
  );
}
