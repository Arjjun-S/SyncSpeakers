import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface RoomInfoProps {
  roomCode: string;
  showQR?: boolean;
}

export function RoomInfo({ roomCode, showQR = true }: RoomInfoProps) {
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (showQR && qrRef.current) {
      const joinUrl = `${window.location.origin}?room=${roomCode}`;
      QRCode.toCanvas(qrRef.current, joinUrl, {
        width: 180,
        margin: 2,
        color: {
          dark: '#1e293b',
          light: '#ffffff'
        }
      });
    }
  }, [roomCode, showQR]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const shareRoom = async () => {
    const joinUrl = `${window.location.origin}?room=${roomCode}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join SyncSpeakers Room',
          text: `Join my SyncSpeakers room with code: ${roomCode}`,
          url: joinUrl
        });
      } catch (err) {
        console.log('Share cancelled');
      }
    } else {
      copyCode();
    }
  };

  return (
    <div className="room-info">
      <div>
        <p className="text-muted text-center">Room Code</p>
        <div className="room-code" onClick={copyCode} style={{ cursor: 'pointer' }}>
          {roomCode}
        </div>
        {copied && <p className="text-center" style={{ color: 'var(--success)', fontSize: '0.875rem' }}>Copied!</p>}
      </div>
      
      {showQR && (
        <div className="qr-code">
          <canvas ref={qrRef} />
        </div>
      )}
      
      <button className="btn btn-secondary" onClick={shareRoom}>
        📤 Share Room
      </button>
    </div>
  );
}
