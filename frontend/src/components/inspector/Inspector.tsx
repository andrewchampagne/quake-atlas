import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { formatCount, formatMagnitude } from '../../lib/format';
import { PHONE_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { useQuakeStore } from '../../store/useQuakeStore';
import { ChevronIcon, CloseIcon } from '../ui/icons';
import { useEventDetail } from '../useEventDetail';
import { EventPanel } from './EventPanel';
import { OverviewPanel } from './OverviewPanel';
import { useOverviewSummary } from './useOverviewSummary';

function InspectorContent() {
  const pinned = useQuakeStore((s) => s.pinned);
  return pinned ? <EventPanel pinned={pinned} /> : <OverviewPanel />;
}

/** Desktop and tablet: a collapsible column on the right. */
function InspectorColumn() {
  const pinned = useQuakeStore((s) => s.pinned);
  const collapsed = useQuakeStore((s) => s.inspectorCollapsed);
  const setCollapsed = useQuakeStore((s) => s.setInspectorCollapsed);
  if (collapsed) {
    return (
      <button type="button" className="panel pointer-events-auto self-end px-3 py-2 text-xs text-ink-2 hover:text-ink" onClick={() => setCollapsed(false)}>
        <span className="flex items-center gap-1.5">
          <ChevronIcon direction="left" />
          {pinned ? 'Show selected earthquake' : 'Show overview'}
        </span>
      </button>
    );
  }
  return (
    <aside
      aria-label={pinned ? 'Selected earthquake' : 'Overview'}
      className="panel pointer-events-auto relative flex min-h-0 w-full flex-col overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="btn btn-ghost btn-icon absolute top-2 right-2 z-10"
        aria-label="Hide panel"
        title="Hide panel"
      >
        <ChevronIcon direction="right" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        <InspectorContent />
      </div>
    </aside>
  );
}

/** Phones: a peek bar above the timeline that opens a bottom sheet. Selecting a quake opens it. */
function InspectorSheet() {
  const pinned = useQuakeStore((s) => s.pinned);
  const detail = useEventDetail(pinned?.rid ?? null);
  const { summary } = useOverviewSummary();
  const [open, setOpen] = useState(false);
  // Selecting a quake opens the sheet (state adjusted during render, not in an effect).
  const rid = pinned?.rid ?? null;
  const [seenRid, setSeenRid] = useState(rid);
  if (rid !== seenRid) {
    setSeenRid(rid);
    if (rid != null) setOpen(true);
  }

  const peek = pinned
    ? `${formatMagnitude(pinned.magnitude)}${detail?.place ? ` · ${detail.place}` : ''}`
    : `${summary ? formatCount(summary.total) : '—'} earthquakes`;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="panel pointer-events-auto flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm">
          <span className="tnum truncate font-medium">{peek}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-ink-3">
            {pinned ? 'Details' : 'Overview'}
            <ChevronIcon direction="up" />
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          className="sheet"
          aria-describedby={undefined}
          tabIndex={-1}
          // Focus the sheet itself rather than ringing its close button on every open.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
        >
          <Dialog.Title className="sr-only">{pinned ? 'Selected earthquake' : 'Overview'}</Dialog.Title>
          <div className="sheet-grabber" aria-hidden="true" />
          <Dialog.Close className="btn btn-ghost btn-icon absolute top-2 right-2" aria-label="Close">
            <CloseIcon />
          </Dialog.Close>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-6">
            <InspectorContent />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Right-hand "what am I looking at" panel: the overview, or the selected earthquake. */
export function Inspector() {
  const phone = useMediaQuery(PHONE_QUERY);
  return phone ? <InspectorSheet /> : <InspectorColumn />;
}
