import { createSignal, onCleanup } from "solid-js";

interface SubscribableStore<TState> {
  getState: () => TState;
  subscribe: (listener: (state: TState, previousState: TState) => void) => () => void;
}

export function createStoreSelector<TState, TValue>(
  store: SubscribableStore<TState>,
  selector: (state: TState) => TValue,
  equals: (a: TValue, b: TValue) => boolean = Object.is,
) {
  const [value, setValue] = createSignal(selector(store.getState()), { equals });
  const unsubscribe = store.subscribe((state) => {
    setValue(() => selector(state));
  });
  onCleanup(unsubscribe);
  return value;
}
