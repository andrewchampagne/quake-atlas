import * as Tabs from '@radix-ui/react-tabs';
import { useMemo } from 'react';
import { decodeDeathToll, formatDeathToll } from '../../api/deaths';
import { describeRole, linkExplanation } from '../../lib/family';
import { formatCount, formatDepth, formatLatLon, formatMagnitude } from '../../lib/format';
import type { InspectorTab } from '../../lib/urlState';
import { useQuakeStore, type PinnedEvent } from '../../store/useQuakeStore';
import { AftershockForecast } from '../AftershockForecast';
import { ChevronIcon } from '../ui/icons';
import { useEventDetail } from '../useEventDetail';
import { FamilyTab } from './FamilyTab';

const SOURCE_NAMES: Record<string, string> = {
  usgs: 'USGS ComCat',
  noaa: 'NOAA NCEI Significant Earthquakes',
};

/** The selected earthquake: header, then Details / Family / Forecast tabs. */
export function EventPanel({ pinned }: { pinned: PinnedEvent }) {
  const pin = useQuakeStore((s) => s.pin);
  const flyTo = useQuakeStore((s) => s.flyTo);
  const events = useQuakeStore((s) => s.events);
  const familiesReady = useQuakeStore((s) => s.meta?.families_ready ?? false);
  const storedFamily = useQuakeStore((s) => s.family);
  const familyStatus = useQuakeStore((s) => s.familyStatus);
  const familyError = useQuakeStore((s) => s.familyError);
  const tab = useQuakeStore((s) => s.inspectorTab);
  const setTab = useQuakeStore((s) => s.setInspectorTab);
  const detail = useEventDetail(pinned.rid);

  const family = storedFamily && storedFamily.rid === pinned.rid ? storedFamily : null;
  // While a new event's family loads, keep showing the previous one if it contains this event.
  const shownFamily = family ?? (storedFamily?.members.rid.includes(pinned.rid) ? storedFamily : null);
  const familyLoading = familiesReady && !family && familyStatus === 'loading';
  const hasFamily = Boolean(shownFamily && shownFamily.size > 1);
  const hasForecast = Boolean(shownFamily?.forecast_eligible);
  const available: InspectorTab[] = ['details'];
  if (hasFamily || (familyLoading && tab === 'family')) available.push('family');
  if (hasForecast || (familyLoading && tab === 'forecast')) available.push('forecast');
  const current = available.includes(tab) ? tab : 'details';

  const loadedToll = useMemo(() => {
    const i = events ? events.rid.indexOf(pinned.rid) : -1;
    return i >= 0 ? decodeDeathToll(events?.deaths?.[i]) : {};
  }, [events, pinned.rid]);

  return (
    <div className="flex min-h-0 flex-col">
      {/* Right padding leaves room for the panel's hide/close button. */}
      <div className="mb-2 flex items-center gap-1 pr-8">
        <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => pin(null)} title="Back to the overview (Esc)">
          <ChevronIcon direction="left" />
          All earthquakes
        </button>
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => flyTo(pinned.longitude, pinned.latitude, 5)}>
          Zoom to it
        </button>
      </div>

      <header>
        <div className="tnum text-2xl leading-tight font-semibold tracking-tight">
          {formatMagnitude(detail?.magnitude ?? pinned.magnitude, detail?.mag_type)}
        </div>
        <div className="text-sm text-ink">{detail ? (detail.place ?? 'Unnamed location') : <span className="text-ink-3">Loading…</span>}</div>
        {detail && (
          <div className="tnum text-xs text-ink-2">
            {detail.time_label} · {formatDepth(detail.depth_km)}
          </div>
        )}
        {familiesReady && (
          <p className="mt-1.5 text-xs leading-snug text-ink-2">
            {family ? describeRole(family) : familyStatus === 'error' ? `Family unavailable: ${familyError}` : 'Finding its family…'}
          </p>
        )}
      </header>

      <Tabs.Root value={current} onValueChange={(v) => setTab(v as InspectorTab)} className="mt-3 flex min-h-0 flex-col">
        {available.length > 1 && (
          <Tabs.List className="tabs-list" aria-label="Event information">
            <Tabs.Trigger value="details" className="tabs-trigger">
              Details
            </Tabs.Trigger>
            {available.includes('family') && (
              <Tabs.Trigger value="family" className="tabs-trigger">
                Family{shownFamily && <span className="tnum ml-1 text-ink-3">{formatCount(shownFamily.size)}</span>}
              </Tabs.Trigger>
            )}
            {available.includes('forecast') && (
              <Tabs.Trigger value="forecast" className="tabs-trigger">
                Forecast
              </Tabs.Trigger>
            )}
          </Tabs.List>
        )}

        <Tabs.Content value="details" className="tabs-content">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-ink-3">Recorded deaths</dt>
            <dd className="tnum text-ink">{formatDeathToll(detail ?? loadedToll)}</dd>
            {detail && (
              <>
                <dt className="text-ink-3">Location</dt>
                <dd className="tnum text-ink">{formatLatLon(detail.latitude, detail.longitude)}</dd>
                <dt className="text-ink-3">Source</dt>
                <dd className="text-ink">
                  {SOURCE_NAMES[detail.source] ?? detail.source}
                  <span className="block text-ink-3">{detail.event_id}</span>
                </dd>
              </>
            )}
          </dl>
          {family && !hasFamily && linkExplanation(family) && (
            <p className="mt-3 text-xs leading-snug text-ink-3">{linkExplanation(family)}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {hasFamily && (
              <button type="button" className="btn btn-sm" onClick={() => setTab('family')}>
                Family tree
              </button>
            )}
            {hasForecast && (
              <button type="button" className="btn btn-sm" onClick={() => setTab('forecast')}>
                Aftershock forecast
              </button>
            )}
            {detail?.url && (
              <a href={detail.url} target="_blank" rel="noreferrer noopener" className="btn btn-sm btn-ghost">
                Source page ↗
              </a>
            )}
          </div>
        </Tabs.Content>

        <Tabs.Content value="family" className="tabs-content">
          {shownFamily ? <FamilyTab family={shownFamily} pinnedRid={pinned.rid} /> : <p className="text-xs text-ink-3">Loading family…</p>}
        </Tabs.Content>

        <Tabs.Content value="forecast" className="tabs-content">
          {shownFamily?.mainshock ? (
            <>
              <p className="mb-3 text-xs leading-snug text-ink-2">
                Fit the Omori–Utsu decay law to the first days of the M {shownFamily.mainshock.magnitude.toFixed(1)} sequence,
                then compare its forecast with what the catalog recorded afterwards.
              </p>
              <AftershockForecast mainshockRid={shownFamily.mainshock.rid} />
            </>
          ) : (
            <p className="text-xs text-ink-3">Loading…</p>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
