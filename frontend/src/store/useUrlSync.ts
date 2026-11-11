/**
 * Two-way sync between the Explore state and the URL hash.
 *
 * - On load (once metadata is ready) and on Back/Forward, the hash is applied.
 * - Afterwards every state change rewrites the hash: selecting an event pushes a
 *   history entry (so Back deselects); everything else replaces the current one.
 * - Nothing is written while playback runs, only once it pauses.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Meta } from '../api/types';
import { clampPlayback } from '../lib/playback';
import { filtersFromUrl, parseHash, serializeHash, urlStateFrom, type View } from '../lib/urlState';
import { useQuakeStore, type QuakeState } from './useQuakeStore';

/** True while a hash is being applied, so the writer doesn't echo it back. */
let applying = false;

export function exploreHash(state: QuakeState): string {
  return serializeHash(
    urlStateFrom({
      view: 'explore',
      filters: state.filters,
      meta: state.meta,
      playback: state.playback,
      event: state.pinned?.rid ?? null,
      tab: state.inspectorTab,
    }),
  );
}

async function applyHash(hash: string, meta: Meta, initial: boolean): Promise<void> {
  const url = parseHash(hash);
  if (url.view !== 'explore') return;
  const store = useQuakeStore.getState();
  applying = true;
  try {
    const filters = filtersFromUrl(url, meta);
    store.setFilters(filters);
    const { filters: applied, playback } = useQuakeStore.getState();
    const next = url.window
      ? {
          ...playback,
          windowEnabled: true,
          playing: false,
          windowStart: url.window.start,
          windowSize: url.window.size,
          mode: url.window.cumulative ? ('cumulative' as const) : ('rolling' as const),
        }
      : { ...playback, windowEnabled: false, playing: false };
    useQuakeStore.setState({ playback: applied ? clampPlayback(next, applied) : next });

    const current = useQuakeStore.getState().pinned?.rid ?? null;
    if (url.event == null) {
      if (current != null) store.pin(null);
    } else if (url.event !== current) {
      await store.select(url.event, { fly: initial });
    }
    useQuakeStore.setState({ inspectorTab: url.event != null ? (url.tab ?? 'details') : 'details' });
  } finally {
    applying = false;
  }
}

/** Keep the Explore view's state and the URL hash in step. */
export function useUrlSync(): void {
  const meta = useQuakeStore((s) => s.meta);

  useEffect(() => {
    if (!meta) return;
    void applyHash(window.location.hash, meta, true);
    const onPop = () => void applyHash(window.location.hash, meta, false);
    window.addEventListener('popstate', onPop);

    let lastRid = useQuakeStore.getState().pinned?.rid ?? null;
    const unsubscribe = useQuakeStore.subscribe((state) => {
      const rid = state.pinned?.rid ?? null;
      if (applying || state.playback.playing) {
        lastRid = rid;
        return;
      }
      const hash = exploreHash(state);
      if (hash !== window.location.hash) {
        if (rid != null && rid !== lastRid) window.history.pushState(null, '', hash);
        else window.history.replaceState(null, '', hash);
      }
      lastRid = rid;
    });
    return () => {
      window.removeEventListener('popstate', onPop);
      unsubscribe();
    };
  }, [meta]);
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

/** The view named by the URL hash (`#/explore` or `#/simulate`). */
export function useHashView(): View {
  return useSyncExternalStore(subscribeHash, () => parseHash(window.location.hash).view, () => 'explore');
}
