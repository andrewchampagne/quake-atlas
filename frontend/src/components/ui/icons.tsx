/** Small inline icons (16px, currentColor). Decorative: always pair with text or an aria-label. */
const base = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true } as const;

export function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg {...base}>
      <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg {...base}>
      <path d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z" fill="currentColor" />
    </svg>
  );
}

export function FilterIcon() {
  return (
    <svg {...base}>
      <path d="M2 4h12M4.5 8h7M7 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg {...base}>
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path
        d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8 3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg {...base}>
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronIcon({ direction = 'down' }: { direction?: 'down' | 'up' | 'left' | 'right' }) {
  const rotate = { down: 0, up: 180, left: 90, right: -90 }[direction];
  return (
    <svg {...base} style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
