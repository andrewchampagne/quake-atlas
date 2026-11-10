import {
  FlyToInterpolator,
  MapView as DeckMapView,
  type MapViewState,
  type PickingInfo,
} from '@deck.gl/core';
import { DataFilterExtension } from '@deck.gl/extensions';
import { ScatterplotLayer } from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import { useEffect, useMemo, useState } from 'react';
import { Map } from 'react-map-gl/maplibre';
import { FILTER_SIZE } from '../lib/attributes';
import { MAP_CONTROLLER } from '../lib/mapControls';
import { maplibregl } from '../lib/maplibre';
import { gpuFilterRange } from '../lib/filters';
import { magnitudeToRadius, zoomRadiusScale } from '../lib/scales';
import { useQuakeStore, type PinnedEvent } from '../store/useQuakeStore';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const VIEWS = new DeckMapView({ id: 'map', repeat: true });
// Module-level so the extension (and its shaders) are created once.
const FILTER_EXTENSION = new DataFilterExtension({ filterSize: FILTER_SIZE, countItems: true });
const EMPTY_RANGE: [number, number][] = Array.from({ length: FILTER_SIZE }, () => [0, 0]);

type ViewState = MapViewState & {
  transitionDuration?: number | 'auto';
  transitionInterpolator?: FlyToInterpolator;
};

/** Zoom at which the world roughly fills the viewport width (zoom 0 = 512 px wide). */
function fitWorldZoom(): number {
  const width = typeof window === 'undefined' ? 1024 : window.innerWidth;
  return Math.min(1.6, Math.max(0, Math.log2(width / 512) + 0.3));
}

// Centred on the Pacific so the Ring of Fire is in view.
const INITIAL_VIEW: ViewState = {
  longitude: 150,
  latitude: 15,
  zoom: fitWorldZoom(),
  pitch: 0,
  bearing: 0,
  minZoom: 0,
  maxZoom: 13,
};

export function MapView() {
  const events = useQuakeStore((s) => s.events);
  const meta = useQuakeStore((s) => s.meta);
  const filters = useQuakeStore((s) => s.filters);
  const playback = useQuakeStore((s) => s.playback);
  const pinned = useQuakeStore((s) => s.pinned);
  const setHover = useQuakeStore((s) => s.setHover);
  const pin = useQuakeStore((s) => s.pin);
  const setVisibleCount = useQuakeStore((s) => s.setVisibleCount);

  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW);

  // Fly-to requests come from other components through the store.
  useEffect(
    () =>
      useQuakeStore.subscribe((state, prev) => {
        const target = state.flyTarget;
        if (!target || target === prev.flyTarget) return;
        setViewState((vs) => ({
          ...vs,
          longitude: target.longitude,
          latitude: target.latitude,
          zoom: Math.max(vs.zoom, target.zoom),
          transitionDuration: 'auto',
          transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
        }));
      }),
    [],
  );

  // Stable binary data object: attributes upload to the GPU only when the dataset changes.
  const data = useMemo(
    () =>
      events && {
        length: events.length,
        attributes: {
          getPosition: { value: events.positions, size: 2 },
          getRadius: { value: events.radii, size: 1 },
          getFillColor: { value: events.colors, size: 4, normalized: true },
          getFilterValue: { value: events.filterValues, size: FILTER_SIZE },
        },
      },
    [events],
  );

  const filterRange = useMemo(
    () => (filters && meta ? gpuFilterRange(filters, meta, playback) : null),
    [filters, meta, playback],
  );

  const radiusScale = zoomRadiusScale(viewState.zoom);

  const layers = [
    data &&
      new ScatterplotLayer({
        id: 'quakes',
        data,
        radiusUnits: 'pixels',
        radiusScale,
        radiusMinPixels: 0.8,
        radiusMaxPixels: 120,
        filled: true,
        stroked: false,
        opacity: 0.85,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 235],
        visible: filterRange !== null,
        extensions: [FILTER_EXTENSION],
        filterRange: filterRange ?? EMPTY_RANGE,
        onFilteredItemsChange: ({ count }: { count: number }) => setVisibleCount(count),
      }),
    pinned &&
      new ScatterplotLayer<PinnedEvent>({
        id: 'pinned',
        data: [pinned],
        getPosition: (d) => [d.longitude, d.latitude],
        getRadius: (d) => magnitudeToRadius(d.magnitude) + 5,
        radiusUnits: 'pixels',
        radiusScale,
        filled: false,
        stroked: true,
        getLineColor: [255, 255, 255, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        updateTriggers: { getRadius: pinned.rid },
      }),
  ];

  function handleHover(info: PickingInfo) {
    if (info.layer?.id === 'quakes' && info.index >= 0) {
      setHover({ index: info.index, x: info.x, y: info.y });
    } else {
      setHover(null);
    }
  }

  function handleClick(info: PickingInfo) {
    if (events && info.layer?.id === 'quakes' && info.index >= 0) {
      const i = info.index;
      pin({ rid: events.rid[i], longitude: events.lon[i], latitude: events.lat[i], magnitude: events.magnitude[i] });
    } else {
      pin(null);
    }
  }

  return (
    <DeckGL
      views={VIEWS}
      viewState={viewState}
      onViewStateChange={({ viewState: next }) => setViewState(next as ViewState)}
      controller={MAP_CONTROLLER}
      layers={layers}
      onHover={handleHover}
      onClick={handleClick}
      getCursor={({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
      pickingRadius={6}
    >
      <Map reuseMaps mapLib={maplibregl} mapStyle={MAP_STYLE} attributionControl={{ compact: false }} />
    </DeckGL>
  );
}
