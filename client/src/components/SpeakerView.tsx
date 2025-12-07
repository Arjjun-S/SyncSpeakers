import React, { useRef, useEffect, useState, useCallback } from 'react';
import { getAnimalEmoji, ConnectionStatus } from '../types';
import { StatusBadge } from './StatusBadge';

interface SpeakerViewProps {
  displayName: string;
  hostDisplayName: string;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  onLeave: () => void;
  wsStatus?: ConnectionStatus;
  latencyMs?: number | null;
  hostTimestampMs?: number;
  lastPacketAgeMs?: number | null;
  onReconnect?: () => void;
  onRefresh?: () => void;
}

export function SpeakerView({ 
  displayName, 
  hostDisplayName, 
  remoteStream, 
  isConnected,
  onLeave,
  wsStatus = 'connected',
  latencyMs,
  hostTimestampMs,
  lastPacketAgeMs,
  onReconnect,
  onRefresh
}: SpeakerViewProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const delayRef = useRef<DelayNode | null>(null);
  const [volume, setVolume] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const targetDelayMs = 120;
  const minDelayMs = 80;
  const maxDelayMs = 150;

  const ensureContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const tearDown = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }
    if (delayRef.current) {
      delayRef.current.disconnect();
      delayRef.current = null;
    }
  }, []);

  const setupPipeline = useCallback(async (stream: MediaStream) => {
    const ctx = ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    tearDown();

    const source = ctx.createMediaStreamSource(stream);
    const delay = ctx.createDelay(maxDelayMs / 1000);
    delay.delayTime.value = targetDelayMs / 1000;

    const gain = ctx.createGain();
    gain.gain.value = volume;

    source.connect(delay).connect(gain).connect(ctx.destination);

    sourceRef.current = source;
    delayRef.current = delay;
    gainRef.current = gain;
    setIsPlaying(true);
  }, [ensureContext, targetDelayMs, maxDelayMs, volume, tearDown]);

  useEffect(() => {
    if (!remoteStream) {
      tearDown();
      setIsPlaying(false);
      return () => {};
    }

    let cancelled = false;
    const tryAutoPlay = async () => {
      try {
        await setupPipeline(remoteStream);
      } catch (err) {
        if (!cancelled) {
          console.warn("Auto playback blocked; tap Start Playback", err);
        }
      }
    };

    // Try to start immediately; if the browser blocks it, the button remains available.
    void tryAutoPlay();

    return () => {
      cancelled = true;
      tearDown();
    };
  }, [remoteStream, setupPipeline, tearDown]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (gainRef.current) {
      gainRef.current.gain.value = newVolume;
    }
  };

  const applyDriftCorrection = useCallback((hostTs: number) => {
    const delay = delayRef.current;
    if (!delay) return;
    const now = Date.now();
    const skewMs = now - hostTs;
    // Aim to keep around targetDelayMs; adjust within bounds
    if (skewMs - targetDelayMs > 60) {
      delay.delayTime.value = Math.max(minDelayMs / 1000, targetDelayMs / 1000 - 0.03);
    } else if (targetDelayMs - skewMs > 60) {
      delay.delayTime.value = Math.min(maxDelayMs / 1000, targetDelayMs / 1000 + 0.02);
    } else {
      delay.delayTime.value = targetDelayMs / 1000;
    }
  }, [minDelayMs, maxDelayMs, targetDelayMs]);

  useEffect(() => {
    if (hostTimestampMs) {
      applyDriftCorrection(hostTimestampMs);
    }
  }, [hostTimestampMs, applyDriftCorrection]);

  const handlePlay = async () => {
    if (!remoteStream) return;
    try {
      await setupPipeline(remoteStream);
    } catch (err) {
      console.error('Playback resume failed', err);
    }
  };

  return (
    <div className="card">
      
      <div className="speaker-status">
        <div className="emoji">{getAnimalEmoji(displayName)}</div>
        <h2>{displayName}</h2>
        
        <div className="flex items-center gap-2 mb-4">
          <StatusBadge status={wsStatus} latencyMs={latencyMs} lastPacketAgeMs={lastPacketAgeMs} />
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

                {onRefresh && (
                  <button
                    className={`btn btn-secondary mb-3 btn-refresh ${refreshing ? 'spinning' : ''}`}
                    onClick={() => {
                      if (refreshing) return;
                      setRefreshing(true);
                      onRefresh();
                      setTimeout(() => setRefreshing(false), 1200);
                    }}
                    disabled={refreshing}
                  >
                    <span className="refresh-icon">🔁</span>
                    {refreshing ? 'Refreshing...' : 'Refresh audio link'}
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
          <>
            <span className="status-badge connecting">
              <span className="status-dot" />
              Connecting...
            </span>
            <p className="text-muted mt-4">Establishing connection with host</p>
          </>
        )}
      </div>
      
      <button className="btn btn-danger mt-4" onClick={onLeave}>
        Leave Room
      </button>
    </div>
  );
}
