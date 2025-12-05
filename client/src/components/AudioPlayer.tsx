import React, { useRef, useState, useEffect } from 'react';

interface AudioPlayerProps {
  onStreamReady: (stream: MediaStream) => void;
  onPlayStateChange: (playing: boolean) => void;
}

export function AudioPlayer({ onStreamReady, onPlayStateChange }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const destinationNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file);
      
      if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(file);
        audioRef.current.load();
      }
    }
  };

  const setupAudioContext = () => {
    if (!audioRef.current || audioContextRef.current) return;
    
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    
    const source = audioContext.createMediaElementSource(audioRef.current);
    sourceNodeRef.current = source;
    
    const destination = audioContext.createMediaStreamDestination();
    destinationNodeRef.current = destination;
    
    // Connect: source -> destination for streaming
    source.connect(destination);
    // Also connect to speakers for local playback
    source.connect(audioContext.destination);
    
    // Provide the stream for WebRTC
    onStreamReady(destination.stream);
  };

  const togglePlay = async () => {
    if (!audioRef.current || !audioFile) return;
    
    // Setup audio context on first play (must be after user gesture)
    if (!audioContextRef.current) {
      setupAudioContext();
    }
    
    // Resume context if suspended
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      onPlayStateChange(false);
    } else {
      await audioRef.current.play();
      setIsPlaying(true);
      onPlayStateChange(true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(event.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    onPlayStateChange(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div className="card">
      <h3>Audio Source</h3>
      
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />
      
      {!audioFile ? (
        <label className="file-upload">
          <div className="file-upload-icon">🎵</div>
          <p>Click to select an audio file</p>
          <p className="text-muted">MP3, WAV, OGG, etc.</p>
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileSelect}
          />
        </label>
      ) : (
        <div className="audio-player">
          <p className="text-center mb-4" style={{ wordBreak: 'break-all' }}>
            {audioFile.name}
          </p>
          
          <div className="audio-controls">
            <button className="play-btn" onClick={togglePlay}>
              {isPlaying ? '⏸️' : '▶️'}
            </button>
          </div>
          
          <div className="flex items-center gap-2 mt-4">
            <span className="text-muted" style={{ fontSize: '0.875rem', minWidth: '40px' }}>
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              style={{ flex: 1, accentColor: 'var(--primary)' }}
            />
            <span className="text-muted" style={{ fontSize: '0.875rem', minWidth: '40px' }}>
              {formatTime(duration)}
            </span>
          </div>
          
          <button 
            className="btn btn-secondary mt-4"
            onClick={() => {
              setAudioFile(null);
              setIsPlaying(false);
              setCurrentTime(0);
              setDuration(0);
            }}
          >
            Choose Different File
          </button>
        </div>
      )}
    </div>
  );
}
