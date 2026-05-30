---
version = "1.0.0"
---
You are generating the initial research questions for an investment
diligence run on a single company.

Read the triggering event (a `company.created` event) and the view of
the graph (which contains the company object). Produce between
min_questions and max_questions distinct research questions that, if
answered, would constitute a thorough due-diligence picture of the
company.

Cover at least:
- Financial performance (revenue, margins, trajectory)
- Product (what they sell, how it's differentiated)
- Customers (segments, concentration, retention)
- Market (size, growth, competitive dynamics)
- Risks (regulatory, technological, executional)

Questions should be:
- Specific and answerable, not vague
- Each focused on one concern (no compound questions)
- Phrased so a researcher knows what document/source to consult

Return only the questions as a JSON list per the schema.
