// ActiveGraphError hierarchy. The error format and the class tree are
// part of the public contract.
//
// Every framework error inherits from ActiveGraphError and renders as:
//
//     <ErrorClass>: <one-line summary>
//
//     What failed:
//       <specific thing that went wrong>
//
//     Why:
//       <root cause>
//
//     How to fix:
//       <concrete action>
//
//     More:
//       https://docs.activegraph.ai/errors/<slug>

export const DOCS_BASE_URL = "https://docs.activegraph.ai";
export const GITHUB_NEW_ISSUE_URL =
  "https://github.com/yoheinakajima/activegraph/issues/new";

export interface ErrorFields {
  whatFailed?: string;
  why?: string;
  howToFix?: string;
  context?: Record<string, unknown>;
}

function indentContinuation(text: string, indent = "  "): string {
  const lines = text.split("\n");
  if (lines.length === 1) return lines[0] ?? "";
  return (
    lines[0] +
    "\n" +
    lines
      .slice(1)
      .map((line) => (line.length > 0 ? indent + line : line))
      .join("\n")
  );
}

export class ActiveGraphError extends Error {
  static readonly docSlug: string = "active-graph-error";

  readonly summary: string;
  readonly whatFailed: string;
  readonly why: string;
  readonly howToFix: string;
  readonly context: Record<string, unknown>;

  constructor(summary: string, fields: ErrorFields = {}) {
    const whatFailed = fields.whatFailed ?? "";
    const why = fields.why ?? "";
    const howToFix = fields.howToFix ?? "";
    const isStructured = whatFailed !== "" && why !== "" && howToFix !== "";
    super(
      isStructured
        ? ActiveGraphError.formatStructured({
            cls: new.target as unknown as { name: string; docSlug?: string },
            summary,
            whatFailed,
            why,
            howToFix,
          })
        : summary,
    );
    this.name = (new.target as { name: string }).name;
    this.summary = summary;
    this.whatFailed = whatFailed;
    this.why = why;
    this.howToFix = howToFix;
    this.context = { ...(fields.context ?? {}) };
    Object.setPrototypeOf(this, new.target.prototype);
  }

  isStructured(): boolean {
    return this.whatFailed !== "" && this.why !== "" && this.howToFix !== "";
  }

  get docUrl(): string {
    const slug =
      (this.constructor as typeof ActiveGraphError).docSlug ??
      ActiveGraphError.docSlug;
    return `${DOCS_BASE_URL}/errors/${slug}`;
  }

  private static formatStructured(args: {
    cls: { name: string; docSlug?: string };
    summary: string;
    whatFailed: string;
    why: string;
    howToFix: string;
  }): string {
    const slug = args.cls.docSlug ?? ActiveGraphError.docSlug;
    const url = `${DOCS_BASE_URL}/errors/${slug}`;
    return [
      `${args.cls.name}: ${args.summary}`,
      "",
      "What failed:",
      `  ${indentContinuation(args.whatFailed)}`,
      "",
      "Why:",
      `  ${indentContinuation(args.why)}`,
      "",
      "How to fix:",
      `  ${indentContinuation(args.howToFix)}`,
      "",
      "More:",
      `  ${url}`,
    ].join("\n");
  }
}

// --- Category bases -------------------------------------------------------

export class ConfigurationError extends ActiveGraphError {
  static override readonly docSlug: string = "configuration-error";
}

export class RegistrationError extends ActiveGraphError {
  static override readonly docSlug: string = "registration-error";
}

export class ExecutionError extends ActiveGraphError {
  static override readonly docSlug: string = "execution-error";
}

export class ReplayError extends ActiveGraphError {
  static override readonly docSlug: string = "replay-error";
}

export class StorageError extends ActiveGraphError {
  static override readonly docSlug: string = "storage-error";
}

export class PatternError extends ActiveGraphError {
  static override readonly docSlug: string = "pattern-error";
}

export class PackError extends ActiveGraphError {
  static override readonly docSlug: string = "pack-error";
}

export class MissingOptionalDependency extends RegistrationError {
  static override readonly docSlug: string = "missing-optional-dependency";
  readonly pkg: string;
  readonly feature: string;
  readonly extras: string | null;

  constructor(args: { pkg: string; feature: string; extras?: string | null }) {
    const extras = args.extras ?? null;
    const installLine = extras
      ? `npm install @activegraph/${extras}`
      : `npm install ${args.pkg}`;
    super(`${args.feature} requires the '${args.pkg}' npm package`, {
      whatFailed: `While initializing ${args.feature}, the import of '${args.pkg}' failed because the package is not installed in this environment.`,
      why: "The framework keeps optional subsystems off the default install path so a minimal install stays small. Each optional subsystem declares its dependency explicitly; missing it produces this error rather than failing later with a confusing module-not-found error deep inside the subsystem.",
      howToFix: `Install the optional dependency:\n    ${installLine}\n\nIf you don't need ${args.feature}, the bare \`activegraph\` install does not depend on '${args.pkg}' — the error only fires when the subsystem is actually used.`,
      context: {
        package: args.pkg,
        feature: args.feature,
        ...(extras !== null ? { extras } : {}),
      },
    });
    this.pkg = args.pkg;
    this.feature = args.feature;
    this.extras = extras;
  }
}

// --- Internal-bug helper --------------------------------------------------

export interface InternalBugInput {
  summary: string;
  whatHappened: string;
  whyInvariant: string;
  location: string;
  extraContext?: Record<string, unknown>;
}

export interface InternalBugFields {
  summary: string;
  whatFailed: string;
  why: string;
  howToFix: string;
  context: Record<string, unknown>;
}

export function internalBugFields(input: InternalBugInput): InternalBugFields {
  // Keep the version literal aligned with the umbrella package's version.
  const frameworkVersion = "2.0.0-dev";
  const ctx: Record<string, unknown> = {
    internal: true,
    framework_version: frameworkVersion,
    internal_error_location: input.location,
    report_url: GITHUB_NEW_ISSUE_URL,
    ...(input.extraContext ?? {}),
  };
  return {
    summary: input.summary,
    whatFailed: input.whatHappened,
    why: input.whyInvariant,
    howToFix: [
      "This is a framework bug, not a problem with your code.",
      "Please file an issue and include the framework version, the",
      "internal error location, and the full message above:",
      `    ${GITHUB_NEW_ISSUE_URL}`,
      "",
      `  framework version:   activegraph ${frameworkVersion}`,
      `  internal location:   ${input.location}`,
    ].join("\n"),
    context: ctx,
  };
}
