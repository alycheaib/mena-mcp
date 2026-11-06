# Deploys the hosted MCP endpoints to Cloudflare Workers (FREE plan, no bindings) and tests them live.
# One-time: run `npx wrangler login` in this folder (opens the browser to authorise wrangler).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\worker')

$who = npx wrangler whoami 2>&1 | Out-String
if ($who -match 'not authenticated') { Write-Host 'Run: npx wrangler login   (then re-run this script)'; exit 1 }

# Safety: refuse to deploy if any billable binding sneaks into the config.
$cfg = Get-Content wrangler.jsonc -Raw
foreach ($b in 'ai', 'kv_namespaces', 'd1_databases', 'r2_buckets', 'durable_objects', 'queues', 'vectorize', 'browser', 'hyperdrive') {
  if ($cfg -match "`"$b`"\s*:") { throw "Billable binding '$b' found in wrangler.jsonc. Aborting." }
}

$out = npx wrangler deploy 2>&1 | Out-String
Write-Host $out
$url = ([regex]'https://[a-z0-9.-]+\.workers\.dev').Match($out).Value
if (-not $url) { throw 'Could not find the workers.dev URL in the deploy output.' }

Set-Location (Join-Path $PSScriptRoot '..')
$env:MCP_REMOTE_URL = $url
node --test --no-warnings test/remote.test.js
Write-Host "`nLive: $url  (endpoints: $url/mcp/gulf-business, /mcp/infra-audit, /mcp/gcc-hr, /mcp/compliance)"
