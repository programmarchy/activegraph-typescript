// Cypher subset parser + matcher.
//
// A strict subset of Cypher. Anything outside the subset throws
// UnsupportedPatternError pointing at the offending token.
//
// Supported:
//   * Node patterns:          (var:type {prop: value, ...})
//   * Relationship patterns:  (a)-[var:rel_type]->(b)
//                             (a)<-[var:rel_type]-(b)
//   * Multi-hop:              (a)-[:r1]->(b)-[:r2]->(c)
//   * WHERE:                  comparisons, AND, NOT, NOT EXISTS { ... }
//   * `{prop: value}` is EQUALITY ONLY. Comparisons go in WHERE.
//
// Refused (throws):
//   RETURN, OPTIONAL MATCH, variable-length paths, WITH, OR, MATCH,
//   CREATE, MERGE, undirected relationships, untyped relationships.

import type { Event, Graph, ObjectNode, Relation } from "@activegraph/core";

import { UnsupportedPatternError } from "./errors.js";

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export interface PatternNode {
  var: string | null;
  type: string | null;
  properties: Record<string, PrimitiveLiteral>;
}

export type RelDirection = "right" | "left";

export interface PatternRel {
  var: string | null;
  type: string;
  direction: RelDirection;
}

export interface MatchClause {
  nodes: PatternNode[];
  /** rels[i] connects nodes[i] to nodes[i+1]. */
  rels: PatternRel[];
}

export type WhereExpr = Comparison | AndExpr | NotExpr | NotExists;

export class Comparison {
  readonly kind = "comparison" as const;
  constructor(
    readonly leftPath: string[],
    readonly op: ComparisonOp,
    readonly rightValue: PrimitiveLiteral | undefined,
    readonly rightPath: string[] | undefined,
  ) {}
}

export class AndExpr {
  readonly kind = "and" as const;
  constructor(readonly parts: WhereExpr[]) {}
}

export class NotExpr {
  readonly kind = "not" as const;
  constructor(readonly inner: WhereExpr) {}
}

export class NotExists {
  readonly kind = "not_exists" as const;
  constructor(readonly subMatch: MatchClause) {}
}

export class Pattern {
  constructor(
    readonly source: string,
    readonly match: MatchClause,
    readonly where: WhereExpr | null,
  ) {}

  compile(): PatternMatcher {
    return new PatternMatcher(this);
  }
}

export type ComparisonOp = "=" | "<" | ">" | "<=" | ">=" | "!=" | "<>";
export type PrimitiveLiteral = string | number | boolean | null;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | "ident"
  | "number"
  | "string"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "lbrace"
  | "rbrace"
  | "colon"
  | "comma"
  | "dot"
  | "minus"
  | "arrow_right"
  | "arrow_left"
  | "op"
  | "keyword"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  start: number;
}

const KEYWORDS = new Set([
  "AND",
  "OR",
  "NOT",
  "EXISTS",
  "WHERE",
  "TRUE",
  "FALSE",
  "NULL",
  "RETURN",
  "OPTIONAL",
  "WITH",
  "MATCH",
  "CREATE",
  "MERGE",
  "UNION",
  "UNWIND",
  "SET",
  "DELETE",
  "DETACH",
]);

const COMPARISON_OPS = new Set<ComparisonOp>(["=", "<", ">", "<=", ">=", "!=", "<>"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen", value: "(", start: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ")", start: i });
      i++;
      continue;
    }
    if (ch === "[") {
      tokens.push({ type: "lbracket", value: "[", start: i });
      i++;
      continue;
    }
    if (ch === "]") {
      tokens.push({ type: "rbracket", value: "]", start: i });
      i++;
      continue;
    }
    if (ch === "{") {
      tokens.push({ type: "lbrace", value: "{", start: i });
      i++;
      continue;
    }
    if (ch === "}") {
      tokens.push({ type: "rbrace", value: "}", start: i });
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ type: "colon", value: ":", start: i });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ",", start: i });
      i++;
      continue;
    }
    if (ch === ".") {
      tokens.push({ type: "dot", value: ".", start: i });
      i++;
      continue;
    }

    // Arrows: -> and <-
    if (ch === "-" && input[i + 1] === ">") {
      tokens.push({ type: "arrow_right", value: "->", start: i });
      i += 2;
      continue;
    }
    if (ch === "<" && input[i + 1] === "-") {
      tokens.push({ type: "arrow_left", value: "<-", start: i });
      i += 2;
      continue;
    }
    if (ch === "-") {
      tokens.push({ type: "minus", value: "-", start: i });
      i++;
      continue;
    }

    // Multi-char comparison ops
    if (ch === "<" && input[i + 1] === "=") {
      tokens.push({ type: "op", value: "<=", start: i });
      i += 2;
      continue;
    }
    if (ch === ">" && input[i + 1] === "=") {
      tokens.push({ type: "op", value: ">=", start: i });
      i += 2;
      continue;
    }
    if (ch === "!" && input[i + 1] === "=") {
      tokens.push({ type: "op", value: "!=", start: i });
      i += 2;
      continue;
    }
    if (ch === "<" && input[i + 1] === ">") {
      tokens.push({ type: "op", value: "<>", start: i });
      i += 2;
      continue;
    }
    if (ch === "<" || ch === ">" || ch === "=") {
      tokens.push({ type: "op", value: ch, start: i });
      i++;
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let str = "";
      while (i < input.length && input[i] !== quote) {
        str += input[i];
        i++;
      }
      if (i >= input.length) {
        throw UnsupportedPatternError_syntax(`unterminated string literal`, input.slice(start));
      }
      i++; // skip closing quote
      tokens.push({ type: "string", value: str, start });
      continue;
    }

    // Numbers (int / float)
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      const start = i;
      if (ch === "-") i++;
      while (i < input.length && /[0-9]/.test(input[i]!)) i++;
      if (input[i] === ".") {
        i++;
        while (i < input.length && /[0-9]/.test(input[i]!)) i++;
      }
      tokens.push({ type: "number", value: input.slice(start, i), start });
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i]!)) i++;
      const value = input.slice(start, i);
      const upper = value.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", value: upper, start });
      } else {
        tokens.push({ type: "ident", value, start });
      }
      continue;
    }

    // Variable-length paths: -[*...]-
    if (ch === "*") {
      throw refusedFeature(
        "variable-length path",
        "Variable-length paths (-[*1..3]-) land in a later release. Express the depth explicitly with multi-hop patterns.",
        input.slice(i),
      );
    }

    throw UnsupportedPatternError_syntax(
      `unexpected character '${ch}'`,
      input.slice(i, Math.min(i + 16, input.length)),
    );
  }

  tokens.push({ type: "eof", value: "", start: input.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function UnsupportedPatternError_syntax(what: string, at: string): UnsupportedPatternError {
  return new UnsupportedPatternError(`pattern does not parse: ${what}`, {
    whatFailed: `While parsing the pattern: ${what}.${at ? `\n  at: ${JSON.stringify(at)}` : ""}`,
    why: "Behaviors register their pattern subscriptions at startup, so the parser refuses ambiguous syntax now rather than risk matching a pattern the developer did not actually write.",
    howToFix:
      "Fix the syntax. The supported subset is documented at https://docs.activegraph.ai/concepts/patterns",
    context: { at },
  });
}

function refusedFeature(feature: string, workaround: string, at: string): UnsupportedPatternError {
  return new UnsupportedPatternError(`${feature} is not supported in the Cypher subset`, {
    whatFailed: `The pattern uses ${feature}. The pattern subset refuses this feature at registration time — long before any match runs.`,
    why: "The pattern subset is deliberately small and exhaustively testable. A fuzzy superset of Cypher would let patterns appear to match input they did not actually match.",
    howToFix: workaround,
    context: { feature, at },
  });
}

class Parser {
  private pos = 0;
  constructor(
    private readonly source: string,
    private readonly tokens: Token[],
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1]!;
  }

  private next(): Token {
    const t = this.tokens[this.pos]!;
    this.pos++;
    return t;
  }

  private expect(type: TokenType, value?: string): Token {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw UnsupportedPatternError_syntax(
        `expected ${type}${value ? ` '${value}'` : ""}, got ${t.type} '${t.value}'`,
        this.source.slice(t.start, t.start + 16),
      );
    }
    return this.next();
  }

  parse(): Pattern {
    this.refuseTopLevelKeywords();
    const match = this.parseMatchClause();
    let where: WhereExpr | null = null;
    if (this.peek().type === "keyword" && this.peek().value === "WHERE") {
      this.next();
      where = this.parseWhereExpr();
    }
    // Anything left at the top level is trailing junk or a refused
    // construct.
    const tail = this.peek();
    if (tail.type !== "eof") {
      if (tail.type === "keyword") {
        this.refuseTopLevelKeywords();
      }
      throw UnsupportedPatternError_syntax(
        `trailing junk after pattern at '${tail.value}'`,
        this.source.slice(tail.start, tail.start + 16),
      );
    }
    return new Pattern(this.source, match, where);
  }

  private refuseTopLevelKeywords(): void {
    const t = this.peek();
    if (t.type !== "keyword") return;
    const at = this.source.slice(t.start, t.start + 32);
    const kw = t.value;
    const REFUSALS: Record<string, [string, string]> = {
      RETURN: [
        "RETURN",
        "Pattern subscriptions do not return values. Bindings reach the behavior body via ctx.matches — read them there.",
      ],
      OPTIONAL: [
        "OPTIONAL MATCH",
        "OPTIONAL MATCH expresses 'match if present, else null.' The runtime has no null binding. Register a second behavior whose pattern is the optional sub-pattern.",
      ],
      WITH: [
        "WITH",
        "WITH composes a pipeline of matches. The runtime evaluates each pattern as a flat match; pipelines are expressed as multiple behaviors chained through emitted events.",
      ],
      MATCH: [
        "MATCH",
        "Patterns start directly with the node — `(a:claim)`, not `MATCH (a:claim)`.",
      ],
      CREATE: ["CREATE", "Patterns are read-only; mutation belongs in the behavior body."],
      MERGE: ["MERGE", "Patterns are read-only; mutation belongs in the behavior body."],
      UNION: ["UNION", "Register two behaviors with their own patterns instead."],
      UNWIND: [
        "UNWIND",
        "Patterns don't iterate over collections. Express the iteration in the behavior body.",
      ],
      SET: ["SET", "Patterns are read-only; mutation belongs in the behavior body."],
      DELETE: ["DELETE", "Patterns are read-only; mutation belongs in the behavior body."],
      DETACH: ["DETACH", "Patterns are read-only; mutation belongs in the behavior body."],
    };
    const r = REFUSALS[kw];
    if (r !== undefined) {
      throw refusedFeature(r[0], r[1], at);
    }
  }

  private parseMatchClause(): MatchClause {
    const nodes: PatternNode[] = [];
    const rels: PatternRel[] = [];

    nodes.push(this.parseNode());

    while (true) {
      const t = this.peek();
      // Possible continuations: -[...]-> | <-[...]- | -[...]-(undirected, refused)
      if (t.type === "arrow_left" || t.type === "minus") {
        const rel = this.parseRel();
        rels.push(rel);
        nodes.push(this.parseNode());
        continue;
      }
      break;
    }

    return { nodes, rels };
  }

  private parseNode(): PatternNode {
    this.expect("lparen");
    let varName: string | null = null;
    let typ: string | null = null;
    const props: Record<string, PrimitiveLiteral> = {};

    // [ident] [: type] [{ ... }]
    if (this.peek().type === "ident") {
      varName = this.next().value;
    }
    if (this.peek().type === "colon") {
      this.next();
      const t = this.expect("ident");
      typ = t.value;
    }
    if (this.peek().type === "lbrace") {
      this.next();
      while (this.peek().type !== "rbrace") {
        const key = this.expect("ident").value;
        this.expect("colon");
        props[key] = this.parseLiteral();
        if (this.peek().type === "comma") this.next();
      }
      this.expect("rbrace");
    }
    this.expect("rparen");
    return { var: varName, type: typ, properties: props };
  }

  private parseRel(): PatternRel {
    // Two shapes:
    //   -[var:type]->
    //   <-[var:type]-
    const first = this.next();
    let direction: RelDirection;
    let openMinus: boolean;
    if (first.type === "minus") {
      direction = "right";
      openMinus = true;
    } else if (first.type === "arrow_left") {
      direction = "left";
      openMinus = true; // emitted at the "<-" boundary; treat the same downstream
    } else {
      throw UnsupportedPatternError_syntax(
        `expected relationship start, got '${first.value}'`,
        this.source.slice(first.start, first.start + 16),
      );
    }
    void openMinus;

    this.expect("lbracket");
    let varName: string | null = null;
    let typ: string | null = null;
    if (this.peek().type === "ident") {
      varName = this.next().value;
    }
    if (this.peek().type === "colon") {
      this.next();
      typ = this.expect("ident").value;
    }
    this.expect("rbracket");

    if (typ === null) {
      throw refusedFeature(
        "untyped relationship",
        "Relationships must declare a type — `-[:depends_on]->` not `-[]->`. Pattern matching needs the type to know what edges to walk.",
        this.source,
      );
    }

    // Closing side: -> for "right", - (and nothing) for "left"
    const second = this.peek();
    if (direction === "right") {
      if (second.type === "arrow_right") {
        this.next();
      } else if (second.type === "minus") {
        throw refusedFeature(
          "undirected relationship",
          "Relationships must declare a direction. Use `-[:type]->` or `<-[:type]-` rather than `-[:type]-`.",
          this.source,
        );
      } else {
        throw UnsupportedPatternError_syntax(
          `expected '->' after relationship, got '${second.value}'`,
          this.source.slice(second.start, second.start + 16),
        );
      }
    } else {
      if (second.type === "minus") {
        this.next();
      } else {
        throw UnsupportedPatternError_syntax(
          `expected '-' after '<-[..]', got '${second.value}'`,
          this.source.slice(second.start, second.start + 16),
        );
      }
    }
    return { var: varName, type: typ, direction };
  }

  private parseLiteral(): PrimitiveLiteral {
    const t = this.peek();
    if (t.type === "number") {
      this.next();
      return Number(t.value);
    }
    if (t.type === "string") {
      this.next();
      return t.value;
    }
    if (t.type === "keyword") {
      if (t.value === "TRUE") {
        this.next();
        return true;
      }
      if (t.value === "FALSE") {
        this.next();
        return false;
      }
      if (t.value === "NULL") {
        this.next();
        return null;
      }
    }
    if (t.type === "ident") {
      // Refuse non-literal: { x: y } is comparison territory.
      throw refusedFeature(
        "non-literal node property value",
        "Node `{prop: value}` accepts literals (numbers, strings, booleans, NULL) only. Comparisons go in WHERE: `(a:claim) WHERE a.x = b.y`.",
        t.value,
      );
    }
    throw UnsupportedPatternError_syntax(`expected literal, got ${t.type} '${t.value}'`, t.value);
  }

  // --- WHERE parser ---

  private parseWhereExpr(): WhereExpr {
    const first = this.parseWhereAtom();
    const parts: WhereExpr[] = [first];
    while (true) {
      const t = this.peek();
      if (t.type === "keyword" && t.value === "AND") {
        this.next();
        parts.push(this.parseWhereAtom());
        continue;
      }
      if (t.type === "keyword" && t.value === "OR") {
        throw refusedFeature(
          "OR",
          "OR is not supported in WHERE — register two behaviors with the alternative patterns. The pattern subset is documented in CONTRACT v0.7 #8.",
          this.source.slice(t.start, t.start + 16),
        );
      }
      break;
    }
    return parts.length === 1 ? parts[0]! : new AndExpr(parts);
  }

  private parseWhereAtom(): WhereExpr {
    const t = this.peek();
    if (t.type === "keyword" && t.value === "NOT") {
      this.next();
      const next = this.peek();
      if (next.type === "keyword" && next.value === "EXISTS") {
        this.next();
        this.expect("lbrace");
        const sub = this.parseMatchClause();
        this.expect("rbrace");
        return new NotExists(sub);
      }
      return new NotExpr(this.parseWhereAtom());
    }
    return this.parseComparison();
  }

  private parseComparison(): Comparison {
    const leftPath = this.parsePath();
    const opTok = this.peek();
    if (opTok.type !== "op") {
      throw UnsupportedPatternError_syntax(
        `expected comparison operator, got '${opTok.value}'`,
        this.source.slice(opTok.start, opTok.start + 16),
      );
    }
    if (!COMPARISON_OPS.has(opTok.value as ComparisonOp)) {
      throw UnsupportedPatternError_syntax(
        `unsupported comparison operator '${opTok.value}'`,
        this.source.slice(opTok.start, opTok.start + 16),
      );
    }
    this.next();
    // RHS: literal or path
    const r = this.peek();
    if (r.type === "ident") {
      const rightPath = this.parsePath();
      return new Comparison(leftPath, opTok.value as ComparisonOp, undefined, rightPath);
    }
    const literal = this.parseLiteral();
    return new Comparison(leftPath, opTok.value as ComparisonOp, literal, undefined);
  }

  private parsePath(): string[] {
    const head = this.expect("ident").value;
    const path = [head];
    while (this.peek().type === "dot") {
      this.next();
      path.push(this.expect("ident").value);
    }
    return path;
  }
}

export function parse(source: string): Pattern {
  const tokens = tokenize(source);
  // Unmatched open paren — surface before the parser sees a stray eof.
  const opens = tokens.filter((t) => t.type === "lparen").length;
  const closes = tokens.filter((t) => t.type === "rparen").length;
  if (opens !== closes) {
    throw UnsupportedPatternError_syntax("unmatched parenthesis", source);
  }
  return new Parser(source, tokens).parse();
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

export class Match {
  constructor(readonly bindings: Record<string, string>) {}
}

export interface PatternMatchResult extends Match {
  // structural alias so tests can use either Match.bindings or m["var"]
  readonly [key: string]: string | Record<string, string>;
}

export class PatternMatcher {
  readonly source: string;

  constructor(readonly pattern: Pattern) {
    this.source = pattern.source;
  }

  static compile(source: string): PatternMatcher {
    return parse(source).compile();
  }

  matches(args: { event?: Event | null; graph: Graph }): MatchHandle[] {
    const baseMatches = this.matchClause(this.pattern.match, args.graph);
    if (this.pattern.where === null) return baseMatches.map((b) => new MatchHandle(b));
    return baseMatches
      .filter((b) => this.evalWhere(this.pattern.where!, b, args.graph))
      .map((b) => new MatchHandle(b));
  }

  // --- match a single match clause against the graph ---

  private matchClause(
    clause: MatchClause,
    graph: Graph,
  ): Array<Record<string, string>> {
    if (clause.nodes.length === 1) {
      return this.matchSingleNode(clause.nodes[0]!, graph).map((id) => bind(clause.nodes[0]!, id));
    }
    // Multi-hop: walk nodes/rels left-to-right, threading bindings.
    let frontier: Array<Record<string, string>> = this.matchSingleNode(
      clause.nodes[0]!,
      graph,
    ).map((id) => bind(clause.nodes[0]!, id));

    for (let i = 0; i < clause.rels.length; i++) {
      const rel = clause.rels[i]!;
      const targetNode = clause.nodes[i + 1]!;
      const next: Array<Record<string, string>> = [];
      for (const bindings of frontier) {
        const sourceId = nodeIdFromBindings(clause.nodes[i]!, bindings);
        if (sourceId === null) continue;
        for (const r of relationsMatching(rel, sourceId, graph)) {
          const otherId = rel.direction === "right" ? r.target : r.source;
          const tgtObj = graph.getObject(otherId);
          if (tgtObj === undefined) continue;
          if (!nodeMatches(targetNode, tgtObj)) continue;
          const nextBindings: Record<string, string> = { ...bindings };
          if (targetNode.var !== null) nextBindings[targetNode.var] = tgtObj.id;
          if (rel.var !== null) nextBindings[rel.var] = r.id;
          next.push(nextBindings);
        }
      }
      frontier = next;
    }
    return frontier;
  }

  private matchSingleNode(node: PatternNode, graph: Graph): string[] {
    const out: string[] = [];
    for (const obj of graph.allObjects()) {
      if (nodeMatches(node, obj)) out.push(obj.id);
    }
    return out;
  }

  private evalWhere(
    expr: WhereExpr,
    bindings: Record<string, string>,
    graph: Graph,
  ): boolean {
    switch (expr.kind) {
      case "and":
        return expr.parts.every((p) => this.evalWhere(p, bindings, graph));
      case "not":
        return !this.evalWhere(expr.inner, bindings, graph);
      case "not_exists":
        return !this.subMatchExists(expr.subMatch, bindings, graph);
      case "comparison":
        return this.evalComparison(expr, bindings, graph);
    }
  }

  private subMatchExists(
    sub: MatchClause,
    bindings: Record<string, string>,
    graph: Graph,
  ): boolean {
    // Find at least one match of `sub` that's consistent with the
    // outer bindings: any var shared with the outer scope must resolve
    // to the same id.
    const matches = this.matchClause(sub, graph);
    for (const m of matches) {
      let consistent = true;
      for (const [k, v] of Object.entries(m)) {
        if (bindings[k] !== undefined && bindings[k] !== v) {
          consistent = false;
          break;
        }
      }
      if (consistent) return true;
    }
    return false;
  }

  private evalComparison(
    c: Comparison,
    bindings: Record<string, string>,
    graph: Graph,
  ): boolean {
    const left = resolvePathValue(c.leftPath, bindings, graph);
    const right =
      c.rightPath !== undefined
        ? resolvePathValue(c.rightPath, bindings, graph)
        : c.rightValue;
    return applyComparison(left, c.op, right);
  }
}

export class MatchHandle extends Match {
  // No additional behavior; just an alias users can store.
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function bind(node: PatternNode, id: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (node.var !== null) out[node.var] = id;
  return out;
}

function nodeIdFromBindings(
  node: PatternNode,
  bindings: Record<string, string>,
): string | null {
  if (node.var === null) return null;
  return bindings[node.var] ?? null;
}

function nodeMatches(node: PatternNode, obj: ObjectNode): boolean {
  if (node.type !== null && obj.type !== node.type) return false;
  for (const [k, v] of Object.entries(node.properties)) {
    if (!shallowEqual((obj.data as Record<string, unknown>)[k], v)) return false;
  }
  return true;
}

function relationsMatching(
  rel: PatternRel,
  sourceId: string,
  graph: Graph,
): Relation[] {
  // For "right" direction the binding's source is the source side; for "left"
  // we walk the inverse — incoming edges of the bound node.
  if (rel.direction === "right") {
    return graph.relations({ source: sourceId, type: rel.type });
  }
  return graph.relations({ target: sourceId, type: rel.type });
}

function resolvePathValue(
  path: string[],
  bindings: Record<string, string>,
  graph: Graph,
): unknown {
  if (path.length === 0) return undefined;
  const head = path[0]!;
  const objId = bindings[head];
  if (objId === undefined) return undefined;
  if (path.length === 1) return objId; // bare var resolves to id
  const obj = graph.getObject(objId);
  if (obj === undefined) return undefined;
  // Fields recognized at the object's root level. `type` and `id` are
  // synonyms for the structural fields; everything else looks under
  // `data` first (so `c.confidence` reads `obj.data.confidence`).
  const second = path[1]!;
  let cursor: unknown;
  if (second === "id") {
    cursor = obj.id;
  } else if (second === "type") {
    cursor = obj.type;
  } else if (second === "version") {
    cursor = obj.version;
  } else if (second === "data") {
    cursor = obj.data;
  } else if (second === "provenance") {
    cursor = obj.provenance;
  } else {
    cursor = (obj.data as Record<string, unknown>)[second];
  }
  for (let i = 2; i < path.length; i++) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[path[i]!];
  }
  return cursor;
}

function applyComparison(left: unknown, op: ComparisonOp, right: unknown): boolean {
  switch (op) {
    case "=":
      return shallowEqual(left, right);
    case "!=":
    case "<>":
      return !shallowEqual(left, right);
    case "<":
      return cmp(left, right) < 0;
    case "<=":
      return cmp(left, right) <= 0;
    case ">":
      return cmp(left, right) > 0;
    case ">=":
      return cmp(left, right) >= 0;
  }
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
