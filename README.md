# mena-mcp: Claude connectors for Gulf & MENA businesses

Three production-ready **MCP servers**, also packaged as **Claude Code plugins**, for problems that generic connectors don't solve:

| Plugin | What it gives Claude | Tools |
|---|---|---|
| **gulf-business** | GCC VAT, Saudi ZATCA e-invoice QR, VAT/TRN and IBAN validation, Hijri (Umm al-Qura) dates, Gulf working days, Arabic amount in words (تفقيط) | 12 |
| **infra-audit** | Passive website/infra audit: TLS certificate, security headers, SPF/DMARC/DKIM, DNS/CAA, end-of-life software, with a graded report and fixes | 7 |
| **business-db** | Safe **read-only** access to SQLite/PostgreSQL: schema discovery, guarded SQL, row caps, PII masking, table allow/deny lists | 6 |

Everything is tested end to end over real stdio MCP connections (`npm test`, 24 tests). Each plugin ships as a single bundled file with no `npm install` needed.

## Install

### Claude Code (plugins)
```bash
claude plugin marketplace add alycheaib/mena-mcp
claude plugin install gulf-business@mena-mcp
claude plugin install infra-audit@mena-mcp
claude plugin install business-db@mena-mcp
```
Slash commands included: `/infra-audit:audit example.com php@7.4`, `/gulf-business:invoice-check <invoice>`, `/business-db:ask-db which customers have overdue invoices?`

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

## Development
```bash
npm install
npm test          # 24 end-to-end tests over stdio (the live-network test skips when offline)
npm run build     # bundle each server into plugins/<name>/server.mjs
```
Source lives in `packages/<name>/src`; `server.js` exports `createServer()` and `cli.js` runs it over stdio.

## Custom connectors & support
Need Claude connected to **your** ERP (Odoo, SAP B1), database, e-invoicing or internal APIs, with the same safety model, or a hosted version for your team? Open an issue or contact [Aly Cheaib](https://github.com/alycheaib).

MIT License © 2026 Aly Cheaib
