import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import type {
  Instrument,
  InstrumentNode,
  InstrumentNodeCable,
  InstrumentNodeGraph,
  InstrumentNodeKind,
  InstrumentNodeParameterValue,
  InstrumentNodePort,
} from "../../state/types";
import {
  firstInstrumentTaxonomyIdForCategory,
  INSTRUMENT_TAXONOMY_CATEGORY_OPTIONS,
  instrumentTaxonomyOptionsForCategory,
  normalizeInstrumentTaxonomy,
  taxonomyAssignmentForInstrumentId,
} from "../../state/instrumentTaxonomy";
import {
  analyzeInstrumentNodeGraph,
  cableIsValid,
  compileNodeGraphToInstrumentPatch,
  CV_SOURCE_NODE_OPTIONS,
  createInstrumentNode,
  createNodeGraphTemplate,
  isCvSourceNodeKind,
  nodeDefinition,
  NODE_BROWSER_GROUPS,
  NODE_DEFINITIONS,
  NODE_GRAPH_TEMPLATES,
  normalizeInstrumentNodeGraph,
  replaceNodeWithCompatibleKind,
  type CvSourceNodeKind,
  type NodeGraphIssue,
  type NodeGraphTemplateId,
  type NodeParameterSpec,
} from "./nodeGraph";
import { NodeCanvas, type NodeCanvasDragCable } from "./NodeCanvas.solid";
import {
  renderInstrumentOutputWaveformPreview,
  startInstrumentPreviewAudition,
  type InstrumentOutputWaveformPreview,
  type InstrumentPreviewAuditionHandle,
} from "../../audio/synthPreview";
import { Button, FloatingSelect, Icon, Knob, TextInput, Toggle } from "../../solid-ui";
import styles from "./NodeInstrumentEditor.module.css";

const NODE_WIDTH = 206;
const CANVAS_WIDTH = 1680;
const CANVAS_HEIGHT = 960;
const PORT_EDGE_INSET = 0;

interface NodeDrag {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  startGraph: InstrumentNodeGraph;
}

interface DevAddCableDetail {
  fromNodeLabel: string;
  fromPortId: string;
  toNodeLabel: string;
  toPortId: string;
}

interface DevSetParameterDetail {
  nodeLabel: string;
  parameterId: string;
  value: InstrumentNodeParameterValue;
}

export interface NodeInstrumentEditorProps {
  instrument: Instrument | null;
  updateInstrument: (id: string, patch: Partial<Instrument>) => void;
  onSaveInstrument?: (instrument: Instrument) => void;
}

interface NodeInstrumentEditorInternalProps {
  props: Accessor<NodeInstrumentEditorProps>;
}

export function NodeInstrumentEditor(props: NodeInstrumentEditorProps) {
  return <NodeInstrumentEditorView props={() => props} />;
}

function NodeInstrumentEditorView({ props }: NodeInstrumentEditorInternalProps) {
  let canvasElement: HTMLDivElement | null = null;
  let lastInstrumentId: string | null = null;

  const [graph, setGraph] = createSignal<InstrumentNodeGraph>(
    normalizeInstrumentNodeGraph(props().instrument?.nodeGraph, props().instrument ?? undefined),
    { equals: false },
  );
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [selectedCableId, setSelectedCableId] = createSignal<string | null>(null);
  const [dirty, setDirty] = createSignal(false);
  const [dragCable, setDragCable] = createSignal<NodeCanvasDragCable | null>(null, { equals: false });
  const [nodeDrag, setNodeDrag] = createSignal<NodeDrag | null>(null, { equals: false });
  const [undoStack, setUndoStack] = createSignal<InstrumentNodeGraph[]>([], { equals: false });
  const [redoStack, setRedoStack] = createSignal<InstrumentNodeGraph[]>([], { equals: false });
  const [auditioning, setAuditioning] = createSignal(false);
  const [taxonomyCategoryOpen, setTaxonomyCategoryOpen] = createSignal(false);
  const [taxonomyInstrumentOpen, setTaxonomyInstrumentOpen] = createSignal(false);
  let auditionHandle: InstrumentPreviewAuditionHandle | null = null;

  const selectedNode = createMemo(() => {
    const currentGraph = graph();
    const id = selectedNodeId();
    return id ? currentGraph.nodes.find((node) => node.id === id) ?? null : null;
  });
  const outputNode = createMemo(() => graph().nodes.find((node) => node.kind === "output") ?? null);
  const graphIssues = createMemo(() => analyzeInstrumentNodeGraph(graph()));
  const instrumentTaxonomy = createMemo(() => {
    const instrument = props().instrument;
    return instrument
      ? normalizeInstrumentTaxonomy(instrument) ?? taxonomyAssignmentForInstrumentId("modular_synth")
      : taxonomyAssignmentForInstrumentId("modular_synth");
  });
  const audioGraphSnapshot = createMemo((previous?: { key: string; graph: InstrumentNodeGraph }) => {
    const nextGraph = stripNodeGraphLayout(graph());
    const key = JSON.stringify(nextGraph);
    return previous?.key === key ? previous : { key, graph: nextGraph };
  });
  const outputPreviewInstrument = createMemo(() => {
    const instrument = props().instrument;
    if (!instrument) return null;
    const patch = compileNodeGraphToInstrumentPatch(audioGraphSnapshot().graph, instrument);
    if (!patch.synthPatch) return null;
    return { ...instrument, ...patch };
  });
  const outputWaveform = createMemo<InstrumentOutputWaveformPreview | null>(() => {
    const instrument = outputPreviewInstrument();
    if (!instrument) return null;
    try {
      return renderInstrumentOutputWaveformPreview(instrument, 112, 1.1, 120, 104);
    } catch {
      return null;
    }
  });
  const canvasState = createMemo(() => ({
    graph: graph(),
    selectedNodeId: selectedNodeId(),
    selectedCableId: selectedCableId(),
    dragCable: dragCable(),
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    onCanvasElement: (element: HTMLDivElement | null) => {
      canvasElement = element;
    },
    onClearSelection: () => {
      setSelectedNodeId(null);
      setSelectedCableId(null);
    },
    onSelectNode: (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setSelectedCableId(null);
    },
    onSelectCable: (cableId: string) => {
      setSelectedCableId(cableId);
      setSelectedNodeId(null);
    },
    onDoubleClickNode: (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setSelectedCableId(null);
    },
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
    setSelectedCableId(null);
    setUndoStack([]);
    setRedoStack([]);
    stopAudition();
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
        }), { history: false });
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragCable()) finishCableDrag(event);
      const activeNodeDrag = nodeDrag();
      if (activeNodeDrag && graphsDiffer(activeNodeDrag.startGraph, graph())) {
        pushUndo(activeNodeDrag.startGraph);
        setRedoStack([]);
      }
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

  createEffect(() => {
    if (!shouldAcceptNodeEditorDevEvents()) return;
    document.documentElement.dataset.beatNodeEditorGraph = JSON.stringify(graph());
  });

  createEffect(() => {
    const cableId = selectedCableId();
    if (!cableId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();
      removeCable(cableId);
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  createEffect(() => {
    if (!props().instrument) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target && shouldKeepNativeTextUndo(target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        redoGraph();
      } else {
        undoGraph();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, { capture: true }));
  });

  onCleanup(() => {
    stopAudition();
  });

  onMount(() => {
    if (!shouldAcceptNodeEditorDevEvents()) return;
    const onDevAddCable = (event: Event) => {
      const detail = (event as CustomEvent<DevAddCableDetail>).detail;
      if (!detail) return;
      const currentGraph = graph();
      const fromNode = currentGraph.nodes.find((node) => node.label === detail.fromNodeLabel);
      const toNode = currentGraph.nodes.find((node) => node.label === detail.toNodeLabel);
      const fromPort = fromNode?.outputs.find((port) => port.id === detail.fromPortId);
      const toPort = toNode?.inputs.find((port) => port.id === detail.toPortId);
      if (!fromNode || !toNode || !fromPort || !toPort || fromPort.signal !== toPort.signal) return;
      patchGraph((current) => {
        const nextCable = {
          id: makeGraphId("cable"),
          fromNodeId: fromNode.id,
          fromPortId: fromPort.id,
          toNodeId: toNode.id,
          toPortId: toPort.id,
        };
        if (!cableIsValid(current, nextCable)) return current;
        return {
          ...current,
          cables: cableAlreadyExists(current.cables, nextCable)
            ? current.cables
            : [...current.cables, nextCable],
        };
      });
      setSelectedNodeId(fromNode.id);
    };
    const onDevSetParameter = (event: Event) => {
      const detail = (event as CustomEvent<DevSetParameterDetail>).detail;
      if (!detail) return;
      const currentGraph = graph();
      const node = currentGraph.nodes.find((candidate) => candidate.label === detail.nodeLabel);
      const spec = node ? nodeDefinition(node.kind).parameters.find((candidate) => candidate.id === detail.parameterId) : undefined;
      if (!node || !spec) return;
      updateParameter(node, spec, detail.value);
      setSelectedNodeId(node.id);
    };
    document.addEventListener("beat:nodemap-dev-add-cable", onDevAddCable);
    document.addEventListener("beat:nodemap-dev-set-parameter", onDevSetParameter);
    onCleanup(() => {
      document.removeEventListener("beat:nodemap-dev-add-cable", onDevAddCable);
      document.removeEventListener("beat:nodemap-dev-set-parameter", onDevSetParameter);
    });
  });

  function patchGraph(updater: (current: InstrumentNodeGraph) => InstrumentNodeGraph, options: { history?: boolean } = {}) {
    const before = graph();
    const next = normalizeInstrumentNodeGraph(updater(structuredClone(before)), props().instrument ?? undefined);
    if (options.history !== false && graphsDiffer(before, next)) {
      pushUndo(before);
      setRedoStack([]);
    }
    setGraph(next);
    setDirty(true);
  }

  function pushUndo(snapshot: InstrumentNodeGraph) {
    setUndoStack((current) => [...current.slice(-39), structuredClone(snapshot)]);
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
    if (kind === "output") return;
    const currentGraph = graph();
    const index = currentGraph.nodes.length;
    const node = createInstrumentNode(kind, 180 + (index % 4) * 240, 120 + Math.floor(index / 4) * 180);
    patchGraph((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
  }

  function applyTemplate(id: NodeGraphTemplateId) {
    const instrument = props().instrument;
    const next = createNodeGraphTemplate(id, instrument ?? undefined);
    pushUndo(graph());
    setRedoStack([]);
    setGraph(next);
    setSelectedNodeId(next.nodes.find((node) => node.kind !== "output")?.id ?? next.nodes[0]?.id ?? null);
    setDirty(true);
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

  function changeNodeKind(node: InstrumentNode, kind: InstrumentNodeKind) {
    const replacement = replaceNodeWithCompatibleKind(node, kind);
    updateNode(node.id, replacement);
  }

  function removeNode(nodeId: string) {
    const node = graph().nodes.find((candidate) => candidate.id === nodeId);
    if (node?.kind === "output") return;
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
    if (selectedCableId() === cableId) setSelectedCableId(null);
  }

  function startCable(event: PointerEvent, node: InstrumentNode, port: InstrumentNodePort, anchor?: { x: number; y: number }) {
    event.preventDefault();
    event.stopPropagation();
    const position = anchor ?? portPosition(graph(), node.id, port.id, port.kind);
    if (!position) return;
    setSelectedNodeId(node.id);
    setSelectedCableId(null);
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
    let selectedId = nextCable.id;
    patchGraph((current) => {
      const existing = current.cables.find((cable) =>
        cable.fromNodeId === nextCable.fromNodeId
          && cable.fromPortId === nextCable.fromPortId
          && cable.toNodeId === nextCable.toNodeId
          && cable.toPortId === nextCable.toPortId,
      );
      if (existing) {
        selectedId = existing.id;
        return current;
      }
      if (!cableIsValid(current, nextCable)) {
        selectedId = "";
        return current;
      }
      return {
        ...current,
        cables: [...current.cables, nextCable],
      };
    });
    if (selectedId) setSelectedCableId(selectedId);
  }

  function startNodeDrag(event: PointerEvent, node: InstrumentNode) {
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    if (!point) return;
    setSelectedNodeId(node.id);
    setSelectedCableId(null);
    setNodeDrag({ nodeId: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y, startGraph: structuredClone(graph()) });
  }

  function undoGraph() {
    const previous = undoStack().at(-1);
    if (!previous) return;
    setRedoStack((current) => [...current.slice(-39), structuredClone(graph())]);
    setUndoStack((current) => current.slice(0, -1));
    setGraph(structuredClone(previous));
    setDirty(true);
  }

  function redoGraph() {
    const next = redoStack().at(-1);
    if (!next) return;
    setUndoStack((current) => [...current.slice(-39), structuredClone(graph())]);
    setRedoStack((current) => current.slice(0, -1));
    setGraph(structuredClone(next));
    setDirty(true);
  }

  function stopAudition() {
    const handle = auditionHandle;
    auditionHandle = null;
    setAuditioning(false);
    handle?.stop();
  }

  function auditionGraph() {
    if (auditioning()) {
      stopAudition();
      return;
    }
    const instrument = props().instrument;
    if (!instrument) return;
    const patch = compileNodeGraphToInstrumentPatch(normalizeInstrumentNodeGraph(graph(), instrument), instrument);
    if (!patch.synthPatch) return;
    const previewInstrument = { ...instrument, ...patch };
    const handle = startInstrumentPreviewAudition(previewInstrument, 1.8, 0.24, 120, 104, () => {
      if (auditionHandle === handle) {
        auditionHandle = null;
        setAuditioning(false);
      }
    });
    auditionHandle = handle;
    setAuditioning(true);
  }

  function saveGraph() {
    const instrument = props().instrument;
    if (!instrument) return;
    const normalized = normalizeInstrumentNodeGraph(graph(), instrument);
    const patch = compileNodeGraphToInstrumentPatch(normalized, instrument);
    const onSaveInstrument = props().onSaveInstrument;
    if (onSaveInstrument) {
      onSaveInstrument({ ...instrument, ...patch });
    } else {
      props().updateInstrument(instrument.id, patch);
    }
    setGraph(normalized);
    setDirty(false);
  }

  function updateInstrumentName(name: string) {
    const instrument = props().instrument;
    if (!instrument) return;
    props().updateInstrument(instrument.id, { name });
  }

  function setInstrumentTaxonomyById(instrumentId: string) {
    const instrument = props().instrument;
    const taxonomy = taxonomyAssignmentForInstrumentId(instrumentId);
    if (!instrument || !taxonomy) return;
    props().updateInstrument(instrument.id, { taxonomy });
  }

  function setInstrumentTaxonomyCategory(categoryId: string) {
    const firstInstrumentId = firstInstrumentTaxonomyIdForCategory(categoryId);
    if (!firstInstrumentId) return;
    setInstrumentTaxonomyById(firstInstrumentId);
  }

  return (
    <Show when={props().instrument} fallback={<div class={styles.empty}>Instrument not found.</div>}>
      {(instrument) => (
        <section class={styles.shell} aria-label="Node instrument editor">
          <header class={styles.toolbar}>
            <div class={styles.identity}>
              <span class={styles.identityMark} aria-hidden="true">
                <Icon name="ph:graph" size={18} decorative />
              </span>
              <div class={styles.identityText}>
                <strong>Nodemap</strong>
                <span>{dirty() ? "Unsaved graph" : "Graph saved"}</span>
              </div>
              <TextInput
                className={styles.identityField}
                label="Name"
                layout="inline"
                value={instrument().name}
                onInput={(event) => updateInstrumentName(event.currentTarget.value)}
              />
              <FloatingSelect
                label="Category"
                layout="inline"
                className={styles.identitySelect}
                value={instrumentTaxonomy()?.categoryId ?? "synth_electronic"}
                ariaLabel="Nodemap instrument category"
                options={INSTRUMENT_TAXONOMY_CATEGORY_OPTIONS}
                open={taxonomyCategoryOpen()}
                onOpenChange={setTaxonomyCategoryOpen}
                onChange={setInstrumentTaxonomyCategory}
              />
              <FloatingSelect
                label="Instrument"
                layout="inline"
                className={styles.identitySelect}
                value={instrumentTaxonomy()?.instrumentId ?? "modular_synth"}
                ariaLabel="Nodemap instrument taxonomy"
                options={instrumentTaxonomyOptionsForCategory(instrumentTaxonomy()?.categoryId ?? "synth_electronic")}
                open={taxonomyInstrumentOpen()}
                onOpenChange={setTaxonomyInstrumentOpen}
                onChange={setInstrumentTaxonomyById}
              />
              <InstrumentOutWaveform waveform={outputWaveform()} />
            </div>
          </header>

          <div class={styles.workspace}>
            <NodeBrowser onAddNode={addNode} onApplyTemplate={applyTemplate} />
            <NodeCanvas state={canvasState} />
            <NodeDetails
              instrument={instrument()}
              outputNode={outputNode()}
              selectedNode={selectedNode()}
              selectedCableId={selectedCableId()}
              graph={graph()}
              issues={graphIssues()}
              onRenameInstrument={(name) => props().updateInstrument(instrument().id, { name })}
              onRenameNode={(label) => {
                const node = selectedNode();
                if (node) updateNode(node.id, { label });
              }}
              onKindChange={changeNodeKind}
              onParameterChange={updateParameter}
            />
          </div>

          <footer class={`ds-action-footer ${styles.instrumentFooter}`}>
            <div class={styles.footerLeft}>
              <Button className={styles.footerButton} variant="ghost" selected={auditioning()} onClick={auditionGraph}>
                <Icon name={auditioning() ? "ph:stop-fill" : "ph:play-fill"} size={18} decorative />
                {auditioning() ? "Stop" : "Audition"}
              </Button>
            </div>
            <div class={styles.footerRight}>
              <Button className={styles.footerButton} variant="primary" onClick={saveGraph}>
                Save
              </Button>
            </div>
          </footer>
        </section>
      )}
    </Show>
  );
}

function InstrumentOutWaveform(props: { waveform: InstrumentOutputWaveformPreview | null }) {
  const points = createMemo(() => outputWaveformPoints(props.waveform?.peaks ?? []));
  const hasSignal = createMemo(() => (props.waveform?.peak ?? 0) > 0.00001 && points().length > 0);
  return (
    <div
      class={styles.outputWaveform}
      data-output-active={hasSignal() ? "true" : "false"}
      aria-label={hasSignal() ? "Instrument Out waveform preview" : "Instrument Out waveform preview is silent"}
      title={hasSignal() ? "Instrument Out preview" : "Instrument Out is silent"}
    >
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        <Show
          when={hasSignal()}
          fallback={<line class={styles.outputWaveformFlatline} x1="0" y1="14" x2="100" y2="14" />}
        >
          <polygon class={styles.outputWaveformFill} points={outputWaveformFill(points())} />
          <polyline class={styles.outputWaveformTrace} points={points().join(" ")} />
        </Show>
      </svg>
      <span>Out</span>
    </div>
  );
}

function outputWaveformPoints(peaks: number[]) {
  if (peaks.length === 0) return [];
  return peaks.map((peak, index) => {
    const x = peaks.length === 1 ? 50 : (index / (peaks.length - 1)) * 100;
    const y = 14 - clamp(peak, 0, 1) * 11;
    return `${x.toFixed(3)},${y.toFixed(3)}`;
  });
}

function outputWaveformFill(points: string[]) {
  if (points.length === 0) return "";
  const center = points.map((point) => `${point.split(",")[0]},14`);
  return [...center, ...points.slice().reverse()].join(" ");
}

function shouldKeepNativeTextUndo(target: HTMLElement): boolean {
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

function stripNodeGraphLayout(source: InstrumentNodeGraph): InstrumentNodeGraph {
  return {
    ...source,
    nodes: source.nodes.map((node) => ({
      ...node,
      x: 0,
      y: 0,
    })),
  };
}

function NodeBrowser(props: {
  onAddNode: (kind: InstrumentNodeKind) => void;
  onApplyTemplate: (id: NodeGraphTemplateId) => void;
}) {
  const [cvSourceKind, setCvSourceKind] = createSignal<CvSourceNodeKind>("lfo");

  return (
    <aside class={styles.nodeBrowser} aria-label="Node browser">
      <div class={styles.browserSection}>
        <h3>Templates</h3>
        <div class={styles.templateList}>
          <For each={NODE_GRAPH_TEMPLATES}>
            {(template) => (
              <Button
                variant="ghost"
                fullWidth
                className={styles.templateButton}
                onClick={() => props.onApplyTemplate(template.id)}
              >
                <strong>{template.label}</strong>
                <span>{template.description}</span>
              </Button>
            )}
          </For>
        </div>
      </div>
      <For each={NODE_BROWSER_GROUPS}>
        {(group) => (
          <div class={styles.browserSection}>
            <h3>{group.label}</h3>
            <div class={styles.nodePalette} aria-label={`${group.label} nodes`}>
              <Show when={group.id === "sole_cv_out_modulation_sources"}>
                <div class={styles.nodeFamilyPicker}>
                  <FloatingSelect
                    label="CV Source"
                    layout="inline"
                    value={cvSourceKind()}
                    ariaLabel="CV source type"
                    options={CV_SOURCE_NODE_OPTIONS}
                    onChange={(value) => setCvSourceKind(value as CvSourceNodeKind)}
                  />
                  <Button
                    iconOnly
                    size="sm"
                    onClick={() => props.onAddNode(cvSourceKind())}
                    aria-label={`Add ${nodeDefinition(cvSourceKind()).label} CV source`}
                  >
                    <Icon name="ph:plus" size={18} decorative />
                  </Button>
                </div>
              </Show>
              <For each={group.nodeKinds}>
                {(kind) => (
                  <Button size="sm" class={styles.nodePaletteButton} onClick={() => props.onAddNode(kind)}>
                    <Icon name={NODE_DEFINITIONS[kind].icon} size={18} decorative />
                    {NODE_DEFINITIONS[kind].label}
                  </Button>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </aside>
  );
}

function NodeDetails(props: {
  instrument: Instrument;
  outputNode: InstrumentNode | null;
  selectedNode: InstrumentNode | null;
  selectedCableId: string | null;
  graph: InstrumentNodeGraph;
  issues: NodeGraphIssue[];
  onRenameInstrument: (name: string) => void;
  onRenameNode: (label: string) => void;
  onKindChange: (node: InstrumentNode, kind: InstrumentNodeKind) => void;
  onParameterChange: (node: InstrumentNode, spec: NodeParameterSpec, value: InstrumentNodeParameterValue) => void;
}) {
  const selectedDefinition = createMemo(() => props.selectedNode ? nodeDefinition(props.selectedNode.kind) : null);
  const selectedCable = createMemo(() => props.selectedCableId
    ? props.graph.cables.find((cable) => cable.id === props.selectedCableId) ?? null
    : null);
  return (
    <aside class={styles.details} aria-label="Node graph details">
      <div class={styles.detailsSection}>
        <Show
          when={props.selectedNode}
          fallback={(
            <Show
              when={selectedCable()}
              fallback={(
                <>
                  <h3>No node selected</h3>
                  <p>Select a node to inspect ports, connections, and parameters.</p>
                </>
              )}
            >
              {(cable) => <CableDetails graph={props.graph} cable={cable()} />}
            </Show>
          )}
        >
          {(node) => (
            <>
              <div class={styles.nodeDetailTitle}>
                <span class={styles.nodeIcon} aria-hidden="true">
                  <Icon name={selectedDefinition()?.icon ?? "ph:graph"} size={18} decorative />
                </span>
                <TextInput
                  class={styles.detailTextField}
                  label="Node"
                  value={node().label}
                  onInput={(event) => props.onRenameNode(event.currentTarget.value)}
                />
              </div>
              <p>{selectedDefinition()?.description}</p>
              <Show when={isCvSourceNodeKind(node().kind)}>
                <FloatingSelect
                  label="CV Type"
                  layout="inline"
                  value={node().kind}
                  ariaLabel="Selected node CV type"
                  options={CV_SOURCE_NODE_OPTIONS}
                  onChange={(value) => props.onKindChange(node(), value as CvSourceNodeKind)}
                />
              </Show>
            </>
          )}
        </Show>
      </div>
      <div class={styles.detailsSection}>
        <h3>Parameters</h3>
        <Show when={props.selectedNode} fallback={<p>Parameters appear here after selecting a node.</p>}>
          {(node) => (
            <div class={styles.sideParameterGrid}>
              <For each={selectedDefinition()?.parameters ?? []}>
                {(spec) => (
                  <ParameterControl
                    node={node()}
                    spec={spec}
                    onChange={(value) => props.onParameterChange(node(), spec, value)}
                  />
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
      <div class={styles.detailsSection}>
        <h3>Inputs / Outputs</h3>
        <Show when={props.selectedNode} fallback={<p>No selected node ports.</p>}>
          {(node) => <PortDetails graph={props.graph} node={node()} />}
        </Show>
      </div>
      <div class={styles.detailsSection}>
        <h3>Instrument Out</h3>
        <p>
          {props.outputNode
            ? "Audio signal must reach Instrument Out to make sound. Control/CV signal only modulates inputs and never reaches the final audio output directly."
            : "No Instrument Out exists. The graph will be silent until the required output node is restored."}
        </p>
      </div>
      <div class={styles.detailsSection}>
        <h3>Warnings</h3>
        <Show when={props.issues.length > 0} fallback={<p>No graph warnings.</p>}>
          <ul class={styles.issueList}>
            <For each={props.issues}>
              {(issue) => (
                <li>
                  <Icon name="ph:warning" size={18} decorative />
                  <span>{issue.message}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </aside>
  );
}

function CableDetails(props: { graph: InstrumentNodeGraph; cable: InstrumentNodeCable }) {
  const from = () => findCablePort(props.graph, props.cable, "from");
  const to = () => findCablePort(props.graph, props.cable, "to");
  const signal = () => from()?.port.signal ?? to()?.port.signal ?? "audio";
  return (
    <>
      <h3>Selected cable</h3>
      <p>{signalSummary(signal())}</p>
      <dl class={styles.connectionSummary}>
        <dt>From</dt>
        <dd>{from() ? `${from()!.node.label} / ${from()!.port.label}` : "Missing source"}</dd>
        <dt>To</dt>
        <dd>{to() ? `${to()!.node.label} / ${to()!.port.label}` : "Missing destination"}</dd>
      </dl>
      <p>Press Delete to remove this cable. Double-click the cable to remove it immediately.</p>
    </>
  );
}

function PortDetails(props: { graph: InstrumentNodeGraph; node: InstrumentNode }) {
  return (
    <div class={styles.portDetails}>
      <PortDetailGroup title="Inputs" ports={props.node.inputs} graph={props.graph} node={props.node} />
      <PortDetailGroup title="Outputs" ports={props.node.outputs} graph={props.graph} node={props.node} />
    </div>
  );
}

function PortDetailGroup(props: {
  title: string;
  ports: InstrumentNodePort[];
  graph: InstrumentNodeGraph;
  node: InstrumentNode;
}) {
  const portKind = () => props.title === "Inputs" ? "input" : "output";
  return (
    <section class={styles.portDetailGroup} data-port-kind={portKind()}>
      <h4 class={styles.portDetailGroupTitle}>
        <Icon name={portKind() === "input" ? "ph:arrow-square-in" : "ph:arrow-square-out"} size={18} decorative />
        <span>{props.title}</span>
      </h4>
      <Show when={props.ports.length > 0} fallback={<p>None.</p>}>
        <For each={props.ports}>
          {(port) => {
            const connections = () => portConnections(props.graph, props.node, port);
            return (
              <div class={styles.portDetailRow}>
                <div class={styles.portDetailHeader}>
                  <Icon name={portSignalIcon(port.signal)} size={18} decorative />
                  <strong>{port.label}</strong>
                </div>
                <div class={styles.portDetailBody}>
                  <span>{signalSummary(port.signal)}</span>
                  <Show when={connections().length > 0} fallback={<small>Unconnected.</small>}>
                    <ul>
                      <For each={connections()}>
                        {(connection) => <li>{connection}</li>}
                      </For>
                    </ul>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </Show>
    </section>
  );
}

function portSignalIcon(signal: InstrumentNodePort["signal"]): string {
  return signal === "audio" ? "ph:waveform" : "ph:activity";
}

interface ParameterControlProps {
  node: InstrumentNode;
  spec: NodeParameterSpec;
  onChange: (value: InstrumentNodeParameterValue) => void;
}

function ParameterControl(props: ParameterControlProps) {
  const value = () => props.node.parameters[props.spec.id] ?? "";
  return (
    <Show
      when={props.spec.kind === "number"}
      fallback={(
        <Show
          when={props.spec.kind === "boolean"}
          fallback={(
            <FloatingSelect
              className={styles.selectField}
              label={props.spec.label}
              layout="inline"
              value={String(value())}
              options={props.spec.options ?? []}
              onChange={props.onChange}
            />
          )}
        >
          <Toggle
            class={styles.booleanField}
            label={props.spec.label}
            checked={Boolean(value())}
            onChange={props.onChange}
          />
        </Show>
      )}
    >
      <Knob
        className={styles.parameterKnob}
        size="sm"
        label={props.spec.label}
        value={typeof value() === "number" ? value() as number : Number(value()) || 0}
        min={props.spec.min ?? 0}
        max={props.spec.max ?? 1}
        step={props.spec.step}
        bipolar={(props.spec.min ?? 0) < 0}
        defaultValue={defaultParameterValue(props.spec)}
        unit={props.spec.unit}
        onChange={props.onChange}
      />
    </Show>
  );
}

function defaultParameterValue(spec: NodeParameterSpec): number {
  if ((spec.min ?? 0) < 0 && (spec.max ?? 1) > 0) return 0;
  return spec.min ?? 0;
}

function portPosition(graph: InstrumentNodeGraph, nodeId: string, portId: string, kind: "input" | "output") {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const ports = kind === "input" ? node.inputs : node.outputs;
  const index = ports.findIndex((port) => port.id === portId);
  if (index < 0) return null;
  return {
    x: node.x + (kind === "input" ? PORT_EDGE_INSET : NODE_WIDTH - PORT_EDGE_INSET),
    y: node.y + 62 + index * 26,
  };
}

function findCablePort(
  graph: InstrumentNodeGraph,
  cable: InstrumentNodeCable,
  side: "from" | "to",
): { node: InstrumentNode; port: InstrumentNodePort } | null {
  const nodeId = side === "from" ? cable.fromNodeId : cable.toNodeId;
  const portId = side === "from" ? cable.fromPortId : cable.toPortId;
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const port = node
    ? (side === "from" ? node.outputs : node.inputs).find((candidate) => candidate.id === portId)
    : undefined;
  return node && port ? { node, port } : null;
}

function portConnections(graph: InstrumentNodeGraph, node: InstrumentNode, port: InstrumentNodePort): string[] {
  return graph.cables
    .map((cable) => {
      const matchesOutput = port.kind === "output" && cable.fromNodeId === node.id && cable.fromPortId === port.id;
      const matchesInput = port.kind === "input" && cable.toNodeId === node.id && cable.toPortId === port.id;
      if (!matchesOutput && !matchesInput) return null;
      const other = matchesOutput ? findCablePort(graph, cable, "to") : findCablePort(graph, cable, "from");
      if (!other) return matchesOutput ? "Missing destination" : "Missing source";
      return matchesOutput
        ? `To ${other.node.label} / ${other.port.label}`
        : `From ${other.node.label} / ${other.port.label}`;
    })
    .filter((label): label is string => Boolean(label));
}

function signalSummary(signal: InstrumentNodePort["signal"]): string {
  return signal === "audio"
    ? "Audio: sound-rate signal that can reach Instrument Out."
    : "CV: control signal for pitch, level, pan, cutoff, resonance, drive, macros, or other modulation inputs.";
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

function graphsDiffer(a: InstrumentNodeGraph, b: InstrumentNodeGraph): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shouldAcceptNodeEditorDevEvents() {
  return import.meta.env.DEV;
}
