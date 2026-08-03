import { nanoid } from "nanoid";
import type { Id } from "../state/types";
import type { SegmentEditCommand } from "../state/store";
import { getLocalCollaborationIdentity } from "./localIdentity";

export interface SegmentEditProjectOperation {
  schemaVersion: 1;
  operationId: Id;
  projectId: Id;
  actorId: Id;
  clientId: Id;
  transactionId: Id;
  lamport: number;
  createdAt: number;
  kind: "segment.edit";
  payload: { command: SegmentEditCommand };
}

export type ProjectOperation = SegmentEditProjectOperation;

const lamports = new Map<Id, number>();
const appliedOperationIds = new Set<Id>();
const observers = new Set<(operation: ProjectOperation) => void>();

/** Allocates every identity needed by a command before it enters the journal. */
export function materializeSegmentEditCommand(command: SegmentEditCommand): SegmentEditCommand {
  if (command.kind === "duplicate" || command.kind === "paste") {
    const supplied = command.createdSegmentIds ?? [];
    return {
      ...command,
      createdSegmentIds: command.segments.map((_, index) => supplied[index] ?? nanoid()),
    };
  }
  if (command.kind === "group") return { ...command, groupId: command.groupId ?? nanoid() };
  if (command.kind === "split") return { ...command, createdSegmentId: command.createdSegmentId ?? nanoid() };
  return structuredClone(command);
}

export function createSegmentEditOperation(projectId: Id, command: SegmentEditCommand): SegmentEditProjectOperation {
  const identity = getLocalCollaborationIdentity();
  const lamport = (lamports.get(projectId) ?? 0) + 1;
  lamports.set(projectId, lamport);
  return {
    schemaVersion: 1,
    operationId: nanoid(),
    projectId,
    actorId: identity.actorId,
    clientId: identity.clientId,
    transactionId: nanoid(),
    lamport,
    createdAt: Date.now(),
    kind: "segment.edit",
    payload: { command: materializeSegmentEditCommand(command) },
  };
}

export function compareProjectOperations(a: ProjectOperation, b: ProjectOperation): number {
  return a.lamport - b.lamport
    || a.actorId.localeCompare(b.actorId)
    || a.operationId.localeCompare(b.operationId);
}

export function hasAppliedProjectOperation(operationId: Id): boolean {
  return appliedOperationIds.has(operationId);
}

export function markProjectOperationApplied(operation: ProjectOperation): void {
  appliedOperationIds.add(operation.operationId);
  lamports.set(operation.projectId, Math.max(lamports.get(operation.projectId) ?? 0, operation.lamport));
}

export function publishProjectOperation(operation: ProjectOperation): void {
  observers.forEach((observer) => observer(operation));
  if (typeof indexedDB === "undefined") return;
  void import("../persistence/dexie")
    .then(({ appendProjectOperation }) => appendProjectOperation(operation))
    .catch(() => undefined);
}

export function subscribeToProjectOperations(observer: (operation: ProjectOperation) => void): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function replayProjectOperations(
  operations: ProjectOperation[],
  apply: (operation: ProjectOperation) => void,
): void {
  for (const operation of [...operations].sort(compareProjectOperations)) {
    if (hasAppliedProjectOperation(operation.operationId)) continue;
    apply(operation);
  }
}

/** Test/logout helper; persisted journal entries are intentionally unaffected. */
export function resetProjectOperationSession(): void {
  lamports.clear();
  appliedOperationIds.clear();
}
