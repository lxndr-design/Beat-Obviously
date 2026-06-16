import { createStore, type StateCreator, type StoreApi, type StoreMutatorIdentifier } from "zustand/vanilla";

export interface TemporalState<TState> {
  pastStates: TState[];
  futureStates: TState[];
  undo: (steps?: number) => void;
  redo: (steps?: number) => void;
  clear: () => void;
  isTracking: boolean;
  pause: () => void;
  resume: () => void;
  _handleSet: (pastState: TState, replace?: unknown, currentState?: TState, deltaState?: TState | Partial<TState> | null) => void;
}

export interface TemporalStoreApi<TState> extends StoreApi<TState> {
  temporal: StoreApi<TemporalState<TState>>;
}

interface TemporalOptions<TState> {
  limit?: number;
  equality?: (pastState: TState, currentState: TState) => boolean;
  partialize?: (state: TState) => TState;
}

export function temporal<
  TState extends object,
  MutatorsIn extends [StoreMutatorIdentifier, unknown][] = [],
  MutatorsOut extends [StoreMutatorIdentifier, unknown][] = [],
>(
  config: StateCreator<TState, MutatorsIn, MutatorsOut, TState>,
  options: TemporalOptions<TState> = {},
): StateCreator<TState, MutatorsIn, MutatorsOut, TState> {
  return (set, get, store) => {
    const baseSet = set;
    const temporalStore = createStore<TemporalState<TState>>((temporalSet, temporalGet) => ({
      pastStates: [],
      futureStates: [],
      undo: (steps = 1) => {
        const state = temporalGet();
        if (state.pastStates.length === 0) return;
        const currentState = snapshot(get(), options);
        const statesToApply = state.pastStates.slice(-steps);
        const nextState = statesToApply[0];
        if (!nextState) return;
        (baseSet as (state: TState) => void)(nextState);
        temporalSet({
          pastStates: state.pastStates.slice(0, Math.max(0, state.pastStates.length - steps)),
          futureStates: [...state.futureStates, currentState, ...statesToApply.slice(1).reverse()],
        });
      },
      redo: (steps = 1) => {
        const state = temporalGet();
        if (state.futureStates.length === 0) return;
        const currentState = snapshot(get(), options);
        const statesToApply = state.futureStates.slice(-steps);
        const nextState = statesToApply[0];
        if (!nextState) return;
        (baseSet as (state: TState) => void)(nextState);
        temporalSet({
          pastStates: [...state.pastStates, currentState, ...statesToApply.slice(1).reverse()],
          futureStates: state.futureStates.slice(0, Math.max(0, state.futureStates.length - steps)),
        });
      },
      clear: () => temporalSet({ pastStates: [], futureStates: [] }),
      isTracking: true,
      pause: () => temporalSet({ isTracking: false }),
      resume: () => temporalSet({ isTracking: true }),
      _handleSet: (pastState, _replace, currentState = snapshot(get(), options), deltaState) => {
        const state = temporalGet();
        if (!state.isTracking) return;
        if (deltaState === null || options.equality?.(pastState, currentState)) return;
        const nextPast = [...state.pastStates, (deltaState ?? pastState) as TState];
        if (options.limit && nextPast.length > options.limit) {
          nextPast.splice(0, nextPast.length - options.limit);
        }
        temporalSet({ pastStates: nextPast, futureStates: [] });
      },
    }));

    (store as TemporalStoreApi<TState>).temporal = temporalStore;

    const trackedSet = ((...args: Parameters<typeof set>) => {
      const pastState = snapshot(get(), options);
      (baseSet as (...setArgs: Parameters<typeof set>) => void)(...args);
      temporalStore.getState()._handleSet(pastState, undefined, snapshot(get(), options));
    }) as typeof set;

    return config(trackedSet, get, store);
  };
}

function snapshot<TState>(state: TState, options: TemporalOptions<TState>) {
  return options.partialize?.(state) ?? state;
}
