import { render } from "solid-js/web";
import { App } from "./App.solid";
import "./design/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

function shouldInstallBeatDevHooks() {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  const isLocalPreview = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "::1";
  return isLocalPreview && new URLSearchParams(window.location.search).has("beatDevFixture");
}

if (shouldInstallBeatDevHooks()) {
  void import("./testing/devHooks")
    .then(({ installBeatDevHooks }) => installBeatDevHooks())
    .catch((error) => {
      console.error("[Beat dev hooks] install failed", error);
    });
}

render(() => <App />, container);

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("beatDevFixture")) {
  document.getElementById("beat-boot-splash")?.remove();
  document.title = "Beat UI Kit | Live Preview";
}
