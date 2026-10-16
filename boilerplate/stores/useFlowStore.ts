import { create } from "zustand";
import * as THREE from "three";

/**
 * The workflow graph is plain data (the renderer is just a view of it).
 * Node positions are THREE.Vector3 objects that are MUTATED directly during
 * drag — never routed through React state — so dragging costs zero re-renders.
 * Components read them inside useFrame (transient updates).
 */

export type NodeKind = "trigger" | "action";
export type NodeStatus = "idle" | "running" | "success" | "error";

export interface FlowNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Mutated in place during drag; read in useFrame. */
  position: THREE.Vector3;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

/** Demo run state machine: trigger fires -> pulse travels the beam -> action runs. */
export type RunPhase = "idle" | "trigger" | "pulse" | "action" | "done";

export const PHASE_DURATIONS_MS: Record<Exclude<RunPhase, "idle">, number> = {
  trigger: 700,
  pulse: 900,
  action: 700,
  done: 1200,
};

interface FlowState {
  nodes: Record<string, FlowNode>;
  edges: FlowEdge[];
  draggingId: string | null;
  runPhase: RunPhase;
  phaseStartedAt: number;
  setDragging: (id: string | null) => void;
  startRun: () => void;
  advancePhase: (phase: RunPhase) => void;
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: {
    "mqtt-sensor": {
      id: "mqtt-sensor",
      label: "MQTT · Temp Sensor",
      kind: "trigger",
      position: new THREE.Vector3(-3.2, 0.6, 0),
    },
    "http-action": {
      id: "http-action",
      label: "HTTP · Notify Slack",
      kind: "action",
      position: new THREE.Vector3(3.2, 0.6, 0),
    },
  },
  edges: [{ id: "e1", from: "mqtt-sensor", to: "http-action" }],
  draggingId: null,
  runPhase: "idle",
  phaseStartedAt: 0,

  setDragging: (id) => set({ draggingId: id }),

  startRun: () => {
    if (get().runPhase !== "idle") return;
    set({ runPhase: "trigger", phaseStartedAt: performance.now() });
  },

  advancePhase: (phase) => set({ runPhase: phase, phaseStartedAt: performance.now() }),
}));

/** Derive a node's visual status from the demo run phase. */
export function statusFor(node: FlowNode, phase: RunPhase): NodeStatus {
  if (node.kind === "trigger") {
    if (phase === "trigger") return "running";
    if (phase === "pulse" || phase === "action" || phase === "done") return "success";
  }
  if (node.kind === "action") {
    if (phase === "action") return "running";
    if (phase === "done") return "success";
  }
  return "idle";
}
