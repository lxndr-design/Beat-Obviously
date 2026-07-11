import { StatusChip } from "./StatusChip.solid";

export function StatusChipDemo() {
  return (
    <section>
      <h2>Status chip</h2>
      <StatusChip>REC</StatusChip>
      <StatusChip>IN</StatusChip>
      <StatusChip tone="muted">+3</StatusChip>
    </section>
  );
}
