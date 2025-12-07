import { useState, useCallback, useEffect, useRef } from 'react';
import { AnimalSelector } from './components/AnimalSelector';
import { DeviceList } from './components/DeviceList';
import { InviteModal } from './components/InviteModal';
import { RoomInfo } from './components/RoomInfo';
import { AudioCapture } from './components/AudioCapture';
import { SpeakerView } from './components/SpeakerView';
import { StatusBadge } from './components/StatusBadge';
import { 
  useSignaling, 
  generateRoomCode, 
  getOrCreateClientId, 
  getStoredDisplayName, 
  storeDisplayName 
} from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { useWakeLock } from './hooks/useWakeLock';
import { ANIMALS, type Animal, type InviteMessage, getAnimalEmoji, type ConnectionStatus } from './types';

type AppView = 'welcome' | 'host' | 'speaker' | 'idle';
const SESSION_KEY = 'syncspeakers_session';

function App() {
  // Client state
  const [clientId] = useState(() => getOrCreateClientId());
  const [selectedAnimal, setSelectedAnimal] = useState<Animal | null>(() => {
    const stored = getStoredDisplayName();
    if (stored) {
      const animal = ANIMALS.find(a => a.name === stored.split('-')[0]);
      return animal || null;
    }
    return null;
  });
  
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
  const [hostPlayTimestamp, setHostPlayTimestamp] = useState<number | null>(null);
  const prevWsStatusRef = useRef<ConnectionStatus>('disconnected');

  const { requestWakeLock, releaseWakeLock } = useWakeLock();
  
  // Check URL for room code
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      setJoinRoomCode(roomFromUrl.toUpperCase());
    }
  }, []);

  // Load persisted session if available
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const session = JSON.parse(raw) as { roomCode: string; role: 'host' | 'speaker' };
      if (!roomCode && session.roomCode) {
        setRoomCode(session.roomCode);
        if (session.role === 'host') {
          setView('host');
        } else {
          setJoinRoomCode(session.roomCode);
          setView('idle');
        }
      }
    } catch (err) {
      console.warn('Failed to restore session', err);
    }
  }, [roomCode]);

  // Auto-rejoin on resume/visibilitychange
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (roomCode) return; // already in a session
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      try {
        const session = JSON.parse(raw) as { roomCode: string; role: 'host' | 'speaker' };
        if (session.roomCode) {
          setRoomCode(session.roomCode);
          if (session.role === 'host') {
            setView('host');
          } else {
            setJoinRoomCode(session.roomCode);
            setView('idle');
          }
        }
      } catch (err) {
        console.warn('Failed to rejoin session', err);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [roomCode]);
  
  // WebRTC hook
  const { 
    setLocalStream, 
    createOffer, 
    handleSignal, 
    closeAllConnections,
    renegotiate
  } = useWebRTC({
    onRemoteStream: (stream) => {
      console.log('Received remote stream');
      setRemoteStream(stream);
      setIsRTCConnected(true);
    },
    onConnectionStateChange: (peerId, state) => {
      console.log('RTC connection state:', state);
      if (state === 'connected') {
        setIsRTCConnected(true);
      } else if (state === 'disconnected' || state === 'failed') {
        setIsRTCConnected(false);
        // Host can proactively renegotiate when a link fails
        if (view === 'host') {
          renegotiate(peerId, (payload) => {
            sendSignalRef.current?.(peerId, payload);
          });
        }
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

  const handlePlayCommand = useCallback((command: 'play' | 'pause' | 'stop', timestamp?: number) => {
    if (command === 'play' && typeof timestamp === 'number') {
      setHostPlayTimestamp(timestamp);
    }
  }, []);
  
  // Signaling hook
  const {
    status,
    latencyMs,
    clients,
    myDisplayName,
    myRole,
    pendingInvites,
    invite,
    respondToInvite,
    cancelInvite,
    sendSignal,
    sendPlayCommand,
    leave,
    manualReconnect
  } = useSignaling({
    roomId: roomCode,
    clientId,
    displayName: selectedAnimal?.name || 'device',
    role: view === 'host' ? 'host' : 'idle',
    onInvite: handleInvite,
    onInviteResponse: handleInviteResponse,
    onInviteExpired: handleInviteExpired,
    onInviteCancelled: handleInviteCancelled,
    onSignal: handleSignalMessage,
    onHostDisconnected: handleHostDisconnected,
    onPlayCommand: handlePlayCommand,
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

  // On WebSocket reconnection, resync offers to current speakers
  useEffect(() => {
    const prev = prevWsStatusRef.current;
    if (status === 'connected' && (prev === 'disconnected' || prev === 'connecting')) {
      if (view === 'host' && clients.length > 0) {
        clients
          .filter(c => c.role === 'speaker')
          .forEach(speaker => {
            createOffer(speaker.clientId, (payload) => {
              sendSignalRef.current?.(speaker.clientId, payload);
            });
          });
      }
    }
    prevWsStatusRef.current = status;
  }, [status, view, clients, createOffer]);
  
  // Handlers
  const handleSelectAnimal = (animal: Animal) => {
    setSelectedAnimal(animal);
    storeDisplayName(animal.name);
  };
  
  const handleCreateRoom = () => {
    if (!selectedAnimal) return;
    const code = generateRoomCode();
    setRoomCode(code);
    setView('host');
  };
  
  const handleJoinRoom = () => {
    if (!selectedAnimal || !joinRoomCode) return;
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
    sendPlayCommand('play');
    
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
    releaseWakeLock();
    setRoomCode('');
    setJoinRoomCode('');
    setView('welcome');
    setRemoteStream(null);
    setIsRTCConnected(false);
    hostClientIdRef.current = null;
    localStreamRef.current = null;
    localStorage.removeItem(SESSION_KEY);
    
    // Clear URL params
    window.history.replaceState({}, '', window.location.pathname);
  };

  const handleRefreshAudioLinks = useCallback(() => {
    if (view !== 'host') return;
    clients
      .filter(c => c.role === 'speaker')
      .forEach(speaker => {
        createOffer(speaker.clientId, (payload) => {
          sendSignalRef.current?.(speaker.clientId, payload);
        });
      });
  }, [view, clients, createOffer]);

  const handleSpeakerRefresh = useCallback(() => {
    closeAllConnections();
    manualReconnect();
    setIsRTCConnected(false);
  }, [closeAllConnections, manualReconnect]);

  // Persist active session so we can resume after sleep/refresh
  useEffect(() => {
    if (roomCode && view !== 'welcome') {
      const role = view === 'host' ? 'host' : 'speaker';
      localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, role }));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }, [roomCode, view]);

  // Keep device awake (wake lock or silent keep-alive) while hosting or speaking
  useEffect(() => {
    const shouldStayAwake = view === 'host' || view === 'speaker';
    if (shouldStayAwake) {
      requestWakeLock();
      return () => {
        releaseWakeLock();
      };
    }
  }, [view, requestWakeLock, releaseWakeLock]);
  
  // Find host display name for speaker view
  const hostInfo = clients.find(c => c.role === 'host');
  
  return (
    <div className="app">
      <header className="header">
        <h1>🔊 SyncSpeakers</h1>
        <p>Synchronized audio across devices</p>
      </header>
      
      {/* Welcome / Setup View */}
      {view === 'welcome' && (
        <>
          <AnimalSelector 
            selectedAnimal={selectedAnimal} 
            onSelect={handleSelectAnimal} 
          />
          
          {selectedAnimal && (
            <div className="card">
              <div className="text-center mb-4">
                <span style={{ fontSize: '3rem' }}>{selectedAnimal.emoji}</span>
                <p className="mt-2">You are <strong>{selectedAnimal.name}</strong></p>
              </div>
              
              <div className="flex flex-col gap-4">
                <button className="btn btn-primary" onClick={handleCreateRoom}>
                  🎙️ Create Room (Host)
                </button>
                
                <div className="text-center text-muted">or</div>
                
                <div className="input-group">
                  <label htmlFor="room-code-input">Join Room</label>
                  <input
                    id="room-code-input"
                    name="roomCode"
                    className="input"
                    type="text"
                    placeholder="Enter room code"
                    value={joinRoomCode}
                    onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                    maxLength={6}
                    autoComplete="off"
                  />
                </div>
                
                <button 
                  className="btn btn-secondary" 
                  onClick={handleJoinRoom}
                  disabled={!joinRoomCode}
                >
                  📱 Join as Speaker
                </button>
              </div>
            </div>
          )}
        </>
      )}
      
      {/* Host View */}
      {view === 'host' && (
        <>
          <div className="flex items-center justify-center gap-4 mb-4">
            <span style={{ fontSize: '2rem' }}>{getAnimalEmoji(myDisplayName)}</span>
            <div>
              <strong>{myDisplayName}</strong>
              <span className="device-role host ml-2">HOST</span>
            </div>
            <StatusBadge status={status} latencyMs={latencyMs} />
            {status === 'disconnected' && (
              <button className="btn btn-secondary btn-sm" onClick={manualReconnect}>
                🔄 Reconnect
              </button>
            )}
          </div>
          
          <RoomInfo roomCode={roomCode} />
          
          <AudioCapture onStreamReady={handleStreamReady} />
          
          <DeviceList
            clients={clients}
            pendingInvites={pendingInvites}
            myClientId={clientId}
            isHost={true}
            onInvite={invite}
            onCancelInvite={cancelInvite}
          />

          <button className="btn btn-secondary mt-3" onClick={handleRefreshAudioLinks}>
            🔁 Refresh audio links
          </button>
          
          <button className="btn btn-danger mt-4" onClick={handleLeaveRoom}>
            End Session
          </button>
        </>
      )}
      
      {/* Idle View (joined but not yet a speaker) */}
      {view === 'idle' && (
        <>
          <div className="flex items-center justify-center gap-4 mb-4">
            <span style={{ fontSize: '2rem' }}>{getAnimalEmoji(myDisplayName)}</span>
            <div>
              <strong>{myDisplayName}</strong>
              <span className="device-role idle ml-2">WAITING</span>
            </div>
            <StatusBadge status={status} latencyMs={latencyMs} />
            {status === 'disconnected' && (
              <button className="btn btn-secondary btn-sm" onClick={manualReconnect}>
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
              <p className="text-muted mt-2">
                The host will invite you to become a speaker
              </p>
            </div>
          </div>
          
          <div className="card">
            <h3>Devices in Room</h3>
            <div className="device-list mt-4">
              {clients.map(client => (
                <div key={client.clientId} className="device-item">
                  <div className="device-info">
                    <span className="device-avatar">{getAnimalEmoji(client.displayName)}</span>
                    <div>
                      <div className="device-name">
                        {client.displayName}
                        {client.clientId === clientId && ' (You)'}
                      </div>
                      <span className={`device-role ${client.role}`}>
                        {client.role}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <button className="btn btn-danger mt-4" onClick={handleLeaveRoom}>
            Leave Room
          </button>
        </>
      )}
      
      {/* Speaker View */}
      {view === 'speaker' && (
        <SpeakerView
          displayName={myDisplayName}
          hostDisplayName={hostInfo?.displayName || 'Host'}
          remoteStream={remoteStream}
          isConnected={isRTCConnected}
          onLeave={handleLeaveRoom}
          wsStatus={status}
          latencyMs={latencyMs}
          hostTimestampMs={hostPlayTimestamp ?? undefined}
          onReconnect={manualReconnect}
          onRefresh={handleSpeakerRefresh}
        />
      )}
      
      {/* Invite Modal */}
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
