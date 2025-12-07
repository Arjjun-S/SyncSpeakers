import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { InviteModal } from './components/InviteModal';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { HostScreen } from './screens/HostScreen';
import { IdleScreen } from './screens/IdleScreen';
import { SpeakerScreen } from './screens/SpeakerScreen';
import { 
  useSignaling, 
  generateRoomCode, 
  getOrCreateClientId, 
  getStoredDisplayName, 
  storeDisplayName 
} from './hooks/useSignaling';
import { useWebRTC, ICE_SERVERS } from './hooks/useWebRTC';
import { useWakeLock } from './hooks/useWakeLock';
import { ANIMALS, type Animal, type InviteMessage, type ConnectionStatus } from './types';

type AppView = 'welcome' | 'host' | 'speaker' | 'idle';
const SESSION_KEY = 'syncspeakers_session';

function App() {
  // Client state
  const [clientId] = useState(() => getOrCreateClientId());
  const [displayName, setDisplayName] = useState<string>(() => getStoredDisplayName() || 'device');
  const [selectedAnimal, setSelectedAnimal] = useState<Animal | null>(() => {
    const stored = getStoredDisplayName();
    if (stored) {
      const animal = ANIMALS.find(a => a.name === stored.split('-')[0]);
      return animal || null;
    }
    return null;
  });
  const [customName, setCustomName] = useState<string>(() => getStoredDisplayName() || '');
  const [selectedRole, setSelectedRole] = useState<'host' | 'speaker' | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone?: 'info' | 'warning' | 'error' }>>([]);
  const [preflight, setPreflight] = useState<{ mic?: 'ok' | 'blocked'; autoplay?: 'ok' | 'blocked'; turn?: 'ok' | 'fail' | 'unknown'; protocol?: 'ok' | 'warn' }>({});
  
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
  
  const addToast = useCallback((message: string, tone: 'info' | 'warning' | 'error' = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

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
      addToast('Invite expired', 'warning');
    }, [addToast]);
  
  const handleInviteCancelled = useCallback(() => {
    console.log('Invite cancelled');
    setPendingInviteFrom(null);
      addToast('Invite cancelled', 'info');
    }, [addToast]);
  
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

  const runPreflight = useCallback(async () => {
    const results: { mic?: 'ok' | 'blocked'; autoplay?: 'ok' | 'blocked'; turn?: 'ok' | 'fail' | 'unknown'; protocol?: 'ok' | 'warn' } = {};

    results.protocol = window.location.protocol === 'https:' || window.location.hostname === 'localhost' ? 'ok' : 'warn';

    try {
      if ((navigator as any).permissions) {
        const status = await (navigator as any).permissions.query({ name: 'microphone' as PermissionName });
        results.mic = status.state === 'denied' ? 'blocked' : 'ok';
      } else {
        results.mic = 'ok';
      }
    } catch (err) {
      results.mic = 'unknown' as any;
    }

    try {
      const ctx = new AudioContext();
      await ctx.resume();
      results.autoplay = 'ok';
      await ctx.close();
    } catch (err) {
      results.autoplay = 'blocked';
    }

    // TURN reachability: look for a relay candidate within a short window
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS.iceServers });
      pc.createDataChannel('probe');
      const done = new Promise<'ok' | 'fail' | 'unknown'>((resolve) => {
        const timer = setTimeout(() => {
          resolve('fail');
          pc.close();
        }, 2500);

        pc.onicecandidate = (ev) => {
          if (ev.candidate && ev.candidate.candidate.includes('relay')) {
            clearTimeout(timer);
            resolve('ok');
            pc.close();
          }
        };

        pc.onicegatheringstatechange = () => {

          useEffect(() => {
            if (roomCode && (view === 'host' || view === 'idle' || view === 'speaker')) {
              runPreflight();
            }
          }, [roomCode, view, runPreflight]);
          if (pc.iceGatheringState === 'complete') {
            // No relay found
            clearTimeout(timer);
            resolve('fail');
            pc.close();
          }
        };
      });

      results.turn = await done;
    } catch (err) {
      results.turn = 'unknown';
    }

    setPreflight(results);
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
    lastMessageAt,
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
    displayName,
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

  const hadConnectedRef = useRef(false);
  useEffect(() => {
    if (status === 'connected') {
      hadConnectedRef.current = true;
    }
  }, [status]);

  const lastPacketAgeMs = useMemo(() => {
    return lastMessageAt ? Date.now() - lastMessageAt : null;
  }, [lastMessageAt]);

  const badgeStatus: ConnectionStatus = useMemo(() => {
    if (status === 'connected') {
      const jittery = (latencyMs ?? 0) > 250 || (lastPacketAgeMs ?? 0) > 15000;
      return jittery ? 'unstable' : 'connected';
    }
    if (status === 'connecting' && hadConnectedRef.current) return 'reconnecting';
    return status;
  }, [status, latencyMs, lastPacketAgeMs]);

  const preflightChips = useMemo(() => {
    const chips: Array<{ label: string; tone: 'ok' | 'warn' | 'error' }> = [];
    if (preflight.mic) chips.push({ label: preflight.mic === 'ok' ? 'Mic ready' : 'Mic blocked', tone: preflight.mic === 'ok' ? 'ok' : 'warn' });
    if (preflight.autoplay) chips.push({ label: preflight.autoplay === 'ok' ? 'Autoplay ready' : 'Autoplay blocked', tone: preflight.autoplay === 'ok' ? 'ok' : 'warn' });
    if (preflight.turn) chips.push({ label: preflight.turn === 'ok' ? 'TURN reachable' : preflight.turn === 'fail' ? 'TURN failed' : 'TURN unknown', tone: preflight.turn === 'ok' ? 'ok' : preflight.turn === 'fail' ? 'error' : 'warn' });
    if (preflight.protocol) chips.push({ label: preflight.protocol === 'ok' ? 'HTTPS ready' : 'Use HTTPS for media', tone: preflight.protocol === 'ok' ? 'ok' : 'warn' });
    return chips;
  }, [preflight]);
  
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
  
  const handleSelectRole = (role: 'host' | 'speaker') => {
    setSelectedRole(role);
  };

  const handleProfileContinue = () => {
    if (!selectedRole) {
      addToast('Choose Host or Speaker to continue', 'warning');
      return;
    }
    const finalName = customName.trim() || selectedAnimal?.name || 'device';
    setDisplayName(finalName);
    storeDisplayName(finalName);

    if (selectedRole === 'host') {
      const code = generateRoomCode();
      setRoomCode(code);
      setView('host');
      runPreflight();
    } else {
      if (!joinRoomCode) {
        addToast('Enter a room code to join as speaker', 'warning');
        return;
      }
      setRoomCode(joinRoomCode.toUpperCase());
      setView('idle');
      runPreflight();
    }
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
        <div className="page slide-in">
          <WelcomeScreen
            selectedRole={selectedRole}
            onSelectRole={handleSelectRole}
            selectedAnimal={selectedAnimal}
            onSelectAnimal={handleSelectAnimal}
            customName={customName}
            onCustomNameChange={setCustomName}
            joinRoomCode={joinRoomCode}
            onJoinRoomCodeChange={(code) => setJoinRoomCode(code)}
            onContinue={handleProfileContinue}
            onBack={() => setSelectedRole(null)}
          />
        </div>
      )}
      
      {/* Host View */}
      {view === 'host' && (
        <div className="page slide-in">
          <HostScreen
            myDisplayName={myDisplayName}
            badgeStatus={badgeStatus}
            latencyMs={latencyMs ?? undefined}
            lastPacketAgeMs={lastPacketAgeMs ?? undefined}
            status={status}
            roomCode={roomCode}
            clients={clients}
            pendingInvites={pendingInvites}
            myClientId={clientId}
            preflightChips={preflightChips}
            onInvite={invite}
            onCancelInvite={cancelInvite}
            onStreamReady={handleStreamReady}
            onRefreshLinks={handleRefreshAudioLinks}
            onLeave={handleLeaveRoom}
            onReconnect={manualReconnect}
          />
        </div>
      )}
      
      {/* Idle View (joined but not yet a speaker) */}
      {view === 'idle' && (
        <div className="page slide-in">
          <IdleScreen
            myDisplayName={myDisplayName}
            badgeStatus={badgeStatus}
            latencyMs={latencyMs ?? undefined}
            lastPacketAgeMs={lastPacketAgeMs ?? undefined}
            status={status}
            roomCode={roomCode}
            preflightChips={preflightChips}
            clients={clients}
            myClientId={clientId}
            onReconnect={manualReconnect}
            onLeave={handleLeaveRoom}
          />
        </div>
      )}
      
      {/* Speaker View */}
      {view === 'speaker' && (
        <div className="page slide-in">
          <SpeakerScreen
            displayName={myDisplayName}
            hostDisplayName={hostInfo?.displayName || 'Host'}
            remoteStream={remoteStream}
            isConnected={isRTCConnected}
            onLeave={handleLeaveRoom}
            wsStatus={badgeStatus}
            latencyMs={latencyMs ?? undefined}
            lastPacketAgeMs={lastPacketAgeMs ?? undefined}
            hostTimestampMs={hostPlayTimestamp ?? undefined}
            onReconnect={manualReconnect}
            onRefresh={handleSpeakerRefresh}
          />
        </div>
      )}
      
      {/* Invite Modal */}
      {pendingInviteFrom && (
        <InviteModal
          hostDisplayName={pendingInviteFrom.displayName}
          onAccept={handleAcceptInvite}
          onDecline={handleDeclineInvite}
        />
      )}

      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone || 'info'}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
