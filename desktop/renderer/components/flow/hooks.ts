import { useState, useEffect } from 'react';

export function useRealtimeClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function formatDuration(ms?: number): string {
  if (ms == null || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
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
