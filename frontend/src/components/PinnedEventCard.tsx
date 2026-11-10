import { useMemo } from 'react';
import { decodeDeathToll, formatDeathToll } from '../api/deaths';
import { formatDepth, formatLatLon, formatMagnitude } from '../lib/format';
import { useQuakeStore } from '../store/useQuakeStore';
import { useEventDetail } from './useEventDetail';

const SOURCE_NAMES: Record<string, string> = {
  usgs: 'USGS ComCat',
  noaa: 'NOAA NCEI Significant Earthquakes',
};

/** Details for the pinned (clicked) event. */
export function PinnedEventCard() {
  const pinned = useQuakeStore((s) => s.pinned);
  const pin = useQuakeStore((s) => s.pin);
  const flyTo = useQuakeStore((s) => s.flyTo);
  const events = useQuakeStore((s) => s.events);
  const detail = useEventDetail(pinned?.rid ?? null);
  const loadedToll = useMemo(() => {
    const index = pinned && events ? events.rid.indexOf(pinned.rid) : -1;
    return index >= 0 ? decodeDeathToll(events?.deaths?.[index]) : {};
  }, [events, pinned]);
  if (!pinned) return null;

  return (
    <section className="panel w-full p-3 text-sm" aria-label="Pinned earthquake">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="eyebrow">Pinned event</div>
          <div className="mt-0.5 text-lg font-semibold">
            {formatMagnitude(detail?.magnitude ?? pinned.magnitude, detail?.mag_type)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => pin(null)}
          className="btn btn-ghost btn-icon"
          aria-label="Unpin event"
        >
          ✕
        </button>
      </div>
      <div className="mt-2 text-xs text-ink-2">
        Recorded deaths: <span className="tnum text-ink">{formatDeathToll(detail ?? loadedToll)}</span>
      </div>
      {detail ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-ink-3">Place</dt>
          <dd className="text-ink">{detail.place ?? 'Unnamed location'}</dd>
          <dt className="text-ink-3">When</dt>
          <dd className="text-ink">{detail.time_label}</dd>
          <dt className="text-ink-3">Depth</dt>
          <dd className="text-ink">{formatDepth(detail.depth_km)}</dd>
          <dt className="text-ink-3">Location</dt>
          <dd className="tnum text-ink">{formatLatLon(detail.latitude, detail.longitude)}</dd>
          <dt className="text-ink-3">Source</dt>
          <dd className="text-ink">
            {SOURCE_NAMES[detail.source] ?? detail.source}
            <span className="text-ink-3"> · {detail.event_id}</span>
          </dd>
        </dl>
      ) : (
        <p className="mt-2 text-xs text-ink-3">Loading details…</p>
      )}
      <div className="mt-3 flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => flyTo(pinned.longitude, pinned.latitude, 5)}
          className="btn btn-sm"
        >
          Zoom to event
        </button>
        {detail?.url && (
          <a
            href={detail.url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-sm btn-ghost"
          >
            Source page ↗
          </a>
        )}
      </div>
    </section>
  );
}
