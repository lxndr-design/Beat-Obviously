import { nanoid } from "nanoid";

export interface LocalCollaborationIdentity {
  actorId: string;
  clientId: string;
  displayName: string;
}

const ACTOR_ID_KEY = "beat.collaboration.actor.v1";
const CLIENT_ID_KEY = "beat.collaboration.client.v1";
const DISPLAY_NAME_KEY = "beat.collaboration.display-name.v1";
let memoryActorId = `local-user-${nanoid()}`;
let memoryClientId = `client-${nanoid()}`;

export function getLocalCollaborationIdentity(): LocalCollaborationIdentity {
  const actorId = readOrCreateStorageId("local", ACTOR_ID_KEY, memoryActorId, (value) => {
    memoryActorId = value;
  });
  const clientId = readOrCreateStorageId("session", CLIENT_ID_KEY, memoryClientId, (value) => {
    memoryClientId = value;
  });
  const displayName = readStorage("local", DISPLAY_NAME_KEY)?.trim() || "Local user";
  return { actorId, clientId, displayName };
}

export function setLocalCollaborationDisplayName(displayName: string): LocalCollaborationIdentity {
  const next = displayName.trim().slice(0, 80) || "Local user";
  writeStorage("local", DISPLAY_NAME_KEY, next);
  return getLocalCollaborationIdentity();
}

function readOrCreateStorageId(
  kind: "local" | "session",
  key: string,
  fallback: string,
  remember: (value: string) => void,
) {
  const existing = readStorage(kind, key)?.trim();
  if (existing) {
    remember(existing);
    return existing;
  }
  writeStorage(kind, key, fallback);
  return fallback;
}

function readStorage(kind: "local" | "session", key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(kind: "local" | "session", key: string, value: string) {
  try {
    if (typeof window === "undefined") return;
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    storage?.setItem(key, value);
  } catch {
    // Memory identity remains valid when storage is unavailable.
  }
}
