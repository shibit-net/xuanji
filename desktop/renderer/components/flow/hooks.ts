import { useState, useEffect } from 'react';

export function useRealtimeClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function formatDuration(ms: number): string {
  const sec = Math.max(0, ms) / 1000;
  return `${sec.toFixed(2)}s`;
}

export function computeLiveDuration(
  evt: { status?: string; duration?: number; startTime?: number },
  now: number,
): number | null {
  if (evt.status === 'running' && evt.startTime) {
    return Math.max(0, now - evt.startTime);
  }
  if (evt.duration != null) return Math.max(0, evt.duration);
  return null;
}
