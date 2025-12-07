import { useState, useEffect, useRef } from 'react';

interface AudioCaptureProps {
  onStreamReady: (stream: MediaStream) => void;
}

type CaptureStatus = 'idle' | 'requesting' | 'capturing' | 'error';
type CaptureMode = 'file' | 'tab' | 'mic' | 'external';

export function AudioCapture({ onStreamReady }: AudioCaptureProps) {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [mode, setMode] = useState<CaptureMode>('file');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [fileUrl, setFileUrl] = useState<string>('');
  const [showPicker, setShowPicker] = useState<boolean>(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const modeLabel: Record<CaptureMode, string> = {
    file: 'File or link',
    tab: 'Browser tab',
    mic: 'Microphone',
    external: 'App or device',
  };

  const stopCurrentStream = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  };

  const setActiveStream = (mediaStream: MediaStream) => {
    stopCurrentStream();
    setStream(mediaStream);
    setStatus('capturing');
    onStreamReady(mediaStream);
  };

  const startFileOrUrl = async () => {
    setStatus('requesting');
    setErrorMessage('');
    try {
      const audioEl = audioElRef.current;
      if (!audioEl) throw new Error('Audio element missing');
      if (!fileUrl) throw new Error('Pick a file or paste a URL');

      audioEl.src = fileUrl;
      await audioEl.play();

      const capture = (audioEl as any).captureStream?.() || (audioEl as any).mozCaptureStream?.();
      if (!capture) throw new Error('captureStream not supported in this browser');

      setActiveStream(capture);
    } catch (err) {
      console.error('File/URL capture error:', err);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start file/URL capture');
    }
  };

  const startTab = async () => {
    setStatus('requesting');
    setErrorMessage('');
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: {
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });

      const audioTracks = mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        mediaStream.getTracks().forEach((t) => t.stop());
        throw new Error('No audio detected. Choose a tab/window with audio and check "Share audio".');
      }

      mediaStream.getVideoTracks().forEach((t) => t.stop());
      setActiveStream(new MediaStream(audioTracks));
    } catch (err) {
      console.error('Tab capture error:', err);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to capture tab audio');
    }
  };

  const startMic = async () => {
    setStatus('requesting');
    setErrorMessage('');
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      setActiveStream(mediaStream);
    } catch (err) {
      console.error('Mic capture error:', err);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to capture microphone');
    }
  };

  const startExternal = async () => {
    // Best-effort: use tab/system audio capture as a fallback for external apps
    await startTab();
  };

  const startCapture = async (modeOverride?: CaptureMode) => {
    const nextMode = modeOverride ?? mode;
    if (nextMode !== mode) setMode(nextMode);

    stopCurrentStream();
    if (nextMode === 'file') return startFileOrUrl();
    if (nextMode === 'tab') return startTab();
    if (nextMode === 'mic') return startMic();
    if (nextMode === 'external') return startExternal();
  };

  const stopCapture = () => {
    stopCurrentStream();
    setStatus('idle');
  };

  const handleFileInput = (file?: File | null) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFileUrl(url);
  };

  useEffect(() => {
    return () => {
      stopCurrentStream();
      const audioEl = audioElRef.current;
      if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
      }
    };
  }, []);

  return (
    <div className="card compact audio-card">
      <div className="audio-card-head">
        <h3>🔊 Audio Broadcast</h3>
        <p className="text-muted tiny">Pick a source and send it to listeners.</p>
      </div>

      <div className="audio-card-cta">
          <button className="btn btn-primary" onClick={() => setShowPicker(true)}>
          🎛️ Choose audio source
        </button>
        <div className="chip-row dense mt-2">
          <span className="chip">Source: {modeLabel[mode]}</span>
          <span className={`chip ${status === 'capturing' ? 'ok' : status === 'requesting' ? 'warn' : status === 'error' ? 'error' : ''}`}>
            {status === 'capturing' ? 'Live' : status === 'requesting' ? 'Requesting' : status === 'error' ? 'Needs attention' : 'Idle'}
          </span>
        </div>
      </div>

      {status === 'requesting' && (
        <div className="audio-capture-requesting mt-3">
          <div className="capture-icon">⏳</div>
          <p>Waiting for permission...</p>
        </div>
      )}

      {status === 'capturing' && (
        <div className="audio-capture-active mt-3">
          <div className="capture-icon pulse">📡</div>
          <p style={{ color: 'var(--success)', fontWeight: 600 }}>
            Broadcasting audio from {mode === 'file' ? 'file/link' : mode === 'tab' ? 'tab' : mode === 'mic' ? 'microphone' : 'device/app'}
          </p>
          <div className="audio-visualizer">
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
          </div>
          <div className="flex gap-2 mt-2">
            <button className="btn btn-danger" onClick={stopCapture}>
              ⏹️ Stop
            </button>
            <button className="btn btn-secondary" onClick={() => startCapture()}>
              🔄 Restart
            </button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="audio-capture-error mt-3">
          <div className="capture-icon">⚠️</div>
          <p style={{ color: 'var(--danger)' }}>{errorMessage}</p>
          <button className="btn btn-primary mt-2" onClick={() => startCapture()}>
            🔄 Try Again
          </button>
        </div>
      )}

      <div className="capture-notes mt-3 text-muted tiny">
        <div>• File/URL: plays in-page and streams via captureStream (fastest, no screen share).</div>
        <div>• Tab/App: browser share prompt; ensure "Share audio" is checked.</div>
        <div>• Mic: mic permission only; good for voice.</div>
      </div>

      {showPicker && (
        <div className="audio-picker-overlay" onClick={() => setShowPicker(false)}>
          <div className="audio-picker-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="audio-picker-head">
              <div>
                <p className="label">Broadcast source</p>
                <h4>Choose how you want to share audio</h4>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowPicker(false)}>
                ✕ Close
              </button>
            </div>

            <div className="picker-grid">
              <div className={`picker-card ${mode === 'file' ? 'selected' : ''}`}>
                <div className="picker-top">
                  <span className="picker-emoji">🎵</span>
                  <div>
                    <p className="label">Play a file or link</p>
                    <p className="picker-sub">Fastest. No screen-share prompt.</p>
                  </div>
                </div>
                <div className="input-group">
                  <label htmlFor="file-url">URL</label>
                  <input
                    id="file-url"
                    className="input"
                    placeholder="https://example.com/song.mp3"
                    value={fileUrl.startsWith('blob:') ? '' : fileUrl}
                    onChange={(e) => setFileUrl(e.target.value)}
                    onFocus={() => setMode('file')}
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="file-picker">Or upload a file</label>
                  <input
                    id="file-picker"
                    type="file"
                    accept="audio/*"
                    onChange={(e) => handleFileInput(e.target.files?.[0] || null)}
                    onClick={() => setMode('file')}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    startCapture('file');
                    setShowPicker(false);
                  }}
                >
                  ▶️ Start file/link
                </button>
              </div>

              <div className={`picker-card ${mode === 'tab' ? 'selected' : ''}`}>
                <div className="picker-top">
                  <span className="picker-emoji">📡</span>
                  <div>
                    <p className="label">Play from another tab</p>
                    <p className="picker-sub">Pick a tab/window with audio and tick “Share audio”.</p>
                  </div>
                </div>
                <ul className="picker-list">
                  <li>Chrome/Edge: choose tab → enable Share audio.</li>
                  <li>Stops video track to keep audio only.</li>
                </ul>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    startCapture('tab');
                    setShowPicker(false);
                  }}
                >
                  Capture tab audio
                </button>
              </div>

              <div className={`picker-card ${mode === 'mic' ? 'selected' : ''}`}>
                <div className="picker-top">
                  <span className="picker-emoji">🎤</span>
                  <div>
                    <p className="label">Play from microphone</p>
                    <p className="picker-sub">Best for live speech and call-ins.</p>
                  </div>
                </div>
                <ul className="picker-list">
                  <li>Mic permission only.</li>
                  <li>Noise suppression on.</li>
                </ul>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    startCapture('mic');
                    setShowPicker(false);
                  }}
                >
                  Use microphone
                </button>
              </div>

              <div className={`picker-card ${mode === 'external' ? 'selected' : ''}`}>
                <div className="picker-top">
                  <span className="picker-emoji">🖥️</span>
                  <div>
                    <p className="label">Play from device/app</p>
                    <p className="picker-sub">Use system/tab capture for Spotify, etc.</p>
                  </div>
                </div>
                <ul className="picker-list">
                  <li>Select the app/tab with audio.</li>
                  <li>Same browser prompt as tab capture.</li>
                </ul>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    startCapture('external');
                    setShowPicker(false);
                  }}
                >
                  Capture app audio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <audio ref={audioElRef} style={{ display: 'none' }} crossOrigin="anonymous" />
    </div>
  );
}
