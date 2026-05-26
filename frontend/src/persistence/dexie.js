import Dexie from "dexie";
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
    projects;
    instruments;
    audioFiles;
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
export async function saveProject(project) {
    await db.projects.put({ ...project, savedAt: Date.now() });
}
export async function loadProject(id) {
    return db.projects.get(id);
}
export async function listProjects() {
    return db.projects.orderBy("savedAt").reverse().toArray();
}
