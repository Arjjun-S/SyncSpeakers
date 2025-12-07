import { useCallback, useEffect, useRef, useState } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

interface WakeLockResult {
  mode: "wake-lock" | "keep-alive";
}

export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wantLockRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<WakeLockResult["mode"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nav = navigator as NavigatorWithWakeLock;
    setSupported(Boolean(nav.wakeLock));
  }, []);

  const stopKeepAlive = useCallback(() => {
    if (oscillatorRef.current) {
      oscillatorRef.current.stop();
      oscillatorRef.current.disconnect();
      oscillatorRef.current = null;
    }
    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const startKeepAlive = useCallback(async () => {
    // Tear down any previous graph before creating a new one
    stopKeepAlive();

    audioContextRef.current = new AudioContext();
    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    oscillator.frequency.value = 20; // low freq tick

    const gain = ctx.createGain();
    gain.gain.value = 0.0001; // inaudible but keeps graph alive

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();

    oscillatorRef.current = oscillator;
    gainRef.current = gain;
    setActive(true);
    setMode("keep-alive");
  }, [stopKeepAlive]);

  const releaseWakeLock = useCallback(async () => {
    wantLockRef.current = false;
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch (err) {
        console.warn("Wake Lock release failed", err);
      }
      wakeLockRef.current = null;
    }
    stopKeepAlive();
    setActive(false);
    setMode(null);
  }, [stopKeepAlive]);

  const requestWakeLock = useCallback(async (): Promise<
    WakeLockResult["mode"]
  > => {
    wantLockRef.current = true;
    setError(null);

    // If page is not visible, skip direct request to avoid NotAllowedError.
    if (document.visibilityState !== "visible") {
      setError("Wake lock deferred: page not visible");
      await startKeepAlive();
      return "keep-alive";
    }

    const nav = navigator as NavigatorWithWakeLock;
    if (nav.wakeLock) {
      try {
        const sentinel = await nav.wakeLock.request("screen");
        wakeLockRef.current = sentinel;
        setActive(true);
        setMode("wake-lock");

        const handleRelease = () => {
          setActive(false);
          setMode(null);
          wakeLockRef.current = null;
          if (wantLockRef.current) {
            // Try to reacquire
            requestWakeLock().catch((err) => setError(String(err)));
          }
        };

        sentinel.addEventListener("release", handleRelease);
        return "wake-lock";
      } catch (err) {
        console.warn(
          "Wake Lock request failed, falling back to keep-alive",
          err
        );
        setError((err as Error).message);
      }
    }

    await startKeepAlive();
    return "keep-alive";
  }, [startKeepAlive]);

  useEffect(() => {
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        wantLockRef.current &&
        !wakeLockRef.current
      ) {
        requestWakeLock().catch((err) => setError(String(err)));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [requestWakeLock]);

  return {
    supported,
    active,
    mode,
    error,
    requestWakeLock,
    releaseWakeLock,
  };
}
