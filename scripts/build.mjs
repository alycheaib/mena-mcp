// Bundles each MCP server into a single dependency-free file inside its Claude Code plugin folder.
import { build } from 'esbuild';

for (const name of ['gulf-business', 'infra-audit', 'business-db']) {
  await build({
    entryPoints: [`packages/${name}/src/cli.js`],
    outfile: `plugins/${name}/server.mjs`,
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    legalComments: 'eof',
    banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
    logLevel: 'warning'
  });
  console.log(`built plugins/${name}/server.mjs`);
}
