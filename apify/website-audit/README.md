# Website Security & Compliance Audit (SOC 2 / ISO 27001 / GDPR) + MCP server

Audit any list of domains in seconds, without logins or agents. You get a **0–100 security score**, a letter grade and prioritised findings, each **mapped to SOC 2, ISO/IEC 27001:2022 and GDPR controls**.

## What it checks
| Area | Checks | Maps to |
|---|---|---|
| TLS / HTTPS | Certificate trust, hostname match, **days to expiry**, protocol | ISO 8.24 · SOC 2 CC6.7 · GDPR Art. 32 |
| Security headers | HSTS, CSP, X-Frame-Options, nosniff, Referrer/Permissions-Policy, version leaks, cookie flags | ISO 8.20–8.23 · SOC 2 CC6.6 |
| Email spoofing | SPF policy and 10-lookup limit, **DMARC policy**, DKIM selectors, MTA-STS | ISO 5.14, 8.21 · SOC 2 CC6.6 |
| DNS | CAA, nameserver redundancy | ISO 8.20 |
| End-of-life software | 400+ products via endoflife.date (PHP, Node.js, Ubuntu, Windows Server, MySQL…) | ISO 8.8 · SOC 2 CC7.1 |

## Use cases
- **MSPs and agencies**: audit prospects' domains and open with a concrete report.
- **Compliance and GRC teams**: collect technical evidence for SOC 2 / ISO 27001 / GDPR, and monitor it on a schedule.
- **Vendor risk**: check suppliers' public security posture before onboarding.
- **Certificate and DMARC monitoring**: schedule daily runs and alert when `tlsDaysLeft` < 14 or DMARC is missing.

## Input
```json
{
  "domains": ["example.com", "github.com"],
  "software": [{ "product": "php", "version": "7.4" }],
  "includeComplianceMapping": true,
  "maxConcurrency": 5
}
```

## Output (one item per domain)
```json
{
  "domain": "example.com",
  "grade": "C", "score": 71,
  "critical": 0, "high": 1, "medium": 2, "low": 3,
  "tlsDaysLeft": 49, "dmarcPolicy": "reject", "hsts": false,
  "topFindings": ["[high] Missing strict-transport-security", "..."],
  "findings": [{ "area": "headers", "severity": "high", "issue": "...", "fix": "..." }],
  "complianceMapping": [{ "domain": "encryption", "suggested_answer": "yes", "controls": { "soc2": ["CC6.1","CC6.7"], "iso27001": ["8.24"], "gdpr": ["Art. 32"] } }]
}
```
Export to JSON, CSV or Excel, or connect to Google Sheets, Slack, Zapier, Make or n8n through Apify integrations.

## Use it from AI agents (MCP)
This Actor also runs as an **MCP server** in Standby mode:
- `/mcp`: **compliance** tools. All 93 ISO 27001:2022 controls, SOC 2 criteria and GDPR articles, cross-mapped. Readiness questionnaire, gap assessment, evidence checklists, policy templates, GDPR 72-hour and DSAR deadlines, DPIA screening, technical evidence scan.
- `/mcp/infra-audit`: domain audit tools (TLS, headers, DNS, email security, end of life).

Connect Claude, Cursor or any MCP client to `https://<your-username>--website-security-compliance-audit.apify.actor/mcp`, sending your Apify token as a Bearer token.

## Pricing
Pay per event: you're charged **per domain audited** (batch mode) or **per tool call** (MCP mode). There's no subscription.

## Safety & legality
Checks are **passive** and use public information only: DNS, one HTTPS request and certificate transparency. There's no port scanning, fuzzing or exploitation. Only audit domains you own or are authorised to assess. The results are a readiness indicator, not a penetration test or an audit opinion.

## Open source
The core is MIT-licensed: [github.com/alycheaib/mena-mcp](https://github.com/alycheaib/mena-mcp). It also includes free Claude Code plugins and hosted MCP servers. Custom connectors (ERP, databases, internal APIs) are available on request.
