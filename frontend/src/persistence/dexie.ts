import Dexie, { type Table } from "dexie";
import type { AudioFile, Instrument, Project } from "../state/types";

/**
 * Dexie/IndexedDB schema.
 *
 * Local cache mirror of project data. The authoritative source is SQLite
 * on the backend (via the JUCE IPC bridge). Dexie holds:
 *  - recent projects for offline / instant-load
 *  - the user-built instrument library
 *  - cached audio file metadata
 *
 * The backend can push deltas via IPC; the frontend writes through here
 * and the bridge replicates to SQLite. See ipc/bridge.ts for the channel.
 */
export class BeatDB extends Dexie {
  projects!: Table<Project, string>;
  instruments!: Table<Instrument, string>;
  audioFiles!: Table<AudioFile, string>;

  constructor() {
    super("beat");
    this.version(1).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated",
      audioFiles: "id, name, path",
    });
  }
}

export const db = new BeatDB();

export async function saveProject(project: Project) {
  await db.projects.put({ ...project, savedAt: Date.now() });
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

export async function listProjects(): Promise<Project[]> {
  return db.projects.orderBy("savedAt").reverse().toArray();
}
