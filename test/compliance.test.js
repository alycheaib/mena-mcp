import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from './helpers.js';
import { ISO_CONTROLS, SOC2_CRITERIA, DOMAINS } from '../packages/compliance/src/catalog.js';
import { mapAuditToControls } from '../packages/compliance/src/compliance.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compliance-test-'));
let s;
before(async () => { s = await connect('compliance', { env: { COMPLIANCE_DATA_DIR: dataDir } }); });
after(async () => { await s.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('catalogue integrity', () => {
  assert.equal(ISO_CONTROLS.length, 93);
  assert.equal(ISO_CONTROLS.filter((c) => c.id.startsWith('5.')).length, 37);
  assert.equal(ISO_CONTROLS.filter((c) => c.id.startsWith('6.')).length, 8);
  assert.equal(ISO_CONTROLS.filter((c) => c.id.startsWith('7.')).length, 14);
  assert.equal(ISO_CONTROLS.filter((c) => c.id.startsWith('8.')).length, 34);
  assert.equal(new Set(ISO_CONTROLS.map((c) => c.id)).size, 93);
  assert.equal(SOC2_CRITERIA.filter((c) => c.id.startsWith('CC')).length, 33);
  const isoIds = new Set(ISO_CONTROLS.map((c) => c.id));
  const socIds = new Set(SOC2_CRITERIA.map((c) => c.id));
  for (const d of DOMAINS) {
    for (const id of d.iso) assert.ok(isoIds.has(id), `${d.key}: bad ISO id ${id}`);
    for (const id of d.soc2) assert.ok(socIds.has(id), `${d.key}: bad SOC 2 id ${id}`);
  }
  // every SOC 2 criterion and every ISO Annex A control is covered by at least one domain
  const mapped = new Set(DOMAINS.flatMap((d) => d.soc2));
  for (const c of SOC2_CRITERIA) assert.ok(mapped.has(c.id), `unmapped ${c.id}`);
  const isoMapped = new Set(DOMAINS.flatMap((d) => d.iso));
  for (const c of ISO_CONTROLS) assert.ok(isoMapped.has(c.id), `unmapped ISO ${c.id}`);
});

test('tools, frameworks and controls', async () => {
  const { tools } = await s.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['crosswalk', 'dpia_screening', 'evidence_checklist', 'gap_assessment', 'gdpr_deadline', 'get_controls', 'list_assessments', 'list_frameworks', 'policy_template', 'questionnaire', 'save_assessment', 'technical_evidence_scan']);
  const f = await s.call('list_frameworks');
  assert.deepEqual(f.frameworks.map((x) => x.key), ['soc2', 'iso27001', 'gdpr']);
  const c = await s.call('get_controls', { framework: 'iso27001', search: 'cryptography' });
  assert.deepEqual(c.controls.map((x) => x.id), ['8.24']);
  assert.ok(c.controls[0].domains.includes('encryption'));
  assert.equal((await s.call('get_controls', { framework: 'soc2', category: 'Privacy' })).count, 18);
});

test('crosswalk ISO 8.24 ↔ SOC 2 ↔ GDPR', async () => {
  const x = await s.call('crosswalk', { framework: 'iso27001', control_id: 'A.8.24' });
  assert.ok(x.equivalents.soc2.some((c) => c.id === 'CC6.7'));
  assert.ok(x.equivalents.gdpr.some((c) => c.id === 'Art. 32'));
  const b = await s.call('crosswalk', { framework: 'gdpr', control_id: 'Art. 33' });
  assert.ok(b.equivalents.iso27001.some((c) => c.id === '5.26'));
  assert.match((await s.call('crosswalk', { framework: 'soc2', control_id: 'ZZ9' })).error, /not found/);
});

test('questionnaire + gap assessment + evidence', async () => {
  const q = await s.call('questionnaire', { frameworks: ['soc2', 'iso27001'] });
  assert.ok(q.questions.length >= 15);
  const allYes = Object.fromEntries(DOMAINS.map((d) => [d.key, 'yes']));
  const full = await s.call('gap_assessment', { answers: allYes });
  assert.equal(full.overall_readiness_percent, 100);
  assert.equal(full.gaps.length, 0);
  const mixed = await s.call('gap_assessment', { organisation: 'Acme', answers: { ...allYes, incident_response: 'no', access_control: 'partial', endpoint_physical: 'na' } });
  assert.ok(mixed.overall_readiness_percent < 100 && mixed.overall_readiness_percent > 70);
  assert.equal(mixed.gaps[0].domain, 'incident_response');
  assert.equal(mixed.gaps[0].priority, 'high');
  assert.ok(mixed.per_framework.gdpr.missing.includes('Art. 33'));
  assert.ok(mixed.per_framework.soc2.partial.includes('CC6.2'));
  const none = await s.call('gap_assessment', { frameworks: ['gdpr'], answers: {} });
  assert.equal(none.overall_readiness_percent, 0); assert.ok(none.unanswered.length > 5);
  assert.match((await s.call('gap_assessment', { answers: { nonsense: 'yes' } })).error, /Unknown domain|Invalid/);
  const ev = await s.call('evidence_checklist', { framework: 'soc2', control_id: 'CC6.1' });
  assert.ok(ev.items.some((i) => i.domain === 'access_control'));
});

test('policies', async () => {
  const p = await s.call('policy_template', { policy: 'incident_response', organisation: 'Acme FZ-LLC' });
  assert.match(p.markdown, /^# Incident Response Policy/);
  assert.match(p.markdown, /72 hours/);
  assert.match(p.markdown, /Acme FZ-LLC/);
  for (const k of ['information_security', 'access_control', 'business_continuity', 'vendor_management', 'data_retention', 'privacy_notice']) {
    assert.ok((await s.call('policy_template', { policy: k })).markdown.length > 400, k);
  }
});

test('GDPR deadlines and DPIA screening', async () => {
  const b = await s.call('gdpr_deadline', { type: 'breach', start: '2026-11-06T09:00:00Z' });
  assert.equal(b.notify_authority_by, '2026-11-09T09:00:00.000Z');
  const d = await s.call('gdpr_deadline', { type: 'dsar', start: '2026-01-31' });
  assert.equal(d.respond_by, '2026-02-28'); assert.equal(d.extended_deadline, '2026-04-30');
  const p = await s.call('dpia_screening', { criteria: ['large_scale', 'sensitive_data'] });
  assert.equal(p.dpia_required, 'likely');
  assert.equal((await s.call('dpia_screening', { criteria: [] })).dpia_required, 'unlikely');
});

test('technical findings map to controls', () => {
  const mapped = mapAuditToControls({ findings: [
    { area: 'tls', severity: 'high', issue: 'Certificate expires in 5 days' },
    { area: 'email', severity: 'medium', issue: 'DMARC p=none' },
    { area: 'headers', severity: 'low', issue: 'Missing referrer-policy' }
  ] });
  const by = Object.fromEntries(mapped.map((m) => [m.domain, m]));
  assert.equal(by.encryption.suggested_answer, 'no');
  assert.ok(by.encryption.controls.iso27001.includes('8.24'));
  assert.equal(by.email_security.suggested_answer, 'partial');
  assert.equal(by.vulnerability_management.suggested_answer, 'yes');
});

test('save and track progress over time', async () => {
  const allYes = Object.fromEntries(DOMAINS.map((d) => [d.key, 'yes']));
  const first = await s.call('gap_assessment', { answers: { ...allYes, incident_response: 'no', vendor_management: 'no' } });
  assert.equal((await s.call('save_assessment', { name: 'acme', assessment: first })).saved, true);
  const second = await s.call('gap_assessment', { answers: { ...allYes, vendor_management: 'partial' } });
  await s.call('save_assessment', { name: 'acme', assessment: second });
  const h = await s.call('list_assessments', { name: 'acme' });
  assert.equal(h.count, 2);
  assert.ok(h.progress.readiness_change > 0);
  assert.deepEqual(h.progress.closed_gaps, ['incident_response']);
  assert.ok(fs.existsSync(path.join(dataDir, 'assessments.json')));
});
