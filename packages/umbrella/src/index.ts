// `activegraph` — umbrella package.
//
// Re-exports the default install bundle: core + runtime + in-memory store
// + SQLite store + packs + Diligence reference pack + CLI. Mirrors what
// `pip install activegraph` ships in the Python world.
//
// Optional providers live in their own packages:
//   - @activegraph/store-postgres
//   - @activegraph/llm-anthropic
//   - @activegraph/llm-openai
//   - @activegraph/observability

export * from "@activegraph/core";
export * from "@activegraph/runtime";
export * from "@activegraph/store-memory";
export * from "@activegraph/store-sqlite";
export * from "@activegraph/packs";
export { diligencePack } from "@activegraph/pack-diligence";
export { main as cli } from "@activegraph/cli";
