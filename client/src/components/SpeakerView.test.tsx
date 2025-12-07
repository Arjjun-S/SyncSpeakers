import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SpeakerView } from './SpeakerView';

// Minimal mocks for Web Audio + MediaStream used inside SpeakerView
class FakeAudioNode {
  connect() {
    return this;
  }
  disconnect() {
    return this;
  }
}

class FakeAudioContext {
  state: 'running' | 'suspended' = 'running';
  destination = new FakeAudioNode();
  async resume() {
    this.state = 'running';
  }
  createMediaStreamSource() {
    return new FakeAudioNode();
  }
  createDelay() {
    return Object.assign(new FakeAudioNode(), { delayTime: { value: 0 } });
  }
  createGain() {
    return Object.assign(new FakeAudioNode(), { gain: { value: 1 } });
  }
}

const OriginalAudioContext = global.AudioContext;

// MediaStream and track stubs
class FakeTrack {
  kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
}

class FakeMediaStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}

describe('SpeakerView', () => {
  beforeEach(() => {
    (global as any).AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    (global as any).MediaStream = FakeMediaStream as unknown as typeof MediaStream;
  });

  afterEach(() => {
    (global as any).AudioContext = OriginalAudioContext;
    (global as any).MediaStream = undefined;
  });

  it('shows Start Playback when a remote stream exists and connects after click', async () => {
    const remoteStream = new FakeMediaStream([new FakeTrack('audio')]) as unknown as MediaStream;

    render(
      <SpeakerView
        displayName="speaker"
        hostDisplayName="host"
        remoteStream={remoteStream}
        isConnected={true}
        onLeave={() => {}}
      />
    );

    const startBtn = await screen.findByRole('button', { name: /start playback/i });
    expect(startBtn).toBeInTheDocument();

    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(screen.getByText(/playing audio from host/i)).toBeInTheDocument();
    });
  });

  it('shows waiting message when no remote stream is present', () => {
    render(
      <SpeakerView
        displayName="speaker"
        hostDisplayName="host"
        remoteStream={null}
        isConnected={true}
        onLeave={() => {}}
      />
    );

    expect(screen.getByText(/waiting for audio stream/i)).toBeInTheDocument();
  });
});