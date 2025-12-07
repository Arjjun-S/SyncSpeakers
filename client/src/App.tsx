import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { DeviceList } from './components/DeviceList';
import { InviteModal } from './components/InviteModal';
import { AudioCapture } from './components/AudioCapture';
import { SpeakerView } from './components/SpeakerView';
import { StatusBadge } from './components/StatusBadge';
import { RoleSelector } from './components/RoleSelector';
import { ProfileForm } from './components/ProfileForm';
import { SessionPanel } from './components/SessionPanel';
import { 
  useSignaling, 
  generateRoomCode, 
  getOrCreateClientId, 
  getStoredDisplayName, 
  storeDisplayName 
} from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { ANIMALS, type Animal, type InviteMessage, getAnimalEmoji } from './types';

type AppView = 'welcome' | 'host' | 'speaker' | 'idle';

function App() {
  // Client state
  const [clientId] = useState(() => getOrCreateClientId());
  const [step, setStep] = useState(1);
  const [selectedRole, setSelectedRole] = useState<'host' | 'speaker' | null>(null);
  const [profileName, setProfileName] = useState(() => {
    const stored = getStoredDisplayName();
    if (!stored) return '';
    const parts = stored.split('-');
    return parts.slice(1).join('-');
  });
  const [selectedAnimal, setSelectedAnimal] = useState<Animal | null>(() => {
    const stored = getStoredDisplayName();
    if (stored) {
      const animal = ANIMALS.find(a => a.name === stored.split('-')[0]);
      return animal || null;
    }
    return null;
  });

  const displayName = useMemo(() => {
    if (!selectedAnimal) return 'device';
    const cleaned = profileName.trim().replace(/\s+/g, '-');
    return cleaned ? `${selectedAnimal.name}-${cleaned}` : selectedAnimal.name;
  }, [selectedAnimal, profileName]);
  useEffect(() => {
    if (selectedAnimal) {
      storeDisplayName(displayName);
    }
  }, [selectedAnimal, displayName]);

  const totalSteps = 3;
  const canProceedToProfile = !!selectedRole;
  const canProceedToSession = canProceedToProfile && !!selectedAnimal;
  
  // Room state
  const [view, setView] = useState<AppView>('welcome');
  const [roomCode, setRoomCode] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState('');
  
  // Invite modal state
  const [pendingInviteFrom, setPendingInviteFrom] = useState<{ id: string; displayName: string } | null>(null);
  
  // Audio state
  const localStreamRef = useRef<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const hostClientIdRef = useRef<string | null>(null);
  const [isRTCConnected, setIsRTCConnected] = useState(false);
  
  // Check URL for room code
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      setJoinRoomCode(roomFromUrl.toUpperCase());
    }
  }, []);
  
  // WebRTC hook
  const { 
    setLocalStream, 
    createOffer, 
    handleSignal, 
    closeAllConnections 
  } = useWebRTC({
    onRemoteStream: (stream) => {
      console.log('Received remote stream');
      setRemoteStream(stream);
      setIsRTCConnected(true);
    },
    onConnectionStateChange: (state) => {
      console.log('RTC connection state:', state);
      if (state === 'connected') {
        setIsRTCConnected(true);
      } else if (state === 'disconnected' || state === 'failed') {
        setIsRTCConnected(false);
      }
    }
  });
  
  // Signaling callbacks
  const handleInvite = useCallback((invite: InviteMessage) => {
    console.log('Received invite from:', invite.fromDisplayName);
    setPendingInviteFrom({ id: invite.from, displayName: invite.fromDisplayName });
    hostClientIdRef.current = invite.from;
  }, []);
  
  const handleInviteResponse = useCallback((from: string, accepted: boolean) => {
    console.log(`Invite response from ${from}: ${accepted ? 'accepted' : 'declined'}`);
    if (accepted && localStreamRef.current) {
      // Create WebRTC offer to the new speaker
      createOffer(from, (payload) => {
        sendSignalRef.current?.(from, payload);
      });
    }
  }, [createOffer]);
  
  const handleInviteExpired = useCallback((inviteId: string) => {
    console.log('Invite expired:', inviteId);
    // Clear modal if it was for this invite
    setPendingInviteFrom(null);
  }, []);
  
  const handleInviteCancelled = useCallback(() => {
    console.log('Invite cancelled');
    setPendingInviteFrom(null);
  }, []);
  
  const handleSignalMessage = useCallback((from: string, payload: RTCSessionDescriptionInit | RTCIceCandidateInit) => {
    console.log('Received signal from:', from);
    handleSignal(from, payload, (p) => {
      sendSignalRef.current?.(from, p);
    });
  }, [handleSignal]);
  
  const handleHostDisconnected = useCallback(() => {
    console.log('Host disconnected');
    alert('Host has disconnected from the room');
    setView('welcome');
    setRoomCode('');
    closeAllConnections();
  }, [closeAllConnections]);
  
  const handleError = useCallback((message: string) => {
    console.error('Error:', message);
  }, []);
  
  // Signaling hook
  const {
    status,
    clients,
    myDisplayName,
    myRole,
    pendingInvites,
    invite,
    respondToInvite,
    cancelInvite,
    sendSignal,
    leave,
    manualReconnect
  } = useSignaling({
    roomId: roomCode,
    clientId,
    displayName,
    role: view === 'host' ? 'host' : 'idle',
    onInvite: handleInvite,
    onInviteResponse: handleInviteResponse,
    onInviteExpired: handleInviteExpired,
    onInviteCancelled: handleInviteCancelled,
    onSignal: handleSignalMessage,
    onHostDisconnected: handleHostDisconnected,
    onError: handleError
  });
  
  // Store sendSignal ref for WebRTC callbacks
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;
  
  // Update view based on role
  useEffect(() => {
    if ((myRole as string) === 'speaker' && view !== 'speaker') {
      setView('speaker');
    }
  }, [myRole, view]);
  
  // Handlers
  const handleSelectRole = (role: 'host' | 'speaker') => {
    setSelectedRole(role);
  };
  
  const handleCreateRoom = () => {
    if (!selectedAnimal) return;
    setSelectedRole('host');
    const code = generateRoomCode();
    setRoomCode(code);
    setView('host');
  };
  
  const handleJoinRoom = () => {
    if (!selectedAnimal || !joinRoomCode) return;
    setSelectedRole('speaker');
    setRoomCode(joinRoomCode.toUpperCase());
    setView('idle');
  };
  
  const handleAcceptInvite = () => {
    if (pendingInviteFrom) {
      respondToInvite(pendingInviteFrom.id, true);
      setPendingInviteFrom(null);
      setView('speaker');
    }
  };
  
  const handleDeclineInvite = () => {
    if (pendingInviteFrom) {
      respondToInvite(pendingInviteFrom.id, false);
      setPendingInviteFrom(null);
    }
  };
  
  const handleStreamReady = (stream: MediaStream) => {
    console.log('Audio stream ready');
    localStreamRef.current = stream;
    setLocalStream(stream);
    
    // If there are already speakers, create offers for them
    clients
      .filter(c => c.role === 'speaker' && c.clientId !== clientId)
      .forEach(speaker => {
        createOffer(speaker.clientId, (payload) => {
          sendSignalRef.current?.(speaker.clientId, payload);
        });
      });
  };
  
  const handleLeaveRoom = () => {
    leave();
    closeAllConnections();
    setRoomCode('');
    setJoinRoomCode('');
    setView('welcome');
    setStep(1);
    setRemoteStream(null);
    setIsRTCConnected(false);
    hostClientIdRef.current = null;
    localStreamRef.current = null;
    
    // Clear URL params
    window.history.replaceState({}, '', window.location.pathname);
  };
  
  // Find host display name for speaker view
  const hostInfo = clients.find(c => c.role === 'host');

  const renderStepper = () => (
    <div className="stepper">
      {[1, 2, 3].map((idx) => {
        const labels = ['Choose role', 'Name & icon', 'Room'];
        const state = idx < step ? 'completed' : idx === step ? 'active' : 'upcoming';
        return (
          <div key={idx} className={`step ${state}`}>
            <div className="step-number">{idx}</div>
            <div>
              <div className="step-label">{labels[idx - 1]}</div>
              <div className="step-sub">{state === 'completed' ? 'Done' : state === 'active' ? 'In progress' : 'Pending'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderWizard = () => (
    <div className="stack">
      {renderStepper()}

      {step === 1 && (
        <RoleSelector role={selectedRole} onChange={handleSelectRole} />
      )}

      {step === 2 && (
        <ProfileForm 
          selectedAnimal={selectedAnimal}
          onSelectAnimal={setSelectedAnimal}
          profileName={profileName}
          onProfileNameChange={setProfileName}
        />
      )}

      {step === 3 && (
        <SessionPanel
          role={selectedRole}
          myDisplayName={displayName}
          roomCode={roomCode}
          joinCode={joinRoomCode}
          status={status}
          onJoinCodeChange={setJoinRoomCode}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onLeave={handleLeaveRoom}
        />
      )}

      <div className="wizard-nav">
        {step > 1 && (
          <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
            ◀ Back
          </button>
        )}
        {step < totalSteps && (
          <button
            className="btn btn-primary"
            onClick={() => setStep(step + 1)}
            disabled={(step === 1 && !canProceedToProfile) || (step === 2 && !canProceedToSession)}
          >
            Next ▶
          </button>
        )}
      </div>
    </div>
  );
  
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SyncSpeakers</p>
          <h1>Get connected in three quick steps</h1>
          <p className="text-muted">Move through role, profile, and room setup—then go live.</p>
        </div>
        <div className="status-chip">
          <span className="chip-icon">{getAnimalEmoji(myDisplayName)}</span>
          <div>
            <div className="chip-title">{myDisplayName || 'Not set'}</div>
            <div className="chip-sub"><StatusBadge status={status} /> {roomCode ? `• Room ${roomCode}` : '• Offline'}</div>
          </div>
        </div>
      </header>

      {view === 'welcome' && renderWizard()}

      {view !== 'welcome' && (
        <div className="stack">
          {view === 'idle' && (
            <div className="card">
              <div className="row-between">
                <div>
                  <p className="eyebrow">Waiting</p>
                  <h2>Waiting for host</h2>
                  <p className="text-muted">Room {roomCode || '—'} • You will be invited to speak</p>
                </div>
                <span className="hero-emoji">⏳</span>
              </div>
              <div className="tag-list">
                {clients.map(client => (
                  <span key={client.clientId} className={`chip-outline ${client.clientId === clientId ? 'chip-active' : ''}`}>
                    {getAnimalEmoji(client.displayName)} {client.displayName} ({client.role})
                  </span>
                ))}
              </div>
              <div className="wizard-nav">
                <button className="btn btn-secondary" onClick={handleLeaveRoom}>✋ Leave</button>
              </div>
            </div>
          )}

          {view === 'host' && (
            <>
              <div className="card">
                <div className="row-between">
                  <div>
                    <p className="eyebrow">Broadcast</p>
                    <h2>Share your audio</h2>
                    <p className="text-muted">Start capturing a tab or screen with audio</p>
                  </div>
                  {status === 'disconnected' && (
                    <button className="btn btn-secondary btn-sm" onClick={manualReconnect}>🔄 Reconnect</button>
                  )}
                </div>
                <AudioCapture onStreamReady={handleStreamReady} />
              </div>

              <DeviceList
                clients={clients}
                pendingInvites={pendingInvites}
                myClientId={clientId}
                isHost={true}
                onInvite={invite}
                onCancelInvite={cancelInvite}
              />

              <button className="btn btn-danger" onClick={handleLeaveRoom}>
                End session
              </button>
            </>
          )}

          {view === 'speaker' && (
            <SpeakerView
              displayName={myDisplayName}
              hostDisplayName={hostInfo?.displayName || 'Host'}
              remoteStream={remoteStream}
              isConnected={isRTCConnected}
              onLeave={handleLeaveRoom}
              wsStatus={status}
              onReconnect={manualReconnect}
            />
          )}
        </div>
      )}

      {pendingInviteFrom && (
        <InviteModal
          hostDisplayName={pendingInviteFrom.displayName}
          onAccept={handleAcceptInvite}
          onDecline={handleDeclineInvite}
        />
      )}
    </div>
  );
}

export default App;
