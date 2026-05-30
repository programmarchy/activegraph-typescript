// Cypher subset matcher tests.

import { describe, expect, it } from "vitest";

import { Graph } from "@activegraph/core";

import { parsePattern } from "../src/index.js";

function buildGraphWithClaims(): Graph {
  const g = new Graph();
  const a = g.addObject("claim", { text: "A", confidence: 0.9, status: "open" });
  const b = g.addObject("claim", { text: "B", confidence: 0.8, status: "open" });
  const c = g.addObject("claim", { text: "C", confidence: 0.3, status: "open" });
  g.addRelation(a.id, b.id, "contradicts");
  g.addRelation(a.id, c.id, "supports");
  return g;
}

describe("PatternMatcher.matches", () => {
  it("single node by type", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern("(c:claim)").compile();
    const matches = matcher.matches({ graph: g });
    expect(matches).toHaveLength(3);
    expect(matches.every((m) => "c" in m.bindings)).toBe(true);
  });

  it("node property equality", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern("(c:claim {confidence: 0.9})").compile();
    expect(matcher.matches({ graph: g })).toHaveLength(1);
  });

  it("relationship by type", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern("(a:claim)-[:contradicts]->(b:claim)").compile();
    const matches = matcher.matches({ graph: g });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.bindings.a).not.toBe(matches[0]!.bindings.b);
  });

  it("relationship variable binding", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern("(a:claim)-[r:contradicts]->(b:claim)").compile();
    const matches = matcher.matches({ graph: g });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.bindings.r).toMatch(/^rel_/);
  });

  it("directed left walks incoming edges", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern("(b:claim)<-[:contradicts]-(a:claim)").compile();
    expect(matcher.matches({ graph: g })).toHaveLength(1);
  });

  it("no matching relationship", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern("(a:claim)-[:cites]->(b:claim)").compile();
    expect(matcher.matches({ graph: g })).toEqual([]);
  });

  it("multi-hop", () => {
    const g = new Graph();
    const a = g.addObject("claim", {});
    const b = g.addObject("source", {});
    const c = g.addObject("doc", {});
    g.addRelation(a.id, b.id, "cites");
    g.addRelation(b.id, c.id, "in");
    const matcher = parsePattern("(a:claim)-[:cites]->(b:source)-[:in]->(c:doc)").compile();
    const matches = matcher.matches({ graph: g });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.bindings).toEqual({ a: a.id, b: b.id, c: c.id });
  });

  it("WHERE filters matches", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern("(c:claim) WHERE c.confidence > 0.5").compile();
    expect(matcher.matches({ graph: g })).toHaveLength(2);
  });

  it("WHERE AND combines predicates", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern(
      '(c:claim) WHERE c.confidence > 0.7 AND c.status = "open"',
    ).compile();
    expect(matcher.matches({ graph: g })).toHaveLength(2);
  });

  it("WHERE NOT inverts", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern("(c:claim) WHERE NOT c.confidence > 0.5").compile();
    expect(matcher.matches({ graph: g })).toHaveLength(1);
  });

  it("WHERE NOT EXISTS excludes matched subpatterns", () => {
    const g = new Graph();
    const a = g.addObject("claim", { text: "A" });
    const b = g.addObject("claim", { text: "B" });
    const x = g.addObject("claim", { text: "X" });
    g.addRelation(x.id, a.id, "contradicts");

    const matcher = parsePattern(
      "(c:claim) WHERE NOT EXISTS { (x:claim)-[:contradicts]->(c) }",
    ).compile();
    const ids = matcher.matches({ graph: g }).map((m) => m.bindings.c!).sort();
    expect(ids).toEqual([b.id, x.id].sort());
  });

  it("multi-hop with WHERE", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern(
      "(c1:claim)-[r:contradicts]->(c2:claim) WHERE c1.confidence > 0.7 AND c2.confidence > 0.7",
    ).compile();
    expect(matcher.matches({ graph: g })).toHaveLength(1);
  });

  it("no matches returns empty array", () => {
    const g = new Graph();
    g.addObject("claim", { confidence: 0.1 });
    const matcher = parsePattern("(c:claim) WHERE c.confidence > 0.99").compile();
    expect(matcher.matches({ graph: g })).toEqual([]);
  });

  it("bare-var path resolves to object id", () => {
    const g = buildGraphWithClaims();
    const a = g.allObjects()[0]!;
    const matcher = parsePattern(`(c:claim) WHERE c = "${a.id}"`).compile();
    const matches = matcher.matches({ graph: g });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.bindings.c).toBe(a.id);
  });

  it("field access via c.type", () => {
    const g = buildGraphWithClaims();
    const matcher = parsePattern('(c) WHERE c.type = "claim"').compile();
    expect(matcher.matches({ graph: g })).toHaveLength(3);
  });
});
