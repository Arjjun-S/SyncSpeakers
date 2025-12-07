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
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.play().catch(() => {
        console.log('Autoplay blocked, waiting for user interaction');
      });
    }
  }, [remoteStream]);

  const handlePlay = async () => {
    if (audioRef.current) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (error) {
        console.error('Playback failed:', error);
      }
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  return (
    <div className="card">
      <audio ref={audioRef} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
      
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
