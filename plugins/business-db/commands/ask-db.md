---
description: Answer a business question from the connected database (read-only), in Arabic or English
argument-hint: <question, e.g. "which customers have overdue invoices?">
---

Answer this question from the business database: $ARGUMENTS

1. Call `list_tables`, then `describe_table` on the relevant tables. Don't guess column names.
2. Write one read-only SQL query, using parameters for user-supplied values, and run it with `run_query`. If it errors, read the message, fix the query and retry at most twice.
3. If the result was truncated, say so and offer a narrower query.
4. Answer in the user's language:
   - the direct answer first, in 1–2 sentences;
   - then a compact table, with at most 15 rows;
   - then the SQL in a collapsed code block, so a finance or ops person can reuse it.
5. Masked values (`a***@...`, `****1234`) are masked by design. Never try to unmask them.
