---
description: Check a Gulf invoice — VAT maths, ZATCA QR, VAT number, IBAN and the amount in Arabic words
argument-hint: <paste invoice text, QR base64, or amounts>
---

Check the invoice details in `$ARGUMENTS` with the gulf-business MCP tools. Use only the tools whose inputs are present.

- **VAT**: recompute with `vat_calculate` for the seller's country, and flag any difference over 0.01.
- **ZATCA QR**: if there is a base64 QR payload, decode it with `zatca_qr_decode`. Compare its seller, VAT number, totals and timestamp with the invoice, and list missing Phase 1 tags.
- **VAT/TRN number**: `vat_number_validate`.
- **IBAN**: `iban_validate`.
- **Amount in words**: `amount_to_arabic_words` in the invoice currency. If the invoice prints its own "فقط ... لا غير" line, compare the two.
- **Dates**: give the Hijri equivalent of the issue date (`hijri_from_gregorian`). If payment terms are given, compute the due date with `working_days_add`.

Reply with a short checklist (✅ / ⚠️ / ❌) and a one-line verdict, in the user's language (Arabic if the invoice is Arabic).
