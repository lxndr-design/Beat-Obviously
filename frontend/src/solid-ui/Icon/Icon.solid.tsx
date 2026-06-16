/** @jsxImportSource solid-js */
import { createEffect, createSignal, Show, splitProps, type JSX } from "solid-js";
import { loadIcon } from "@iconify/core/lib/api/icons";
import { setAPIModule } from "@iconify/core/lib/api/modules";
import { fetchAPIModule } from "@iconify/core/lib/api/modules/fetch";
import { getIcon } from "@iconify/core/lib/storage/functions";
import { iconToSVG, replaceIDs } from "@iconify/utils";

export interface IconProps extends Omit<JSX.SvgSVGAttributes<SVGSVGElement>, "style"> {
  name: string;
  size?: 12 | 14 | 16 | 24 | 32 | 40 | 48;
  decorative?: boolean;
  title?: string;
  style?: JSX.CSSProperties;
  className?: string;
}

const ALLOWED_PREFIX = "ph:";
setAPIModule("", fetchAPIModule);

export function Icon(allProps: IconProps) {
  const [local, props] = splitProps(allProps, ["name", "size", "decorative", "title", "style", "class", "className"]);
  const [body, setBody] = createSignal("");
  const [viewBox, setViewBox] = createSignal("0 0 16 16");

  createEffect(() => {
    const name = local.name;
    if (!name.startsWith(ALLOWED_PREFIX) && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[Beat] Icon "${name}" is not from the Phosphor set. Only \`${ALLOWED_PREFIX}*\` icons are allowed.`);
    }
    const cached = getIcon(name);
    if (cached) {
      applyIcon(cached);
      return;
    }
    setBody("");
    void loadIcon(name).then(applyIcon).catch(() => setBody(""));
  });

  function applyIcon(icon: NonNullable<ReturnType<typeof getIcon>>) {
    const built = iconToSVG(icon);
    const width = Number(built.attributes.width) || icon.width || 16;
    const height = Number(built.attributes.height) || icon.height || 16;
    setViewBox(`0 0 ${width} ${height}`);
    setBody(replaceIDs(built.body));
  }

  const size = () => local.size ?? 16;
  const title = () => local.title ?? local.name;

  return (
    <svg
      width={size()}
      height={size()}
      viewBox={viewBox()}
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
      <g innerHTML={body()} />
    </svg>
  );
}
