import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listFrameworks, getControls, crosswalk, questionnaire, gapAssessment, evidenceChecklist, gdprDeadline, dpiaScreening, mapAuditToControls, DPIA_CRITERIA } from './compliance.js';
import { policyTemplate, POLICY_KEYS } from './policies.js';
import { DOMAIN_KEYS } from './catalog.js';
import { auditDomain } from '../../infra-audit/src/checks.js';

/**
 * @param {object} options  McpServer options (e.g. jsonSchemaValidator)
 * @param {object} [store]  { saveAssessment, listAssessments } — only on runtimes with a filesystem
 */
export function createServer(options = {}, store = null) {
  const server = new McpServer({ name: 'compliance', version: '0.1.0' }, {
    ...options,
    instructions: 'SOC 2, ISO 27001:2022 and GDPR readiness. Typical flow: questionnaire, then gap_assessment (optionally after technical_evidence_scan), then evidence_checklist and policy_template for the gaps, then save_assessment to track progress. This is a readiness aid, not an audit opinion or legal advice.'
  });
  const ro = { readOnlyHint: true, openWorldHint: false, idempotentHint: true };
  const tool = (name, title, description, inputSchema, fn, annotations = ro) =>
    server.registerTool(name, { title, description, inputSchema, annotations }, async (args) => {
      try {
        const out = await fn(args);
        return { content: [{ type: 'text', text: out.markdown ?? JSON.stringify(out, null, 2) }], structuredContent: out };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });

  const frameworks = z.array(z.enum(['soc2', 'iso27001', 'gdpr'])).min(1).default(['soc2', 'iso27001', 'gdpr']);

  tool('list_frameworks', 'List frameworks', 'List the supported frameworks (SOC 2, ISO/IEC 27001:2022, GDPR) with control counts.', {}, () => ({ frameworks: listFrameworks() }));

  tool('get_controls', 'Get controls', 'List the controls/criteria/articles of a framework, optionally filtered by text or category, with their common control domains.',
    { framework: z.enum(['soc2', 'iso27001', 'gdpr']), search: z.string().optional(), category: z.string().optional().describe('e.g. "Security", "Privacy", "CC6", "8."') },
    (a) => getControls(a));

  tool('crosswalk', 'Cross-framework mapping', 'Map one control to its equivalents in the other frameworks (e.g. ISO 8.24 → SOC 2 CC6.7 → GDPR Art. 32) and list the shared evidence.',
    { framework: z.enum(['soc2', 'iso27001', 'gdpr']), control_id: z.string().describe('e.g. CC6.1, 8.24, Art. 33') }, (a) => crosswalk(a));

  tool('questionnaire', 'Readiness questionnaire', 'Get the readiness questions (one per control domain) to answer before running gap_assessment.',
    { frameworks }, (a) => questionnaire(a));

  tool('gap_assessment', 'Gap assessment',
    `Score SOC 2 / ISO 27001 / GDPR readiness from yes/partial/no/na answers per domain. Returns overall and per-framework readiness, met/partial/missing controls and prioritised remediation. Domains: ${DOMAIN_KEYS.join(', ')}.`,
    { frameworks, answers: z.record(z.string(), z.enum(['yes', 'partial', 'no', 'na'])).describe('{ "access_control": "partial", ... }'), organisation: z.string().optional() },
    (a) => gapAssessment(a));

  tool('evidence_checklist', 'Evidence checklist', 'Evidence an auditor will ask for, by domain or by a specific control, with remediation steps.',
    { domain: z.enum(DOMAIN_KEYS).optional(), framework: z.enum(['soc2', 'iso27001', 'gdpr']).optional(), control_id: z.string().optional() }, (a) => evidenceChecklist(a));

  tool('policy_template', 'Policy template', `Generate a starter policy in Markdown, mapped to SOC 2 / ISO / GDPR controls. Policies: ${POLICY_KEYS.join(', ')}.`,
    { policy: z.enum(POLICY_KEYS), organisation: z.string().optional(), owner: z.string().optional() }, (a) => policyTemplate(a));

  tool('gdpr_deadline', 'GDPR deadlines', 'Compute the GDPR breach-notification deadline (72 hours, Art. 33) or the data subject request deadline (1 month, extendable by 2, Art. 12(3)).',
    { type: z.enum(['breach', 'dsar']), start: z.string().describe('When you became aware of the breach (date-time) or received the request (date)') }, (a) => gdprDeadline(a));

  tool('dpia_screening', 'DPIA screening', 'Check whether a processing activity likely needs a DPIA using the 9 EDPB/WP29 criteria (2+ means likely).',
    { criteria: z.array(z.enum(Object.keys(DPIA_CRITERIA))).default([]) }, (a) => dpiaScreening(a));

  tool('technical_evidence_scan', 'Technical evidence scan',
    'Passively scan a domain (TLS, security headers, SPF/DMARC, DNS, end-of-life software) and map the findings to SOC 2 / ISO 27001 / GDPR controls, with a suggested answer for the matching domains. Only scan domains you own or are authorised to assess.',
    { domain: z.string().min(1), software: z.array(z.object({ product: z.string(), version: z.string() })).max(20).default([]) },
    async ({ domain, software }) => {
      const audit = await auditDomain(domain, { software });
      return { domain: audit.domain, scanned_at: audit.checked_at, technical_grade: audit.grade, suggested_answers: mapAuditToControls(audit), disclaimer: audit.disclaimer };
    }, { readOnlyHint: true, openWorldHint: true, idempotentHint: true });

  if (store) {
    tool('save_assessment', 'Save assessment', 'Save a gap_assessment result under a name so progress can be tracked over time.',
      { name: z.string().min(1).max(80), assessment: z.record(z.string(), z.any()).describe('The full object returned by gap_assessment') },
      (a) => store.saveAssessment(a), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    tool('list_assessments', 'Assessment history', 'List saved assessments and, for a name, the progress since the previous one (readiness change, closed and new gaps).',
      { name: z.string().optional() }, (a) => store.listAssessments(a));
  }
  return server;
}
