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

/** Space toggles playback, Escape unpins (ignored while typing in a control). */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName))) return;
      const state = useQuakeStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        state.togglePlay();
      } else if (e.key === 'Escape') {
        state.pin(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
