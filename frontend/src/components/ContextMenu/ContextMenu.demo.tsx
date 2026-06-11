import { Button } from "../Button";
import { DemoSample, DemoSection } from "../../design/UiKitDemo";
import { useContextMenu, type ContextMenuItem } from "./ContextMenu";

export function ContextMenuDemo() {
  const { onContextMenu, openAt, menu } = useContextMenu(makeMenuItems);

  return (
    <DemoSection title="ContextMenu" note="Right-click target or open the same menu from keyboard/button coordinates.">
      <DemoSample label="target with submenu and disabled item">
        <div onContextMenu={onContextMenu}>
          <Button
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openAt(rect.left, rect.bottom + 8);
            }}
          >
            Open menu
          </Button>
          {menu}
        </div>
      </DemoSample>
    </DemoSection>
  );
}

function makeMenuItems(): ContextMenuItem[] {
  return [
    { label: "Edit segment", icon: "ph:pencil-line", hint: "Enter" },
    { label: "Duplicate", icon: "ph:copy", hint: "D" },
    {
      label: "Quantize",
      icon: "ph:grid-nine",
      submenu: [
        { label: "1/4 beat", onSelect: noop },
        { label: "1/8 beat", onSelect: noop },
        { label: "1/16 beat", onSelect: noop },
      ],
    },
    { label: "Freeze", icon: "ph:snowflake", disabled: true, separatorBefore: true },
    { label: "Delete", icon: "ph:trash", onSelect: noop },
  ];
}

function noop() {}
