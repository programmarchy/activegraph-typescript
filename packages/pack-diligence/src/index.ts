// @activegraph/pack-diligence — the reference Diligence pack.
//
// 8 object types, 6 relation types, 4 prompts. Schemas use Zod 4 (the
// documented default per the port plan).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Pack, definePack } from "@activegraph/packs";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Prompts ship as .md files. In source they live at src/prompts; the
// build script copies them into dist/prompts so the same relative
// lookup resolves at install time.
const PROMPTS_DIR = join(__dirname, "prompts");

function loadPromptSync(name: string): { name: string; text: string } {
  const text = readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");
  return { name, text };
}

// --- object-type schemas ------------------------------------------------

export const CompanySchema = z.object({
  name: z.string(),
  ticker: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  description: z.string().default(""),
});

export const DocumentSchema = z.object({
  title: z.string(),
  url: z.string(),
  company_id: z.string(),
  summary: z.string().default(""),
  published_at: z.string().nullable().optional(),
});

export const QuestionSchema = z.object({
  text: z.string(),
  company_id: z.string(),
  company_name: z.string().default(""),
  status: z.enum(["open", "answered", "skipped"]).default("open"),
});

export const ClaimSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  company_id: z.string(),
  source_document_id: z.string().nullable().optional(),
  status: z.enum(["open", "reviewed", "retracted"]).default("open"),
});

export const EvidenceSchema = z.object({
  text: z.string(),
  document_id: z.string(),
  claim_id: z.string(),
  location: z.string().default(""),
});

export const ContradictionSchema = z.object({
  claim_a_id: z.string(),
  claim_b_id: z.string(),
  rationale: z.string().default(""),
  status: z.enum(["open", "resolved"]).default("open"),
});

export const RiskSchema = z.object({
  title: z.string(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  company_id: z.string(),
  related_claim_ids: z.array(z.string()).default([]),
});

export const MemoSchema = z.object({
  company_id: z.string(),
  summary: z.string(),
  thesis_questions_addressed: z.array(z.record(z.string(), z.unknown())),
  key_claims: z.array(z.record(z.string(), z.unknown())),
  open_contradictions: z.array(z.record(z.string(), z.unknown())),
  contradictions_note: z.string().default(""),
  risks: z.array(z.record(z.string(), z.unknown())),
});

export const diligenceBehaviors = [
  { name: "company_planner" },
  { name: "question_generator" },
  { name: "document_researcher" },
  { name: "evidence_linker" },
  { name: "contradiction_detector" },
  { name: "risk_identifier" },
  { name: "memo_synthesizer" },
] as const;

export const diligenceTools = [
  { name: "fetch_company_docs" },
  { name: "search_filings" },
  { name: "summarize_document" },
] as const;

// --- the pack -----------------------------------------------------------

export const diligencePack: Pack = definePack({
  name: "diligence",
  version: "1.0.5",
  description:
    "Investment-diligence reference pack: companies, documents, claims, evidence, contradictions, risks, memos.",
  objectTypes: [
    { name: "company", schema: CompanySchema },
    { name: "document", schema: DocumentSchema },
    { name: "question", schema: QuestionSchema },
    { name: "claim", schema: ClaimSchema },
    { name: "evidence", schema: EvidenceSchema },
    { name: "contradiction", schema: ContradictionSchema },
    { name: "risk", schema: RiskSchema },
    { name: "memo", schema: MemoSchema },
  ],
  relationTypes: [
    { name: "addresses", allowedSources: ["claim"], allowedTargets: ["question"] },
    { name: "supports", allowedSources: ["evidence"], allowedTargets: ["claim"] },
    { name: "contradicts", allowedSources: ["claim"], allowedTargets: ["claim"] },
    {
      name: "references",
      allowedSources: ["claim", "memo"],
      allowedTargets: ["document"],
    },
    {
      name: "derived_from",
      allowedSources: ["claim", "evidence"],
      allowedTargets: ["document"],
    },
    { name: "mitigates", allowedSources: ["evidence", "claim"], allowedTargets: ["risk"] },
  ],
  behaviors: diligenceBehaviors,
  tools: diligenceTools,
  prompts: [
    loadPromptSync("document_researcher"),
    loadPromptSync("memo_synthesizer"),
    loadPromptSync("question_generator"),
    loadPromptSync("risk_identifier"),
  ],
});
