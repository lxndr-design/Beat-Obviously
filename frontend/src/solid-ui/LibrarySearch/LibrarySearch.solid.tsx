import { splitProps, type JSX } from "solid-js";
import styles from "./LibrarySearch.module.css";

export interface LibrarySearchProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "type"> {
  className?: string;
}

export function LibrarySearch(allProps: LibrarySearchProps) {
  const [local, props] = splitProps(allProps, ["class", "className", "placeholder"]);
  return (
    <input
      type="search"
      class={[styles.input, local.class, local.className].filter(Boolean).join(" ")}
      placeholder={local.placeholder ?? "Search..."}
      {...props}
    />
  );
}
