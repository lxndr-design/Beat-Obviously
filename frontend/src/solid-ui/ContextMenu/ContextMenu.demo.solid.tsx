/** @jsxImportSource solid-js */
import { createContextMenu } from "./ContextMenu.solid";

export function ContextMenuSolidDemo() {
  const menu = createContextMenu(() => [
    { label: "Edit", icon: "ph:pencil-simple" },
    { label: "Delete", icon: "ph:trash", separatorBefore: true },
  ]);
  return (
    <section onContextMenu={menu.onContextMenu}>
      <h2>Solid ContextMenu</h2>
      <p>Right-click this demo row.</p>
      {menu.menu()}
    </section>
  );
}
