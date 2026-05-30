#!/usr/bin/env node
import { main } from "../dist/index.js";

main(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err?.stack ?? err);
    process.exit(1);
  });
