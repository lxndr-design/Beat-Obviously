import type { CSSProperties, ReactNode } from "react";
import styles from "./UiKitDemo.module.css";

interface DemoSectionProps {
  title: string;
  note?: string;
  children: ReactNode;
}

export function UiKitDemoPage({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Beat UI Kit</h1>
        <p className={styles.intro}>
          Shared primitives, states, and interaction surfaces for the Beat DAW interface.
        </p>
      </header>
      {children}
    </main>
  );
}

export function DemoSection({ title, note, children }: DemoSectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {note && <p className={styles.sectionNote}>{note}</p>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

export function DemoRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

export function DemoGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function DemoSample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.sample}>
      <div className={styles.sampleLabel}>{label}</div>
      {children}
    </div>
  );
}

export function DemoSwatch({ label, style }: { label: string; style: CSSProperties }) {
  return (
    <div className={styles.swatch}>
      <div className={styles.swatchChip} style={style} />
      <div className={styles.swatchLabel}>{label}</div>
    </div>
  );
}

export const constrainedDemoClassName = styles.constrained;
