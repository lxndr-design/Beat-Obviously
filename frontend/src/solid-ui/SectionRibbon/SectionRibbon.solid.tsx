import { Show, splitProps, type JSX } from "solid-js";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { RibbonHelp, type RibbonHelpPage } from "../RibbonHelp";
import { Tag } from "../Tag";
import styles from "./SectionRibbon.module.css";

export interface SectionRibbonProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  actions?: JSX.Element;
  count?: number;
  showToggle?: boolean;
  className?: string;
  help?: RibbonHelpPage[];
  helpLabel?: string;
}

export function SectionRibbon(allProps: SectionRibbonProps) {
  const [local, props] = splitProps(allProps, ["title", "expanded", "onToggle", "actions", "count", "showToggle", "class", "className", "help", "helpLabel"]);
  const showToggle = () => local.showToggle ?? true;
  return (
    <div
      class={[
        styles.ribbon,
        local.expanded && styles.ribbonExpanded,
        !showToggle() && styles.ribbonNoToggle,
        local.class,
        local.className,
      ].filter(Boolean).join(" ")}
      {...props}
    >
      <Show when={showToggle()}>
        <Button
          iconOnly
          size="md"
          class={styles.toggle}
          onClick={local.onToggle}
          aria-label={local.expanded ? `Collapse ${local.title}` : `Expand ${local.title}`}
        >
          <span class={`${styles.toggleIcon} ${local.expanded ? styles.toggleIconExpanded : ""}`}>
            <Icon name="ph:caret-right" size={18} decorative />
          </span>
        </Button>
      </Show>
      <span class={styles.label}>
        <span class={styles.labelText}>{local.title}</span>
        <Show when={local.help?.length}>
          <RibbonHelp label={local.helpLabel ?? local.title} pages={local.help ?? []} />
        </Show>
      </span>
      <span class={styles.right}>
        <Show when={typeof local.count === "number"}>
          <span class={styles.count}><Tag tone={local.count === 0 ? "zero" : "default"}>{local.count}</Tag></span>
        </Show>
        <Show when={local.actions}><span class={styles.actions}>{local.actions}</span></Show>
      </span>
    </div>
  );
}

export function SectionRibbonActionButton(allProps: Omit<Parameters<typeof Button>[0], "iconOnly" | "size"> & { className?: string }) {
  const [local, props] = splitProps(allProps, ["class", "className"]);
  return (
    <Button
      iconOnly
      size="md"
      class={[styles.actionButton, local.class, local.className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
