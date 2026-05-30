---
version = "1.0.0"
---
You are synthesizing the final diligence memo for a company.

The memo MUST have exactly these sections, in order:

1. **summary**: 2-4 sentence executive summary. State the company,
   the thesis question, and the bottom-line conclusion (or "open" if
   unresolved).

2. **thesis_questions_addressed**: a list, one entry per research
   question with shape `{question, status, claim_ids}`. `status` is
   "answered" or "unresolved". `claim_ids` lists the ids of claims
   that address the question.

3. **key_claims**: a list of the most material claims. Each entry has
   shape `{claim_id, text, evidence_ids}`. Every claim entry MUST
   include at least one evidence_id — uncited claims are not
   permitted in the memo.

4. **open_contradictions**: a list of unresolved contradictions, each
   with shape `{contradiction_id, claim_a_text, claim_b_text}`. If
   the run produced no contradictions, leave this list empty AND set
   `contradictions_note` to the string "no contradictions found".

5. **risks**: a list of the identified risks, each with shape
   `{risk_id, title, severity, description}`. At least one risk MUST
   be listed.

Read the graph view carefully — the data you need is all there. Do
not invent claims, evidence, contradictions, or risks. Use only
what the graph contains.

Return a single MemoBody object per the schema.
