import * as Dialog from '@radix-ui/react-dialog';
import { EraList } from './timeline/EraInfo';
import { CloseIcon } from './ui/icons';

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play or pause'],
  ['← →', 'Step the playback window back or forward'],
  ['Esc', 'Deselect the earthquake, then show all years'],
];

/** "?" in the header: how to use the app, shortcuts, data caveats and sources. */
export function HelpDialog() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className="btn btn-ghost btn-icon !rounded-full border border-line" aria-label="Help and about" title="Help and about">
          ?
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="dialog" aria-describedby="help-intro">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold">About Quake Atlas</Dialog.Title>
            <Dialog.Close className="btn btn-ghost btn-icon -mt-1 -mr-1" aria-label="Close">
              <CloseIcon />
            </Dialog.Close>
          </div>
          <p id="help-intro" className="mt-1 text-sm text-ink-2">
            Earthquakes from 2150 BCE to today. Each dot is one event: size grows with magnitude, colour shows depth.
          </p>

          <section className="mt-4">
            <h3 className="eyebrow mb-1.5">How to use it</h3>
            <ul className="list-disc space-y-1 pl-4 text-sm text-ink-2">
              <li>
                <span className="text-ink">Timeline</span> (bottom): drag the handles to choose years, click a bar to show that
                period, or press play. Click the period to type exact years.
              </li>
              <li>
                <span className="text-ink">Filters</span> (top left): magnitude, depth, sources and aftershocks. Active
                filters appear as chips; click one to remove it.
              </li>
              <li>
                <span className="text-ink">Click an earthquake</span> for its details, its family of foreshocks and
                aftershocks, and (for big ones) an aftershock forecast.
              </li>
              <li>The address bar always holds the current view, so you can bookmark or share it.</li>
            </ul>
          </section>

          <section className="mt-4">
            <h3 className="eyebrow mb-1.5">Keyboard</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {SHORTCUTS.map(([key, what]) => (
                <div key={key} className="contents">
                  <dt>
                    <kbd className="kbd">{key}</kbd>
                  </dt>
                  <dd className="text-ink-2">{what}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-4">
            <h3 className="eyebrow mb-1.5">How complete is the record?</h3>
            <EraList />
          </section>

          <section className="mt-4 text-xs text-ink-3">
            Data:{' '}
            <a className="link" href="https://earthquake.usgs.gov/fdsnws/event/1/" target="_blank" rel="noreferrer">
              USGS ComCat
            </a>
            ,{' '}
            <a className="link" href="https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/search" target="_blank" rel="noreferrer">
              NOAA NCEI
            </a>
            . Basemap © CARTO, © OpenStreetMap contributors.
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
