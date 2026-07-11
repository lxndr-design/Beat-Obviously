import { createSignal } from "solid-js";
import { LibrarySearch } from "./LibrarySearch.solid";

export function LibrarySearchDemo() {
  const [query, setQuery] = createSignal("");
  return (
    <section>
      <h2>Library search</h2>
      <LibrarySearch value={query()} onInput={(event) => setQuery(event.currentTarget.value)} aria-label="Search library" />
    </section>
  );
}
