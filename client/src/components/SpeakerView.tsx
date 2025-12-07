import React, { useRef, useEffect, useState } from 'react';
import { getAnimalEmoji, ConnectionStatus } from '../types';
import { StatusBadge } from './StatusBadge';

interface SpeakerViewProps {
  displayName: string;
  hostDisplayName: string;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  onLeave: () => void;
  wsStatus?: ConnectionStatus;
  onReconnect?: () => void;
}

export function SpeakerView({ 
  displayName, 
  hostDisplayName, 
  remoteStream, 
  isConnected,
  onLeave,
  wsStatus = 'connected',
  onReconnect
}: SpeakerViewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [ctxError, setCtxError] = useState<string | null>(null);

  useEffect(() => {
    // Hook remote stream to both the media element (fallback) and a low-latency AudioContext path.
    if (!remoteStream) {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      setIsPlaying(false);
      return;
    }

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

    return () => {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (gainRef.current) {
        gainRef.current.disconnect();
        gainRef.current = null;
      }
    };
  }, [remoteStream]);

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
            <span className="status-badge connected mb-4">
              <span className="status-dot" />
              Connected to {hostDisplayName}
            </span>
            
            {remoteStream ? (
              <div className="mt-4">
                {!isPlaying && (
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
