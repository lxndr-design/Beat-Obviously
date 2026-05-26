const REGISTRY = [];
export function registerVisualizer(v) {
    if (REGISTRY.some((x) => x.id === v.id))
        return;
    REGISTRY.push(v);
}
export function listVisualizers() {
    return REGISTRY.slice();
}
