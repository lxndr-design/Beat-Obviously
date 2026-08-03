import { render } from "solid-js/web";
import { App } from "./App.solid";
import "./design/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

if (import.meta.env.DEV) {
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
