/**
 * Shared deck.gl controller settings for both maps.
 *
 * deck.gl's default wheel zoom (speed 0.01) jumps several zoom levels per
 * notch on many mice and trackpads; 0.003 felt too sluggish. 0.0065 sits
 * halfway between the two, with smoothing for gradual, predictable zooming.
 */
export const SCROLL_ZOOM = { speed: 0.0065, smooth: true } as const;

export const MAP_CONTROLLER = {
  dragRotate: false,
  touchRotate: false,
  doubleClickZoom: true,
  scrollZoom: SCROLL_ZOOM,
} as const;
