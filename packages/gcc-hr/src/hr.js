// GCC HR & payroll calculations: end-of-service, GOSI, leave, overtime, final settlement.
// Rules encoded (verify against current law before payroll use, see README for sources):
//  UAE: Federal Decree-Law 33/2021 (Art. 51): 21 days' basic wage per year for the first 5 years, 30 days per year after;
//       eligible after 1 year of continuous service; total capped at 2 years' wage; unpaid absence is excluded; no resignation reduction.
//  KSA: Labor Law Art. 84: half a month's wage per year for the first 5 years, one month per year after, on the last actual wage;
//       Art. 85 resignation: <2 yrs 0, 2-<5 yrs 1/3, 5-<10 yrs 2/3, 10+ yrs full; Art. 87 exceptions pay in full.
//  GOSI (KSA): annuities 9% + 9% for Saudis registered before 3 Jul 2024; for those registered from 3 Jul 2024 the annuity
//       rate rises 0.5 pt each July from 2025 to 11% in 2028 (each side). SANED 0.75% + 0.75%. Occupational hazards 2% employer.
//       Non-Saudis: 2% employer only. Contribution base = basic + housing, capped at SAR 45,000/month.

const DAY = 86400000;
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function parseDate(s, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error(`${name} must be YYYY-MM-DD`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error(`Invalid ${name}: ${s}`);
  return d;
}

/** Service length from start to end date (inclusive), minus unpaid days. */
export function serviceLength(start, end, unpaidDays = 0) {
  const a = parseDate(start, 'start_date');
  const b = parseDate(end, 'end_date');
  if (b < a) throw new Error('end_date must be on or after start_date');
  if (!(unpaidDays >= 0)) throw new Error('unpaid_leave_days must be >= 0');
  const days = Math.round((b - a) / DAY) + 1 - unpaidDays;
  if (days < 0) throw new Error('unpaid_leave_days is longer than the service period');
  // Calendar method: count full anniversaries, then the fraction of the current service year (leap-year safe).
  const endExcl = new Date(b.getTime() + DAY);
  const addYears = (d, n) => new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
  let full = 0;
  while (addYears(a, full + 1) <= endExcl) full++;
  const anniv = addYears(a, full);
  const frac = (endExcl - anniv) / (addYears(a, full + 1) - anniv);
  const years = Math.max(0, full + frac - unpaidDays / 365);
  const wy = Math.floor(years);
  const remDays = Math.round((years - wy) * 365);
  return { days, years: Math.round(years * 10000) / 10000, text: `${wy} year(s), ${Math.floor(remDays / 30.4167)} month(s), ${Math.round(remDays % 30.4167)} day(s)` };
}

// ---------------- UAE ----------------
export function uaeGratuity({ basic_salary, start_date, end_date, unpaid_leave_days = 0, daily_wage_basis = '30' }) {
  if (!(basic_salary > 0)) throw new Error('basic_salary (monthly basic wage, AED) must be > 0');
  const svc = serviceLength(start_date, end_date, unpaid_leave_days);
  const daily = daily_wage_basis === '365' ? (basic_salary * 12) / 365 : basic_salary / 30;
  const base = { country: 'AE', service: svc, basic_salary, daily_basic_wage: r2(daily), daily_wage_basis: daily_wage_basis === '365' ? 'basic × 12 / 365' : 'basic / 30' };
  if (svc.years < 1) return { ...base, eligible: false, gratuity: 0, reason: 'Less than 1 year of continuous service: no gratuity (Decree-Law 33/2021, Art. 51).' };
  const first = Math.min(svc.years, 5);
  const rest = Math.max(svc.years - 5, 0);
  const days = first * 21 + rest * 30;
  const raw = days * daily;
  const cap = basic_salary * 24;
  const gratuity = Math.min(raw, cap);
  return {
    ...base, eligible: true,
    breakdown: [
      { period: `first ${r2(first)} year(s) × 21 days`, days: r2(first * 21), amount: r2(first * 21 * daily) },
      ...(rest ? [{ period: `next ${r2(rest)} year(s) × 30 days`, days: r2(rest * 30), amount: r2(rest * 30 * daily) }] : [])
    ],
    gratuity_days: r2(days), uncapped: r2(raw), cap_two_years_wage: r2(cap), capped: raw > cap, gratuity: r2(gratuity),
    rules: 'Decree-Law 33/2021 Art. 51: 21 days/yr (first 5 yrs), 30 days/yr after, on last basic wage, capped at 2 years. Same for resignation or termination. Pay within 14 days of contract end.',
    note: 'Mainland private sector. DIFC (DEWS), ADGM and free-zone or government schemes may differ.'
  };
}

// ---------------- KSA ----------------
const KSA_REASONS = ['contract_end', 'employer_termination', 'resignation', 'art87_exception', 'art80_dismissal'];

export function ksaEndOfService({ monthly_wage, start_date, end_date, reason = 'contract_end', unpaid_leave_days = 0 }) {
  if (!(monthly_wage > 0)) throw new Error('monthly_wage (last actual wage: basic + housing + fixed allowances, SAR) must be > 0');
  if (!KSA_REASONS.includes(reason)) throw new Error(`reason must be one of ${KSA_REASONS.join(', ')}`);
  const svc = serviceLength(start_date, end_date, unpaid_leave_days);
  const first = Math.min(svc.years, 5);
  const rest = Math.max(svc.years - 5, 0);
  const full = first * (monthly_wage / 2) + rest * monthly_wage;
  let factor = 1;
  let rule = 'Art. 84: full award (contract end or termination by the employer).';
  if (reason === 'resignation') {
    if (svc.years < 2) { factor = 0; rule = 'Art. 85: resignation with under 2 years of service, no award.'; }
    else if (svc.years < 5) { factor = 1 / 3; rule = 'Art. 85: resignation after 2–5 years, one third of the award.'; }
    else if (svc.years < 10) { factor = 2 / 3; rule = 'Art. 85: resignation after 5–10 years, two thirds of the award.'; }
    else rule = 'Art. 85: resignation after 10+ years, full award.';
  } else if (reason === 'art87_exception') {
    rule = 'Art. 87: full award (e.g. force majeure, or a woman resigning within 6 months of marriage or 3 months of giving birth).';
  } else if (reason === 'art80_dismissal') {
    factor = 0; rule = 'Art. 80: dismissal for cause under one of the listed cases, no award.';
  }
  return {
    country: 'SA', service: svc, monthly_wage, reason,
    breakdown: [
      { period: `first ${r2(first)} year(s) × ½ month`, amount: r2(first * monthly_wage / 2) },
      ...(rest ? [{ period: `next ${r2(rest)} year(s) × 1 month`, amount: r2(rest * monthly_wage) }] : [])
    ],
    full_award: r2(full), entitlement_factor: r2(factor), end_of_service_award: r2(full * factor), rule,
    note: 'Based on the last actual wage (Art. 2: basic plus fixed allowances such as housing). Check your contract and any later amendments.'
  };
}

// ---------------- GOSI ----------------
function annuityRate(registeredFrom2024, onDate) {
  if (!registeredFrom2024) return 0.09;
  const d = onDate.toISOString().slice(0, 10);
  if (d < '2025-07-01') return 0.09;
  if (d < '2026-07-01') return 0.095;
  if (d < '2027-07-01') return 0.10;
  if (d < '2028-07-01') return 0.105;
  return 0.11;
}

export function gosiContributions({ basic_salary, housing_allowance = 0, nationality = 'saudi', registration_date, on_date }) {
  if (!(basic_salary > 0)) throw new Error('basic_salary must be > 0');
  if (!(housing_allowance >= 0)) throw new Error('housing_allowance must be >= 0');
  const nat = String(nationality).toLowerCase();
  if (!['saudi', 'non_saudi'].includes(nat)) throw new Error('nationality must be "saudi" or "non_saudi"');
  const when = on_date ? parseDate(on_date, 'on_date') : new Date();
  const rawBase = basic_salary + housing_allowance;
  const base = Math.min(rawBase, 45000);
  if (nat === 'non_saudi') {
    return { nationality: nat, contribution_base: r2(base), capped: rawBase > 45000, employee: { total: 0 }, employer: { occupational_hazards: r2(base * 0.02), total: r2(base * 0.02) }, total_monthly: r2(base * 0.02), rates: { occupational_hazards_employer: '2%' }, note: 'Non-Saudi employees: employer pays 2% occupational hazards only.' };
  }
  const newSystem = registration_date ? parseDate(registration_date, 'registration_date') >= new Date('2024-07-03T00:00:00Z') : false;
  const ann = annuityRate(newSystem, when);
  const saned = 0.0075;
  const employee = { annuities: r2(base * ann), saned: r2(base * saned) };
  employee.total = r2(employee.annuities + employee.saned);
  const employer = { annuities: r2(base * ann), saned: r2(base * saned), occupational_hazards: r2(base * 0.02) };
  employer.total = r2(employer.annuities + employer.saned + employer.occupational_hazards);
  return {
    nationality: nat, schedule: newSystem ? 'New Social Insurance Law (first registered on or after 3 Jul 2024)' : 'Legacy (registered before 3 Jul 2024)',
    as_of: when.toISOString().slice(0, 10), contribution_base: r2(base), capped: rawBase > 45000,
    rates: { annuities_each_side: `${r2(ann * 100)}%`, saned_each_side: '0.75%', occupational_hazards_employer: '2%' },
    employee, employer, total_monthly: r2(employee.total + employer.total),
    net_salary_after_gosi: r2(basic_salary + housing_allowance - employee.total),
    note: 'Base = basic + housing, capped at SAR 45,000. If registration_date is omitted, the legacy schedule is used. Confirm rates on gosi.gov.sa.'
  };
}

// ---------------- Leave ----------------
export function annualLeave({ country, start_date, as_of_date, days_taken = 0, basic_salary }) {
  const c = String(country).toUpperCase();
  const svc = serviceLength(start_date, as_of_date);
  let accrued;
  let rule;
  if (c === 'AE') {
    if (svc.days < 183) { accrued = 0; rule = 'UAE: no annual leave before 6 months of service.'; }
    else if (svc.years < 1) { accrued = Math.floor(svc.days / 30.4167) * 2; rule = 'UAE Art. 29: 2 days per month after 6 months, until 1 year.'; }
    else { accrued = svc.years * 30; rule = 'UAE Art. 29: 30 calendar days per year after the first year.'; }
  } else if (c === 'SA') {
    const first5 = Math.min(svc.years, 5);
    accrued = first5 * 21 + Math.max(svc.years - 5, 0) * 30;
    rule = 'KSA Art. 109: 21 days per year, 30 days after 5 years with the same employer.';
  } else throw new Error('country must be AE or SA');
  const balance = Math.max(0, accrued - days_taken);
  const out = { country: c, service: svc, accrued_days: r2(accrued), days_taken, balance_days: r2(balance), rule };
  if (basic_salary > 0) {
    out.encashment_value = r2(balance * (basic_salary / 30));
    out.encashment_note = c === 'AE' ? 'UAE: unused leave on exit is paid on basic wage (basic / 30 per day).' : 'KSA Art. 111: unused leave on exit is paid on the actual wage; pass the actual wage as basic_salary to use it.';
  }
  return out;
}

// ---------------- Overtime ----------------
export function overtimePay({ country, basic_salary, actual_wage, hours, type = 'normal', hours_per_day = 8 }) {
  const c = String(country).toUpperCase();
  if (!(basic_salary > 0)) throw new Error('basic_salary must be > 0');
  if (!(hours >= 0)) throw new Error('hours must be >= 0');
  const basicHourly = basic_salary / 30 / hours_per_day;
  if (c === 'AE') {
    const pct = type === 'night' || type === 'rest_day' ? 0.5 : 0.25;
    const perHour = basicHourly * (1 + pct);
    return { country: c, type, hours, basic_hourly: r2(basicHourly), premium: `${pct * 100}%`, per_hour: r2(perHour), total: r2(perHour * hours),
      rule: 'UAE Art. 19: at least 25% on top of the basic hourly wage; at least 50% for 10pm–4am or for rest-day work, unless a substitute day off is given.' };
  }
  if (c === 'SA') {
    const actualHourly = (actual_wage > 0 ? actual_wage : basic_salary) / 30 / hours_per_day;
    const perHour = actualHourly + basicHourly * 0.5;
    return { country: c, type, hours, actual_hourly: r2(actualHourly), basic_hourly: r2(basicHourly), per_hour: r2(perHour), total: r2(perHour * hours),
      rule: 'KSA Art. 107: the hourly wage plus 50% of the basic hourly wage, for each overtime hour.' };
  }
  throw new Error('country must be AE or SA');
}

// ---------------- Final settlement ----------------
export function finalSettlement(input) {
  const c = String(input.country).toUpperCase();
  const lines = [];
  let eos;
  if (c === 'AE') {
    eos = uaeGratuity(input);
    lines.push({ item: 'End-of-service gratuity', amount: eos.gratuity });
  } else if (c === 'SA') {
    eos = ksaEndOfService({ ...input, monthly_wage: input.monthly_wage ?? input.basic_salary });
    lines.push({ item: 'End-of-service award', amount: eos.end_of_service_award });
  } else throw new Error('country must be AE or SA');
  if (input.leave_balance_days > 0) {
    const perDay = (c === 'SA' ? (input.monthly_wage ?? input.basic_salary) : input.basic_salary) / 30;
    lines.push({ item: `Unused leave (${input.leave_balance_days} days)`, amount: r2(input.leave_balance_days * perDay) });
  }
  if (input.unpaid_salary_days > 0) {
    const gross = input.gross_salary ?? input.monthly_wage ?? input.basic_salary;
    lines.push({ item: `Salary for ${input.unpaid_salary_days} worked day(s) not yet paid`, amount: r2(input.unpaid_salary_days * gross / 30) });
  }
  for (const o of input.other_additions || []) lines.push({ item: o.item, amount: r2(o.amount) });
  for (const d of input.deductions || []) lines.push({ item: d.item, amount: -r2(Math.abs(d.amount)) });
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  return { country: c, lines, total, end_of_service_detail: eos, currency: c === 'AE' ? 'AED' : 'SAR', disclaimer: 'Estimate for planning. Check the contract, any later legal amendments and official calculators before paying.' };
}
