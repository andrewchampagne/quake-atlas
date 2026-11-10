import { useEffect, useRef, useState, type CSSProperties } from 'react';
import SimulatorView from './simulator/SimulatorView';
import { FilterSidebar } from './components/FilterSidebar';
import { HoverTooltip } from './components/HoverTooltip';
import { Legend } from './components/Legend';
import { MapView } from './components/MapView';
import { PinnedEventCard } from './components/PinnedEventCard';
import { ErrorToast, StartupOverlay, TopProgress } from './components/StatusOverlays';
import { SummaryPanel } from './components/SummaryPanel';
import { TimeControls } from './components/TimeControls';
import { useDataSync } from './store/useDataSync';
import { useKeyboardShortcuts, usePlayback } from './store/usePlayback';
import { useQuakeStore } from './store/useQuakeStore';

/** Height of an element, tracked with ResizeObserver (so panels never overlap the time bar). */
function useElementHeight<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}

function ExploreView() {
  useDataSync();
  usePlayback();
  useKeyboardShortcuts();
  const sidebarOpen = useQuakeStore((s) => s.sidebarOpen);
  const ready = useQuakeStore((s) => s.metaStatus === 'ready');
  const [timeBarRef, timeBarHeight] = useElementHeight<HTMLDivElement>(150);

  const layoutVars = {
    '--sidebar-offset': sidebarOpen ? '21.5rem' : '0.75rem',
    '--timebar-h': `${timeBarHeight}px`,
  } as CSSProperties;

  return (
    <div className="relative h-full w-full" style={layoutVars}>
      <main className="absolute inset-0" aria-label="Earthquake map">
        <MapView />
      </main>
      <TopProgress />
      {ready && (
        <>
          <FilterSidebar />

          {/* Right column: summary shrinks (and scrolls) so the legend always fits above the time bar. */}
          <div className="pointer-events-none fixed top-[4.5rem] right-3 z-10 flex max-h-[calc(100dvh-var(--timebar-h)-6rem)] w-[min(20rem,calc(100vw-8.5rem))] flex-col items-end gap-2 lg:w-80">
            <SummaryPanel />
            <div className="pointer-events-auto shrink-0">
              <Legend />
            </div>
          </div>

          <div className="pointer-events-none fixed right-3 bottom-3 left-3 z-10 flex flex-col gap-2 transition-[left] duration-200 lg:left-[var(--sidebar-offset)]">
            <div className="pointer-events-auto w-full max-w-sm lg:max-w-[calc(100%-21rem)] xl:max-w-sm">
              <PinnedEventCard />
            </div>
            <div ref={timeBarRef} className="pointer-events-auto">
              <TimeControls />
            </div>
          </div>
        </>
      )}
      <HoverTooltip />
      <ErrorToast />
      <StartupOverlay />
    </div>
  );
}


export default function App() {
  const [mode, setMode] = useState<'explore' | 'simulate'>('explore');
  return (
    <div className="flex h-full flex-col">
      <header className="z-40 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel-solid px-4 py-2">
        <span className="text-sm font-semibold tracking-tight">Quake Atlas</span>
        <nav aria-label="App features" className="seg">
          {(['explore', 'simulate'] as const).map((item) => (
            <button key={item} type="button" aria-pressed={mode === item}
              className="!px-3 !py-1 !text-[13px]"
              onClick={() => { useQuakeStore.setState((s) => ({ playback: { ...s.playback, playing: false } })); setMode(item); }}>
              {item === 'explore' ? 'Explore history' : 'Simulator'}
            </button>
          ))}
        </nav>
      </header>
      <div className="relative min-h-0 flex-1">{mode === 'explore' ? <ExploreView /> : <SimulatorView />}</div>
    </div>
  );
}
