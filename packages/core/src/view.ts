// Read-only scoped slice of the graph passed to behaviors as ctx.view.

import type { Event } from "./event.js";
import type { ObjectNode, Relation, WhereClause } from "./graph.js";
import { evalWhereOnObject } from "./graph.js";

export class View {
  constructor(
    private readonly _objects: ObjectNode[],
    private readonly _relations: Relation[],
    private readonly _events: Event[],
  ) {}

  objects(opts: { type?: string; where?: WhereClause } = {}): ObjectNode[] {
    let out = this._objects;
    if (opts.type !== undefined) out = out.filter((o) => o.type === opts.type);
    if (opts.where !== undefined) {
      const w = opts.where;
      out = out.filter((o) => evalWhereOnObject(w, o));
    }
    return [...out];
  }

  relations(opts: { type?: string } = {}): Relation[] {
    let out = this._relations;
    if (opts.type !== undefined) out = out.filter((r) => r.type === opts.type);
    return [...out];
  }

  events(opts: { type?: string } = {}): Event[] {
    let out = this._events;
    if (opts.type !== undefined) out = out.filter((e) => e.type === opts.type);
    return [...out];
  }
}
