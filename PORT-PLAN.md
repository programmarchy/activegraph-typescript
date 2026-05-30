# Active Graph → TypeScript port plan

A plan to reimplement `activegraph` (Python, ~20K LOC, ~13K LOC tests)
as an idiomatic TypeScript library, preserving its determinism /
replay / fork-and-diff guarantees and its testing discipline. This is
a port, not a transliteration: we adopt TS idioms where they materially
improve the API, and we keep the public surface stable in shape and
semantics so the existing docs and examples translate one-for-one.

This document is the design contract for the port. CONTRACT.md will get
a v1.0.5 section once the choices below are accepted.

---

## 1. Goals & non-goals

**Goals**
- A `@activegraph/*` family of npm packages whose top-level API is
  recognizably the same as the Python one (Graph, Runtime, behaviors,
  patches, views, frames, packs, stores, LLM providers, tools, trace).
- Strong types everywhere — `tsc --strict`, no implicit `any`, exported
  types are the documentation. Replace mypy strict-mode allowlist gate
  with `tsc --strict` over the whole repo from day one.
- Byte-for-byte deterministic snapshots and the same replay /
  fork-and-diff guarantees. Tests gate on identical trace text (after
  one rebaseline) and identical fixture JSON shape.
- Pluggable stores (memory, SQLite, Postgres), pluggable LLM providers
  (Anthropic, OpenAI, Recorded), pluggable tools, packs as data, all
  with the same Protocol → interface mapping.
- Node 20+ first. ESM-only.

**Non-goals**
- 1:1 file-for-file mirror. We collapse small Python modules where TS
  prefers fewer files, and split a couple of God-modules (`runtime.py`
  at 2.6K LOC) along their natural seams.
- Browser/edge runtime support in v1.0.5 (later: a `core` package with no
  Node deps is browser-shippable; SQLite/Postgres stay Node-only).
- Backwards Python compatibility — the wire format for the event log
  must match (so the same fixture JSON deserializes in either runtime),
  but APIs do not.

---

## 2. Idiomatic-TS decisions (with rationale)

The Python codebase makes choices that don't map cleanly to TS. These
are the ones that change the shape of the API or the build.

### 2.1 Decorators → factory functions

Python uses `@behavior(...)`, `@relation_behavior(...)`, `@llm_behavior(...)`,
`@tool(...)` as the only registration surface. TC39 decorators exist
in TS 5.x and Node 22, but they're awkward for free functions (they
target classes and class members) and force users into a decorator
syntax they may not have configured.

**Decision:** the public surface is `defineBehavior({...})`,
`defineRelationBehavior({...})`, `defineLLMBehavior({...})`,
`defineTool({...})`. Each returns a registered handle. The function
body is one of the option fields (`handler: (event, graph, ctx) => ...`).
This works in plain JS without TS, plays nicely with type inference
(generic parameters carry through), and matches what idiomatic TS
agent libraries already do (Vercel AI SDK, Inngest, Trigger.dev).

Decorator syntax is added later as a thin sugar layer if there's
demand:
```ts
const planner = defineBehavior({
  name: "planner",
  on: ["goal.created"],
  handler: async (event, graph, ctx) => { /* ... */ },
});
```

### 2.2 Pydantic → Zod (with Standard Schema escape hatch)

Pack object types, LLM `output_schema=`, and pack settings all use
Pydantic. The 2026-idiomatic TS replacement is **Zod 4** (with
Standard Schema support so users can plug in Valibot/ArkType/TypeBox
if they want).

```ts
import { z } from "zod";

const Claim = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
});

defineLLMBehavior({
  name: "extractor",
  on: ["object.created"],
  outputSchema: Claim,        // any StandardSchemaV1
  handler: async (event, graph, ctx, output) => { /* output is z.infer<typeof Claim> */ },
});
```

Pack object-type schemas are declared the same way:
```ts
const pack = definePack({
  name: "diligence",
  objectTypes: { claim: Claim, evidence: Evidence, /* ... */ },
});
```

### 2.3 Sync core → async runtime

Python's runtime is synchronous (it blocks on `sqlite3`, `requests`,
the OpenAI/Anthropic clients in sync mode). TS idioms favor async/await
for any I/O. We make the runtime async-first:

```ts
const runtime = new Runtime(graph, { budget: { maxEvents: 200 } });
await runtime.runGoal("Evaluate this startup idea");
```

Behavior handlers may be sync OR async — the runtime awaits whatever
they return. Graph mutations remain sync (they're in-memory). Store
calls, LLM calls, and tool calls are async.

This is the single largest API shape change. Justification: it makes
the SQLite/Postgres/Recorded LLM/HTTP-tool integrations honest, and it
lets users compose with the rest of the Node ecosystem. The Python
sync model would have forced us to wrap every async SDK in a sync
shim or to fork the runtime; both are worse than async-first.

### 2.4 Package layout — monorepo, split by optional extras

Python uses optional extras (`pip install activegraph[postgres]`).
The TS equivalent is one package with optional peerDependencies. But:
- Optional peer deps produce warnings on install and require runtime
  `await import()` guards that read poorly.
- A monorepo with split packages mirrors the extras 1:1 and lets users
  install exactly what they need.

**Decision:** pnpm workspace, packages published under `@activegraph/*`:

| Package                       | Replaces / corresponds to                              |
|-------------------------------|--------------------------------------------------------|
| `@activegraph/core`           | `activegraph.{core,errors,frame,policy,trace}`         |
| `@activegraph/runtime`        | `activegraph.runtime.*`, `activegraph.behaviors.*`     |
| `@activegraph/store-memory`   | `activegraph.store.{base,memory,serde,url}`            |
| `@activegraph/store-sqlite`   | `activegraph.store.sqlite` (better-sqlite3)            |
| `@activegraph/store-postgres` | `activegraph.store.postgres` (pg)                      |
| `@activegraph/llm`            | `activegraph.llm.{provider,types,parsing,prompt,cache,recorded,errors}` |
| `@activegraph/llm-anthropic`  | `activegraph.llm.anthropic`                            |
| `@activegraph/llm-openai`     | `activegraph.llm.openai`                               |
| `@activegraph/tools`          | `activegraph.tools.*`                                  |
| `@activegraph/observability`  | `activegraph.observability.*` (pino + prom-client)     |
| `@activegraph/packs`          | `activegraph.packs.{loader,scaffold}`                  |
| `@activegraph/pack-diligence` | `activegraph.packs.diligence`                          |
| `@activegraph/cli`            | `activegraph.cli.*` (commander)                        |
| `activegraph`                 | umbrella package: re-exports core + runtime + memory + sqlite + diligence (mirrors the default `pip install activegraph`) |

`activegraph` (the umbrella) is what `pip install activegraph` ships
today: core + memory + sqlite + diligence + CLI. Optional extras stay
optional packages users add explicitly.

### 2.5 Stack choices

| Concern              | Python tool        | TS choice                | Note                                                     |
|----------------------|--------------------|--------------------------|----------------------------------------------------------|
| Test runner          | pytest             | **vitest**               | first-class snapshot support, fast, watch-mode           |
| Build                | setuptools         | **tsup** (esbuild)       | per-package ESM build; declarations via `tsc -p`         |
| Schemas              | pydantic           | **zod 4** + Standard Schema |                                                          |
| CLI                  | click              | **commander**            | mature, small; citty is an alternative                   |
| SQLite               | sqlite3 (stdlib)   | **better-sqlite3**       | sync, fast, widely deployed                              |
| Postgres             | psycopg            | **pg** (`node-postgres`) | the boring choice                                        |
| Anthropic SDK        | anthropic          | `@anthropic-ai/sdk`      | official                                                 |
| OpenAI SDK           | openai             | `openai`                 | official                                                 |
| Token counter        | tiktoken           | **gpt-tokenizer**        | pure JS, no wasm download; `js-tiktoken` is fallback     |
| Structured logging   | stdlib `logging`   | **pino**                 | the structured-logging default                           |
| Metrics              | prometheus_client  | **prom-client**          |                                                          |
| HTTP (tools)         | requests / httpx   | `undici` (built-in `fetch` on Node 20+) | no extra dep                                |
| Lint / format        | (none gated)       | **biome** OR eslint+prettier | bias to biome for speed                                 |
| Type docs            | mkdocstrings       | **typedoc**              | feeds the doc site                                       |
| Doc site             | mkdocs-material    | **vitepress** or keep mkdocs | see §8                                              |

### 2.6 Async iteration & event delivery

Several Python surfaces (`runtime.events()`, `graph.snapshot()` -> generator)
become `AsyncIterable<Event>` or `Promise<EventBatch>` in TS. The
runtime exposes `runtime.events()` as an async iterator so users can
`for await (const event of runtime.events())`.

### 2.7 Replacing setuptools entry points (pack discovery)

Python registers packs via `[project.entry-points."activegraph.packs"]`.
TS has no equivalent. Two options:

1. **Convention:** packages with `keywords: ["activegraph-pack"]` in
   `package.json` are discoverable when listed in the host project's
   own `package.json` (we read the manifest, never the filesystem).
2. **Explicit:** users call `runtime.loadPack(diligencePack)` with an
   imported pack object. No discovery magic.

**Decision:** ship #2 as the primary mechanism, document #1 in v2.1 if
demand exists. Magic discovery has a worse failure mode and TS users
expect explicit imports.

---

## 3. Repo layout

```
activegraph-ts/                       # new repo (or branch)
├── package.json                      # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json                # shared strict config
├── biome.json                        # or .eslintrc + .prettierrc
├── vitest.config.ts                  # root config, packages extend
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── index.ts              # barrel
│   │   │   ├── graph.ts              # Graph, Object, Relation
│   │   │   ├── event.ts
│   │   │   ├── patch.ts
│   │   │   ├── view.ts
│   │   │   ├── clock.ts              # Clock, FrozenClock, TickingClock
│   │   │   ├── ids.ts                # IDGen
│   │   │   ├── frame.ts
│   │   │   ├── policy.ts
│   │   │   ├── errors.ts             # ActiveGraphError hierarchy
│   │   │   └── trace/
│   │   │       ├── causal.ts
│   │   │       └── printer.ts
│   │   └── test/                     # mirrors tests/test_{graph,event,...}.py
│   ├── runtime/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── runtime.ts            # façade — splits Python runtime.py
│   │   │   ├── scheduler.ts
│   │   │   ├── queue.ts
│   │   │   ├── registry.ts
│   │   │   ├── behavior-graph.ts
│   │   │   ├── view-builder.ts
│   │   │   ├── diff.ts
│   │   │   ├── budget.ts
│   │   │   ├── patterns/
│   │   │   │   ├── parser.ts
│   │   │   │   ├── matcher.ts
│   │   │   │   └── index.ts
│   │   │   ├── behaviors/
│   │   │   │   ├── define.ts         # defineBehavior, defineRelationBehavior
│   │   │   │   └── llm.ts            # defineLLMBehavior
│   │   │   ├── errors.ts             # replay-divergence, exec, registration
│   │   │   └── live.ts               # _live.py port
│   │   └── test/
│   ├── store-memory/ ... store-sqlite/ ... store-postgres/
│   ├── llm/                          # provider interface + recorded + shared parsing
│   ├── llm-anthropic/  llm-openai/
│   ├── tools/
│   ├── observability/
│   ├── packs/                        # loader, scaffold, definePack
│   ├── pack-diligence/
│   └── cli/                          # bin: activegraph
├── apps/
│   └── docs/                         # vitepress site (if chosen)
├── examples/                         # ports of examples/*.py
├── snapshots/                        # canonical trace snapshots (see §5)
└── .github/workflows/                # mirror Python CI gates (see §6)
```

### 3.1 Splitting `runtime.py` (2592 lines)

Python's `runtime.py` is the biggest single file and the most
deserving of decomposition. Natural seams (already implied by the
companion modules):

- `runtime.ts` — public façade: `Runtime`, `run_goal`, `events()`,
  `print_trace()`, `save`/`load` orchestration. ~400 LOC.
- `evaluator.ts` — the inner "fire one behavior, validate output,
  apply patches, emit events" loop. ~500 LOC.
- `dispatch.ts` — event → matching-behaviors lookup, including
  pattern-matching delegation. ~300 LOC.
- `replay.ts` — strict + permissive replay, divergence detection. ~400
  LOC.
- `fork.ts` — fork-from-event, replay-cache plumbing. ~250 LOC.
- `state.ts` — runtime context, frames-on-stack, budget tracking. ~200 LOC.

(Same total LOC, but each file is reviewable and individually testable.)

---

## 4. Phased plan

Six phases, each ends with a green CI gate. Order matters: later phases
import from earlier ones.

### Phase 0 — Bootstrap (1–2 days)
- Create pnpm workspace, root `tsconfig.base.json`, biome, vitest.
- Mirror the Python CI gates as empty workflow files:
  `typecheck.yml`, `tests.yml`, `lint.yml`, `docstring-coverage.yml`
  (TSDoc), `wheel-completeness.yml` (= `npm-pack-completeness.yml`),
  `broken-links.yml`.
- Set up `changesets` for semver / publishing.
- Decision log committed: this file + a `CONTRACT-v2.md` stub.

### Phase 1 — `@activegraph/core` (1 week)
Port the pure data layer first because everything else imports from it.
- `clock`, `ids`, `event`, `patch`, `view`, `graph`, `frame`, `policy`,
  the error hierarchy, `trace/{causal,printer}`.
- Port `tests/test_{clock,ids,event,patch,view,graph,trace,patch_lifecycle}.py`
  to `packages/core/test/*.test.ts`. These tests are pure-Python and
  port cleanly.
- **Exit gate:** core tests pass; type-only API frozen (`@activegraph/core`
  exports stable types from this phase on).

### Phase 2 — `@activegraph/runtime` (2 weeks)
The hardest phase. Port runtime + scheduler + queue + registry +
patterns + behaviors + diff + replay + fork.
- Implement `defineBehavior` / `defineRelationBehavior` and the global
  registry first; port `tests/test_runtime.py`,
  `test_pattern_{parser,matcher,subscriptions}.py`, `test_diff.py`,
  `test_fork.py`, `test_replay.py`, `test_requeue_unfired.py`,
  `test_activate_after.py`.
- Pattern engine (`patterns.py`, 946 LOC) gets a dedicated review —
  the Cypher subset parser is one of the most subtle pieces.
- **Exit gate:** every non-LLM, non-tool, non-store test passes.
  Snapshot tests run against the in-memory store.

### Phase 3 — Stores (3 days each)
- `@activegraph/store-memory` (port + conformance suite).
- `@activegraph/store-sqlite` (better-sqlite3; port migration logic
  carefully — schema version mismatch errors must be preserved).
- `@activegraph/store-postgres` (pg; gated tests behind
  `ACTIVEGRAPH_TEST_POSTGRES_URL`, matching Python).
- Port `test_persistence.py`, `test_store_{conformance,url,serde}.py`,
  `test_postgres_store.py`.
- **Exit gate:** the same store-conformance suite runs against all three
  backends and passes identically.

### Phase 4 — Tools (1 week)
- `@activegraph/tools` with `defineTool`, `ToolContext`, recorded
  provider, the bundled `web_fetch` (built-in `fetch`) and
  `graph_query` tools.
- Port `test_tools.py`, `test_tool_replay.py`,
  `test_tool_trace_snapshot.py`, `test_v1_0_3_tool_multiturn.py`,
  `test_causal_cross_tool.py`.
- **Exit gate:** tool tests pass; tool fixtures (JSON files) work as-is
  between Python and TS (cross-language fixture interop).

### Phase 5 — LLM (2 weeks)
- `@activegraph/llm` with `LLMProvider` interface, `RecordedLLMProvider`,
  prompt construction, parsing, cache, errors.
- `@activegraph/llm-anthropic`, `@activegraph/llm-openai`.
- `defineLLMBehavior` with Zod-schema validation.
- Port the LLM test files: `test_llm_{anthropic,openai,behavior,budget,
  causal,claim_extraction,default_model,determinism,failure,prompt,
  provider_fixtures,replay,trace,trace_snapshot,tool_loop,types}.py`.
- Recorded fixtures (the `.json` files under `tests/snapshots/`) get
  reused as-is by the TS replay provider.
- **Exit gate:** LLM tests pass; recorded fixtures interop.

### Phase 6 — Observability, packs, CLI, examples, docs (2 weeks)
- `@activegraph/observability`: pino logging, prom-client metrics,
  runtime status, migration report.
- `@activegraph/packs`: `definePack`, loader, scaffold, prompt loading.
- `@activegraph/pack-diligence`: port the reference pack (8 object
  types, 7 behaviors, 3 tools, fixtures).
- `@activegraph/cli` and `activegraph` umbrella: `activegraph
  quickstart` and the rest of the subcommands.
- Port `examples/*.py` to `examples/*.ts`.
- Doc site: keep mkdocs (and just rewrite the code blocks) OR migrate
  to vitepress. **Recommend keeping mkdocs**; the prose dominates the
  cost, and we already have a working doc-link gate. Decide before
  Phase 6.
- **Exit gate:** the equivalent of `activegraph quickstart` runs against
  the published wheel-equivalent (`npm pack`) and produces byte-equal
  output to the Python `quickstart_session.txt`.

**Total estimate:** ~6–8 weeks of focused single-person work, faster
with two people splitting Phase 2 (runtime/patterns) from
Phases 4+5 (tools/LLM).

---

## 5. Preserving verification & testing

This is the riskiest part of the port and the user's explicit ask.
The Python test suite is the framework's most important asset.

### 5.1 What to keep identical

- **Test names.** Every Python test file gets a same-named TS file
  (snake → kebab) — `tests/test_pattern_matcher.py` →
  `packages/runtime/test/pattern-matcher.test.ts`. One-to-one mapping
  lets us tick them off and audit coverage gaps.
- **Assertions.** Where pytest does `assert event.payload["x"] == 1`,
  vitest does `expect(event.payload.x).toBe(1)`. Same checks, same
  ordering.
- **Snapshot text.** The trace printer's output format is the spec.
  We rebaseline once (TS prints get committed as canonical) and from
  then on the TS printer is locked to byte-equal output. The Python
  printer keeps producing the same text; the two outputs stay
  identical, which means recorded fixtures are cross-language
  interchangeable.
- **Recorded LLM/tool fixtures (`*.json`).** The wire format is the
  spec. We port the serde to produce the same field names, the same
  key ordering, the same float formatting. Cross-run a Python-recorded
  fixture through the TS `RecordedLLMProvider` and vice versa as a CI
  gate (see §6 below).
- **Determinism contract.** IDGen sequencing, event id derivation,
  clock semantics — all spec'd. Test the same way the Python tests
  do (`test_ids.py`, `test_clock.py`, `test_determinism.py`).
- **Store conformance suite.** One suite, three backends, identical
  pass criteria. This is the contract for "what an EventStore is."
- **Error catalog.** Every `ActiveGraphError` subclass keeps its name
  (PascalCase), its message format, and its `More:` link. The
  per-error reference pages stay valid for both runtimes.

### 5.2 What is allowed to drift

- **File layout.** TS prefers fewer files; some Python files merge
  (e.g., the `*_errors.py` triplet under runtime → one `errors.ts`).
- **Test runner harness.** `conftest.py` fixtures become vitest
  `beforeEach` / per-suite setup. `pytest.mark.postgres` becomes
  `describe.runIf(process.env.ACTIVEGRAPH_TEST_POSTGRES_URL)(...)`.
- **Snapshot file format.** Vitest stores inline `.snap` files by
  default; we use external `.txt` files (`expect(...).toMatchFileSnapshot(...)`)
  so the Python and TS suites can share the same on-disk snapshot if
  they choose.

### 5.3 New gates introduced by the port

- **TS strict type-check** over the whole repo (replaces the
  allowlist-based mypy gate; v1.0.5 starts clean).
- **`npm pack` completeness** — install the tarball into a scratch dir
  and run quickstart against it. Same shape as the Python wheel-
  completeness gate.
- **Cross-runtime fixture interop** — pick 3 representative recorded
  fixtures, replay each against both the Python and TS providers, diff
  the resulting trace. If the formats drift, CI fails.
- **API extractor** — typedoc + a "no breaking change" check on the
  exported types between commits.

### 5.4 What's deliberately not ported

- `scripts/audit_docstrings.py`, `scripts/audit_types.py`,
  `scripts/gate_docstrings.py`. Their TS equivalents (typedoc +
  `tsc --strict`) cover the same ground.
- The pip-install matrix (extras). Replaced by per-package installs.

---

## 6. CI gate parity

| Python gate                          | TS equivalent                                              |
|--------------------------------------|------------------------------------------------------------|
| `pytest`                             | `pnpm -r test` (vitest, all packages)                      |
| `mypy --strict` (allowlist)          | `tsc -b` over the workspace; strict on day one             |
| docstring coverage                   | typedoc + missing-public-docs lint rule                    |
| broken-link gate                     | port the script (lychee or markdown-link-check)            |
| wheel-completeness                   | `npm pack` → install → run quickstart                      |
| version-sync                         | changesets handles it; small script for `__version__` parity |
| Postgres tests                       | gated by `ACTIVEGRAPH_TEST_POSTGRES_URL`, identical        |
| LLM determinism                      | recorded-provider replay diff, identical                   |

---

## 7. Risk register

- **Pattern matcher subtleties.** `runtime/patterns.py` is 946 LOC of
  Cypher-subset parsing and matching with NOT EXISTS and temporal
  predicates. Plan budget: 1 week for a TS port + the existing test
  suite as the spec. Pre-mitigation: extract the grammar into a
  separate file with a fuzzer test in both runtimes.
- **Determinism of float formatting / JSON encoding.** Python's
  `json.dumps` and Node's `JSON.stringify` produce different output
  for some floats (`1.0` vs `1`). The serde layer must canonicalize
  before write. Already a known problem; the SQLite store's serde
  module is the one place to fix it.
- **Snapshot rebaseline.** We will need to rebaseline trace snapshots
  once for trivial differences (timestamp formatting, integer vs
  float in payloads). After rebaseline, lock and gate strictly.
- **Decorator → factory migration cost in docs/examples.** Every code
  block in docs has `@behavior`. Mechanical replacement, but every
  page needs touching. Tracked under Phase 6.
- **No equivalent to setuptools entry points.** Pack discovery becomes
  explicit. Slight regression in ergonomics; mitigated by §2.7's
  `keywords: ["activegraph-pack"]` convention if needed in v2.1.
- **Pydantic-specific error messages in user-facing errors.** The
  `output_schema must be a Pydantic BaseModel subclass…` error needs
  rewriting for Zod. Generally: any error message that names Pydantic
  has to be retranslated. Catalog of these is small (grep
  `errors.py` / `llm/errors.py`).

---

## 8. Decisions locked

Confirmed before Phase 0 begins. Each was a recommended option in an
earlier draft; the table below is the final answer plus the implication
for the rest of the plan.

| #  | Decision                              | Choice                                                              | Implication                                                                                              |
|----|---------------------------------------|---------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| D1 | Packaging                             | Monorepo of `@activegraph/*` packages                               | Mirrors Python extras. Umbrella `activegraph` re-exports core+memory+sqlite+diligence+CLI.               |
| D2 | Async model                           | Async-first; `await runtime.runGoal(...)`                           | Behaviors may be sync OR async; stores/LLM/tools async. Graph mutations stay sync (in-memory).            |
| D3 | Repo layout                           | New repo `activegraph-ts`                                           | Independent git history & CI. Cross-link from both READMEs. CONTRACT.md kept in sync manually.           |
| D4 | Python/TS relationship                | Peers — both evolve in lockstep                                     | New CONTRACT decisions apply to both; doc site shows code in both languages. Costs ~2x maintenance.       |
| D5 | Validation library                    | Standard Schema (Zod 4 default)                                     | Public APIs accept any `StandardSchemaV1`; docs and Diligence pack use Zod 4. Pluggable Valibot/ArkType. |
| D6 | CLI library                           | Commander                                                           | Boring, mature, ubiquitous. Citty/cac rejected for unfamiliarity / bundle-size irrelevance.              |
| D7 | Doc site                              | Keep mkdocs, add TS code blocks alongside Python                    | Preserves broken-link gate, mkdocstrings, and SEO. Code blocks gain a TS tab.                            |

D4 (peers) is the most consequential commitment. It means the v1.1
roadmap in `CONTRACT.md § v1.1` must be implemented twice (once per
runtime). The cross-language fixture-interop gate (§5.3) is what
catches drift; without it, the two runtimes will diverge silently.

---

## 9. What ships in v1.0.5

The first npm release. Scope-equivalent to `pip install activegraph`:

- `activegraph` (umbrella) — Graph, Runtime, defineBehavior et al.,
  InMemoryEventStore, SQLiteEventStore, the Diligence pack, CLI.
- Optional installs: `@activegraph/store-postgres`,
  `@activegraph/llm-anthropic`, `@activegraph/llm-openai`,
  `@activegraph/observability`.
- Same quickstart command (`npx activegraph quickstart`), same
  byte-deterministic output, same fork-and-diff demo.
- README updated to show TS code blocks; existing docs site continues
  to host concept pages with both Python and TS code samples.

After v1.0.5, the Python and TS runtimes evolve in lockstep. The
CONTRACT.md v1.1 roadmap items map straight onto the TS codebase
(they're language-agnostic design decisions).
