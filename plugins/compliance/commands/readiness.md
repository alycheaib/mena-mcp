---
description: Run a SOC 2 / ISO 27001 / GDPR readiness assessment, with a prioritised roadmap and a saved baseline
argument-hint: [organisation] [domain to scan, e.g. example.com]
---

Run a compliance readiness assessment for: $ARGUMENTS

1. Call `questionnaire`, then ask the user the questions in **one** compact numbered list. They answer yes/partial/no/na for each.
2. If a domain was given, call `technical_evidence_scan`. Use its `suggested_answers` for the encryption, network, email and vulnerability domains, and tell the user which answers came from the scan.
3. Call `gap_assessment` with the answers.
4. Report:
   - **Overall readiness %** and per framework (SOC 2, ISO 27001, GDPR).
   - **Top 5 gaps**: a table with the gap, priority, fix and evidence needed.
   - **30/60/90-day roadmap**.
   - The policy templates to start with (offer to generate them with `policy_template`).
5. Ask whether to save the result. If yes, call `save_assessment` with the organisation name. On later runs, call `list_assessments` and report progress (readiness change, closed gaps).

Say once that this is a readiness self-assessment, not an audit opinion or legal advice.
