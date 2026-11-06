export const landingPage = (origin) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mena-mcp: hosted MCP servers</title>
<meta name="description" content="Free hosted MCP servers for Claude, ChatGPT and any MCP client: Gulf business toolkit (VAT, ZATCA QR, IBAN, Hijri, Arabic amount in words) and a passive website security audit.">
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#5f5d57;--card:#fff;--line:#e6e2d9;--accent:#0f6b5c}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#efede6;--muted:#a8a59b;--card:#1d1d1b;--line:#33322e;--accent:#4fc1a8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px 64px}h1{font-size:2rem;margin:0 0 .25rem}h2{margin-top:2.2rem;font-size:1.25rem}
p.lead{color:var(--muted);margin-top:0}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:14px 0}
code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88rem}pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;white-space:pre}
a{color:var(--accent)}.url{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.url code{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:4px 8px;word-break:break-all}
ul{padding-left:1.2rem}small{color:var(--muted)}
</style></head><body><main>
<h1>mena-mcp</h1>
<p class="lead">Free, open-source MCP servers for Claude and any MCP client. No sign-up, no API key. <a href="https://github.com/alycheaib/mena-mcp">GitHub</a> · MIT</p>

<div class="card"><h2 style="margin-top:0">Gulf business toolkit</h2>
<div class="url"><code>${origin}/mcp/gulf-business</code></div>
<ul><li>GCC VAT (SA 15%, AE 5%, BH 10%, OM 5%), inclusive or exclusive</li><li>Saudi ZATCA e-invoice QR encode/decode, VAT/TRN number checks</li>
<li>IBAN validation (GCC, Lebanon, Egypt, Jordan, EU)</li><li>Hijri ↔ Gregorian (Umm al-Qura), Gulf working days</li><li>Amount in Arabic words (تفقيط) for 11 currencies</li></ul></div>

<div class="card"><h2 style="margin-top:0">Infra &amp; website audit</h2>
<div class="url"><code>${origin}/mcp/infra-audit</code></div>
<ul><li>One-call graded audit: TLS certificate, security headers, SPF/DMARC/DKIM, DNS/CAA</li><li>End-of-life check for 400+ products (PHP, Node, Ubuntu, Windows Server…)</li>
<li>Passive and public-data only. Audit only domains you own or are authorised to assess.</li></ul></div>

<div class="card"><h2 style="margin-top:0">SOC 2 · ISO 27001 · GDPR compliance</h2>
<div class="url"><code>${origin}/mcp/compliance</code></div>
<ul><li>All 93 ISO/IEC 27001:2022 Annex A controls, SOC 2 Trust Services Criteria and GDPR articles, cross-mapped</li>
<li>One readiness questionnaire scored against all three frameworks, with prioritised gaps</li>
<li>Evidence checklists, 7 starter policies, GDPR 72-hour breach and 1-month DSAR deadlines, DPIA screening</li>
<li>Technical evidence scan: maps live TLS, header and email findings to control IDs</li></ul></div>

<div class="card"><h2 style="margin-top:0">GCC HR &amp; payroll</h2>
<div class="url"><code>${origin}/mcp/gcc-hr</code></div>
<ul><li>UAE end-of-service gratuity (Decree-Law 33/2021) and Saudi end-of-service award (Art. 84/85/87)</li>
<li>Saudi GOSI contributions (legacy and post-July-2024 schedules)</li><li>Annual leave, overtime and full final-settlement statements</li></ul></div>

<h2>Connect</h2>
<p><b>Claude</b> (claude.ai, Desktop): Settings → Connectors → <i>Add custom connector</i>, then paste one of the URLs above.</p>
<p><b>Claude Code</b></p>
<pre>claude mcp add --transport http gulf-business ${origin}/mcp/gulf-business
claude mcp add --transport http infra-audit ${origin}/mcp/infra-audit</pre>
<p><b>Any MCP client</b> (Cursor, VS Code, Windsurf…)</p>
<pre>{
  "mcpServers": {
    "gulf-business": { "type": "http", "url": "${origin}/mcp/gulf-business" },
    "infra-audit":   { "type": "http", "url": "${origin}/mcp/infra-audit" }
  }
}</pre>
<p>The safe <b>read-only business database</b> connector runs locally next to your data: see the <a href="https://github.com/alycheaib/mena-mcp#business-db">README</a>.</p>

<h2>Need Claude connected to your own systems?</h2>
<p>Custom connectors for Odoo, SAP B1, internal databases, e-invoicing and internal APIs, built with the same safety model. <a href="https://github.com/alycheaib/mena-mcp/issues/new?title=Custom%20connector%20request">Open a request</a>.</p>
<p><small>Fair use: a free shared service with best-effort availability. Built by Aly Cheaib.</small></p>
</main></body></html>`;
