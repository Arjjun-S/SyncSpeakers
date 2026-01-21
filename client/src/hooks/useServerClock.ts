import { useCallback, useEffect, useRef, useState } from "react";
import { getWsUrl } from "./useSignaling";

interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

export interface UseServerClockResult {
  /** Estimated offset to add to local Date.now() to get server time (ms). */
  offsetMs: number;
  /** Best-observed round-trip time for sync samples (ms). */
  rttMs: number | null;
  /** Whether we have at least one valid clock sample. */
  ready: boolean;
  /** Get the current estimated server time in ms since epoch. */
  getServerTime: () => number;
}

/**
 * Lightweight NTP-style clock sync using the server's /time endpoint.
 *
 * For each sample:
 *   t0 = client send time (ms)
 *   t3 = client receive time (ms)
 *   Ts = serverTime in response (ms)
 *   RTT = t3 - t0
 *   offset = Ts - (t0 + t3) / 2
 *
 * We keep the sample with the smallest RTT as the current best estimate.
 */
export function useServerClock(
  sampleCount: number = 5,
  refreshIntervalMs: number = 30_000
): UseServerClockResult {
  const [offsetMs, setOffsetMs] = useState(0);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const samplesRef = useRef<ClockSample[]>([]);
  const baseUrlRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // Derive HTTP base URL from WebSocket URL once on mount
  useEffect(() => {
    const wsUrl = getWsUrl();
    let httpUrl = wsUrl;
    if (wsUrl.startsWith("ws://")) {
      httpUrl = wsUrl.replace("ws://", "http://");
    } else if (wsUrl.startsWith("wss://")) {
      httpUrl = wsUrl.replace("wss://", "https://");
    }
    baseUrlRef.current = httpUrl.replace(/\/$/, "");
  }, []);

  const takeSample = useCallback(async () => {
    if (!baseUrlRef.current) return;

    const t0 = Date.now();
    try {
      const res = await fetch(`${baseUrlRef.current}/time`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { serverTime: number };
      const t3 = Date.now();

      const rtt = t3 - t0;
      const mid = (t0 + t3) / 2;
      const offset = data.serverTime - mid;

      const nextSamples = [...samplesRef.current, { offsetMs: offset, rttMs: rtt }];
      // Keep only the most recent 2 * sampleCount samples
      samplesRef.current = nextSamples.slice(-sampleCount * 2);

      // Choose the sample with the smallest RTT as best estimate
      const best = samplesRef.current.reduce<ClockSample | null>((bestSoFar, s) => {
        if (!bestSoFar) return s;
        return s.rttMs < bestSoFar.rttMs ? s : bestSoFar;
      }, null);

      if (best) {
        setOffsetMs(best.offsetMs);
        setRttMs(best.rttMs);
        setReady(true);
      }
    } catch (err) {
      console.warn("Time sync sample failed:", err);
    }
  }, [sampleCount]);

  useEffect(() => {
    // Take an initial burst of samples for a good baseline
    let cancelled = false;

    const runInitial = async () => {
      for (let i = 0; i < sampleCount; i++) {
        if (cancelled) return;
        await takeSample();
        // Small delay between initial samples
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    };

    runInitial();

    // Periodic refresh to correct drift
    timerRef.current = window.setInterval(() => {
      void takeSample();
    }, refreshIntervalMs);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sampleCount, refreshIntervalMs, takeSample]);

  const getServerTime = useCallback(() => {
    return Date.now() + offsetMs;
  }, [offsetMs]);

  return { offsetMs, rttMs, ready, getServerTime };
}
