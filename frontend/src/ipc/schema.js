/**
 * IPC schema — JS ↔ C++ message contract.
 *
 * IMPORTANT: keep this in sync with `backend/Source/Ipc/Schema.h`. The two
 * sides exchange JSON-encoded payloads keyed by the request `kind`. If you
 * add/change a kind here, mirror it there.
 */
export {};
