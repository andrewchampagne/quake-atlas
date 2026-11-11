import type { MouseEvent } from 'react';
import SimulatorView from './simulator/SimulatorView';
import { FilterBar } from './components/filters/FilterBar';
import { HelpDialog } from './components/HelpDialog';
import { HoverTooltip } from './components/HoverTooltip';
import { Inspector } from './components/inspector/Inspector';
import { Legend } from './components/Legend';
import { MapView } from './components/MapView';
import { ErrorToast, StartupOverlay, TopProgress } from './components/StatusOverlays';
import { Timeline } from './components/timeline/Timeline';
import { PHONE_QUERY, useMediaQuery } from './lib/useMediaQuery';
import { useDataSync, useFamilySync } from './store/useDataSync';
import { useKeyboardShortcuts, usePlayback } from './store/usePlayback';
import { useQuakeStore } from './store/useQuakeStore';
import { exploreHash, useHashView, useUrlSync } from './store/useUrlSync';

/**
 * Map-first layout: filters top left, the inspector on the right (a bottom
 * sheet on phones), the legend bottom left and the timeline along the bottom.
 */
function ExploreView() {
  useDataSync();
  useFamilySync();
  usePlayback();
  useKeyboardShortcuts();
  useUrlSync();
  const ready = useQuakeStore((s) => s.metaStatus === 'ready');
  const phone = useMediaQuery(PHONE_QUERY);

  return (
    <div className="explore relative h-full w-full overflow-hidden">
      <main className="absolute inset-0" aria-label="Earthquake map">
        <MapView />
      </main>
      <TopProgress />
      {ready && (
        // Overlay grid: everything above the timeline lives in the first row, so
        // panels can never run underneath it. Empty areas let the map take input.
        <div className="pointer-events-none absolute inset-0 z-20 grid grid-rows-[minmax(0,1fr)_auto] gap-3 p-3">
          <div className="relative flex min-h-0 gap-3">
            <div className="flex min-w-0 flex-1 flex-col items-start justify-between gap-2">
              <div className="pointer-events-auto max-w-full">
                <FilterBar />
              </div>
              <div className="flex w-full flex-col items-start gap-2">
                <Legend />
                {phone && (
                  <div className="w-full">
                    <Inspector />
                  </div>
                )}
              </div>
            </div>
            {!phone && (
              <div className="flex min-h-0 w-[var(--inspector-w)] shrink-0 flex-col">
                <Inspector />
              </div>
            )}
          </div>
          <div className="pointer-events-auto">
            <Timeline />
          </div>
        </div>
      )}
      <HoverTooltip />
      <ErrorToast />
      <StartupOverlay />
    </div>
  );
}

const VIEWS = [
  { id: 'explore', label: 'Explore', long: 'Explore history' },
  { id: 'simulate', label: 'Simulate', long: 'Simulator' },
] as const;

export default function App() {
  const view = useHashView();

  const go = (e: MouseEvent<HTMLAnchorElement>, target: 'explore' | 'simulate') => {
    e.preventDefault();
    const state = useQuakeStore.getState();
    useQuakeStore.setState({ playback: { ...state.playback, playing: false } });
    // Returning to Explore restores its filters and selection from the store.
    window.location.hash = target === 'explore' ? exploreHash(state) : '#/simulate';
  };

  return (
    <div className="flex h-full flex-col">
      <header className="z-40 flex shrink-0 items-center justify-between gap-2 border-b border-line bg-panel-solid px-3 py-2 sm:px-4">
        <a href="#/explore" onClick={(e) => go(e, 'explore')} className="truncate text-sm font-semibold tracking-tight">
          Quake Atlas
        </a>
        <div className="flex items-center gap-2">
          <nav aria-label="App views" className="seg">
            {VIEWS.map((item) => (
              <a
                key={item.id}
                href={item.id === 'explore' ? '#/explore' : '#/simulate'}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={(e) => go(e, item.id)}
                className="seg-link"
              >
                <span className="sm:hidden">{item.label}</span>
                <span className="hidden sm:inline">{item.long}</span>
              </a>
            ))}
          </nav>
          <HelpDialog />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">{view === 'explore' ? <ExploreView /> : <SimulatorView />}</div>
    </div>
  );
}
