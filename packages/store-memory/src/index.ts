// @activegraph/store-memory — in-memory EventStore + the EventStore
// interface itself (so other packages can import the interface without
// dragging a backend in).

export type { EventStore, RunRecord, IterEventsOptions } from "./base.js";
export { replayInto } from "./base.js";

export { InMemoryEventStore } from "./memory.js";

export {
  SchemaVersionMismatch,
  EventNotFoundError,
  DuplicateEventError,
  CorruptedEventPayloadError,
  NonSerializableEventError,
  InvalidStoreURL,
} from "./errors.js";

export { conformanceCases } from "./conformance.js";
export type { ConformanceCase, ConformanceContext, ExpectLike } from "./conformance.js";
