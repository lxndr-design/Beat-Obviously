import { createSignal } from "solid-js";
import { Icon } from "../Icon";
import { RowActionButton } from "../RowActionButton";
import { RowItem } from "../RowItem";
import { LibraryFolder } from "./LibraryFolder.solid";

export function LibraryFolderDemo() {
  const [open, setOpen] = createSignal(true);
  return (
    <section>
      <h2>Library folder</h2>
      <LibraryFolder
        name="User Patterns"
        count={1}
        open={open()}
        dragMime="application/x-beat-component"
        onToggle={() => setOpen(!open())}
        onDropItem={() => undefined}
        onStartRename={() => undefined}
        onRename={() => undefined}
        onCancelRename={() => undefined}
        onUngroup={() => undefined}
      >
        <RowItem
          density="compact"
          name="Verse Pattern"
          icon={<Icon name="ph:grid-four" size={18} decorative />}
          action={<RowActionButton size="compact" aria-label="Preview"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>}
        />
      </LibraryFolder>
    </section>
  );
}
