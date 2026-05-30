# Active Graph TypeScript port — notes

## Deferred Python test files

These Python test files don't port directly because they exercise
infrastructure that's Python-specific or that the TS port hasn't grown
yet. Each is logged here so future work can pick them up deliberately.

| Python file | Why deferred | TS path forward |
|-------------|--------------|-----------------|
| `tests/test_doc_links.py` | Walks markdown links in the Python doc tree (`docs/`). The TS port doesn't ship its own doc site yet — the Python `docs/` is shared. | Land when `apps/docs/` or equivalent exists. Use [lychee](https://github.com/lycheeverse/lychee) or `markdown-link-check`. |
| `tests/test_doc_site_reachable.py` | HTTP-fetches `docs.activegraph.ai` and asserts 200. The site is served from the Python repo's `mkdocs build`. | Reuse the Python gate; not a TS concern. |
| `tests/test_llms_txt.py` | Verifies the mkdocs `llms.txt` / `llms-full.txt` output. mkdocs-only. | Reuse the Python gate. |
| `tests/test_tutorial_snippets.py` | Asserts code snippets in `docs/quickstart.md` execute. The TS port has no tutorial yet. | Land when `apps/docs/quickstart.md` exists with TS code blocks. |
| `tests/test_operate_example.py` | Runs `examples/operate_a_run.py`. Python example. | Port `examples/operate-a-run.ts` (Phase 6 polish), then port this test. |
| `tests/test_resume_example.py` | Runs `examples/resume_and_fork.py`. Python example. | Covered structurally by `persistence.test.ts` + `fork.test.ts`. The example port is a follow-on. |

## Skipped (gated) tests

These run conditionally:

- **PostgresEventStore conformance** — 9 tests gated by
  `ACTIVEGRAPH_TEST_POSTGRES_URL`. Without the env var they're listed
  as skipped (not failed). Set it to a connection string to run:
  ```bash
  ACTIVEGRAPH_TEST_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/postgres \
    pnpm vitest run packages/store-postgres
  ```
- **npm-pack completeness** — three tests in
  `packages/cli/test/npm-pack-completeness.test.ts` that read each
  package's `dist/` to verify the tarball would include the right
  files. They print a `console.warn` and skip if `dist/` is missing
  for a package; in CI we run `pnpm -r build` first.

## Future cross-runtime gates

The wire-format contract test
(`packages/core/test/wire-format.test.ts`) plus the Python-shaped
fixture replay (`packages/core/test/cross-runtime-fixture.test.ts`)
cover the TS-side half of the peers contract (D4 in PORT-PLAN.md).
The full bytes-match gate that replays a TS fixture through the
Python runtime and a Python fixture through the TS runtime needs both
repos checked out in the same CI job — that workflow lives ahead.
