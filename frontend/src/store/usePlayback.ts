import { useEffect } from 'react';
import { useQuakeStore } from './useQuakeStore';

/** Drive playback with requestAnimationFrame while playing. Only the GPU filter range changes per frame. */
export function usePlayback(): void {
  const playing = useQuakeStore((s) => s.playback.playing);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // clamp after tab switches
      last = now;
      useQuakeStore.getState().tick(dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}

/** A popover or dialog is open; it owns Escape and focus. */
function overlayOpen(): boolean {
  return Boolean(document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]'));
}

/**
 * Space plays/pauses, ←/→ step the playback window, Escape deselects the event
 * (then clears the window). Ignored while typing in a control or with an overlay open.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName))) return;
      if (overlayOpen()) return;
      const state = useQuakeStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        state.togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        state.stepWindow(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'Escape') {
        if (state.pinned) state.pin(null);
        else if (state.playback.windowEnabled) state.clearWindow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
