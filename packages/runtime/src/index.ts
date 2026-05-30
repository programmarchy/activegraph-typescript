// @activegraph/runtime — runtime, behaviors, dispatch, budget, patterns.

export type {
  BehaviorHandler,
  RelationBehaviorHandler,
  LLMBehaviorHandler,
  ViewSpec,
  BehaviorDef,
  RelationBehaviorDef,
  LLMBehaviorDef,
  OutputSchema,
  Behavior,
  RelationBehavior,
  LLMBehavior,
  AnyBehavior,
} from "./behaviors.js";
export {
  defineBehavior,
  defineRelationBehavior,
  defineLLMBehavior,
  getRegistry,
  clearRegistry,
} from "./behaviors.js";

export type { RuntimeContext } from "./context.js";

export { Budget } from "./budget.js";
export type { BudgetLimits } from "./budget.js";

export { Runtime } from "./runtime.js";
export type { RuntimeOptions } from "./runtime.js";

export {
  Pattern,
  PatternMatcher,
  Match,
  MatchHandle,
  Comparison,
  AndExpr,
  NotExpr,
  NotExists,
  parse as parsePattern,
} from "./patterns.js";
export type {
  PatternNode,
  PatternRel,
  RelDirection,
  MatchClause,
  WhereExpr,
  ComparisonOp,
  PrimitiveLiteral,
} from "./patterns.js";

export { structuralDiff } from "./diff.js";
export type { Diff, DivergentObject, DivergentRelation } from "./diff.js";

export { buildView, resolveEventPath, DEFAULT_RECENT_EVENTS } from "./view-builder.js";

export {
  InvalidRuntimeConfiguration,
  InvalidArgumentType,
  IncompatibleRuntimeState,
  BehaviorNotFoundError,
  AmbiguousBehaviorError,
  ToolNotFoundError,
  AmbiguousToolError,
  InvalidToolRegistration,
  BehaviorFailure,
  ApprovalNotFoundError,
  InvalidPatchLifecycleState,
  RuntimeContextRequiredError,
  InternalEvaluatorError,
  InvalidActivateAfter,
  ReplayDivergenceError,
  UnsupportedPatternError,
} from "./errors.js";
