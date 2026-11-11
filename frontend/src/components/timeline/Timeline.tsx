import { visibleWindow } from '../../lib/filters';
import { formatMonthYear, formatPeriod, formatYear } from '../../lib/time';
import { useQuakeStore } from '../../store/useQuakeStore';
import { ChevronIcon, CloseIcon, PlayIcon } from '../ui/icons';
import { Popover } from '../ui/Popover';
import { DateRangeEditor } from './DateRangeEditor';
import { EraInfo } from './EraInfo';
import { PlaybackSettings } from './PlaybackSettings';
import { TimelineTrack } from './TimelineTrack';

/**
 * The one place that controls time: play/pause, the period shown (click it to
 * type a range), the playback window, and the histogram track with range handles.
 */
export function Timeline() {
  const filters = useQuakeStore((s) => s.filters);
  const meta = useQuakeStore((s) => s.meta);
  const playback = useQuakeStore((s) => s.playback);
  const togglePlay = useQuakeStore((s) => s.togglePlay);
  const clearWindow = useQuakeStore((s) => s.clearWindow);
  if (!filters || !meta) return null;

  const [y0, y1] = filters.yearRange;
  const [w0, w1] = visibleWindow(filters, playback);
  const range = y0 === y1 ? formatYear(y0) : `${formatYear(y0)} – ${formatYear(y1)}`;
  let period = range;
  let caption = 'All years in the selected range';
  if (playback.windowEnabled) {
    if (playback.mode === 'cumulative') {
      period = `Up to ${Number.isInteger(w1) ? formatYear(w1 - 1) : formatMonthYear(w1)}`;
      caption = `Accumulating from ${formatYear(y0)}`;
    } else {
      period = formatPeriod(w0, w1);
      caption = `${playback.windowSize}-year window of ${range}`;
    }
  }

  return (
    <section className="panel px-3 pt-2.5 pb-2 sm:px-4" aria-label="Timeline">
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playback.playing ? 'Pause' : 'Play through time'}
          title="Play / pause (Space)"
          className="btn btn-primary h-10 w-10 shrink-0 !rounded-full !p-0"
        >
          <PlayIcon playing={playback.playing} />
        </button>

        <Popover
          label="Choose a date range"
          side="top"
          className="w-[min(22rem,calc(100vw-1.5rem))]"
          trigger={
            <button type="button" className="period-button group min-w-0 text-left" aria-label={`Period ${period}. Change date range`}>
              <span className="tnum flex items-center gap-1.5 truncate text-lg leading-tight font-semibold tracking-tight sm:text-2xl">
                <span className="truncate">{period}</span>
                <span className="shrink-0 text-ink-3 group-hover:text-ink">
                  <ChevronIcon />
                </span>
              </span>
              <span className="tnum block truncate text-[11px] text-ink-3">{caption}</span>
            </button>
          }
        >
          <DateRangeEditor />
        </Popover>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {playback.windowEnabled && (
            <button type="button" className="chip chip-remove" onClick={clearWindow} title="Show every year in the range (Esc)">
              <span className="hidden sm:inline">Show all years</span>
              <span className="sm:hidden">All</span>
              <CloseIcon />
            </button>
          )}
          <PlaybackSettings />
          <EraInfo />
        </div>
      </div>
      <div className="mt-1.5">
        <TimelineTrack />
      </div>
    </section>
  );
}
