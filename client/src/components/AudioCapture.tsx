import { useState, useEffect } from 'react';

interface AudioCaptureProps {
  onStreamReady: (stream: MediaStream) => void;
}

type CaptureStatus = 'idle' | 'requesting' | 'capturing' | 'error';

export function AudioCapture({ onStreamReady }: AudioCaptureProps) {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);

  const startCapture = async () => {
    setStatus('requesting');
    setErrorMessage('');

    try {
      // Request screen/tab audio capture
      // This will prompt user to share a tab, window, or screen with audio
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Required, but we'll ignore it
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      // Check if audio track exists
      const audioTracks = mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        // Stop video track if no audio
        mediaStream.getTracks().forEach(t => t.stop());
        setErrorMessage('No audio detected. Please share a tab/window with audio playing, and check "Share audio" checkbox.');
        setStatus('error');
        return;
      }

      // Stop video tracks - we only need audio
      mediaStream.getVideoTracks().forEach(track => track.stop());

      // Create audio-only stream
      const audioStream = new MediaStream(audioTracks);
      
      setStream(audioStream);
      setStatus('capturing');
      onStreamReady(audioStream);

      // Handle track ended (user stops sharing)
      audioTracks[0].onended = () => {
        setStatus('idle');
        setStream(null);
      };

    } catch (error) {
      console.error('Capture error:', error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          setErrorMessage('Permission denied. Please allow screen sharing to capture audio.');
        } else {
          setErrorMessage(`Failed to capture: ${error.message}`);
        }
      } else {
        setErrorMessage('Failed to capture system audio');
      }
      setStatus('error');
    }
  };

  const stopCapture = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setStatus('idle');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  return (
    <div className="broadcast-card">
      {status === 'idle' && (
        <div className="audio-capture-idle">
          <div className="capture-icon">🎵</div>
          <p>Share audio from a browser tab to broadcast to all speakers</p>
          <button className="btn btn-primary" onClick={startCapture}>
            📡 Start Broadcasting
          </button>
          <p className="text-muted mt-2" style={{ fontSize: '0.8rem' }}>
            Tip: Play music/audio in another tab, then share that tab with "Share audio" checked
          </p>
        </div>
      )}

      {status === 'requesting' && (
        <div className="audio-capture-requesting">
          <div className="capture-icon">⏳</div>
          <p>Select a tab or window to share...</p>
          <p className="text-muted">Make sure to check "Share audio" in the popup!</p>
        </div>
      )}

      {status === 'capturing' && (
        <div className="audio-capture-active">
          <div className="capture-icon pulse">📡</div>
          <p style={{ color: 'var(--success)', fontWeight: 600 }}>
            Broadcasting audio...
          </p>
          <div className="audio-visualizer">
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
          </div>
          <button className="btn btn-danger mt-4" onClick={stopCapture}>
            ⏹️ Stop Broadcasting
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="audio-capture-error">
          <div className="capture-icon">⚠️</div>
          <p style={{ color: 'var(--danger)' }}>{errorMessage}</p>
          <button className="btn btn-primary mt-4" onClick={startCapture}>
            🔄 Try Again
          </button>
        </div>
      )}
    </div>
  );
}
