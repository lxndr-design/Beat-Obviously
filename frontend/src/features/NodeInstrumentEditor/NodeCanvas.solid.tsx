import { createMemo, For, type Accessor } from "solid-js";
import type {
  InstrumentNode,
  InstrumentNodeCable,
  InstrumentNodeGraph,
  InstrumentNodePort,
} from "../../state/types";
import { nodeDefinition } from "./nodeGraph";
import styles from "./NodeInstrumentEditor.module.css";

const NODE_WIDTH = 206;
const PORT_TOP = 62;
const PORT_GAP = 26;

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
  dragCable: NodeCanvasDragCable | null;
  canvasWidth: number;
  canvasHeight: number;
  onCanvasElement: (element: HTMLDivElement | null) => void;
  onClearSelection: () => void;
  onSelectNode: (nodeId: string) => void;
  onDoubleClickNode: (nodeId: string) => void;
  onStartNodeDrag: (event: PointerEvent, node: InstrumentNode) => void;
  onRemoveNode: (nodeId: string) => void;
  onStartCable: (event: PointerEvent, node: InstrumentNode, port: InstrumentNodePort) => void;
  onRemoveCable: (cableId: string) => void;
}

interface NodeCanvasProps {
  state: Accessor<NodeCanvasState>;
}

export function NodeCanvas(props: NodeCanvasProps) {
  const cablePaths = createMemo(() =>
    props.state().graph.cables
      .map((cable) => {
        const graph = props.state().graph;
        const from = portPosition(graph, cable.fromNodeId, cable.fromPortId, "output");
        const to = portPosition(graph, cable.toNodeId, cable.toPortId, "input");
        if (!from || !to) return null;
        return { cable, path: cablePath(from.x, from.y, to.x, to.y) };
      })
      .filter((item): item is { cable: InstrumentNodeCable; path: string } => item !== null),
  );

  return (
    <div class={styles.viewport}>
      <div
        ref={(element) => props.state().onCanvasElement(element)}
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
            {({ cable, path }) => {
              const fromNode = props.state().graph.nodes.find((node) => node.id === cable.fromNodeId);
              const signal = fromNode?.outputs.find((port) => port.id === cable.fromPortId)?.signal ?? "audio";
              return (
                <g>
                  <path class={styles.cableHitArea} d={path} onClick={() => props.state().onRemoveCable(cable.id)} />
                  <path
                    class={styles.cable}
                    data-signal={signal}
                    d={path}
                    onClick={() => props.state().onRemoveCable(cable.id)}
                  />
                </g>
              );
            }}
          </For>
          {props.state().dragCable && (
            <path
              class={styles.draftCable}
              data-signal={props.state().dragCable?.signal}
              d={draftCablePath(props.state().graph, props.state().dragCable)}
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

function NodeBlock({
  node,
  selected,
  state,
}: {
  node: InstrumentNode;
  selected: boolean;
  state: Accessor<NodeCanvasState>;
}) {
  const definition = nodeDefinition(node.kind);
  return (
    <article
      class={`${styles.node} ${selected ? styles.selectedNode : ""}`}
      style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        state().onSelectNode(node.id);
      }}
      onDblClick={() => state().onDoubleClickNode(node.id)}
    >
      <div class={styles.nodeHeader} onPointerDown={(event) => state().onStartNodeDrag(event, node)}>
        <span class={styles.nodeIcon}>{definition.label.slice(0, 1)}</span>
        <strong>{node.label}</strong>
        {node.kind !== "output" && (
          <button
            class={styles.removeNode}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              state().onRemoveNode(node.id);
            }}
            aria-label={`Remove ${node.label}`}
          >
            x
          </button>
        )}
      </div>
      <div class={styles.portGrid}>
        <div class={styles.portColumn}>
          <For each={node.inputs}>{(port) => <PortButton node={node} port={port} state={state} />}</For>
        </div>
        <div class={styles.portColumn} data-align="right">
          <For each={node.outputs}>{(port) => <PortButton node={node} port={port} state={state} />}</For>
        </div>
      </div>
    </article>
  );
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
      onPointerDown={(event) => state().onStartCable(event, node, port)}
      title={`${port.label} ${port.kind}`}
    >
      <span class={styles.portDot} data-signal={port.signal} />
      <span>{port.label}</span>
    </button>
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
    y: node.y + PORT_TOP + index * PORT_GAP,
  };
}

function draftCablePath(graph: InstrumentNodeGraph, drag: NodeCanvasDragCable | null): string {
  if (!drag) return "";
  const from = portPosition(graph, drag.nodeId, drag.portId, drag.portKind);
  if (!from) return "";
  return drag.portKind === "output"
    ? cablePath(from.x, from.y, drag.x, drag.y)
    : cablePath(drag.x, drag.y, from.x, from.y);
}

function cablePath(x1: number, y1: number, x2: number, y2: number): string {
  const handle = Math.max(72, Math.abs(x2 - x1) * 0.42);
  return `M ${x1} ${y1} C ${x1 + handle} ${y1}, ${x2 - handle} ${y2}, ${x2} ${y2}`;
}
