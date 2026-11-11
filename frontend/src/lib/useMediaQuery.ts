import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query (false where `matchMedia` is unavailable, e.g. tests). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Phones: the inspector becomes a bottom sheet and the chrome compacts. */
export const PHONE_QUERY = '(max-width: 767px)';
