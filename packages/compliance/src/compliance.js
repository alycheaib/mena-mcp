import { FRAMEWORKS, ISO_CONTROLS, SOC2_CRITERIA, GDPR_ARTICLES, DOMAINS, DOMAIN_KEYS } from './catalog.js';

const CATALOG = { soc2: SOC2_CRITERIA, iso27001: ISO_CONTROLS, gdpr: GDPR_ARTICLES };
const FIELD = { soc2: 'soc2', iso27001: 'iso', gdpr: 'gdpr' };
const SCORE = { yes: 1, partial: 0.5, no: 0 };
const r1 = (n) => Math.round(n * 10) / 10;

function fw(name) {
  const k = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = { soc2: 'soc2', soc: 'soc2', iso27001: 'iso27001', iso: 'iso27001', iso270012022: 'iso27001', gdpr: 'gdpr' }[k];
  if (!key) throw new Error(`Unknown framework "${name}". Use soc2, iso27001 or gdpr.`);
  return key;
}

const domainsFor = (f, id) => DOMAINS.filter((d) => d[FIELD[f]].includes(id)).map((d) => d.key);

export function listFrameworks() {
  return Object.entries(FRAMEWORKS).map(([key, v]) => ({ key, ...v, controls: CATALOG[key].length, mapped_to_domains: CATALOG[key].filter((c) => domainsFor(key, c.id).length).length }));
}

export function getControls({ framework, search, category }) {
  const f = fw(framework);
  const q = search ? String(search).toLowerCase() : null;
  const list = CATALOG[f]
    .filter((c) => !q || c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
    .filter((c) => !category || (c.category || '').toLowerCase().includes(String(category).toLowerCase()) || c.id.startsWith(category))
    .map((c) => ({ ...c, domains: domainsFor(f, c.id) }));
  return { framework: f, name: FRAMEWORKS[f].name, count: list.length, controls: list };
}

export function crosswalk({ framework, control_id }) {
  const f = fw(framework);
  const ctl = CATALOG[f].find((c) => c.id.toLowerCase() === String(control_id).toLowerCase().replace(/^a\./, ''));
  if (!ctl) throw new Error(`${control_id} not found in ${f}. Use get_controls to list IDs.`);
  const doms = DOMAINS.filter((d) => d[FIELD[f]].includes(ctl.id));
  const related = (g) => [...new Set(doms.flatMap((d) => d[FIELD[g]]))].map((id) => CATALOG[g].find((c) => c.id === id)).filter(Boolean);
  return {
    framework: f, control: ctl, domains: doms.map((d) => ({ key: d.key, title: d.title })),
    equivalents: Object.fromEntries(Object.keys(CATALOG).filter((g) => g !== f).map((g) => [g, related(g)])),
    shared_evidence: [...new Set(doms.flatMap((d) => d.evidence))],
    note: doms.length ? 'Equivalents share a control domain: one piece of evidence can usually serve all of them.' : 'This control is not mapped to a common domain yet.'
  };
}

export function questionnaire({ frameworks = ['soc2', 'iso27001', 'gdpr'] } = {}) {
  const fs = frameworks.map(fw);
  const doms = DOMAINS.filter((d) => fs.some((f) => d[FIELD[f]].length) && (!d.privacy || fs.includes('gdpr') || fs.includes('soc2')));
  return {
    frameworks: fs, instructions: 'Answer each domain with yes, partial, no or na (not applicable). Pass the answers to gap_assessment.',
    questions: doms.map((d) => ({ domain: d.key, title: d.title, question: d.question, covers: Object.fromEntries(fs.map((f) => [f, d[FIELD[f]]])) }))
  };
}

export function gapAssessment({ frameworks = ['soc2', 'iso27001', 'gdpr'], answers = {}, organisation }) {
  const fs = frameworks.map(fw);
  for (const [k, v] of Object.entries(answers)) {
    if (!DOMAIN_KEYS.includes(k)) throw new Error(`Unknown domain "${k}". Valid: ${DOMAIN_KEYS.join(', ')}`);
    if (!['yes', 'partial', 'no', 'na'].includes(v)) throw new Error(`Answer for ${k} must be yes, partial, no or na`);
  }
  const relevant = DOMAINS.filter((d) => fs.some((f) => d[FIELD[f]].length));
  const unanswered = relevant.filter((d) => !(d.key in answers)).map((d) => d.key);

  // overall weighted readiness
  let wSum = 0; let wGot = 0;
  for (const d of relevant) {
    const a = answers[d.key];
    if (!a || a === 'na') continue;
    wSum += d.weight; wGot += d.weight * SCORE[a];
  }

  const perFramework = {};
  for (const f of fs) {
    const status = {};
    for (const c of CATALOG[f]) {
      const ds = DOMAINS.filter((d) => d[FIELD[f]].includes(c.id) && answers[d.key] && answers[d.key] !== 'na');
      if (!ds.length) continue;
      status[c.id] = Math.max(...ds.map((d) => SCORE[answers[d.key]]));
    }
    const vals = Object.values(status);
    const mappedTotal = CATALOG[f].filter((c) => domainsFor(f, c.id).length).length;
    perFramework[f] = {
      name: FRAMEWORKS[f].name,
      readiness_percent: vals.length ? r1((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) : 0,
      controls_assessed: vals.length, controls_mapped: mappedTotal, controls_total: CATALOG[f].length,
      met: Object.entries(status).filter(([, v]) => v === 1).map(([k]) => k),
      partial: Object.entries(status).filter(([, v]) => v === 0.5).map(([k]) => k),
      missing: Object.entries(status).filter(([, v]) => v === 0).map(([k]) => k)
    };
  }

  const gaps = relevant
    .filter((d) => answers[d.key] === 'no' || answers[d.key] === 'partial')
    .map((d) => ({ domain: d.key, title: d.title, status: answers[d.key], priority: d.weight * (answers[d.key] === 'no' ? 2 : 1) >= 4 ? 'high' : d.weight * (answers[d.key] === 'no' ? 2 : 1) >= 2 ? 'medium' : 'low',
      remediation: d.fix, evidence_needed: d.evidence, affects: Object.fromEntries(fs.map((f) => [f, d[FIELD[f]]])) }))
    .sort((a, b) => ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority));

  const score = wSum ? r1((wGot / wSum) * 100) : 0;
  return {
    organisation: organisation || null, assessed_at: new Date().toISOString(), frameworks: fs,
    overall_readiness_percent: score,
    verdict: score >= 85 ? 'Audit-ready: gather evidence and book a readiness review.' : score >= 60 ? 'Close: fix the high-priority gaps, then do a pre-audit.' : 'Early stage: build the foundations (policies, risk register, access control, incident response) first.',
    per_framework: perFramework, gaps, unanswered,
    disclaimer: 'Self-assessment readiness estimate. Not a SOC 2 report, ISO certificate or legal opinion.'
  };
}

export function evidenceChecklist({ domain, framework, control_id }) {
  let doms;
  if (domain) {
    const d = DOMAINS.find((x) => x.key === domain);
    if (!d) throw new Error(`Unknown domain. Valid: ${DOMAIN_KEYS.join(', ')}`);
    doms = [d];
  } else if (framework && control_id) {
    const f = fw(framework);
    doms = DOMAINS.filter((d) => d[FIELD[f]].includes(control_id));
    if (!doms.length) throw new Error(`No evidence mapping for ${f} ${control_id}`);
  } else {
    doms = DOMAINS;
  }
  return { items: doms.map((d) => ({ domain: d.key, title: d.title, evidence: d.evidence, remediation: d.fix, controls: { soc2: d.soc2, iso27001: d.iso, gdpr: d.gdpr } })) };
}

// ---------- GDPR helpers ----------
function addMonths(d, n) {
  const y = d.getUTCFullYear(); const m = d.getUTCMonth() + n; const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes()));
}

export function gdprDeadline({ type, start }) {
  const t = new Date(start);
  if (Number.isNaN(t.getTime())) throw new Error('start must be an ISO date or date-time');
  if (type === 'breach') {
    const due = new Date(t.getTime() + 72 * 3600000);
    return { type, became_aware_at: t.toISOString(), notify_authority_by: due.toISOString(), hours: 72,
      rules: ['Art. 33: notify the lead supervisory authority without undue delay and within 72 hours of becoming aware, unless the breach is unlikely to risk individuals\' rights.',
        'If late, give reasons for the delay. Information may be provided in phases.',
        'Art. 34: tell affected individuals without undue delay if the breach is likely to cause a HIGH risk.',
        'Art. 33(5): document every breach (facts, effects, remedial action), even when not notified.'] };
  }
  if (type === 'dsar') {
    const due = addMonths(t, 1);
    const ext = addMonths(t, 3);
    return { type, received_at: t.toISOString().slice(0, 10), respond_by: due.toISOString().slice(0, 10), extended_deadline: ext.toISOString().slice(0, 10),
      rules: ['Art. 12(3): respond within one month of receipt.', 'Extendable by two further months for complex or numerous requests; tell the person within the first month, with reasons.', 'Free of charge unless manifestly unfounded or excessive.'] };
  }
  throw new Error('type must be "breach" or "dsar"');
}

export const DPIA_CRITERIA = {
  evaluation_scoring: 'Evaluation or scoring, including profiling and prediction',
  automated_decisions: 'Automated decision-making with legal or similarly significant effect',
  systematic_monitoring: 'Systematic monitoring (incl. publicly accessible areas)',
  sensitive_data: 'Sensitive data or data of a highly personal nature (special categories, criminal, financial, location)',
  large_scale: 'Data processed on a large scale',
  matching_combining: 'Matching or combining datasets',
  vulnerable_subjects: 'Data concerning vulnerable data subjects (children, employees, patients…)',
  innovative_technology: 'Innovative use or new technological or organisational solutions (e.g. AI, biometrics)',
  prevents_rights: 'Processing that prevents people from exercising a right or using a service/contract'
};

export function dpiaScreening({ criteria = [] }) {
  for (const c of criteria) if (!DPIA_CRITERIA[c]) throw new Error(`Unknown criterion ${c}. Valid: ${Object.keys(DPIA_CRITERIA).join(', ')}`);
  const n = criteria.length;
  return {
    criteria_met: criteria.map((c) => ({ key: c, description: DPIA_CRITERIA[c] })), count: n,
    dpia_required: n >= 2 ? 'likely' : n === 1 ? 'possibly' : 'unlikely',
    guidance: n >= 2 ? 'Two or more criteria: carry out a DPIA before processing starts (Art. 35; EDPB/WP29 guidelines).'
      : n === 1 ? 'One criterion: a DPIA may still be needed; document your reasoning and check your supervisory authority\'s DPIA list.'
        : 'No criteria met: record the screening result; review if the processing changes.',
    all_criteria: DPIA_CRITERIA
  };
}

// ---------- Technical evidence from a passive domain audit ----------
export function mapAuditToControls(audit) {
  const byArea = { tls: 'encryption', headers: 'network_security', email: 'email_security', software: 'vulnerability_management', dns: 'network_security' };
  const res = {};
  for (const key of new Set(Object.values(byArea))) res[key] = { findings: [] };
  for (const f of audit.findings || []) {
    const dk = byArea[f.area];
    if (dk) res[dk].findings.push({ severity: f.severity, issue: f.issue, fix: f.fix });
  }
  return Object.entries(res).map(([key, v]) => {
    const d = DOMAINS.find((x) => x.key === key);
    const sev = v.findings.map((f) => f.severity);
    const suggested = sev.some((s) => s === 'critical' || s === 'high') ? 'no' : sev.some((s) => s === 'medium' || s === 'low') ? 'partial' : 'yes';
    return { domain: key, title: d.title, suggested_answer: suggested, controls: { soc2: d.soc2, iso27001: d.iso, gdpr: d.gdpr }, findings: v.findings };
  });
}
