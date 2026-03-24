import React, { useRef, useEffect, useState } from 'react';
import { getAnimalEmoji, ConnectionStatus, PlaybackCommandPayload, StartAudioPayload } from '../types';
import { StatusBadge } from './StatusBadge';
import { usePlaybackScheduler } from '../hooks/usePlaybackScheduler';

interface SpeakerViewProps {
  displayName: string;
  hostDisplayName: string;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  onLeave: () => void;
  wsStatus?: ConnectionStatus;
  onReconnect?: () => void;
  /** Latest playback command from host, already parsed from signaling. */
  playbackCommand?: PlaybackCommandPayload | null;
  /** Function returning current estimated server time in ms. */
  getServerTime: () => number;
  startAudioCommand?: StartAudioPayload | null;
  wsTimeOffset: number;
}

export function SpeakerView({ 
  displayName, 
  hostDisplayName, 
  remoteStream, 
  isConnected,
  onLeave,
  wsStatus = 'connected',
  onReconnect,
  playbackCommand,
  getServerTime,
  startAudioCommand,
  wsTimeOffset,
}: SpeakerViewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const isLanMode = typeof window !== 'undefined' && 
    (window.location.hostname.includes("192.168") || 
     window.location.hostname.includes("localhost") || 
     window.location.hostname === "127.0.0.1");

  // Per-device output latency estimate (ms). We start from
  // AudioContext.baseLatency / outputLatency where available, and
  // allow future refinement via calibration.
  const [outputLatencyMs, setOutputLatencyMs] = useState(80);
  const [usingBluetooth, setUsingBluetooth] = useState(false);

  const { applyRemoteCommand } = usePlaybackScheduler(
    audioRef,
    {
      getServerTime,
      outputLatencyMs,
      minBufferMs: 3000,
    }
  );

  // Load any previously calibrated latency offset from storage.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('syncspeakers_output_latency_ms');
      if (stored) {
        const parsed = parseFloat(stored);
        if (!Number.isNaN(parsed) && parsed > 0) {
          setOutputLatencyMs(parsed);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Heuristic Bluetooth detection: if any audiooutput device label
  // contains "Bluetooth", inflate the assumed output latency and
  // surface a user-facing warning.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const hasBluetooth = devices.some(
          (d) => d.kind === 'audiooutput' && /bluetooth/i.test(d.label || '')
        );
        if (hasBluetooth) {
          setUsingBluetooth(true);
          setOutputLatencyMs((prev) => Math.max(prev, 220));
        }
      })
      .catch((err) => {
        console.warn('enumerateDevices failed for Bluetooth detection:', err);
      });
  }, []);

  useEffect(() => {
    // Hook remote stream to both the media element (fallback) and a low-latency AudioContext path.
    if (!remoteStream || !startAudioCommand) {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      setIsPlaying(false);
      return;
    }

    const now = Date.now() + wsTimeOffset;
    const delay = startAudioCommand.startTime - now;

    if (delay > 0) {
      setIsSyncing(true);
    }

    const timerId = setTimeout(() => {
      setIsSyncing(false);
      if (audioRef.current) {
        audioRef.current.srcObject = remoteStream;
        audioRef.current.volume = 0; // mute element to avoid double output when context is used
        audioRef.current.play().catch(() => {
          console.log('Autoplay blocked, waiting for user interaction');
        });
      }

      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new AudioContext({ latencyHint: 'interactive' });
          const ctx = audioCtxRef.current;
          const base = (ctx as any).baseLatency ?? 0;
          const output = (ctx as any).outputLatency ?? 0;
          const estLatencyMs = (base + output) * 1000;
          if (estLatencyMs > 0) {
            setOutputLatencyMs(estLatencyMs);
            try {
              localStorage.setItem('syncspeakers_output_latency_ms', estLatencyMs.toString());
            } catch {
              // Ignore storage errors
            }
          }

          // Fire a short calibration tone once to warm up the
          // output pipeline and anchor timing based on AudioContext.
          try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.1;
            osc.frequency.value = 1000;
            osc.connect(gain).connect(ctx.destination);
            const startAt = ctx.currentTime + 0.05;
            const stopAt = startAt + 0.1;
            osc.start(startAt);
            osc.stop(stopAt);
          } catch (toneErr) {
            console.warn('Calibration tone failed:', toneErr);
          }
        }
        if (sourceRef.current) {
          sourceRef.current.disconnect();
        }
        if (!gainRef.current) {
          gainRef.current = audioCtxRef.current.createGain();
          gainRef.current.gain.value = volume;
        }
        sourceRef.current = audioCtxRef.current.createMediaStreamSource(remoteStream);
        sourceRef.current.connect(gainRef.current);
        gainRef.current.connect(audioCtxRef.current.destination);
        audioCtxRef.current.resume().then(() => {
          setIsPlaying(true);
          setCtxError(null);
        }).catch((err) => {
          console.warn('AudioContext resume blocked:', err);
          setCtxError('Tap play to resume audio');
        });
      } catch (err) {
        console.error('AudioContext setup failed:', err);
        setCtxError('Low-latency path unavailable');
      }
    }, Math.max(0, delay));

    return () => {
      clearTimeout(timerId);
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (gainRef.current) {
        gainRef.current.disconnect();
        gainRef.current = null;
      }
    };
  }, [remoteStream, startAudioCommand, wsTimeOffset, volume]);

  // Handle Drift (Advanced Sync)
  useEffect(() => {
    if (!isPlaying || !startAudioCommand || !audioRef.current) return;
    
    // Periodic correction
    const intervalId = setInterval(() => {
      if (!audioRef.current) return;
      const audio = audioRef.current;
      
      const elapsed = Date.now() + wsTimeOffset - startAudioCommand.startTime;
      if (elapsed < 0) return; // Not started yet

      const expectedTime = elapsed; // expected playback time in ms
      const actualTime = audio.currentTime * 1000;

      const drift = actualTime - expectedTime;

      if (Math.abs(drift) > 50) {
        audio.playbackRate = drift > 0 ? 0.98 : 1.02;
      } else {
        audio.playbackRate = 1.0;
      }
    }, 2000);

    return () => {
      clearInterval(intervalId);
      if (audioRef.current) audioRef.current.playbackRate = 1.0;
    };
  }, [isPlaying, startAudioCommand, wsTimeOffset]);

  // Apply any incoming synchronized playback commands.
  useEffect(() => {
    if (playbackCommand) {
      applyRemoteCommand(playbackCommand);
    }
  }, [playbackCommand, applyRemoteCommand]);

  const handlePlay = async () => {
    if (audioRef.current) {
      try {
        // Ensure AudioContext is resumed for lowest latency; fall back to media element
        if (audioCtxRef.current?.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
        if (sourceRef.current && !isPlaying) {
          setIsPlaying(true);
          setCtxError(null);
        }

        await audioRef.current.play();
      } catch (error) {
        console.error('Playback failed:', error);
        setCtxError('User gesture required to start audio');
      }
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
    if (gainRef.current) {
      gainRef.current.gain.value = newVolume;
    }
  };

  return (
    <div className="card">
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      
      <div className="speaker-status">
        <div className="emoji">{getAnimalEmoji(displayName)}</div>
        <h2>{displayName}</h2>
        
        <div className="flex items-center gap-2 mb-4">
          <StatusBadge status={wsStatus} />
          {wsStatus === 'disconnected' && onReconnect && (
            <button className="btn btn-secondary btn-sm" onClick={onReconnect}>
              🔄 Reconnect
            </button>
          )}
        </div>
        
        {isConnected ? (
          <>
            <div className="flex flex-col gap-2 mb-4">
              <span className="status-badge connected w-fit">
                <span className="status-dot" />
                Connected to {hostDisplayName}
              </span>
              {isLanMode && (
                <span className="status-badge w-fit" style={{background: 'var(--success-light)', color: 'var(--success-dark)'}}>
                  ⚡ Low latency mode
                </span>
              )}
            </div>
            
            {remoteStream ? (
              <div className="mt-4">
                {isSyncing && (
                  <p className="text-muted mb-4 font-medium" style={{ color: 'var(--primary)' }}>
                    🔄 Syncing...
                  </p>
                )}
                <div className="mt-2 text-muted mb-4" style={{fontSize: '0.85rem'}}>
                  📶 Connection quality: Good {wsStatus === 'connected' ? '(Stable)' : ''}
                </div>

                {!isPlaying && !isSyncing && (
                  <button className="btn btn-primary mb-4" onClick={handlePlay}>
                    🔊 Start Playback
                  </button>
                )}
                
                <div className="volume-indicator">
                  <span>🔈</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={volume}
                    onChange={handleVolumeChange}
                    style={{ flex: 1, accentColor: 'var(--primary)' }}
                  />
                  <span>🔊</span>
                </div>

                {ctxError && (
                  <p className="text-muted mt-2" style={{ color: 'var(--warning)' }}>
                    {ctxError}
                  </p>
                )}

                {usingBluetooth && (
                  <p className="text-muted mt-1" style={{ color: 'var(--warning)' }}>
                    ⚠️ Bluetooth output detected. Sync accuracy may be slightly reduced
                    when mixing Bluetooth and non-Bluetooth devices.
                  </p>
                )}
                
                {isPlaying && (
                  <p className="text-center mt-4" style={{ color: 'var(--success)' }}>
                    ▶️ Playing audio from host...
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted mt-4">Waiting for audio stream...</p>
            )}
          </>
        ) : (
          <p className="text-muted mt-2">Establishing connection with host</p>
        )}
      </div>
      
      <button className="btn btn-danger mt-4" onClick={onLeave}>
        Leave Room
      </button>
    </div>
  );
}
