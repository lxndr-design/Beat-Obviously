import { createMemo, Show, splitProps, type JSX } from "solid-js";
import { addCollection, getIcon } from "@iconify/core/lib/storage/functions";
import { iconToSVG, replaceIDs } from "@iconify/utils";
import type { IconifyIcon } from "@iconify/types";
import { PH_ICON_SUBSET } from "./phIconSubset";

export interface IconProps extends Omit<JSX.SvgSVGAttributes<SVGSVGElement>, "style"> {
  name: string;
  size?: 12 | 14 | 16 | 24 | 32 | 40 | 48;
  decorative?: boolean;
  title?: string;
  style?: JSX.CSSProperties;
  className?: string;
}

const ALLOWED_PREFIX = "ph:";
addCollection(PH_ICON_SUBSET);

export function Icon(allProps: IconProps) {
  const [local, props] = splitProps(allProps, ["name", "size", "decorative", "title", "style", "class", "className"]);
  const icon = createMemo(() => {
    const name = local.name;
    if (!name.startsWith(ALLOWED_PREFIX) && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[Beat] Icon "${name}" is not from the Phosphor set. Only \`${ALLOWED_PREFIX}*\` icons are allowed.`);
    }
    const loaded = getIcon(name);
    if (!loaded && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[Beat] Icon "${name}" is not bundled in the local Phosphor icon collection.`);
    }
    return loaded ? buildIconSvg(loaded) : { body: "", viewBox: "0 0 16 16" };
  });

  const size = () => local.size ?? 16;
  const title = () => local.title ?? local.name;

  return (
    <svg
      width={size()}
      height={size()}
      viewBox={icon().viewBox}
      class={[local.class, local.className].filter(Boolean).join(" ") || undefined}
      style={{ color: "currentColor", display: "block", ...local.style }}
      aria-hidden={local.decorative}
      role={local.decorative ? "presentation" : "img"}
      aria-label={local.decorative ? undefined : title()}
      {...props}
    >
      <Show when={!local.decorative}>
        <title>{title()}</title>
      </Show>
      <g innerHTML={icon().body} />
    </svg>
  );
}

function buildIconSvg(icon: IconifyIcon): { body: string; viewBox: string } {
  const built = iconToSVG(icon);
  const width = Number(built.attributes.width) || icon.width || 16;
  const height = Number(built.attributes.height) || icon.height || 16;
  return {
    body: replaceIDs(built.body),
    viewBox: `0 0 ${width} ${height}`,
  };
}
