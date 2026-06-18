import { render } from "solid-js/web";
import { App } from "./App.solid";
import "./design/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

render(() => <App />, container);
