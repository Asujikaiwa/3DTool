"use client";

import { useRef, useMemo } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { useFlowStore, statusFor, type FlowNode } from "@/stores/useFlowStore";

const KIND_COLORS: Record<FlowNode["kind"], string> = {
  trigger: "#22d3ee", // cyan
  action: "#a78bfa", // violet
};

const STATUS_COLORS = {
  running: "#facc15",
  success: "#34d399",
  error: "#f87171",
} as const;

const DRAG_Y = 0.6;
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_Y);
const intersection = new THREE.Vector3();

export function WorkflowNode({ node }: { node: FlowNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.MeshStandardMaterial>(null);
  const setDragging = useFlowStore((s) => s.setDragging);
  const baseColor = KIND_COLORS[node.kind];
  const emissive = useMemo(() => new THREE.Color(baseColor), [baseColor]);

  // Per-frame work: follow the (mutated) store position, animate glow by status.
  useFrame(({ clock }) => {
    const group = groupRef.current;
    const ring = ringRef.current;
    if (!group || !ring) return;

    group.position.copy(node.position);

    const status = statusFor(node, useFlowStore.getState().runPhase);
    const t = clock.elapsedTime;

    if (status === "running") {
      emissive.set(STATUS_COLORS.running);
      ring.emissiveIntensity = 1.5 + Math.sin(t * 10) * 0.8; // pulse
      group.scale.setScalar(1 + Math.sin(t * 10) * 0.03);
    } else if (status === "success") {
      emissive.set(STATUS_COLORS.success);
      ring.emissiveIntensity = 1.4;
      group.scale.setScalar(1);
    } else if (status === "error") {
      emissive.set(STATUS_COLORS.error);
      ring.emissiveIntensity = 1.6;
    } else {
      emissive.set(baseColor);
      ring.emissiveIntensity = 0.8 + Math.sin(t * 2) * 0.15; // idle breathing
      group.scale.setScalar(1);
    }
    ring.emissive = emissive;
  });

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(node.id);
    document.body.style.cursor = "grabbing";
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (useFlowStore.getState().draggingId !== node.id) return;
    // Project the pointer ray onto the horizontal drag plane; mutate in place.
    if (e.ray.intersectPlane(dragPlane, intersection)) {
      node.position.set(intersection.x, DRAG_Y, intersection.z);
    }
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    (e.target as Element).releasePointerCapture(e.pointerId);
    setDragging(null);
    document.body.style.cursor = "auto";
  };

  return (
    <group ref={groupRef}>
      {/* Glassy slab body */}
      <RoundedBox
        args={[2, 1, 0.35]}
        radius={0.12}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOver={() => (document.body.style.cursor = "grab")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        <meshPhysicalMaterial
          color="#0f172a"
          roughness={0.15}
          metalness={0.2}
          transmission={0.4}
          thickness={0.5}
          transparent
          opacity={0.92}
        />
      </RoundedBox>

      {/* Emissive edge ring (the neon accent) */}
      <mesh>
        <torusGeometry args={[1.18, 0.035, 12, 48]} />
        <meshStandardMaterial ref={ringRef} color="#0b1020" toneMapped={false} />
      </mesh>

      {/* Output / input port studs */}
      <mesh position={[node.kind === "trigger" ? 1.05 : -1.05, 0, 0]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={baseColor}
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>

      {/* Label as crisp DOM, not in-scene text */}
      <Html center distanceFactor={10} position={[0, -0.95, 0]} style={{ pointerEvents: "none" }}>
        <div className="node-label">{node.label}</div>
      </Html>
    </group>
  );
}
