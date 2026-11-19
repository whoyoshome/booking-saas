'use client';

import { useEffect, useState } from 'react';

/**
 * Current time as state, refreshed every `intervalMs` so relative labels
 * ("vence en 2 min") and priorities keep moving while the page stays open.
 * With `enabled = false` it stays frozen at the instant of the first render.
 */
export function useNow(intervalMs: number, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);

  return now;
}
