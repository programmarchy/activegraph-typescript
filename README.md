# Active Graph — TypeScript runtime

The TypeScript implementation of [Active Graph](../python/README.md).
An event-sourced reactive graph runtime for long-running, auditable,
agentic systems.

**Status:** Phase 0 — workspace bootstrap. No package source yet. The
port plan lives at [`../TS-PORT-PLAN.md`](../TS-PORT-PLAN.md).

## Layout

```
typescript/
├── packages/
│   ├── core/            @activegraph/core
│   ├── runtime/         @activegraph/runtime
│   ├── store-memory/    @activegraph/store-memory
│   ├── store-sqlite/    @activegraph/store-sqlite
│   ├── store-postgres/  @activegraph/store-postgres
│   ├── llm/             @activegraph/llm
│   ├── llm-anthropic/   @activegraph/llm-anthropic
│   ├── llm-openai/      @activegraph/llm-openai
│   ├── tools/           @activegraph/tools
│   ├── observability/   @activegraph/observability
│   ├── packs/           @activegraph/packs
│   ├── pack-diligence/  @activegraph/pack-diligence
│   ├── cli/             @activegraph/cli
│   └── umbrella/        activegraph (re-exports core + runtime + memory + sqlite + diligence + cli)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json        (workspace project references)
├── biome.json
├── vitest.config.ts
└── package.json
```

## Toolchain

| Concern        | Tool                              |
|----------------|-----------------------------------|
| Package mgr    | pnpm 9, workspace mode            |
| Build          | tsup (esbuild) per package        |
| Type-check     | tsc -b (project references)       |
| Test runner    | vitest                            |
| Lint + format  | biome                             |
| Release        | changesets (linked, public)       |
| Node target    | ≥ 20.10.0                         |

## Commands

    pnpm install              # install all workspace deps
    pnpm typecheck            # tsc -b over the whole workspace
    pnpm test                 # vitest run
    pnpm build                # build every package
    pnpm lint                 # biome check

## Next steps

See [`../TS-PORT-PLAN.md`](../TS-PORT-PLAN.md). Phase 1 ports
`@activegraph/core` (the pure data layer). Each subsequent phase adds
one more package family.
