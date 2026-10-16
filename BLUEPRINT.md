# Technical Blueprint — "FLUX" 3D Automation & IoT Integration Platform

*A Zapier/Node-RED-class workflow engine with an immersive 3D node canvas.*
*Versions researched 2026-07-03: Next.js 16.2 LTS · React Three Fiber v9 · Three.js WebGPU renderer (production since r171, WebGL2 auto-fallback) · NestJS 11.x.*

---

## Executive summary

FLUX lets users wire devices, APIs, and logic into automation workflows on a 3D canvas: nodes are floating objects, connections are beams of light, and live execution is visualized as pulses traveling along those beams. The four decisions that define the architecture:

1. **The 3D canvas is a *view*, not the source of truth.** Workflows are plain JSON graphs (nodes + edges + data mappings) stored in Postgres. The renderer could be swapped for a 2D view tomorrow without touching the engine.
2. **Editing and execution are fully separated.** A NestJS API serves the editor; stateless worker processes execute workflows off a Redis (BullMQ) queue. They share the database and the event bus, nothing else.
3. **One event spine.** Every state change — device message, node started/succeeded/failed, payload snapshot — flows through Redis pub/sub and out to browsers via a WebSocket gateway. The 3D visual feedback (pulses, red error glow) is just a subscriber of this stream.
4. **WebGPU-first rendering with free WebGL2 fallback**, and strict R3F discipline (transient state, instancing, ref mutation) so the canvas holds 60fps even with hundreds of nodes.

## Constraints & assumptions

Stated where you were terse — correct any that are wrong:

- **Scale**: launch at hundreds of users / thousands of workflow runs per day; architecture must survive 10× without redesign, not be built for 10× on day one.
- **Team**: small full-stack TypeScript team → one language end-to-end (Node/TS everywhere) beats a Python engine for shared types alone.
- **Devices**: consumer/prosumer IoT over MQTT + SaaS over REST/webhooks. No hard real-time (<10ms) control loops — this is orchestration, not PLC territory.
- **Desktop-first** editor; mobile gets a monitoring-grade experience, not full 3D editing.
- **Budget**: bootstrapped-to-seed. Managed services over self-ops wherever the bill allows.

## Stack

| Layer | Choice | Why | Alternative rejected |
|---|---|---|---|
| Frontend | **Next.js 16 (App Router) + React 19** | SSR shell for auth/marketing pages, SPA behavior inside the editor; team default | Vite SPA — fine for the editor but loses the marketing/docs/SEO story in one codebase |
| 3D layer | **React Three Fiber v9 + drei + Three.js WebGPU renderer (WebGL2 fallback)** | Declarative scene graph in React; v9 supports async `gl` for `WebGPURenderer`; fallback is free | Babylon.js — great engine, but R3F integrates with the React state model the rest of the app lives in; Spline — not code-ownable at this complexity |
| UI state | **Zustand** (+ transient subscriptions for per-frame data) | Shared 3D/UI state without context re-renders | Redux — ceremony without benefit here |
| Backend API | **NestJS 11 (REST + WebSocket gateway)** | Structured DI, guards, first-class WS gateways; same TS types as frontend via shared package | FastAPI — solid, but splits the type system across two languages |
| Execution engine | **Node.js workers + BullMQ (Redis)** | Stateless horizontal-scaling workers; delayed jobs give Delay nodes for free | Temporal — the *right* tool at big scale, but heavy to operate pre-product-market-fit; adopt later if run durations/complexity demand it |
| Workflow store | **PostgreSQL 16 (jsonb graph + relational metadata)** | Transactions, versioned workflow definitions, one system of record | MongoDB as primary — trades away FK integrity and transactional versioning for no gain here |
| Queue / pub-sub / cache | **Redis 7** | BullMQ queue, pub/sub event spine, rate-limit counters, hot state | Kafka — durability you don't need yet at ops cost you can't afford yet |
| Run logs | **MongoDB (capped/TTL collections)** | Write-heavy, schemaless payload snapshots, TTL expiry | ClickHouse — better analytics at scale; migrate when log analytics becomes a feature |
| MQTT broker | **EMQX (managed: EMQX Cloud)** | Scales, auth hooks, bridges cleanly to backend | Mosquitto — fine for dev, weak multi-tenant auth story |
| Auth | **Managed identity (e.g. Clerk / Auth0)** + per-device MQTT credentials | Auth is not your differentiator; device identity ≠ user identity | Hand-rolled sessions — undifferentiated risk |
| Hosting | **Vercel (frontend) + Fly.io/Railway (API, workers, bridge — long-running)** | Workers and WS need long-running processes; serverless fights you there | All-serverless — WebSockets, MQTT bridging, and long jobs all fight FaaS limits |
| Secrets (user credentials) | **Encrypted at rest (KMS envelope), never sent to browser** | Users store third-party API keys — this is your crown-jewel liability | .env-style storage — disqualifying |

## Project structure

pnpm monorepo — earned here because frontend, API, and workers genuinely share the workflow-graph types and node catalog:

```
flux/
├── apps/
│   ├── web/                     # Next.js 16
│   │   ├── app/                 # routes (marketing SSR, /editor SPA shell)
│   │   ├── features/
│   │   │   ├── canvas/          # R3F scene: nodes, beams, camera, effects
│   │   │   ├── inspector/       # glass panels: node config, data mapper
│   │   │   ├── runs/            # live run monitor, log viewer
│   │   │   └── library/         # node/integration catalog browser
│   │   └── stores/              # Zustand: flow graph, selection, live-run state
│   ├── api/                     # NestJS: REST + WS gateway + webhook ingress
│   │   └── modules/ (workflows, runs, integrations, devices, auth, ws)
│   ├── engine/                  # BullMQ workers: DAG interpreter, node executors
│   │   └── executors/ (http, mqtt, condition, delay, loop, map, script)
│   └── bridge/                  # MQTT <-> Redis event bridge
├── packages/
│   ├── graph/                   # workflow JSON schema, validation, types (shared)
│   ├── nodes/                   # node-type registry: manifest + config schema per type
│   └── shared/                  # DTOs, event names, utils
└── infra/                       # IaC, docker-compose (dev: postgres/redis/mongo/emqx)
```

Boundary logic: `packages/graph` is the contract everything depends on; apps never import from each other.

---

## UI/UX flow & layout — the 3D workspace

### Spatial model

- **An infinite dark "grid plane"** (subtle glowing gridlines fading to horizon) — nodes float slightly above it. Camera is a constrained orbit: pan freely in XY, zoom 5–100 units, orbit pitch clamped 15°–80° so users can never get lost under the floor or gimbal-flip. Double-tap/press `F` = frame selection; `Home` = reset view.
- **Nodes** are rounded glass slabs (~2×1×0.3 units) with an emissive edge ring, an icon, and a floating label rendered as DOM via drei `<Html>` (crisp text, accessible, selectable). Color language: cyan = trigger, violet = action, amber = logic (if/else, loop, delay), white = data transform.
- **Ports**: small glowing studs on node faces — outputs on the right face, inputs on the left. Hover enlarges the stud and shows the port's data type as a tooltip.
- **Connections** are quadratic-Bézier "light beams" between ports with a soft bloom. Idle = dim; armed workflow = slow breathing glow; live data = a bright pulse sphere travels source→target; error = the beam and downstream node flash red and stay red-rimmed until acknowledged.

### Layout (screen regions)

```
┌────────────────────────────────────────────────────────────┐
│ Top bar (glass): workflow name · versions · Deploy/Arm ·   │
│ run status chip · account                                   │
├──────────┬─────────────────────────────────┬───────────────┤
│ Node     │                                 │ Inspector      │
│ Library  │        3D CANVAS                │ (glass panel)  │
│ (glass,  │   nodes · beams · grid          │ · node config  │
│ search,  │                                 │ · credentials  │
│ drag out)│                                 │ · DATA MAPPER  │
├──────────┴─────────────────────────────────┴───────────────┤
│ Bottom drawer: live run timeline · logs · payload snoop    │
└────────────────────────────────────────────────────────────┘
```

All panels are 2D DOM overlays (glassmorphism: `backdrop-filter: blur`, 1px light border, 8% white fill) — **never UI inside the 3D scene**. This keeps text crisp, screen readers functional, and the frame budget for the scene itself.

### Core interaction flows

1. **Create**: drag a node type from the Library onto the canvas → it drops onto the plane with a soft landing animation at the raycast point.
2. **Connect**: drag from an output stud → a live beam follows the cursor (raycast to drag-plane) → valid input studs within snap radius glow green (type-compatible) or red (incompatible) → release to connect. Incompatible release = beam retracts with a shake.
3. **Configure**: click node → camera glides to a gentle three-quarter framing, Inspector slides in. Trigger nodes configure sources (MQTT topic, webhook URL shown with copy button, cron schedule); action nodes configure the API call and credential.
4. **Map data**: in the Inspector's Data Mapper, left column = upstream sample payload tree (from last test run), right = target fields; drag leaves across to bind; expression mode (JSONata) for transforms. Every edge carries its mapping.
5. **Test**: "Run once with sample" executes the real engine in test mode; the canvas replays it — pulses hop node to node, each node shows a ✓/✕ badge and timing; bottom drawer shows payloads per hop.
6. **Deploy/Arm**: one switch. Armed workflows breathe; the run counter ticks live.
7. **Monitor**: the dashboard view zooms out to a "constellation" of all workflows; each glows by health (activity brightness, error redness). Clicking dives into that workflow's canvas.

### Comfort & accessibility

- `prefers-reduced-motion` → no breathing/pulse animation, instant camera cuts, static beams with state shown by color only.
- Full keyboard path: tab through nodes (DOM mirror list), arrow-key nudge, Enter to open Inspector — the workflow is fully editable without the mouse; the 3D is an enhancement, not the only path.
- WebGL/WebGPU unavailable → automatic 2D SVG graph fallback (same graph JSON, different renderer). No black canvas, ever.

---

## System architecture

```
                        BROWSER
   ┌────────────────────────────────────────────────┐
   │  Next.js app                                    │
   │  ┌──────────────┐   ┌───────────────────────┐   │
   │  │ R3F 3D Canvas │←→│ Zustand stores         │   │
   │  │ (view layer)  │   │ graph · selection ·    │   │
   │  └──────────────┘   │ live-run (transient)   │   │
   │        ▲            └───────────┬───────────┘   │
   └────────┼────────────────────────┼───────────────┘
            │ WS: run events         │ REST: CRUD workflows,
            │ (node.started/…)       │ credentials, catalog
            ▼                        ▼
   ┌─────────────────────────────────────────────┐
   │  API (NestJS)                                │
   │  REST controllers · WS gateway · webhook     │
   │  ingress (/hooks/:id) · auth guards          │
   └───────┬──────────────┬──────────────┬────────┘
           │ enqueue run  │ pub/sub      │ read/write
           ▼              ▼              ▼
   ┌──────────────┐  ┌─────────┐  ┌────────────┐  ┌──────────┐
   │ Redis        │  │ Redis   │  │ PostgreSQL │  │ MongoDB  │
   │ BullMQ queue │  │ pub/sub │  │ workflows, │  │ run logs,│
   │ + delayed    │  │ event   │  │ users,     │  │ payload  │
   │ jobs         │  │ spine   │  │ creds(enc) │  │ snapshots│
   └──────┬───────┘  └────▲────┘  └─────▲──────┘  └────▲─────┘
          │ consume       │ emit        │               │
          ▼               │             │               │
   ┌─────────────────────────────────────────────┐      │
   │  ENGINE (N stateless workers)                │──────┘
   │  DAG interpreter → node executors            │
   │  (http, condition, delay, loop, map, script) │
   └──────────────────▲──────────────────────────┘
                      │ device events → trigger match
   ┌──────────────────┴───────────┐        ┌───────────────┐
   │  BRIDGE  (MQTT ⇄ Redis)      │◀──────▶│  EMQX broker   │◀── IoT devices
   └──────────────────────────────┘        └───────────────┘
```

**How the 3D frontend talks to the engine — the full loop:**

1. Editor saves graph JSON → `PUT /workflows/:id` → Postgres (new version row).
2. A trigger fires (MQTT message hits the Bridge, a webhook hits `/hooks/:id`, or a cron scheduler ticks) → API/Bridge matches it to armed workflows → enqueues a `run` job in BullMQ with the trigger payload.
3. A worker picks up the job, loads the pinned workflow version, walks the DAG: for each node it resolves the input mapping (JSONata over upstream outputs), executes the node's executor with retries/timeout, persists the log to Mongo, and **publishes an event to Redis pub/sub**: `run.{runId}.node.started|succeeded|failed` with node id, ms, and a truncated payload sample. Delay nodes = BullMQ delayed continuation job (survives worker restarts); Loop nodes = bounded fan-out with an iteration cap.
4. The NestJS WS gateway subscribes to `run.*` for workflows the connected user watches and forwards events over WebSocket.
5. In the browser, the live-run Zustand slice updates **transiently** (no React re-render): the R3F canvas reads it in `useFrame` and drives the pulse along the beam, flips node emissive to green/red. Visual feedback is *pure subscription* — zero coupling from renderer to engine.

---

## The eight pillars

- **Architecture** — Modular monolith API + separated stateless workers + thin bridge. Not microservices: one team, one domain; the only boundary that *earns* separation is edit-vs-execute (different scaling, different failure blast radius). Split trigger-scheduling into its own service only when cron volume makes it noisy. Tension named: sharing Postgres between API and engine couples deploys slightly — accepted for transactional simplicity; `packages/graph` keeps the contract honest.
- **Reliability** — Failure modes and guards: (1) third-party API down → per-node timeout + exponential-backoff retries (idempotency: each node execution carries a deterministic key; HTTP executor sends it as an idempotency header where supported); (2) worker crash mid-run → BullMQ at-least-once redelivery, run resumes from last completed node (node results checkpointed to Mongo); (3) Redis outage → API keeps accepting edits (Postgres), triggers buffer at EMQX with persistent sessions; canvas shows a "live feed degraded" chip instead of lying. Graceful degradation: the editor works fully offline-from-engine. Target SLO: 99.9% trigger-to-start < 5s; be explicit to users that this is not a hard-real-time system.
- **Performance** — Two budgets. *Engine*: trigger→first-node < 1s p95 (queue depth is the scaling signal). *Canvas*: 16ms frame — see 3D section. API latencies are trivial by comparison; the one hot path is webhook ingress → enqueue, kept to a single Postgres lookup (cached in Redis) + LPUSH. Payload snapshots truncated to 8KB in events so WS fan-out never balloons.
- **Security** — Threat model headline: **you store users' third-party credentials and accept inbound webhooks; you are a credential vault plus an SSRF factory unless designed otherwise.** Guards: credentials envelope-encrypted (KMS), decrypted only inside executors, never in API responses or WS events; the Script node runs in an isolated sandbox (e.g. `isolated-vm`) with no fs/net except a fetch proxy that **blocks private IP ranges** (SSRF); webhook endpoints are per-workflow secrets with HMAC signature verification option; MQTT is mTLS/per-device credentials with topic ACLs (`tenant/{id}/#`) so tenants can't subscribe across; object-level authz on every workflow/run route (id ownership check, not just "logged in"); dependency scanning + lockfile audit in CI. Compliance: GDPR-grade PII handling — payload logs are user data; TTL-expire them and honor deletion.
- **Data consistency** — Workflow definitions: **strong** (Postgres transactions; deploys pin an immutable version row so an edit mid-run never changes a running graph). Run state: **eventual** is fine — the canvas visualization lagging 200ms is invisible; the log record in Mongo is the run's source of truth, the WS stream is best-effort. The one race to design for: two triggers firing the same workflow concurrently → runs are independent by design (no shared mutable workflow state); anything stateful (counters, dedupe) lives in Redis with atomic ops. Source of truth per datum: graph = Postgres, run history = Mongo, live state = Redis (disposable).
- **Observability** — Structured JSON logs with `runId`/`nodeId`/`tenantId` correlation everywhere (the same IDs the canvas shows, so a user screenshot maps to a log query in seconds). Metrics: queue depth, run latency p95, node failure rate by integration, WS connection count, MQTT bridge lag. Tracing: OpenTelemetry spans per node execution — a run *is* a trace, which is a gift; ship them to a managed backend. The five pages: queue depth sustained high, run failure rate spike, bridge disconnected from EMQX, Postgres/Redis down, credential-decrypt failures (possible key issue). Bonus: the 3D canvas is itself an observability surface — the "constellation" view is your users' status page.
- **Infrastructure** — Long-running containers (Fly/Railway) for api/engine/bridge because WS + MQTT + queues all want persistent processes; Vercel for the Next.js app. Docker-compose mirrors prod services for dev. CI/CD: GitHub Actions — typecheck/test → build images → deploy staging → promote. Rollback = redeploy previous image + workflow versions are already immutable. Scaling: workers scale horizontally on queue depth (stateless by design); Postgres is the eventual ceiling — mitigate first with read replicas, and log volume already lives in Mongo, off the critical path.
- **Cost efficiency** — Now: ~$150–350/mo (managed Postgres + Redis + EMQX Cloud entry tiers, 2–3 small containers, Vercel Pro, Mongo Atlas M10). At 10×: the lines that grow are **worker compute** (scales with runs — meter it; runs/month is also your natural pricing unit), **log storage** (TTL + truncation keeps it linear and small), and **MQTT connections** (EMQX Cloud prices per connection — watch this cliff; self-hosting EMQX on a VM is the escape hatch). Traps: per-run third-party API costs (users' keys, their bill — keep it that way), WS egress at high fan-out (cap event rate per client, canvas interpolates between events anyway).

## 3D layer

- **Is 3D justified?** Honestly: a 2D graph (React Flow) would be *functionally* sufficient — Zapier proves it. The 3D earns its cost only as product differentiation and spatial organization at scale (depth = grouping/layers of workflows). Verdict: build it, but keep the graph JSON renderer-agnostic and ship the 2D fallback — that's insurance, accessibility, and mobile, all in one artifact.
- **Renderer**: R3F v9 with Three.js `WebGPURenderer` via async `gl` prop, automatic WebGL2 fallback (test the fallback with `forceWebGL: true` in CI). TSL for the beam/glow shaders so they compile to WGSL and GLSL from one source.
- **Frame budget (16ms) levers for this scene**: node bodies via `InstancedMesh` per node-kind (hundreds of nodes ≈ 4 draw calls, not 400); beams as instanced/merged bezier ribbons with a shader-driven pulse (uniform `t` per beam — no geometry updates per frame); **all per-frame motion via ref mutation and transient Zustand reads in `useFrame` — never React state at 60Hz**; labels as drei `<Html>` (DOM, free of the GPU budget); bloom via selective postprocessing on the emissive layer only; `dpr` clamped to `[1, 2]`; dispose on unmount for everything the editor creates dynamically.
- **Assets**: node icons as SVG/DOM; any decorative meshes as Draco-compressed GLB with KTX2 textures via gltf-transform. This scene is geometry-light by design — the pipeline stays small.
- **Loading & CWV**: editor route lazy-loads the whole 3D bundle (`dynamic import`, no SSR for the canvas); static poster + skeleton panels render instantly so LCP fires on cheap DOM; canvas space reserved (no CLS); marketing pages carry zero Three.js.
- **Device adaptation**: capability probe on first mount (GPU tier heuristic) → three quality presets (bloom off / dpr 1 / reduced beam segments on low tier). Mobile: monitoring view with touch orbit, editing gated to tablets+ or the 2D fallback.
- **Accessibility**: DOM mirror of the graph (list of nodes/connections) for screen readers and keyboard editing; `prefers-reduced-motion` respected; 2D SVG fallback when WebGL/WebGPU is absent.

## Top risks

1. **3D editor UX misses** (drag precision, occlusion, disorientation) — *early sign*: testers reach for the 2D view. Mitigation: strict camera constraints, snap-to-grid, and treat the 2D fallback as a first-class equal so the product doesn't live or die on the 3D.
2. **Script-node sandbox escape / SSRF** — the classic automation-platform CVE. Mitigation: `isolated-vm`, private-IP egress blocking, per-tenant rate limits; pen-test before GA.
3. **Integration catalog treadmill** — the engine is easy; 200 connectors is the moat and the grind. Mitigation: a declarative node-manifest format (`packages/nodes`) so connectors are data + small executors, and consider piggybacking an existing open connector spec.
4. **Redis as queue *and* event spine** becomes a single choke point at scale — *early sign*: pub/sub latency under load. Mitigation: split instances (queue vs pub/sub) first; NATS/Kafka only when numbers demand.
5. **WebGPU/R3F v9 integration churn** — v9's async `gl` path is newish. Mitigation: the WebGL2 fallback is the same renderer API; pin versions, CI-test both paths.

## Next steps

1. Run the boilerplate in `boilerplate/` (canvas + 2 nodes + beam + simulated run pulse) — validate the interaction feel first; it's the highest-risk bet.
2. Define `packages/graph` JSON schema (nodes, ports, edges, mappings) + validation.
3. Stand up docker-compose (Postgres, Redis, Mongo, EMQX) and the NestJS skeleton with one webhook trigger → one HTTP action end-to-end.
4. Build the DAG interpreter with checkpointing + the event spine; wire the WS gateway to the canvas — the moment a real MQTT message makes a pulse travel a beam, the core loop is proven.
5. Add condition/delay/loop executors, the data mapper UI, then credentials encryption before *any* real third-party key is stored.
