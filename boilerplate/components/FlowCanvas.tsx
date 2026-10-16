"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import { WorkflowNode } from "@/components/WorkflowNode";
import { ConnectionBeam } from "@/components/ConnectionBeam";
import {
  useFlowStore,
  PHASE_DURATIONS_MS,
  type RunPhase,
} from "@/stores/useFlowStore";

const NEXT_PHASE: Partial<Record<RunPhase, RunPhase>> = {
  trigger: "pulse",
  pulse: "action",
  action: "done",
  done: "idle",
};

/** Advances the demo run state machine on the render clock. */
function RunDirector() {
  const advancePhase = useFlowStore((s) => s.advancePhase);

  useFrame(() => {
    const { runPhase, phaseStartedAt } = useFlowStore.getState();
    if (runPhase === "idle") return;
    const elapsed = performance.now() - phaseStartedAt;
    if (elapsed >= PHASE_DURATIONS_MS[runPhase]) {
      advancePhase(NEXT_PHASE[runPhase] ?? "idle");
    }
  });

  return null;
}

export function FlowCanvas() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const draggingId = useFlowStore((s) => s.draggingId);

  return (
    <Canvas
      camera={{ position: [0, 6, 11], fov: 45 }}
      dpr={[1, 2]} // cap pixel ratio: high-DPI screens won't 4x the shading cost
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#050510"]} />
      <fog attach="fog" args={["#050510", 18, 42]} />

      <ambientLight intensity={0.4} />
      <directionalLight position={[6, 10, 4]} intensity={1.2} />
      <Environment preset="city" />

      {/* The signature "infinite neon grid" floor */}
      <Grid
        position={[0, 0, 0]}
        args={[60, 60]}
        cellColor="#1e2a4a"
        sectionColor="#2563eb"
        sectionThickness={1.2}
        cellThickness={0.6}
        fadeDistance={38}
        infiniteGrid
      />

      {edges.map((edge) => (
        <ConnectionBeam key={edge.id} edge={edge} />
      ))}
      {Object.values(nodes).map((node) => (
        <WorkflowNode key={node.id} node={node} />
      ))}

      <RunDirector />

      {/* Constrained orbit: users can pan/zoom but never get lost under the floor */}
      <OrbitControls
        makeDefault
        enabled={!draggingId} // don't fight the camera while dragging a node
        enableDamping
        dampingFactor={0.08}
        minDistance={5}
        maxDistance={30}
        maxPolarAngle={Math.PI * 0.46}
      />
    </Canvas>
  );
}
