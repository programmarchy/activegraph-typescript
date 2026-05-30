// Cypher subset parser tests.

import { describe, expect, it } from "vitest";

import {
  AndExpr,
  Comparison,
  NotExists,
  NotExpr,
  Pattern,
  UnsupportedPatternError,
  parsePattern,
} from "../src/index.js";

describe("parsePattern — happy path", () => {
  it("single node, no type", () => {
    const p = parsePattern("(a)");
    expect(p).toBeInstanceOf(Pattern);
    expect(p.match.nodes).toHaveLength(1);
    expect(p.match.nodes[0]!.var).toBe("a");
    expect(p.match.nodes[0]!.type).toBeNull();
    expect(p.where).toBeNull();
  });

  it("node with type", () => {
    const p = parsePattern("(a:claim)");
    expect(p.match.nodes[0]!.type).toBe("claim");
  });

  it("node with properties", () => {
    const p = parsePattern('(a:claim {confidence: 0.9, status: "open"})');
    expect(p.match.nodes[0]!.properties).toEqual({ confidence: 0.9, status: "open" });
  });

  it("anonymous node", () => {
    const p = parsePattern("(:claim)");
    expect(p.match.nodes[0]!.var).toBeNull();
    expect(p.match.nodes[0]!.type).toBe("claim");
  });

  it("directed right rel", () => {
    const p = parsePattern("(a)-[:supports]->(b)");
    expect(p.match.rels).toHaveLength(1);
    expect(p.match.rels[0]!.type).toBe("supports");
    expect(p.match.rels[0]!.direction).toBe("right");
    expect(p.match.rels[0]!.var).toBeNull();
  });

  it("directed left rel", () => {
    const p = parsePattern("(a)<-[:supports]-(b)");
    expect(p.match.rels[0]!.direction).toBe("left");
  });

  it("relationship variable binding", () => {
    const p = parsePattern("(a)-[r:supports]->(b)");
    expect(p.match.rels[0]!.var).toBe("r");
  });

  it("multi-hop", () => {
    const p = parsePattern("(a:claim)-[:supports]->(b:doc)-[:cites]->(c:source)");
    expect(p.match.nodes).toHaveLength(3);
    expect(p.match.rels).toHaveLength(2);
    expect(p.match.nodes.map((n) => n.type)).toEqual(["claim", "doc", "source"]);
    expect(p.match.rels.map((r) => r.type)).toEqual(["supports", "cites"]);
  });

  it("WHERE simple comparison", () => {
    const p = parsePattern("(a:claim) WHERE a.confidence > 0.7");
    expect(p.where).toBeInstanceOf(Comparison);
    const c = p.where as Comparison;
    expect(c.op).toBe(">");
    expect(c.rightValue).toBe(0.7);
  });

  it("WHERE AND", () => {
    const p = parsePattern('(a:claim) WHERE a.confidence > 0.7 AND a.status = "open"');
    expect(p.where).toBeInstanceOf(AndExpr);
    expect((p.where as AndExpr).parts).toHaveLength(2);
  });

  it("WHERE NOT", () => {
    const p = parsePattern("(a:claim) WHERE NOT a.confidence < 0.3");
    expect(p.where).toBeInstanceOf(NotExpr);
  });

  it("WHERE NOT EXISTS subpattern", () => {
    const p = parsePattern("(a:claim) WHERE NOT EXISTS { (a)-[:supersedes]->(b:claim) }");
    expect(p.where).toBeInstanceOf(NotExists);
    const ne = p.where as NotExists;
    expect(ne.subMatch.nodes[0]!.var).toBe("a");
    expect(ne.subMatch.rels[0]!.type).toBe("supersedes");
  });

  it("WHERE path vs path", () => {
    const p = parsePattern("(a:c)-[:r]->(b:c) WHERE a.confidence > b.confidence");
    expect(p.where).toBeInstanceOf(Comparison);
    expect((p.where as Comparison).rightPath).toEqual(["b", "confidence"]);
  });

  it("property-path under data", () => {
    const p = parsePattern("(a:claim) WHERE a.data.priority = 3");
    expect(p.where).toBeInstanceOf(Comparison);
    expect((p.where as Comparison).leftPath).toEqual(["a", "data", "priority"]);
  });

  it("all comparison operators parse", () => {
    for (const op of ["=", "<", ">", "<=", ">=", "!=", "<>"]) {
      const p = parsePattern(`(a:c) WHERE a.x ${op} 1`);
      expect(p.where).toBeInstanceOf(Comparison);
      expect((p.where as Comparison).op).toBe(op);
    }
  });

  it("string literals (single + double quotes)", () => {
    expect(((parsePattern('(a:c) WHERE a.x = "hello"').where) as Comparison).rightValue).toBe("hello");
    expect(((parsePattern("(a:c) WHERE a.x = 'hello'").where) as Comparison).rightValue).toBe("hello");
  });

  it("boolean and null literals", () => {
    expect(((parsePattern("(a:c) WHERE a.x = TRUE").where) as Comparison).rightValue).toBe(true);
    expect(((parsePattern("(a:c) WHERE a.x = FALSE").where) as Comparison).rightValue).toBe(false);
    expect(((parsePattern("(a:c) WHERE a.x = NULL").where) as Comparison).rightValue).toBeNull();
  });
});

describe("parsePattern — refusals", () => {
  it("OR in WHERE", () => {
    expect(() => parsePattern("(a:c) WHERE a.x > 0 OR a.x < -1")).toThrowError(
      /OR is not supported/,
    );
  });

  it("RETURN", () => {
    expect(() => parsePattern("(a:c) RETURN a")).toThrowError(/RETURN/);
  });

  it("OPTIONAL", () => {
    expect(() => parsePattern("OPTIONAL (a:c)")).toThrowError(/OPTIONAL/);
  });

  it("WITH", () => {
    expect(() => parsePattern("(a:c) WITH a")).toThrowError(/WITH/);
  });

  it("MATCH", () => {
    expect(() => parsePattern("MATCH (a:c)")).toThrowError(/MATCH/);
  });

  it("variable-length path", () => {
    expect(() => parsePattern("(a:c)-[*]->(b:c)")).toThrowError(/variable-length/);
  });

  it("undirected relationship", () => {
    expect(() => parsePattern("(a:c)-[:r]-(b:c)")).toThrowError(/undirected/);
  });

  it("untyped relationship", () => {
    expect(() => parsePattern("(a)-[]->(b)")).toThrowError(/untyped/);
  });

  it("CREATE", () => {
    expect(() => parsePattern("CREATE (a:c)")).toThrowError(/CREATE/);
  });

  it("MERGE", () => {
    expect(() => parsePattern("MERGE (a:c)")).toThrowError(/MERGE/);
  });

  it("non-literal node property", () => {
    expect(() => parsePattern("(a:c {x: y})")).toThrow(UnsupportedPatternError);
  });

  it("trailing junk", () => {
    expect(() => parsePattern("(a:c) junk_here")).toThrowError(/trailing/);
  });

  it("unmatched paren", () => {
    expect(() => parsePattern("(a:c")).toThrow(UnsupportedPatternError);
  });

  it("unexpected character", () => {
    expect(() => parsePattern("(a:c) WHERE a.x ?? 1")).toThrowError(/unexpected character/);
  });
});
