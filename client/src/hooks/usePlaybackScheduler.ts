import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaybackCommandPayload } from "../types";

export type PlaybackState = "idle" | "buffering" | "playing" | "paused";

interface TimelineState {
  isPlaying: boolean;
  /** Server time (ms) when playback last started/resumed. */
  startServerTime: number;
  /** Track position in seconds at startServerTime. */
  startPositionSec: number;
}

export interface UsePlaybackSchedulerOptions {
  /** Function returning current estimated server time (ms since epoch). */
  getServerTime: () => number;
  /** Calibrated output latency for this device in ms (includes Bluetooth inflate). */
  outputLatencyMs: number;
  /** Minimum desired global buffer before commands take effect (ms). */
  minBufferMs?: number;
}

export interface UsePlaybackSchedulerResult {
  state: PlaybackState;
  /** Apply a remote playback command (from server/host). */
  applyRemoteCommand: (cmd: PlaybackCommandPayload) => void;
}

/**
 * Client-side playback scheduler for a single HTMLMediaElement.
 *
 * It transforms server-timestamped commands into local play/pause/seek
 * operations, compensating for output latency and performing slow
 * playbackRate nudges to correct drift over time.
 */
export function usePlaybackScheduler(
  audioRef: React.RefObject<HTMLAudioElement>,
  { getServerTime, outputLatencyMs, minBufferMs = 3000 }: UsePlaybackSchedulerOptions
): UsePlaybackSchedulerResult {
  const [state, setState] = useState<PlaybackState>("idle");
  const commandTimerRef = useRef<number | null>(null);
  const timelineRef = useRef<TimelineState | null>(null);

  const clearTimer = () => {
    if (commandTimerRef.current != null) {
      clearTimeout(commandTimerRef.current);
      commandTimerRef.current = null;
    }
  };

  const updateTimelineForPlay = (effectiveTime: number, positionSec: number) => {
    timelineRef.current = {
      isPlaying: true,
      startServerTime: effectiveTime,
      startPositionSec: positionSec,
    };
  };

  const updateTimelineForPause = (effectiveTime: number) => {
    const tl = timelineRef.current;
    const serverNow = effectiveTime;
    if (!tl) {
      timelineRef.current = {
        isPlaying: false,
        startServerTime: serverNow,
        startPositionSec: 0,
      };
      return;
    }

    if (!tl.isPlaying) return;

    const dtSec = (serverNow - tl.startServerTime) / 1000;
    const pos = tl.startPositionSec + Math.max(0, dtSec);
    timelineRef.current = {
      isPlaying: false,
      startServerTime: serverNow,
      startPositionSec: pos,
    };
  };

  const getExpectedPosition = (serverTimeMs: number): number => {
    const tl = timelineRef.current;
    if (!tl) return 0;

    if (!tl.isPlaying) {
      return tl.startPositionSec;
    }

    const dtSec = (serverTimeMs - tl.startServerTime) / 1000;
    return tl.startPositionSec + Math.max(0, dtSec);
  };

  const applyRemoteCommand = useCallback(
    (cmd: PlaybackCommandPayload) => {
      const audio = audioRef.current;
      if (!audio) return;

      clearTimer();

      const serverNow = getServerTime();
      const baseDelayMs = cmd.effectiveTime - serverNow - outputLatencyMs;
      const lateMs = baseDelayMs < 0 ? -baseDelayMs : 0;
      const delayMs = Math.max(0, baseDelayMs);

      const scheduleAt = (fn: () => void, delay: number) => {
        if (delay <= 0) {
          fn();
          return;
        }
        commandTimerRef.current = window.setTimeout(fn, delay);
      };

      switch (cmd.command) {
        case "play":
        case "seek": {
          const basePosition = cmd.targetPosition ?? audio.currentTime;
          const adjustedPosition = basePosition + lateMs / 1000;

          const run = () => {
            const clampedPos = Math.max(0, adjustedPosition);
            try {
              audio.currentTime = clampedPos;
            } catch {
              // Ignore currentTime errors (e.g., if not seekable yet)
            }
            audio.playbackRate = 1.0;
            void audio.play().catch(() => {
              // Autoplay may still require user gesture; keep state but log silently.
              // Caller can surface UI prompt if needed.
            });
            updateTimelineForPlay(cmd.effectiveTime, clampedPos);
            setState("playing");
          };

          // If command is in the near future, treat as buffering window.
          const totalDelay = Math.max(delayMs, minBufferMs);
          if (delayMs > 0) {
            setState("buffering");
          }
          scheduleAt(run, totalDelay);
          break;
        }

        case "pause": {
          const run = () => {
            audio.pause();
            updateTimelineForPause(cmd.effectiveTime);
            setState("paused");
          };
          scheduleAt(run, delayMs);
          break;
        }
      }
    },
    [audioRef, getServerTime, outputLatencyMs, minBufferMs]
  );

  // Drift correction loop: gently nudge playbackRate toward expected position.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const intervalId = window.setInterval(() => {
      if (!audioRef.current) return;
      const el = audioRef.current;
      if (el.paused) {
        el.playbackRate = 1.0;
        return;
      }

      const serverNow = getServerTime();
      const expectedPos = getExpectedPosition(serverNow);
      const actualPos = el.currentTime;
      const errorSec = expectedPos - actualPos;
      const absErrorSec = Math.abs(errorSec);

      // Within 10ms we consider it perfectly in sync.
      if (absErrorSec < 0.01) {
        el.playbackRate = 1.0;
        return;
      }

      // Map error into a small playbackRate offset within ±0.1%.
      const direction = errorSec > 0 ? 1 : -1;
      const maxRateDelta = 0.001; // ±0.1%
      // Scale correction: full delta when error >= 0.5s, smaller for tiny errors.
      const scale = Math.min(absErrorSec / 0.5, 1);
      const rateDelta = direction * maxRateDelta * scale;

      el.playbackRate = 1.0 + rateDelta;
    }, 1000);

    return () => {
      clearInterval(intervalId);
      if (audioRef.current) {
        audioRef.current.playbackRate = 1.0;
      }
    };
  }, [audioRef, getServerTime]);

  return { state, applyRemoteCommand };
}
