"use client";

import dynamic from "next/dynamic";
import { useFlowStore } from "@/stores/useFlowStore";

// Lazy-load the 3D bundle client-side only: keeps LCP on cheap DOM,
// and Three.js never ships to non-editor pages.
const FlowCanvas = dynamic(
  () => import("@/components/FlowCanvas").then((m) => m.FlowCanvas),
  { ssr: false, loading: () => <div className="canvas-loading">Initializing workspace…</div> },
);

export default function EditorPage() {
  const startRun = useFlowStore((s) => s.startRun);
  const runPhase = useFlowStore((s) => s.runPhase);

  return (
    <main className="editor-root">
      <FlowCanvas />

      {/* Glassmorphism overlay panels: 2D DOM over the 3D scene, never inside it */}
      <header className="glass top-bar">
        <span className="brand">FLUX</span>
        <span className="workflow-name">Temp Alert → Slack</span>
        <button
          className="run-button"
          onClick={startRun}
          disabled={runPhase !== "idle"}
        >
          {runPhase === "idle" ? "▶ Run once" : "Running…"}
        </button>
      </header>

      <aside className="glass hint-panel">
        <strong>Try it</strong>
        <p>Drag a node to move it — the beam follows.</p>
        <p>Orbit: drag empty space · Zoom: scroll.</p>
        <p>“Run once” simulates a trigger firing: watch the pulse travel.</p>
      </aside>
    </main>
  );
}
