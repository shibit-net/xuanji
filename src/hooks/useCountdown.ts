import { useState, useEffect, useRef, useCallback } from 'react';

interface CountdownResult {
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
}

/**
 * Custom hook for countdown timer.
 * Returns { hours, minutes, seconds, isExpired } updated every second.
 * Handles cleanup on unmount and edge case where targetTime is in the past.
 */
export function useCountdown(targetTime: number): CountdownResult {
  const calculateTimeLeft = useCallback((): CountdownResult => {
    const now = Date.now();
    const diff = targetTime - now;

    if (diff <= 0) {
      return { hours: 0, minutes: 0, seconds: 0, isExpired: true };
    }

    const totalSeconds = Math.floor(diff / 1000);
    return {
      hours: Math.floor(totalSeconds / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
      isExpired: false,
    };
  }, [targetTime]);

  const [timeLeft, setTimeLeft] = useState<CountdownResult>(calculateTimeLeft);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Calculate immediately in case targetTime changed
    setTimeLeft(calculateTimeLeft());

    // If already expired, don't start the interval
    if (targetTime <= Date.now()) {
      return;
    }

    intervalRef.current = setInterval(() => {
      const result = calculateTimeLeft();
      setTimeLeft(result);

      // Auto-cleanup interval when expired
      if (result.isExpired && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [targetTime, calculateTimeLeft]);

  return timeLeft;
}
