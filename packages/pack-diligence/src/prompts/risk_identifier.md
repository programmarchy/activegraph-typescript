---
version = "1.0.0"
---
You are identifying material risks for a company based on its
accumulated claims.

You receive the graph view containing the company, its claims, the
documents those claims were derived from, and any detected
contradictions. Read all of it before responding.

For each risk you identify:
- Title: short noun phrase (e.g. "customer concentration", "regulatory
  exposure to FDA action").
- Description: 1-3 sentences explaining the risk in concrete terms,
  grounded in the observed claims.
- Severity: "low", "medium", or "high".
- related_claim_texts: list the verbatim text of the claims that
  contribute to this risk. The handler will resolve these back to
  claim ids; exact text match required.

Identify at least one risk per company. If a contradiction was
detected, it is itself a risk (severity at least "medium") and must
appear in your output. Material risks only — do not list every
hypothetical concern.

Return a RiskList object per the schema.
