# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).

When you make a change to one of the `@activegraph/*` packages, add a
changeset describing it:

    pnpm changeset

Pick the bump level (patch / minor / major). Commit the generated
`.changeset/*.md` alongside your code. CI runs `pnpm release` on
merges to `main` to publish updated packages.

All `@activegraph/*` packages and the umbrella `activegraph` package
are version-linked — they release together with the same version
number (see `config.json` `linked`).
