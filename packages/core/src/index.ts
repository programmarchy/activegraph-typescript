// @activegraph/core — pure data layer.
// No external dependencies. Every other package imports from here.

export type { Clock } from "./clock.js";
export { WallClock, FrozenClock, TickingClock } from "./clock.js";

export type { Event, EventInit, EventPayload } from "./event.js";
export { makeEvent, eventToJSON } from "./event.js";

export type { Patch, PatchOp, PatchStatus } from "./patch.js";
export { PATCH_OPS, patchToJSON, patchFromJSON } from "./patch.js";

export { IDGen } from "./ids.js";

export type { Frame } from "./frame.js";
export { makeFrame } from "./frame.js";

export type { Policy } from "./policy.js";
export { makePolicy } from "./policy.js";

export {
  ActiveGraphError,
  ConfigurationError,
  RegistrationError,
  ExecutionError,
  ReplayError,
  StorageError,
  PatternError,
  PackError,
  MissingOptionalDependency,
  internalBugFields,
  DOCS_BASE_URL,
  GITHUB_NEW_ISSUE_URL,
} from "./errors.js";
export type { ErrorFields, InternalBugFields, InternalBugInput } from "./errors.js";

export type {
  ObjectNode,
  Relation,
  GraphOptions,
  EventListener,
  EventStoreSink,
  ObjectValidator,
  RelationValidator,
  WhereClause,
} from "./graph.js";
export { Graph, applyEvent, evaluateWhere, evalWhereOnObject } from "./graph.js";

export { View } from "./view.js";

export { Trace, formatEvent } from "./trace/printer.js";
export { causalChain } from "./trace/causal.js";
