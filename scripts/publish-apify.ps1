# Builds and pushes the Apify Actor. One-time: create a free Apify account, then `npx apify-cli login`.
# After the push: Apify Console > Actor > Publication: set pay-per-event prices
#   domain-audited = $0.01, tool-call = $0.005 (suggested), add an icon, choose categories (Security, Developer tools, AI), publish to the Store.
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
Set-Location $root
npx esbuild apify/website-audit/src/main.js --bundle --platform=node --format=esm --target=node22 --external:apify `
  --outfile=apify/website-audit/dist/main.mjs "--banner:js=import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" --log-level=warning
Set-Location (Join-Path $root 'apify\website-audit')
npx apify-cli push
