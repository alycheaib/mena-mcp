---
description: Run a passive security & infrastructure audit of a domain and write a client-ready report
argument-hint: <domain> [product@version ...]
---

Audit the domain in `$ARGUMENTS` with the infra-audit MCP tools.

1. The first word is the domain. Any further words like `php@7.4` or `nginx@1.18` are software versions: pass them to `audit_domain` as `software: [{product, version}]`.
2. Call `audit_domain`. If a check failed, say so; don't guess.
3. Write the report in the user's language:
   - **Score**: the grade letter and score out of 100, in one line.
   - **Fix first**: critical and high findings as a table (area, issue, fix).
   - **Then**: medium and low findings, grouped by area.
   - **Good**: what already passes (TLS trust and expiry, DMARC policy and so on).
   - **Next steps**: 3 bullets, ordered by effort against impact.
4. Only audit domains the user owns or is authorised to assess. These are passive checks of public information, not a penetration test; say so in one line at the end.
