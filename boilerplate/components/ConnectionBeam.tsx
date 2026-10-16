"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { QuadraticBezierLine } from "@react-three/drei";
import * as THREE from "three";
import {
  useFlowStore,
  PHASE_DURATIONS_MS,
  type FlowEdge,
} from "@/stores/useFlowStore";

type BezierLineHandle = {
  setPoints: (start: THREE.Vector3, end: THREE.Vector3, mid?: THREE.Vector3) => void;
  material: THREE.Material & { opacity: number };
};

// Reused across frames — no per-frame allocations (GC pauses read as jank).
const start = new THREE.Vector3();
const end = new THREE.Vector3();
const mid = new THREE.Vector3();
const pulsePos = new THREE.Vector3();
const OUT_PORT_OFFSET = new THREE.Vector3(1.05, 0, 0);
const IN_PORT_OFFSET = new THREE.Vector3(-1.05, 0, 0);

/** Quadratic bezier point at t (reused, allocation-free). */
function bezierAt(t: number, out: THREE.Vector3) {
  const u = 1 - t;
  out.set(
    u * u * start.x + 2 * u * t * mid.x + t * t * end.x,
    u * u * start.y + 2 * u * t * mid.y + t * t * end.y,
    u * u * start.z + 2 * u * t * mid.z + t * t * end.z,
  );
}

export function ConnectionBeam({ edge }: { edge: FlowEdge }) {
  const lineRef = useRef<BezierLineHandle>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const state = useFlowStore.getState();
    const from = state.nodes[edge.from];
    const to = state.nodes[edge.to];
    if (!from || !to || !lineRef.current || !pulseRef.current) return;

    // Anchor at the port studs; arc gently upward between them.
    start.copy(from.position).add(OUT_PORT_OFFSET);
    end.copy(to.position).add(IN_PORT_OFFSET);
    mid.lerpVectors(start, end, 0.5).setY(Math.max(start.y, end.y) + 1.1);
    lineRef.current.setPoints(start, end, mid);

    // Data pulse traveling along the beam during the "pulse" phase.
    if (state.runPhase === "pulse") {
      const t = Math.min(
        (performance.now() - state.phaseStartedAt) / PHASE_DURATIONS_MS.pulse,
        1,
      );
      bezierAt(t, pulsePos);
      pulseRef.current.position.copy(pulsePos);
      pulseRef.current.visible = true;
    } else {
      pulseRef.current.visible = false;
    }

    // Beam brightens while the workflow is live.
    lineRef.current.material.opacity = state.runPhase === "idle" ? 0.45 : 0.95;
  });

  return (
    <group>
      <QuadraticBezierLine
        // drei exposes setPoints via ref for imperative per-frame updates
        ref={lineRef as never}
        start={[0, 0, 0]}
        end={[0, 0, 0]}
        color="#38bdf8"
        lineWidth={2.5}
        transparent
        opacity={0.45}
        dashed={false}
      />
      {/* The traveling data packet */}
      <mesh ref={pulseRef} visible={false}>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial
          color="#e0f2fe"
          emissive="#38bdf8"
          emissiveIntensity={4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
