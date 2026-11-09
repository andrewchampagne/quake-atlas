import { useQuakeStore } from '../store/useQuakeStore';

/** Thin indeterminate bar at the top while data refetches (the map keeps its frame). */
export function TopProgress() {
  const busy = useQuakeStore(
    (s) => (s.eventsStatus === 'loading' && s.events !== null) || s.summaryStatus === 'loading',
  );
  if (!busy) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden" role="progressbar" aria-label="Loading data">
      <div className="progress-indeterminate h-full w-1/3 bg-accent" />
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Full-screen states before the first data arrives: loading, or a fatal error. */
export function StartupOverlay() {
  const metaStatus = useQuakeStore((s) => s.metaStatus);
  const metaError = useQuakeStore((s) => s.metaError);
  const firstLoad = useQuakeStore((s) => s.events === null && s.eventsStatus !== 'error');
  const retry = useQuakeStore((s) => s.retry);

  if (metaStatus === 'error') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/90 p-4">
        <div className="panel max-w-md p-5" role="alert">
          <h2 className="text-lg font-semibold">Can't load the earthquake catalog</h2>
          <p className="mt-2 text-sm text-ink-2">{metaError}</p>
          <p className="mt-3 text-xs text-ink-3">
            Start the backend with <code className="rounded bg-raised px-1">make dev</code>. If it reports a missing
            dataset, build the sample first with <code className="rounded bg-raised px-1">make sample</code>.
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (metaStatus !== 'ready' || firstLoad) {
    return (
      <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
        <div className="panel flex items-center gap-3 px-4 py-3 text-sm text-ink-2" role="status">
          <Spinner />
          {metaStatus === 'ready' ? 'Loading earthquakes…' : 'Loading catalog…'}
        </div>
      </div>
    );
  }
  return null;
}

/** Non-fatal error for the events request, with a retry. */
export function ErrorToast() {
  const eventsError = useQuakeStore((s) => (s.eventsStatus === 'error' ? s.eventsError : null));
  const retry = useQuakeStore((s) => s.retry);
  if (!eventsError) return null;
  return (
    <div className="fixed top-16 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2" role="alert">
      <div className="panel flex items-center gap-3 border-danger/50 p-3 text-sm">
        <span aria-hidden="true" className="text-danger">
          ●
        </span>
        <span className="flex-1 text-ink">Couldn't load earthquakes: {eventsError}</span>
        <button type="button" onClick={retry} className="rounded-md bg-raised px-2.5 py-1 text-xs hover:bg-line">
          Retry
        </button>
      </div>
    </div>
  );
}
