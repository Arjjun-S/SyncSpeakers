import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
  removeEventListener: (type: 'release', listener: () => void) => void;
};

declare global {
  // eslint-disable-next-line no-var
  var AudioContext: typeof globalThis.AudioContext;
}

const createMockAudioContext = () => {
  const resume = vi.fn(async () => {});
  const close = vi.fn(async () => {});

  const gainNode = {
    gain: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as GainNode;

  const oscillatorNode = {
    frequency: { value: 0 },
    connect: vi.fn(() => gainNode),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as OscillatorNode;

  const createGain = vi.fn(() => gainNode);
  const createOscillator = vi.fn(() => oscillatorNode);

  const ctx = {
    state: 'running',
    resume,
    close,
    createGain,
    createOscillator,
    destination: {},
  } as unknown as AudioContext;

  return { ctx, gainNode, oscillatorNode, resume, close, createGain, createOscillator };
};

describe('useWakeLock', () => {
  const originalWakeLock = (navigator as any).wakeLock;
  const originalAudioContext = globalThis.AudioContext;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: originalWakeLock,
      configurable: true,
      writable: true,
    });
    if (originalAudioContext) {
      globalThis.AudioContext = originalAudioContext;
    } else {
      // @ts-ignore
      delete (globalThis as any).AudioContext;
    }
  });

  it('falls back to keep-alive when Wake Lock is unavailable', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const { ctx } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(() => ctx) as unknown as typeof AudioContext;

    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      const mode = await result.current.requestWakeLock();
      expect(mode).toBe('keep-alive');
    });

    expect(result.current.mode).toBe('keep-alive');
    expect(result.current.active).toBe(true);
  });

  it('acquires screen wake lock when available', async () => {
    const sentinel: WakeLockSentinelLike = {
      released: false,
      release: vi.fn(async () => {
        sentinel.released = true;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: vi.fn(async () => sentinel),
      },
      configurable: true,
      writable: true,
    });

    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      const mode = await result.current.requestWakeLock();
      expect(mode).toBe('wake-lock');
    });

    expect(result.current.mode).toBe('wake-lock');
    expect(result.current.active).toBe(true);
    expect((navigator as any).wakeLock.request).toHaveBeenCalledWith('screen');
  });
});
