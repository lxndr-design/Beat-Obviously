/**
 * Visualizer extension interface.
 *
 * Future variants (other shaders, an openFrameworks-backed renderer,
 * particle systems) implement this and register themselves. The active
 * variant is set in user preferences and consumed by the Solid visualizer host.
 */
export interface VisualizerVariant {
  id: string;
  label: string;
  /** Mount the variant into a host element and return a cleanup callback. */
  mount: (host: HTMLElement) => () => void;
}

const REGISTRY: VisualizerVariant[] = [];

export function registerVisualizer(v: VisualizerVariant) {
  if (REGISTRY.some((x) => x.id === v.id)) return;
  REGISTRY.push(v);
}

export function listVisualizers(): VisualizerVariant[] {
  return REGISTRY.slice();
}
