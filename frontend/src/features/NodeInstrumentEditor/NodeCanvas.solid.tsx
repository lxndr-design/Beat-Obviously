import { createEffect, createMemo, createSignal, For, onCleanup, type Accessor } from "solid-js";
import type {
  InstrumentNode,
  InstrumentNodeCable,
  InstrumentNodeGraph,
  InstrumentNodePort,
} from "../../state/types";
import { inputCanAcceptCable, nodeDefinition } from "./nodeGraph";
import { Button, createContextMenu, Icon } from "../../solid-ui";
import styles from "./NodeInstrumentEditor.module.css";

const NODE_WIDTH = 206;
const NODE_HEADER_HEIGHT = 38;
const PORT_BODY_PADDING_Y = 12;
const PORT_ROW_HEIGHT = 24;
const PORT_ROW_GAP = 8;
const PORT_TOP = NODE_HEADER_HEIGHT + PORT_BODY_PADDING_Y + PORT_ROW_HEIGHT / 2;
const PORT_GAP = PORT_ROW_HEIGHT + PORT_ROW_GAP;
const PORT_EDGE_INSET = 0;

type PortAnchor = { offsetX: number; offsetY: number };
type PortAnchorMap = Map<string, PortAnchor>;

export interface NodeCanvasDragCable {
  nodeId: string;
  portId: string;
  portKind: "input" | "output";
  signal: "audio" | "control";
  x: number;
  y: number;
}

export interface NodeCanvasState {
  graph: InstrumentNodeGraph;
  selectedNodeId: string | null;
  selectedCableId: string | null;
  dragCable: NodeCanvasDragCable | null;
  canvasWidth: number;
  canvasHeight: number;
  onCanvasElement: (element: HTMLDivElement | null) => void;
  onClearSelection: () => void;
  onSelectNode: (nodeId: string) => void;
  onSelectCable: (cableId: string) => void;
  onDoubleClickNode: (nodeId: string) => void;
  onStartNodeDrag: (event: PointerEvent, node: InstrumentNode) => void;
  onRemoveNode: (nodeId: string) => void;
  onStartCable: (event: PointerEvent, node: InstrumentNode, port: InstrumentNodePort, anchor?: { x: number; y: number }) => void;
  onRemoveCable: (cableId: string) => void;
}

interface NodeCanvasProps {
  state: Accessor<NodeCanvasState>;
}

export function NodeCanvas(props: NodeCanvasProps) {
  let canvasElement: HTMLDivElement | undefined;
  let measureFrame: number | null = null;
  const [portAnchors, setPortAnchors] = createSignal<PortAnchorMap>(new Map(), { equals: false });

  const queueMeasure = () => {
    if (measureFrame !== null) cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(() => {
      measureFrame = null;
      const canvas = canvasElement;
      if (!canvas) return;
      const canvasRect = canvas.getBoundingClientRect();
      const next = new Map<string, PortAnchor>();
      for (const dot of canvas.querySelectorAll<HTMLElement>("[data-node-port-dot]")) {
        const port = dot.closest<HTMLElement>("[data-node-port]");
        const nodeId = port?.dataset.nodeId;
        const portId = port?.dataset.portId;
        const portKind = port?.dataset.portKind as "input" | "output" | undefined;
        const node = nodeId ? props.state().graph.nodes.find((candidate) => candidate.id === nodeId) : null;
        if (!node || !portId || !portKind) continue;
        const rect = dot.getBoundingClientRect();
        next.set(portAnchorKey(node.id, portId, portKind), {
          offsetX: rect.left + rect.width / 2 - canvasRect.left - node.x,
          offsetY: rect.top + rect.height / 2 - canvasRect.top - node.y,
        });
      }
      setPortAnchors(next);
    });
  };

  createEffect(() => {
    props.state().graph.nodes;
    props.state().graph.cables;
    props.state().canvasWidth;
    props.state().canvasHeight;
    queueMeasure();
  });

  onCleanup(() => {
    if (measureFrame !== null) cancelAnimationFrame(measureFrame);
  });

  const cablePaths = createMemo(() =>
    props.state().graph.cables
      .map((cable) => {
        const graph = props.state().graph;
        const anchors = portAnchors();
        const from = portPosition(graph, cable.fromNodeId, cable.fromPortId, "output", anchors);
        const to = portPosition(graph, cable.toNodeId, cable.toPortId, "input", anchors);
        if (!from || !to) return null;
        return { cable, from, to, path: cablePath(from.x, from.y, to.x, to.y) };
      })
      .filter((item): item is { cable: InstrumentNodeCable; from: { x: number; y: number }; to: { x: number; y: number }; path: string } => item !== null),
  );

  return (
    <div class={styles.viewport}>
      <div
        ref={(element) => {
          canvasElement = element;
          props.state().onCanvasElement(element);
          queueMeasure();
        }}
        data-node-canvas
        class={styles.canvas}
        style={{ width: `${props.state().canvasWidth}px`, height: `${props.state().canvasHeight}px` }}
        onPointerDown={() => props.state().onClearSelection()}
      >
        <svg class={styles.cables} width={props.state().canvasWidth} height={props.state().canvasHeight} aria-hidden="true">
          <defs>
            <linearGradient id="node-cable-audio" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="var(--node-cable-audio-start)" />
              <stop offset="100%" stop-color="var(--node-cable-audio-end)" />
            </linearGradient>
            <linearGradient id="node-cable-control" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="var(--node-cable-control-start)" />
              <stop offset="100%" stop-color="var(--node-cable-control-end)" />
            </linearGradient>
          </defs>
          <For each={cablePaths()}>
            {({ cable, from, to, path }) => {
              const fromNode = props.state().graph.nodes.find((node) => node.id === cable.fromNodeId);
              const signal = fromNode?.outputs.find((port) => port.id === cable.fromPortId)?.signal ?? "audio";
              return (
                <g class={styles.cableGroup} data-selected={props.state().selectedCableId === cable.id ? "true" : "false"}>
                  <path id={cablePathId(cable.id)} class={styles.cableGuide} d={path} />
                  <path
                    class={styles.cableHitArea}
                    d={path}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      props.state().onSelectCable(cable.id);
                    }}
                    onDblClick={(event) => {
                      event.stopPropagation();
                      props.state().onRemoveCable(cable.id);
                    }}
                  />
                  <path
                    class={styles.cable}
                    data-signal={signal}
                    d={path}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      props.state().onSelectCable(cable.id);
                    }}
                  />
                  <circle class={styles.cableEnd} data-signal={signal} cx={from.x} cy={from.y} r="4" />
                  <circle class={styles.cableEnd} data-signal={signal} cx={to.x} cy={to.y} r="4" />
                  <circle class={styles.cablePulse} data-signal={signal} r="3">
                    <animateMotion dur="2.8s" repeatCount="indefinite" path={path} />
                  </circle>
                </g>
              );
            }}
          </For>
          {props.state().dragCable && (
            <path
              class={styles.draftCable}
              data-signal={props.state().dragCable?.signal}
              d={draftCablePath(props.state().graph, props.state().dragCable, portAnchors())}
            />
          )}
        </svg>

        <For each={props.state().graph.nodes}>
          {(node) => (
            <NodeBlock
              node={node}
              selected={props.state().selectedNodeId === node.id}
              state={props.state}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function NodeBlock(props: {
  node: InstrumentNode;
  selected: boolean;
  state: Accessor<NodeCanvasState>;
}) {
  const definition = nodeDefinition(props.node.kind);
  const customLabel = createMemo(() => {
    const label = props.node.label.trim();
    return label && label !== definition.label ? label : "";
  });
  const contextMenu = createContextMenu(() => [
    {
      label: props.node.kind === "output" ? "Instrument Out is required" : "Delete node",
      icon: props.node.kind === "output" ? "ph:warning" : "ph:trash",
      disabled: props.node.kind === "output",
      onSelect: () => props.state().onRemoveNode(props.node.id),
    },
  ]);
  return (
    <>
      <article
        class={`${styles.node} ${props.selected ? styles.selectedNode : ""} ${props.node.kind === "output" ? styles.outputNode : ""}`}
        data-selected={props.selected ? "true" : "false"}
        data-port-rows={nodePortRowCount(props.node)}
        style={{ transform: `translate(${props.node.x}px, ${props.node.y}px)`, "min-height": `${nodeMinHeight(props.node)}px` }}
        onPointerDown={(event) => {
          event.stopPropagation();
          props.state().onSelectNode(props.node.id);
        }}
        onContextMenu={contextMenu.onContextMenu}
        onDblClick={() => props.state().onDoubleClickNode(props.node.id)}
      >
        <div class={styles.nodeHeader} onPointerDown={(event) => props.state().onStartNodeDrag(event, props.node)}>
          <span class={styles.nodeIcon}>
            <Icon name={definition.icon} size={18} decorative />
          </span>
          <span class={styles.nodeTitle}>
            <strong>{definition.label}</strong>
            {customLabel() && <span class={styles.nodeCustomName}>{customLabel()}</span>}
          </span>
          {props.node.kind !== "output" && (
            <Button
              iconOnly
              size="xs"
              variant="ghost"
              className={styles.removeNode}
              onClick={(event) => {
                event.stopPropagation();
                props.state().onRemoveNode(props.node.id);
              }}
              aria-label={`Remove ${props.node.label}`}
            >
              <Icon name="ph:trash" size={18} decorative />
            </Button>
          )}
        </div>
        <div class={styles.portGrid}>
          <div class={styles.portColumn}>
            <For each={props.node.inputs}>{(port) => <PortButton node={props.node} port={port} state={props.state} />}</For>
          </div>
          <div class={styles.portColumn} data-align="right">
            <For each={props.node.outputs}>{(port) => <PortButton node={props.node} port={port} state={props.state} />}</For>
          </div>
        </div>
      </article>
      {contextMenu.menu()}
    </>
  );
}

function nodePortRowCount(node: InstrumentNode): number {
  return Math.max(1, node.inputs.length, node.outputs.length);
}

function nodeMinHeight(node: InstrumentNode): number {
  const rows = nodePortRowCount(node);
  return NODE_HEADER_HEIGHT
    + PORT_BODY_PADDING_Y * 2
    + rows * PORT_ROW_HEIGHT
    + Math.max(0, rows - 1) * PORT_ROW_GAP;
}

function PortButton({
  node,
  port,
  state,
}: {
  node: InstrumentNode;
  port: InstrumentNodePort;
  state: Accessor<NodeCanvasState>;
}) {
  const compatibility = () => portCompatibility(state().graph, state().dragCable, node, port);
  return (
    <button
      type="button"
      class={styles.port}
      data-node-port
      data-node-id={node.id}
      data-port-id={port.id}
      data-port-kind={port.kind}
      data-signal={port.signal}
      data-kind={port.kind}
      data-connection-state={compatibility()}
      onPointerDown={(event) => state().onStartCable(event, node, port, measuredPortAnchor(event.currentTarget))}
      title={`${port.label} ${port.kind} - ${signalDescription(port.signal)}`}
    >
      <span class={styles.portDot} data-node-port-dot data-signal={port.signal} />
      <span>{port.label}</span>
    </button>
  );
}

function portCompatibility(
  graph: InstrumentNodeGraph,
  drag: NodeCanvasDragCable | null,
  node: InstrumentNode,
  port: InstrumentNodePort,
): "idle" | "origin" | "compatible" | "incompatible" {
  if (!drag) return "idle";
  if (drag.nodeId === node.id && drag.portId === port.id && drag.portKind === port.kind) return "origin";
  if (drag.nodeId === node.id) return "incompatible";
  if (drag.signal !== port.signal) return "incompatible";
  if (drag.portKind === port.kind) return "incompatible";
  const inputNodeId = port.kind === "input" ? node.id : drag.nodeId;
  const inputPortId = port.kind === "input" ? port.id : drag.portId;
  const cablePatch = drag.portKind === "output"
    ? { fromNodeId: drag.nodeId, fromPortId: drag.portId, toNodeId: node.id, toPortId: port.id }
    : { fromNodeId: node.id, fromPortId: port.id, toNodeId: drag.nodeId, toPortId: drag.portId };
  if (!inputCanAcceptCable(graph, inputNodeId, inputPortId, cablePatch)) return "incompatible";
  return "compatible";
}

function signalDescription(signal: InstrumentNodePort["signal"]): string {
  return signal === "audio"
    ? "audio-rate sound signal"
    : "control-voltage modulation signal";
}

function portPosition(graph: InstrumentNodeGraph, nodeId: string, portId: string, kind: "input" | "output", anchors?: PortAnchorMap) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const ports = kind === "input" ? node.inputs : node.outputs;
  const index = ports.findIndex((port) => port.id === portId);
  if (index < 0) return null;
  const anchor = anchors?.get(portAnchorKey(nodeId, portId, kind));
  if (anchor) {
    return {
      x: node.x + anchor.offsetX,
      y: node.y + anchor.offsetY,
    };
  }
  return {
    x: node.x + (kind === "input" ? PORT_EDGE_INSET : NODE_WIDTH - PORT_EDGE_INSET),
    y: node.y + PORT_TOP + index * PORT_GAP,
  };
}

function draftCablePath(graph: InstrumentNodeGraph, drag: NodeCanvasDragCable | null, anchors?: PortAnchorMap): string {
  if (!drag) return "";
  const from = portPosition(graph, drag.nodeId, drag.portId, drag.portKind, anchors);
  if (!from) return "";
  return drag.portKind === "output"
    ? cablePath(from.x, from.y, drag.x, drag.y)
    : cablePath(drag.x, drag.y, from.x, from.y);
}

function cablePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const isDirectRun = dx > 0 && Math.abs(dy) < 5;
  if (isDirectRun) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const absDx = Math.abs(dx);
  const minHandle = dx > 0 ? Math.min(24, absDx / 2) : 32;
  const maxHandle = dx > 0 ? Math.max(12, absDx / 2) : 88;
  const handle = Math.min(maxHandle, Math.max(minHandle, absDx * 0.42));
  return `M ${x1} ${y1} C ${x1 + handle} ${y1}, ${x2 - handle} ${y2}, ${x2} ${y2}`;
}

function cablePathId(id: string): string {
  return `node-cable-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function portAnchorKey(nodeId: string, portId: string, kind: "input" | "output"): string {
  return `${nodeId}:${kind}:${portId}`;
}

function measuredPortAnchor(portElement: HTMLElement): { x: number; y: number } | undefined {
  const canvas = portElement.closest<HTMLElement>("[data-node-canvas]");
  const dot = portElement.querySelector<HTMLElement>("[data-node-port-dot]");
  if (!canvas || !dot) return undefined;
  const canvasRect = canvas.getBoundingClientRect();
  const dotRect = dot.getBoundingClientRect();
  return {
    x: dotRect.left + dotRect.width / 2 - canvasRect.left,
    y: dotRect.top + dotRect.height / 2 - canvasRect.top,
  };
}
