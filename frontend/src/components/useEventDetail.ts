import { useEffect, useState } from 'react';
import { fetchEventDetail } from '../api/client';
import type { EventDetail } from '../api/types';

/**
 * Fetch details for `rid` after `delayMs` (so sweeping the mouse across many
 * points doesn't fire a request per point). Results are memoised in the client.
 */
export function useEventDetail(rid: number | null, delayMs = 0): EventDetail | null {
  const [state, setState] = useState<{ rid: number; detail: EventDetail } | null>(null);
  useEffect(() => {
    if (rid == null) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      fetchEventDetail(rid)
        .then((detail) => !cancelled && setState({ rid, detail }))
        .catch(() => undefined); // details are a nice-to-have; the tooltip still shows core fields
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [rid, delayMs]);
  return state && state.rid === rid ? state.detail : null;
}
