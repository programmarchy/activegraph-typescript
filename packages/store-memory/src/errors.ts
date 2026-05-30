// Storage-layer error leaves under StorageError.

import { StorageError } from "@activegraph/core";

export class SchemaVersionMismatch extends StorageError {
  static override readonly docSlug: string = "schema-version-mismatch";
}

export class EventNotFoundError extends StorageError {
  static override readonly docSlug: string = "event-not-found-error";
}

export class DuplicateEventError extends StorageError {
  static override readonly docSlug: string = "duplicate-event-error";
}

export class CorruptedEventPayloadError extends StorageError {
  static override readonly docSlug: string = "corrupted-event-payload-error";
}

export class NonSerializableEventError extends StorageError {
  static override readonly docSlug: string = "non-serializable-event-error";
}

export class InvalidStoreURL extends StorageError {
  static override readonly docSlug: string = "invalid-store-url";
}
