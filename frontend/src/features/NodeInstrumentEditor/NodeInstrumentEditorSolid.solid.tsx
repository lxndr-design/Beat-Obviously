/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor, type Setter } from "solid-js";
import { render } from "solid-js/web";
import type {
  Instrument,
  InstrumentNode,
  InstrumentNodeGraph,
  InstrumentNodeKind,
  InstrumentNodeParameterValue,
  InstrumentNodePort,
} from "../../state/types";
import {
  compileNodeGraphToInstrumentPatch,
  createInstrumentNode,
  createOutputOnlyInstrumentNodeGraph,
  nodeDefinition,
  NODE_DEFINITIONS,
  normalizeInstrumentNodeGraph,
  type NodeParameterSpec,
} from "./nodeGraph";
import { NodeCanvasSolid, type NodeCanvasSolidDragCable } from "./NodeCanvasSolid.solid";
import { Button, Icon, NumberInput, TextInput, Toggle } from "../../solid-ui";
import styles from "./NodeInstrumentEditor.module.css";

const NODE_WIDTH = 206;
const CANVAS_WIDTH = 1680;
const CANVAS_HEIGHT = 960;

interface NodeDrag {
  nodeId: string;
  offsetX: number;
  offsetY: number;
}

export interface NodeInstrumentEditorSolidProps {
  instrument: Instrument | null;
  updateInstrument: (id: string, patch: Partial<Instrument>) => void;
}

interface NodeInstrumentEditorSolidInternalProps {
  props: Accessor<NodeInstrumentEditorSolidProps>;
}

export interface MountedNodeInstrumentEditorSolid {
  setProps: Setter<NodeInstrumentEditorSolidProps>;
  dispose: () => void;
}

export function mountNodeInstrumentEditorSolid(
  element: HTMLElement,
  initialProps: NodeInstrumentEditorSolidProps,
): MountedNodeInstrumentEditorSolid {
  const [props, setProps] = createSignal(initialProps, { equals: false });
  const dispose = render(() => <NodeInstrumentEditorSolidView props={props} />, element);
  return { setProps, dispose };
}

export function NodeInstrumentEditorSolid(props: NodeInstrumentEditorSolidProps) {
  return <NodeInstrumentEditorSolidView props={() => props} />;
}

function NodeInstrumentEditorSolidView({ props }: NodeInstrumentEditorSolidInternalProps) {
  let canvasElement: HTMLDivElement | null = null;
  let lastInstrumentId: string | null = null;

  const [graph, setGraph] = createSignal<InstrumentNodeGraph>(
    normalizeInstrumentNodeGraph(props().instrument?.nodeGraph, props().instrument ?? undefined),
    { equals: false },
  );
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [dirty, setDirty] = createSignal(false);
  const [dragCable, setDragCable] = createSignal<NodeCanvasSolidDragCable | null>(null, { equals: false });
  const [nodeDrag, setNodeDrag] = createSignal<NodeDrag | null>(null, { equals: false });

  const selectedNode = createMemo(() => {
    const currentGraph = graph();
    return currentGraph.nodes.find((node) => node.id === selectedNodeId()) ?? currentGraph.nodes[0];
  });

  const canvasState = createMemo(() => ({
    graph: graph(),
    selectedNodeId: selectedNode()?.id ?? null,
    dragCable: dragCable(),
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    onCanvasElement: (element: HTMLDivElement | null) => {
      canvasElement = element;
    },
    onClearSelection: () => setSelectedNodeId(null),
    onSelectNode: setSelectedNodeId,
    onDoubleClickNode: setSelectedNodeId,
    onStartNodeDrag: startNodeDrag,
    onRemoveNode: removeNode,
    onStartCable: startCable,
    onRemoveCable: removeCable,
  }));

  createEffect(() => {
    const instrument = props().instrument;
    const nextId = instrument?.id ?? null;
    if (nextId === lastInstrumentId) return;
    lastInstrumentId = nextId;
    setGraph(normalizeInstrumentNodeGraph(instrument?.nodeGraph, instrument ?? undefined));
    setSelectedNodeId(null);
    setDirty(false);
    setDragCable(null);
    setNodeDrag(null);
  });

  createEffect(() => {
    const activeDragCable = dragCable();
    const activeNodeDrag = nodeDrag();
    if (!activeDragCable && !activeNodeDrag) return;

    const onPointerMove = (event: PointerEvent) => {
      const point = canvasPoint(event);
      if (!point) return;
      const latestCable = dragCable();
      const latestNodeDrag = nodeDrag();
      if (latestCable) {
        setDragCable({ ...latestCable, ...point });
      } else if (latestNodeDrag) {
        patchGraph((current) => ({
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === latestNodeDrag.nodeId
              ? {
                  ...node,
                  x: clamp(point.x - latestNodeDrag.offsetX, 16, CANVAS_WIDTH - NODE_WIDTH - 16),
                  y: clamp(point.y - latestNodeDrag.offsetY, 16, CANVAS_HEIGHT - 160),
                }
              : node,
          ),
        }));
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragCable()) finishCableDrag(event);
      setDragCable(null);
      setNodeDrag(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    onCleanup(() => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    });
  });

  function patchGraph(updater: (current: InstrumentNodeGraph) => InstrumentNodeGraph) {
    setGraph((current) => updater(current));
    setDirty(true);
  }

  function canvasPoint(event: PointerEvent) {
    if (!canvasElement) return null;
    const rect = canvasElement.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, CANVAS_WIDTH),
      y: clamp(event.clientY - rect.top, 0, CANVAS_HEIGHT),
    };
  }

  function addNode(kind: InstrumentNodeKind) {
    const currentGraph = graph();
    const index = currentGraph.nodes.length;
    const node = createInstrumentNode(kind, 180 + (index % 4) * 240, 120 + Math.floor(index / 4) * 180);
    patchGraph((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
  }

  function updateNode(nodeId: string, patch: Partial<InstrumentNode>) {
    patchGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    }));
  }

  function updateParameter(node: InstrumentNode, spec: NodeParameterSpec, value: InstrumentNodeParameterValue) {
    updateNode(node.id, {
      parameters: {
        ...node.parameters,
        [spec.id]: value,
      },
    });
  }

  function removeNode(nodeId: string) {
    patchGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      cables: current.cables.filter((cable) => cable.fromNodeId !== nodeId && cable.toNodeId !== nodeId),
    }));
    if (selectedNodeId() === nodeId) setSelectedNodeId(null);
  }

  function removeCable(cableId: string) {
    patchGraph((current) => ({
      ...current,
      cables: current.cables.filter((cable) => cable.id !== cableId),
    }));
  }

  function startCable(event: PointerEvent, node: InstrumentNode, port: InstrumentNodePort) {
    event.preventDefault();
    event.stopPropagation();
    const position = portPosition(graph(), node.id, port.id, port.kind);
    if (!position) return;
    setSelectedNodeId(node.id);
    setDragCable({
      nodeId: node.id,
      portId: port.id,
      portKind: port.kind,
      signal: port.signal,
      x: position.x,
      y: position.y,
    });
  }

  function finishCableDrag(event: PointerEvent) {
    const activeDragCable = dragCable();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-node-port]");
    if (!target || !activeDragCable) return;
    const targetNodeId = target.dataset.nodeId;
    const targetPortId = target.dataset.portId;
    const targetKind = target.dataset.portKind as "input" | "output" | undefined;
    const targetSignal = target.dataset.signal as "audio" | "control" | undefined;
    if (!targetNodeId || !targetPortId || !targetKind || targetSignal !== activeDragCable.signal || targetKind === activeDragCable.portKind) return;

    const nextCable = activeDragCable.portKind === "output"
      ? {
          id: makeGraphId("cable"),
          fromNodeId: activeDragCable.nodeId,
          fromPortId: activeDragCable.portId,
          toNodeId: targetNodeId,
          toPortId: targetPortId,
        }
      : {
          id: makeGraphId("cable"),
          fromNodeId: targetNodeId,
          fromPortId: targetPortId,
          toNodeId: activeDragCable.nodeId,
          toPortId: activeDragCable.portId,
        };
    if (nextCable.fromNodeId === nextCable.toNodeId) return;
    patchGraph((current) => ({
      ...current,
      cables: cableAlreadyExists(current.cables, nextCable)
        ? current.cables
        : [...current.cables, nextCable],
    }));
  }

  function startNodeDrag(event: PointerEvent, node: InstrumentNode) {
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    if (!point) return;
    setSelectedNodeId(node.id);
    setNodeDrag({ nodeId: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y });
  }

  function saveGraph() {
    const instrument = props().instrument;
    if (!instrument) return;
    const normalized = normalizeInstrumentNodeGraph(graph(), instrument);
    props().updateInstrument(instrument.id, compileNodeGraphToInstrumentPatch(normalized, instrument));
    setGraph(normalized);
    setDirty(false);
  }

  function resetGraph() {
    setGraph(createOutputOnlyInstrumentNodeGraph());
    setDirty(true);
    setSelectedNodeId(null);
  }

  return (
    <Show when={props().instrument} fallback={<div class={styles.empty}>Instrument not found.</div>}>
      {(instrument) => (
        <section class={styles.shell} aria-label="Node instrument editor">
          <header class={styles.toolbar}>
            <div class={styles.identity}>
              <span class={styles.identityMark} aria-hidden="true">
                <Icon name="ph:graph" size={16} decorative />
              </span>
              <div>
                <strong>{instrument().name}</strong>
                <span>{dirty() ? "Unsaved node graph" : "Node graph saved"}</span>
              </div>
            </div>
            <div class={styles.nodePalette} aria-label="Add node">
              <For each={Object.keys(NODE_DEFINITIONS) as InstrumentNodeKind[]}>
                {(kind) => (
                  <Button size="sm" class={styles.nodePaletteButton} onClick={() => addNode(kind)}>
                    <Icon name={NODE_DEFINITIONS[kind].icon} size={14} decorative />
                    {NODE_DEFINITIONS[kind].label}
                  </Button>
                )}
              </For>
            </div>
            <div class={styles.toolbarActions}>
              <Button size="sm" class={styles.nodeActionButton} onClick={resetGraph}>
                Reset
              </Button>
              <Button size="sm" variant="primary" class={`${styles.nodeActionButton} ${styles.primaryActionButton}`} onClick={saveGraph}>
                Apply graph
              </Button>
            </div>
          </header>

          <NodeCanvasSolid state={canvasState} />

          <NodeInspector
            node={selectedNode()}
            onRename={(label) => {
              const node = selectedNode();
              if (node) updateNode(node.id, { label });
            }}
            onParameterChange={updateParameter}
          />
        </section>
      )}
    </Show>
  );
}

interface NodeInspectorProps {
  node?: InstrumentNode;
  onRename: (label: string) => void;
  onParameterChange: (node: InstrumentNode, spec: NodeParameterSpec, value: InstrumentNodeParameterValue) => void;
}

function NodeInspector({ node, onRename, onParameterChange }: NodeInspectorProps) {
  return (
    <Show
      when={node}
      fallback={(
        <footer class={styles.inspector}>
          <span class={styles.inspectorHint}>Select or double-click a node to edit settings.</span>
        </footer>
      )}
    >
      {(selected) => {
        const definition = nodeDefinition(selected().kind);
        return (
          <footer class={styles.inspector}>
            <div class={styles.inspectorTitle}>
              <span class={styles.nodeIcon} aria-hidden="true">
                <Icon name={definition.icon} size={14} decorative />
              </span>
              <TextInput
                class={styles.textField}
                label="Node"
                value={selected().label}
                onInput={(event) => onRename(event.currentTarget.value)}
              />
            </div>
            <div class={styles.parameterGrid}>
              <For each={definition.parameters}>
                {(spec) => (
                  <ParameterControl
                    node={selected()}
                    spec={spec}
                    onChange={(value) => onParameterChange(selected(), spec, value)}
                  />
                )}
              </For>
            </div>
          </footer>
        );
      }}
    </Show>
  );
}

interface ParameterControlProps {
  node: InstrumentNode;
  spec: NodeParameterSpec;
  onChange: (value: InstrumentNodeParameterValue) => void;
}

function ParameterControl({ node, spec, onChange }: ParameterControlProps) {
  const value = () => node.parameters[spec.id] ?? "";
  return (
    <Show
      when={spec.kind === "number"}
      fallback={(
        <Show
          when={spec.kind === "boolean"}
          fallback={(
            <label class={styles.selectField}>
              <span>{spec.label}</span>
              <select value={String(value())} onInput={(event) => onChange(event.currentTarget.value)}>
                <For each={spec.options ?? []}>
                  {(option) => <option value={option.value}>{option.label}</option>}
                </For>
              </select>
            </label>
          )}
        >
          <Toggle
            class={styles.booleanField}
            label={spec.label}
            checked={Boolean(value())}
            onChange={onChange}
          />
        </Show>
      )}
    >
      <NumberInput
        label={spec.label}
        value={typeof value() === "number" ? value() as number : Number(value()) || 0}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        unit={spec.unit}
        onChange={onChange}
      />
    </Show>
  );
}

function portPosition(graph: InstrumentNodeGraph, nodeId: string, portId: string, kind: "input" | "output") {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const ports = kind === "input" ? node.inputs : node.outputs;
  const index = ports.findIndex((port) => port.id === portId);
  if (index < 0) return null;
  return {
    x: node.x + (kind === "input" ? 0 : NODE_WIDTH),
    y: node.y + 62 + index * 26,
  };
}

function makeGraphId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function cableAlreadyExists(
  cables: InstrumentNodeGraph["cables"],
  nextCable: Omit<InstrumentNodeGraph["cables"][number], "id">,
): boolean {
  return cables.some((cable) =>
    cable.fromNodeId === nextCable.fromNodeId
      && cable.fromPortId === nextCable.fromPortId
      && cable.toNodeId === nextCable.toNodeId
      && cable.toPortId === nextCable.toPortId,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
