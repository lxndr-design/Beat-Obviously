import { Show, splitProps, type JSX } from "solid-js";
import styles from "./RowItem.module.css";

type RowItemDensity = "compact" | "standard" | "media";

export interface RowItemProps extends JSX.LiHTMLAttributes<HTMLLIElement> {
  density?: RowItemDensity;
  reserveDragSlot?: boolean;
  dragSlot?: JSX.Element;
  icon?: JSX.Element;
  hoverIcon?: JSX.Element;
  iconAriaHidden?: boolean;
  name: string;
  meta?: JSX.Element;
  detail?: JSX.Element;
  action?: JSX.Element;
  cursor?: "pointer" | "grab" | "default";
  className?: string;
}

export function RowItem(allProps: RowItemProps) {
  const [local, props] = splitProps(allProps, [
    "density",
    "reserveDragSlot",
    "dragSlot",
    "icon",
    "hoverIcon",
    "iconAriaHidden",
    "name",
    "meta",
    "detail",
    "action",
    "cursor",
    "class",
    "className",
    "children",
  ]);
  const reserveDragSlot = () => local.reserveDragSlot ?? Boolean(local.dragSlot);
  const cls = () => [
    styles.row,
    styles[`density-${local.density ?? "standard"}`],
    styles[`cursor-${local.cursor ?? "pointer"}`],
    !reserveDragSlot() && styles.noDragSlot,
    local.class,
    local.className,
  ].filter(Boolean).join(" ");

  return (
    <li class={cls()} {...props}>
      <Show when={reserveDragSlot()}>
        <span class={styles.dragSlot} aria-hidden="true">{local.dragSlot}</span>
      </Show>
      <span class={`${styles.iconSlot} ${local.hoverIcon ? styles.iconSwapSlot : ""}`} aria-hidden={local.iconAriaHidden ?? true}>
        <Show when={local.hoverIcon} fallback={local.icon}>
          <span class={styles.iconDefault}>{local.icon}</span>
          <span class={styles.iconHover}>{local.hoverIcon}</span>
        </Show>
      </span>
      <span class={styles.text}>
        <span class={styles.name} title={local.name}>{local.name}</span>
        <Show when={local.meta}><span class={styles.meta}>{local.meta}</span></Show>
        <Show when={local.detail}><span class={styles.detail}>{local.detail}</span></Show>
        {local.children}
      </span>
      <Show when={local.action}><span class={styles.action}>{local.action}</span></Show>
    </li>
  );
}
