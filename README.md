# mena-mcp: Claude connectors for compliance, security, HR and Gulf business

[![tests](https://img.shields.io/badge/tests-44%20passing-brightgreen)](#development) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20Streamable%20HTTP-purple)](#hosted-remote-edition)

Five production-ready **MCP servers**, also packaged as **Claude Code plugins** and as a **hosted remote edition**, for problems that generic connectors don't solve:

| Plugin | What it gives Claude | Tools |
|---|---|---|
| **gulf-business** | GCC VAT, Saudi ZATCA e-invoice QR, VAT/TRN and IBAN validation, Hijri (Umm al-Qura) dates, Gulf working days, Arabic amount in words (تفقيط) | 12 |
| **infra-audit** | Passive website/infra audit: TLS certificate, security headers, SPF/DMARC/DKIM, DNS/CAA, end-of-life software, with a graded report and fixes | 7 |
| **business-db** | Safe **read-only** access to SQLite/PostgreSQL: schema discovery, guarded SQL, row caps, PII masking, table allow/deny lists | 6 |
| **compliance** | **SOC 2, ISO 27001:2022 and GDPR** readiness: all 93 Annex A controls, SOC 2 criteria and GDPR articles cross-mapped; gap assessment, evidence checklists, 7 policy templates, GDPR 72h/DSAR deadlines, DPIA screening, technical evidence scan, progress tracking | 12 |
| **gcc-hr** | GCC HR & payroll: UAE gratuity (Decree-Law 33/2021), Saudi end-of-service (Art. 84/85/87), GOSI (legacy and 2024+ schedules), annual leave, overtime, final settlement | 6 |

Everything is tested end to end over real MCP connections, both stdio and HTTP (44 tests). Each plugin ships as a single bundled file with no `npm install` needed.

## Install

### Claude Code (plugins)
```bash
claude plugin marketplace add alycheaib/mena-mcp
claude plugin install gulf-business@mena-mcp
claude plugin install infra-audit@mena-mcp
claude plugin install business-db@mena-mcp
claude plugin install compliance@mena-mcp
claude plugin install gcc-hr@mena-mcp
```
Slash commands included: `/compliance:readiness Acme example.com`, `/gcc-hr:settlement`, `/infra-audit:audit example.com php@7.4`, `/gulf-business:invoice-check <invoice>`, `/business-db:ask-db which customers have overdue invoices?`

### Hosted (remote) edition
No install needed: add a **custom connector** in Claude (Settings → Connectors) or any MCP client with one of these Streamable HTTP URLs. It's free and needs no API key:
```
https://mena-mcp.<account>.workers.dev/mcp/compliance
https://mena-mcp.<account>.workers.dev/mcp/infra-audit
https://mena-mcp.<account>.workers.dev/mcp/gcc-hr
https://mena-mcp.<account>.workers.dev/mcp/gulf-business
```
The hosted edition runs on Cloudflare Workers (`worker/`); certificate details come from Certificate Transparency logs, since Workers have no raw TLS sockets. Deploy your own copy with `scripts/deploy-cloudflare.ps1`.

### Apify
`apify/website-audit` is an Apify Actor with two modes: a batch domain audit with SOC 2/ISO/GDPR mapping, and an MCP server in Standby mode (pay per event).

### Claude Desktop / any MCP client
Clone the repo (or download `plugins/<name>/server.mjs`) and add to your MCP config:
```json
{
  "mcpServers": {
    "gulf-business": { "command": "node", "args": ["/path/to/mena-mcp/plugins/gulf-business/server.mjs"] },
    "infra-audit":   { "command": "node", "args": ["/path/to/mena-mcp/plugins/infra-audit/server.mjs"] },
    "business-db":   { "command": "node", "args": ["/path/to/mena-mcp/plugins/business-db/server.mjs"],
                       "env": { "BUSINESS_DB_URL": "/path/to/company.db" } }
  }
}
```
Requires Node.js 22.5+ (business-db uses the built-in `node:sqlite`); the other two run on Node 20+.

---

## gulf-business

| Tool | Example |
|---|---|
| `vat_calculate` | 1000 SAR net → VAT 150, gross 1150 · inclusive mode for gross prices · SA 15%, AE 5%, BH 10%, OM 5%, QA/KW 0% |
| `vat_rates` | Current GCC VAT rates |
| `vat_number_validate` | Saudi VAT number (15 digits, 3…3), UAE TRN, Bahrain VAT format check |
| `zatca_qr_encode` / `zatca_qr_decode` | Build or read the TLV/base64 QR on Saudi simplified tax invoices (Phase 1 tags; lists Phase 2 tags when present) |
| `iban_validate` | mod-97 checksum and country length for GCC, Lebanon, Egypt, Jordan, Iraq, Turkey and EU countries; bank code for SA/AE |
| `amount_to_arabic_words` | `1250.50 SAR` → «فقط ألف ومائتان وخمسون ريالاً سعودياً وخمسون هللة لا غير» (SAR, AED, QAR, KWD, BHD, OMR, JOD, EGP, LBP, USD, EUR) with correct dual/plural/accusative agreement |
| `number_to_arabic_words` | Integers, masculine or feminine |
| `hijri_from_gregorian` / `gregorian_from_hijri` | Umm al-Qura calendar (Saudi official) |
| `working_days_count` / `working_days_add` | Country weekends (UAE Sat–Sun, rest of GCC Fri–Sat) plus your holiday list |

> The ZATCA tools handle the QR payload. Phase 2 (Fatoora) cryptographic stamping must come from your ZATCA-onboarded e-invoicing system.

## infra-audit

| Tool | What it checks |
|---|---|
| `audit_domain` | Everything below in one call, giving a 0–100 score, letter grade and prioritised findings with fixes |
| `tls_certificate` | Trust chain, hostname match, days to expiry, issuer, SANs, protocol, cipher |
| `http_security_headers` | HSTS, CSP, X-Frame-Options/frame-ancestors, nosniff, Referrer/Permissions-Policy, version leaks, cookie flags, redirect chain |
| `email_security` | SPF (policy, multiple records, 10-lookup limit), DMARC (policy, reporting, pct), DKIM on common selectors, MTA-STS |
| `dns_records` | A, AAAA, MX, NS, TXT, CAA, SOA |
| `eol_check` / `eol_products` | End of life and latest patch from [endoflife.date](https://endoflife.date) (php, nodejs, python, ubuntu, windows-server, mysql, postgresql, django, laravel and more) |

**Safety:** checks are passive and use public data only: no port scans, no exploitation. Private, loopback and cloud-metadata addresses are refused, which prevents SSRF. Set `INFRA_AUDIT_ALLOW_PRIVATE=1` to audit your own internal hosts. Only audit domains you own or are authorised to assess.

## business-db

Lets Claude answer questions like *"which Saudi customers have overdue invoices?"* or *"ما هي أكثر المنتجات مبيعاً هذا الربع؟"* directly from your database, without being able to change it.

| Tool | |
|---|---|
| `database_info` | Engine and the safety settings in force |
| `list_tables` / `describe_table` | Tables, views, row counts, columns, keys, foreign keys, indexes, PII/hidden flags |
| `sample_rows` | First rows of a table |
| `run_query` | One read-only SQL query with parameters |
| `explain_query` | Query plan (index advice for slow reports) |

**Defence in depth:**
1. The connection is opened read-only (SQLite `readOnly`; Postgres `default_transaction_read_only` plus a `BEGIN READ ONLY` transaction).
2. **SQLite engine authorizer:** only SELECT and READ are allowed. Writes, ATTACH, PRAGMA, `sqlite_schema` and `load_extension` are denied by the database engine itself.
3. Statement guard: a single statement only, which must be SELECT, WITH, VALUES or EXPLAIN, with dangerous keywords rejected.
4. Row cap (`BUSINESS_DB_MAX_ROWS`, default 200) and a statement timeout.
5. **PII masking:** emails, phones, IBANs and national IDs are masked by column name, and emails or international phone numbers inside free text are masked too. Secret columns such as `password*`, `*token*` and `*hash*` come back as `NULL`.
6. `BUSINESS_DB_ALLOW_TABLES` and `BUSINESS_DB_DENY_TABLES`. With SQLite, views over a denied table are blocked too.

| Env var | Default |
|---|---|
| `BUSINESS_DB_URL` | SQLite file path or `postgres://…`. If unset, a **sample Gulf trading-company database** (customers, orders, invoices with VAT, bilingual names) is generated |
| `BUSINESS_DB_MAX_ROWS` | `200` (max 5000) |
| `BUSINESS_DB_TIMEOUT_MS` | `10000` |
| `BUSINESS_DB_MASK_PII` | `1` (set `0` to disable) |
| `BUSINESS_DB_ALLOW_TABLES` / `BUSINESS_DB_DENY_TABLES` | comma-separated |

PostgreSQL needs `npm install pg` next to the server. For production, also connect with a database role that only has `SELECT` grants.

---

## compliance

| Tool | |
|---|---|
| `list_frameworks` / `get_controls` | SOC 2 TSC, ISO/IEC 27001:2022 Annex A (93), GDPR articles, each with its control domains |
| `crosswalk` | ISO 8.24 → SOC 2 CC6.1/CC6.7 → GDPR Art. 32, plus the shared evidence |
| `questionnaire` → `gap_assessment` | 21 domain questions answered yes/partial/no/na, giving overall and per-framework readiness %, met/partial/missing controls and prioritised remediation |
| `evidence_checklist` | What auditors ask for, per domain or control |
| `policy_template` | Information security, access control, incident response, BCP/backup, vendor, data retention, privacy notice |
| `gdpr_deadline` | Breach: 72h (Art. 33). DSAR: 1 month, extendable by 2 (Art. 12(3)) |
| `dpia_screening` | The 9 EDPB/WP29 criteria; 2 or more means a DPIA is likely needed |
| `technical_evidence_scan` | Live TLS, header, email and EOL findings mapped to control IDs with suggested answers |
| `save_assessment` / `list_assessments` | Local history (`~/.compliance-mcp`) showing readiness change and closed/new gaps (local edition only) |

The catalogue holds control IDs and short titles/summaries written by us; the official texts belong to AICPA and ISO. This is a readiness aid, not an audit opinion or legal advice.

## gcc-hr

| Tool | Rule encoded |
|---|---|
| `uae_gratuity` | Decree-Law 33/2021: 21 days/yr for the first 5 years, 30 days after, on basic wage, capped at 2 years, nothing under 1 year |
| `ksa_end_of_service` | Art. 84: ½ month/yr for the first 5 years, 1 month after. Art. 85 resignation: under 2 yrs 0, 2–5 ⅓, 5–10 ⅔, 10+ full. Art. 87 exceptions |
| `gosi_contributions` | Saudis: 9% + 9% annuities (legacy) or the 2024+ schedule (+0.5 pt each July up to 11%), SANED 0.75% + 0.75%, hazards 2%; non-Saudis 2% employer; SAR 45,000 cap |
| `annual_leave` | UAE 2 days/month (6–12 months) then 30/yr; KSA 21/yr, 30 after 5 years; encashment value |
| `overtime_pay` | UAE +25% (+50% at night/rest day); KSA hourly wage + 50% of basic |
| `final_settlement` | Statement: end-of-service + leave + unpaid salary ± other items |

Service is counted by calendar anniversaries and excludes unpaid leave. These are estimates: verify against the contract, later amendments and official calculators.

## Development
```bash
npm install
npm test          # end-to-end tests over stdio (the live-network test skips when offline)
MCP_REMOTE_URL=http://127.0.0.1:8787 node --test test/remote.test.js   # hosted edition (run `npx wrangler dev` in worker/ first)
npm run build     # bundle each server into plugins/<name>/server.mjs
```
Source lives in `packages/<name>/src`; `server.js` exports `createServer()` and `cli.js` runs it over stdio.

## Work with me
| Service | What you get |
|---|---|
| **Security & compliance readiness report** | Domain audit plus SOC 2 / ISO 27001 / GDPR gap assessment, a prioritised 90-day roadmap and starter policies, delivered in 5 days |
| **Connect Claude to your systems** | Odoo, SAP B1, internal databases, e-invoicing or internal APIs, with the same read-only and PII-masking safety model, delivered in 7–10 days |
| **Hosted & monitored connectors** | Your private MCP endpoints, plus monitoring of certificates, DMARC and end-of-life software |

Open an issue titled **"Custom connector request"** or **"Readiness report"**: [new request](https://github.com/alycheaib/mena-mcp/issues/new?title=Custom%20connector%20request). ⭐ Star the repo if it helps you; it helps others find it.


MIT License © 2026 Aly Cheaib
