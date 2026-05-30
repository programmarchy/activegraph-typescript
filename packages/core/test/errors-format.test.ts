// Errors format — the locked v1.0 contract for every structured error.
//
// Layout:
//   <ErrorClass>: <one-line summary>
//
//   What failed:
//     <prose, possibly multi-line>
//
//   Why:
//     <prose>
//
//   How to fix:
//     <prose>
//
//   More:
//     https://docs.activegraph.ai/errors/<slug>
//
// Each structured-error site re-derives the same format; this test pins
// the layout so a change to indentContinuation / formatStructured /
// docSlug regresses loud.

import { describe, expect, it } from "vitest";

import {
  ActiveGraphError,
  ConfigurationError,
  DOCS_BASE_URL,
  ExecutionError,
  MissingOptionalDependency,
  PackError,
  PatternError,
  RegistrationError,
  ReplayError,
  StorageError,
  internalBugFields,
} from "../src/index.js";

describe("ActiveGraphError format", () => {
  it("structured construction produces the canonical layout", () => {
    const e = new ActiveGraphError("summary line", {
      whatFailed: "a specific thing",
      why: "the root cause",
      howToFix: "do this",
    });
    expect(e.message).toBe(
      [
        "ActiveGraphError: summary line",
        "",
        "What failed:",
        "  a specific thing",
        "",
        "Why:",
        "  the root cause",
        "",
        "How to fix:",
        "  do this",
        "",
        "More:",
        `  ${DOCS_BASE_URL}/errors/active-graph-error`,
      ].join("\n"),
    );
  });

  it("unstructured construction (summary only) leaves message bare", () => {
    const e = new ActiveGraphError("just a summary");
    expect(e.message).toBe("just a summary");
    expect(e.isStructured()).toBe(false);
  });

  it("multi-line fields preserve their indent under the heading", () => {
    const e = new ActiveGraphError("x", {
      whatFailed: "line 1\nline 2\nline 3",
      why: "y",
      howToFix: "z",
    });
    expect(e.message).toContain("What failed:\n  line 1\n  line 2\n  line 3");
  });

  it("docUrl derives from the subclass docSlug", () => {
    expect(new ConfigurationError("x", { whatFailed: "a", why: "b", howToFix: "c" }).docUrl).toBe(
      `${DOCS_BASE_URL}/errors/configuration-error`,
    );
    expect(new ReplayError("x", { whatFailed: "a", why: "b", howToFix: "c" }).docUrl).toBe(
      `${DOCS_BASE_URL}/errors/replay-error`,
    );
  });

  it("name is the concrete subclass name", () => {
    expect(new ConfigurationError("x").name).toBe("ConfigurationError");
    expect(new PatternError("x").name).toBe("PatternError");
    expect(new StorageError("x").name).toBe("StorageError");
    expect(new PackError("x").name).toBe("PackError");
    expect(new ExecutionError("x").name).toBe("ExecutionError");
    expect(new RegistrationError("x").name).toBe("RegistrationError");
  });
});

describe("MissingOptionalDependency", () => {
  it("install line uses pip-equivalent (npm install @activegraph/<extras>) when extras given", () => {
    const e = new MissingOptionalDependency({
      pkg: "pg",
      feature: "PostgresEventStore",
      extras: "store-postgres",
    });
    expect(e.howToFix).toContain("npm install @activegraph/store-postgres");
  });

  it("falls back to npm install <pkg> when no extras", () => {
    const e = new MissingOptionalDependency({
      pkg: "some-pkg",
      feature: "SomeFeature",
    });
    expect(e.howToFix).toContain("npm install some-pkg");
  });

  it("multi-inherits the contract: instanceof RegistrationError + ActiveGraphError", () => {
    const e = new MissingOptionalDependency({ pkg: "x", feature: "y" });
    expect(e).toBeInstanceOf(RegistrationError);
    expect(e).toBeInstanceOf(ActiveGraphError);
  });
});

describe("internalBugFields helper", () => {
  it("produces context with framework_version + report_url + location", () => {
    const f = internalBugFields({
      summary: "unknown widget",
      whatHappened: "the X received Y",
      whyInvariant: "should never get Y",
      location: "core/foo:fn",
      extraContext: { extra: 1 },
    });
    expect(f.context.internal).toBe(true);
    expect(f.context.internal_error_location).toBe("core/foo:fn");
    expect(String(f.context.report_url)).toContain("github.com");
    expect(f.context.extra).toBe(1);
    expect(f.howToFix).toContain("framework bug");
  });
});
