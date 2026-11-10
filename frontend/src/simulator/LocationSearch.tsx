import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { searchPlaces } from './client';
import type { PlaceResult } from './types';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

interface Props {
  /** Text shown before the user types, e.g. the current place's label. */
  initialQuery?: string;
  onSelect: (place: PlaceResult) => void;
}

type Status = 'idle' | 'loading' | 'done' | 'error';

/**
 * Google-Maps-style place search: type-ahead suggestions (debounced), arrow
 * keys to move, Enter to pick, Escape to close. Implements the ARIA combobox
 * pattern so screen readers announce the list.
 */
export function LocationSearch({ initialQuery = '', onSelect }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [typed, setTyped] = useState(false); // only search after the user types, not for the initial label

  useEffect(() => {
    const q = query.trim();
    if (!typed || q.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus('loading');
      searchPlaces(q, controller.signal)
        .then((places) => {
          setResults(places);
          setActive(places.length ? 0 : -1);
          setStatus('done');
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setStatus(err instanceof DOMException && err.name === 'AbortError' ? 'idle' : 'error');
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, typed]);

  function choose(place: PlaceResult) {
    setTyped(false);
    setQuery(place.label);
    setResults([]);
    setOpen(false);
    setStatus('idle');
    onSelect(place);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault(); // never submit the scenario form from the search box
      const pick = results[active] ?? results[0];
      if (pick) choose(pick);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const tooShort = query.trim().length < MIN_CHARS;
  const showList = open && typed && !tooShort;

  return (
    <div className="sim-search">
      <label htmlFor={`${id}-input`}>Search for a place</label>
      <div className="sim-search-box">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="City, region or landmark"
          value={query}
          onChange={(event) => {
            setTyped(true);
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={(event) => {
            event.target.select();
            if (typed) setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {status === 'loading' && <span className="sim-search-spinner" aria-hidden="true" />}
      </div>
      {showList && (
        <ul id={listId} role="listbox" className="sim-search-list" aria-label="Place suggestions">
          {results.map((place, i) => (
            <li
              key={`${place.label}-${i}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(event) => event.preventDefault()} // keep focus so blur doesn't close first
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(place)}
            >
              <span className="sim-search-name">{place.name}</span>
              <span className="sim-search-detail">
                {place.label.split(', ').slice(1).join(', ') || place.kind || 'Place'}
              </span>
            </li>
          ))}
          {status === 'done' && results.length === 0 && <li className="sim-search-empty">No places found.</li>}
          {status === 'error' && <li className="sim-search-empty">Search is unavailable. Click the map or enter coordinates.</li>}
          {results.some((r) => r.source === 'photon') && (
            <li className="sim-search-credit" aria-hidden="true">Search © OpenStreetMap contributors (Photon)</li>
          )}
        </ul>
      )}
    </div>
  );
}
