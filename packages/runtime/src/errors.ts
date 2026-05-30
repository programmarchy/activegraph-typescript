// Runtime-specific error leaves.

import {
  ConfigurationError,
  ExecutionError,
  RegistrationError,
  ReplayError,
} from "@activegraph/core";

// --- configuration -------------------------------------------------------

export class InvalidRuntimeConfiguration extends ConfigurationError {
  static override readonly docSlug: string = "invalid-runtime-configuration";
}

export class InvalidArgumentType extends ConfigurationError {
  static override readonly docSlug: string = "invalid-argument-type";
}

export class IncompatibleRuntimeState extends ConfigurationError {
  static override readonly docSlug: string = "incompatible-runtime-state";
}

// --- registration --------------------------------------------------------

export class BehaviorNotFoundError extends RegistrationError {
  static override readonly docSlug: string = "behavior-not-found";
}

export class AmbiguousBehaviorError extends RegistrationError {
  static override readonly docSlug: string = "ambiguous-behavior-error";
}

export class ToolNotFoundError extends RegistrationError {
  static override readonly docSlug: string = "tool-not-found";
}

export class AmbiguousToolError extends RegistrationError {
  static override readonly docSlug: string = "ambiguous-tool-error";
}

export class InvalidToolRegistration extends RegistrationError {
  static override readonly docSlug: string = "invalid-tool-registration";
}

// --- execution -----------------------------------------------------------

export class BehaviorFailure extends ExecutionError {
  static override readonly docSlug: string = "behavior-failure";
}

export class ApprovalNotFoundError extends ExecutionError {
  static override readonly docSlug: string = "approval-not-found";
}

export class InvalidPatchLifecycleState extends ExecutionError {
  static override readonly docSlug: string = "invalid-patch-lifecycle-state";
}

export class RuntimeContextRequiredError extends ExecutionError {
  static override readonly docSlug: string = "runtime-context-required";
}

export class InternalEvaluatorError extends ExecutionError {
  static override readonly docSlug: string = "internal-evaluator-error";
}

export class InvalidActivateAfter extends ExecutionError {
  static override readonly docSlug: string = "invalid-activate-after";
}

// --- replay --------------------------------------------------------------

export class ReplayDivergenceError extends ReplayError {
  static override readonly docSlug: string = "replay-divergence-error";
}

// --- pattern -------------------------------------------------------------

export class UnsupportedPatternError extends RegistrationError {
  static override readonly docSlug: string = "unsupported-pattern-error";
}
