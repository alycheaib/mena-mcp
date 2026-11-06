---
description: Calculate a UAE or Saudi final settlement (end-of-service, leave, salary, deductions)
argument-hint: <country, salary, start and end dates, reason, leave balance…>
---

Prepare a final settlement from: $ARGUMENTS

1. Work out the country (AE or SA). Ask only for missing **required** inputs: basic salary (and, for KSA, the actual wage including allowances), start date, last working day, and, for KSA, the reason for leaving.
2. Call `final_settlement`. Use `uae_gratuity`, `ksa_end_of_service` or `annual_leave` only if the user wants detail.
3. Present:
   - a settlement statement table (item, amount) with the total in AED or SAR;
   - one line explaining the legal rule applied;
   - assumptions (daily-wage basis, unpaid leave excluded).
4. Reply in the user's language (Arabic if they wrote in Arabic). Add one line saying this is an estimate and should be checked against the contract and the official calculators.
