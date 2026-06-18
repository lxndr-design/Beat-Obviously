import { render } from "solid-js/web";
import { AppSolid } from "./App.solid";
import "./design/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

render(() => <AppSolid />, container);
