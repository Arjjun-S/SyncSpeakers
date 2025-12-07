
import { getAnimalEmoji, type Client, type PendingInvite } from '../types';

interface DeviceListProps {
  clients: Client[];
  pendingInvites: PendingInvite[];
  myClientId: string;
  isHost: boolean;
  onInvite: (clientId: string) => void;
  onCancelInvite: (inviteId: string) => void;
}

export function DeviceList({ 
  clients, 
  pendingInvites, 
  myClientId, 
  isHost, 
  onInvite,
  onCancelInvite 
}: DeviceListProps) {
  // Filter out self and get other clients
  const otherClients = clients.filter(c => c.clientId !== myClientId);
  const hasDevices = otherClients.length > 0;

  const isPending = (clientId: string) => 
    pendingInvites.some(inv => inv.toClientId === clientId);
  
  const getPendingInvite = (clientId: string) => 
    pendingInvites.find(inv => inv.toClientId === clientId);

  return (
    <div className="card card-compact device-card">
      <div className="device-card-header">
        <div>
          <h3>Connected Devices{hasDevices ? ` (${otherClients.length})` : ''}</h3>
          <p className="text-muted" style={{ fontSize: '0.9rem' }}>
            Share the code to bring devices online
          </p>
        </div>
      </div>

      {hasDevices ? (
        <div className="device-list">
          {otherClients.map((client) => {
            const pending = isPending(client.clientId);
            const invite = getPendingInvite(client.clientId);
            
            return (
              <div key={client.clientId} className="device-item">
                <div className="device-info">
                  <span className="device-avatar">{getAnimalEmoji(client.displayName)}</span>
                  <div>
                    <div className="device-name">{client.displayName}</div>
                    <span className={`device-role ${pending ? 'pending' : client.role}`}>
                      {pending ? 'Pending' : client.role}
                    </span>
                  </div>
                </div>
                
                {isHost && client.role === 'idle' && !pending && (
                  <button 
                    className="btn btn-primary btn-small"
                    onClick={() => onInvite(client.clientId)}
                  >
                    Invite
                  </button>
                )}
                
                {isHost && pending && invite && (
                  <button 
                    className="btn btn-secondary btn-small"
                    onClick={() => onCancelInvite(invite.inviteId)}
                  >
                    Cancel
                  </button>
                )}
                
                {isHost && client.role === 'speaker' && (
                  <span className="status-badge connected">
                    <span className="status-dot" />
                    Connected
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state compact">
          <div className="empty-state-icon">📱</div>
          <p>No other devices connected yet</p>
          <p className="text-muted">Share the room code to invite devices</p>
        </div>
      )}
    </div>
  );
}
