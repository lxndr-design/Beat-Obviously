/** @jsxImportSource solid-js */
import { Button } from "../Button";
import { HoverInfo } from "./HoverInfo.solid";

export function HoverInfoSolidDemo() {
  return (
    <section>
      <h2>Solid HoverInfo</h2>
      <HoverInfo content="Toggle monitoring">
        <Button>Monitor</Button>
      </HoverInfo>
    </section>
  );
}
