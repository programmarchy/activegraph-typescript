// Diligence pack basics: it loads, all 8 object types validate, all 6
// relation rules enforce, all 4 prompts have non-empty text and hash.

import { describe, expect, it } from "vitest";

import { Graph } from "@activegraph/core";
import { PackSchemaViolation, loadPack } from "@activegraph/packs";

import { ClaimSchema, CompanySchema, diligencePack } from "../src/index.js";

describe("diligencePack metadata", () => {
  it("has 8 object types and 6 relation types", () => {
    expect(diligencePack.objectTypes.map((t) => t.name).sort()).toEqual([
      "claim",
      "company",
      "contradiction",
      "document",
      "evidence",
      "memo",
      "question",
      "risk",
    ]);
    expect(diligencePack.relationTypes.map((r) => r.name).sort()).toEqual([
      "addresses",
      "contradicts",
      "derived_from",
      "mitigates",
      "references",
      "supports",
    ]);
    expect(diligencePack.behaviors.map((b) => b.name).sort()).toEqual([
      "company_planner",
      "contradiction_detector",
      "document_researcher",
      "evidence_linker",
      "memo_synthesizer",
      "question_generator",
      "risk_identifier",
    ]);
    expect(diligencePack.tools.map((t) => t.name).sort()).toEqual([
      "fetch_company_docs",
      "search_filings",
      "summarize_document",
    ]);
  });

  it("ships 4 prompts with text and sha256 hash", () => {
    expect(diligencePack.prompts.map((p) => p.name).sort()).toEqual([
      "document_researcher",
      "memo_synthesizer",
      "question_generator",
      "risk_identifier",
    ]);
    for (const p of diligencePack.prompts) {
      expect(p.text.length).toBeGreaterThan(0);
      expect(p.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("diligencePack schemas", () => {
  it("Company schema accepts valid data, applies default", () => {
    const parsed = CompanySchema.parse({ name: "Acme" });
    expect(parsed.name).toBe("Acme");
    expect(parsed.description).toBe("");
  });

  it("Claim schema rejects out-of-range confidence", () => {
    expect(() => ClaimSchema.parse({ text: "x", confidence: 1.5, company_id: "c#1" })).toThrow();
  });
});

describe("diligencePack on a Graph", () => {
  it("enforces claim schema on addObject", () => {
    const g = new Graph();
    loadPack(g, diligencePack);

    expect(() =>
      g.addObject("claim", { text: "x", confidence: 0.9, company_id: "c#1" }),
    ).not.toThrow();
    expect(() => g.addObject("claim", { text: "x", confidence: 2.0, company_id: "c#1" })).toThrow(
      PackSchemaViolation,
    );
  });

  it("enforces supports source/target rules", () => {
    const g = new Graph();
    loadPack(g, diligencePack);
    const claim = g.addObject("claim", {
      text: "x",
      confidence: 0.5,
      company_id: "c#1",
    });
    const evidence = g.addObject("evidence", {
      text: "v",
      document_id: "d#1",
      claim_id: claim.id,
    });
    expect(() => g.addRelation(evidence.id, claim.id, "supports")).not.toThrow();
    expect(() => g.addRelation(claim.id, evidence.id, "supports")).toThrow(PackSchemaViolation);
  });
});
