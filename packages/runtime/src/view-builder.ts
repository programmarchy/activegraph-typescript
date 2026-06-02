// Constructs the View passed to a behavior as ctx.view.
//
// Honors the behavior's viewSpec — `types` to filter by object type,
// `around`/`depth` to scope to a neighborhood, `recentEvents` to cap the
// event window. Defaults match the Python implementation.

import type { Event, Graph } from "@activegraph/core";
import { View } from "@activegraph/core";

import type { AnyBehavior, ViewSpec } from "./behaviors.js";

export const DEFAULT_RECENT_EVENTS = 50;

export function buildView(behavior: AnyBehavior, event: Event, graph: Graph): View {
  const spec: ViewSpec | null = behavior.viewSpec;
  const aroundId = spec?.around !== undefined ? resolveEventPath(spec.around, event) : null;
  const depth = spec?.depth ?? 1;
  const legacySpec = spec as
    | (ViewSpec & { recent_events?: number; include_types?: string[] })
    | null;
  const recent = spec?.recentEvents ?? legacySpec?.recent_events ?? DEFAULT_RECENT_EVENTS;
  const types = spec?.types ?? legacySpec?.include_types ?? null;

  let objs = graph.allObjects();
  let rels = graph.allRelations();

  if (aroundId !== null) {
    const nbh = graph.neighborhood(aroundId, depth);
    objs = nbh.objects;
    rels = nbh.relations;
  }

  if (types !== null) {
    const set = new Set(types);
    objs = objs.filter((o) => set.has(o.type));
  }

  const events = graph.events.slice(-recent);
  return new View(objs, rels, [...events]);
}

export function resolveEventPath(expr: string, event: Event): string | null {
  // Supports both TS shorthand (`payload.object.id`) and the Python/docs
  // spelling (`event.payload.object.id`).
  const path = expr.startsWith("event.") ? expr.slice("event.".length).split(".") : expr.split(".");
  let cur: unknown = event;
  for (const seg of path) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return null;
    }
  }
  return typeof cur === "string" ? cur : null;
}
