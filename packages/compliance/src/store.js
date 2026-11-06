// Local JSON store so assessments can be saved and re-checked later (stdio edition only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = () => process.env.COMPLIANCE_DATA_DIR || path.join(os.homedir(), '.compliance-mcp');
const file = () => path.join(dir(), 'assessments.json');

function load() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; }
}

export function saveAssessment({ name, assessment }) {
  if (!name || !/^[\w .-]{1,80}$/.test(name)) throw new Error('name must be 1-80 letters, digits, spaces, dots, dashes or underscores');
  if (!assessment || typeof assessment.overall_readiness_percent !== 'number') throw new Error('assessment must be the object returned by gap_assessment');
  const all = load();
  const entry = { id: all.length + 1, name, saved_at: new Date().toISOString(), overall_readiness_percent: assessment.overall_readiness_percent,
    per_framework: Object.fromEntries(Object.entries(assessment.per_framework || {}).map(([k, v]) => [k, v.readiness_percent])),
    open_gaps: (assessment.gaps || []).map((g) => g.domain), assessment };
  all.push(entry);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(all, null, 2));
  return { saved: true, id: entry.id, name, file: file() };
}

export function listAssessments({ name } = {}) {
  const rows = load().filter((a) => !name || a.name === name);
  const history = rows.map(({ assessment, ...summary }) => summary);
  let progress = null;
  if (name && rows.length >= 2) {
    const [prev, last] = rows.slice(-2);
    progress = {
      from: prev.saved_at, to: last.saved_at, readiness_change: Math.round((last.overall_readiness_percent - prev.overall_readiness_percent) * 10) / 10,
      closed_gaps: prev.open_gaps.filter((g) => !last.open_gaps.includes(g)), new_gaps: last.open_gaps.filter((g) => !prev.open_gaps.includes(g))
    };
  }
  return { count: history.length, history, progress, file: file() };
}
