# FLUX — 3D Automation Canvas Boilerplate

Minimal Next.js 16 + React Three Fiber v9 demo: an interactive 3D workspace with **two draggable workflow nodes** (MQTT trigger → HTTP action) connected by a **glowing beam**, plus a simulated run that sends a data pulse along the connection.

## Run

```bash
npm install
npm run dev   # http://localhost:3000
```

## What it demonstrates

| Pattern | Where | Why it matters |
|---|---|---|
| Transient state (zero re-render drag) | `stores/useFlowStore.ts` | Node positions are `THREE.Vector3`s mutated in place; components read them in `useFrame`. Never `setState` at 60Hz. |
| Raycast drag on a plane | `WorkflowNode.tsx` | Pointer capture + `ray.intersectPlane` — robust 3D drag without gesture libs. |
| Imperative beam updates | `ConnectionBeam.tsx` | drei `QuadraticBezierLine` `setPoints()` per frame; reused vectors, no per-frame allocations. |
| Live-run visual feedback | `RunDirector` in `FlowCanvas.tsx` | Phase state machine → node glow + traveling pulse. In production this is driven by WebSocket `run.*` events instead of timers. |
| 2D glass UI over 3D | `app/page.tsx` + `globals.css` | Panels are DOM (crisp, accessible), never in-scene geometry. |
| CWV protection | `dynamic(..., { ssr: false })` in `page.tsx` | The 3D bundle lazy-loads; capped `dpr=[1,2]`. |
| Constrained camera | `FlowCanvas.tsx` | Orbit clamps so users can't get lost; controls disabled while dragging. |

## Next steps toward the real product

1. Replace `RunDirector`'s timers with a WebSocket subscription to engine events (`run.{id}.node.started|succeeded|failed`).
2. Convert node bodies to `InstancedMesh` per node kind once node counts grow (hundreds of nodes ≈ a handful of draw calls).
3. Add selective bloom (`@react-three/postprocessing`) on the emissive layer for the full neon look.
4. WebGPU: pass an async-initialized `WebGPURenderer` via the Canvas `gl` prop (R3F v9) — automatic WebGL2 fallback.
5. Port-to-port connection dragging, snap targets, and type-compatibility highlighting (see BLUEPRINT.md §UI/UX).
