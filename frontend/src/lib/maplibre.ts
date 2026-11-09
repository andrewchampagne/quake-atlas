/**
 * MapLibre 6 locates its web worker relative to its own module URL. Vite's
 * dependency pre-bundling (dev) and chunking (build) move that module, so the
 * default worker URL 404s and no basemap renders. Bundle the worker as a proper
 * Vite worker entry and hand MapLibre its URL instead.
 */
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };
