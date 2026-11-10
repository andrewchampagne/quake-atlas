import { useMemo, useRef, useState } from 'react';
import { FlyToInterpolator, type MapViewState, type PickingInfo } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';
import DeckGL, { type DeckGLRef } from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import { maplibregl } from '../lib/maplibre';
import { MAP_CONTROLLER } from '../lib/mapControls';
import { intensity, wrapLongitude } from './presentation';
import type { ShakingRing, Simulation, SimulationInput } from './types';

interface Props {
  location: Pick<SimulationInput, 'latitude' | 'longitude'> | null;
  result: Simulation | null;
  onPlace: (latitude: number, longitude: number) => void;
}

export default function SimulatorMap({ location, result, onPlace }: Props) {
  const deck = useRef<DeckGLRef>(null);
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  // Deck owns interaction state. A changed initialViewState starts a camera move;
  // unrelated renders keep the same object, preserving the user's pan and zoom.
  const initialViewState = useMemo<MapViewState>(() => ({
    longitude: longitude ?? 138,
    latitude: Math.max(-85, Math.min(85, latitude ?? 35)),
    zoom: 5,
    pitch: 0,
    bearing: 0,
    minZoom: 0,
    maxZoom: 13,
    transitionDuration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
    transitionInterpolator: new FlyToInterpolator(),
  }), [latitude, longitude]);
  const [mapError, setMapError] = useState(false);
  const layers = useMemo(() => {
    const rings = result?.rings.filter((ring) => ring.radius_km > 0).slice().sort((a, b) => b.radius_km - a.radius_km) ?? [];
    return [
      result && new ScatterplotLayer<ShakingRing>({
        id: 'simulator-shaking',
        data: rings,
        getPosition: () => [result.input.longitude, result.input.latitude],
        // Deck projects world-meter radii at the epicenter, rather than drawing degree buffers.
        radiusUnits: 'meters',
        getRadius: (ring) => ring.radius_km * 1000,
        getFillColor: (ring) => [...intensity(ring.mmi).rgb, 28],
        getLineColor: (ring) => [...intensity(ring.mmi).rgb, 190],
        filled: true,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.4,
        pickable: true,
        wrapLongitude: true,
      }),
      location && new ScatterplotLayer({
        id: 'simulator-epicenter',
        data: [location],
        getPosition: (point) => [point.longitude, point.latitude],
        getRadius: 7,
        radiusUnits: 'pixels',
        getFillColor: [237, 237, 237, 255],
        getLineColor: [57, 135, 229, 255],
        getLineWidth: 3,
        lineWidthUnits: 'pixels',
        stroked: true,
        wrapLongitude: true,
      }),
    ];
  }, [location, result]);

  function place(info: PickingInfo) {
    if (!info.coordinate) return;
    const [longitude, latitude] = info.coordinate;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      onPlace(Number(Math.max(-90, Math.min(90, latitude)).toFixed(4)), Number(wrapLongitude(longitude).toFixed(4)));
    }
  }

  function center() {
    if (!location) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    deck.current?.deck?.setProps({ initialViewState: {
      ...initialViewState,
      longitude: location.longitude,
      latitude: Math.max(-85, Math.min(85, location.latitude)),
      zoom: 5,
      transitionDuration: reducedMotion ? 0 : 600,
      transitionInterpolator: new FlyToInterpolator(),
    } });
  }

  return (
    <section className="sim-map" aria-label="Scenario map">
      <DeckGL
        ref={deck}
        initialViewState={initialViewState}
        controller={MAP_CONTROLLER}
        layers={layers}
        onClick={place}
        getCursor={({ isDragging }) => isDragging ? 'grabbing' : 'crosshair'}
        getTooltip={({ object, layer }) => layer?.id === 'simulator-shaking' && object ? {
          text: `MMI ${intensity(object.mmi).roman} · ${intensity(object.mmi).label}\n${object.radius_km.toFixed(1)} km radius`,
          style: { backgroundColor: '#161618', color: '#ededed', fontSize: '12px' },
        } : null}
      >
        <Map
          reuseMaps
          mapLib={maplibregl}
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          attributionControl={{ compact: true }}
          onError={() => setMapError(true)}
          onLoad={() => setMapError(false)}
        />
      </DeckGL>
      <div className="sim-map-top">
        <span className="sim-map-hint">Click the map to place an epicenter</span>
        <button type="button" className="sim-map-center" onClick={center} disabled={!location}>Center on epicenter</button>
      </div>
      {mapError && <p className="sim-map-error" role="status">Some map tiles could not load. You can still enter coordinates and run a scenario.</p>}
      <div className="sim-map-bottom">
        {result ? <>
          <span className="sim-eyebrow">Estimated shaking · MMI</span>
          <div className="sim-ring-legend">
            {result.rings.slice().sort((a, b) => a.mmi - b.mmi).map((ring) => <span key={ring.mmi}>
              <i style={{ background: intensity(ring.mmi).color }} />{intensity(ring.mmi).roman}<small>{ring.radius_km.toFixed(0)} km</small>
            </span>)}
          </div>
          <p>Idealized intensity contours; local ground conditions are not represented.</p>
        </> : <>
          <span className="sim-eyebrow">A hypothetical earthquake</span>
          <p>Set a location, magnitude, and depth. Run the scenario to reveal estimated shaking and city exposure.</p>
        </>}
      </div>
    </section>
  );
}
