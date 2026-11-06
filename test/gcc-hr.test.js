import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers.js';

let s;
before(async () => { s = await connect('gcc-hr'); });
after(() => s.close());

test('exposes HR tools', async () => {
  const { tools } = await s.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['annual_leave', 'final_settlement', 'gosi_contributions', 'ksa_end_of_service', 'overtime_pay', 'uae_gratuity']);
});

test('UAE gratuity: under 1 year, 21-day band, 30-day band and 2-year cap', async () => {
  const short = await s.call('uae_gratuity', { basic_salary: 10000, start_date: '2026-01-01', end_date: '2026-10-31' });
  assert.equal(short.eligible, false); assert.equal(short.gratuity, 0);
  // exactly 3 years (non-leap span 2022-01-01..2024-12-31 is 1095 days)
  const three = await s.call('uae_gratuity', { basic_salary: 9000, start_date: '2022-01-01', end_date: '2024-12-31' });
  assert.equal(three.gratuity_days, 63); assert.equal(three.gratuity, 18900); // 63 × 300
  const long = await s.call('uae_gratuity', { basic_salary: 10000, start_date: '1990-01-01', end_date: '2026-12-31' });
  assert.equal(long.capped, true); assert.equal(long.gratuity, 240000);
  const d365 = await s.call('uae_gratuity', { basic_salary: 9125, start_date: '2022-01-01', end_date: '2024-12-31', daily_wage_basis: '365' });
  assert.equal(d365.daily_basic_wage, 300);
  const unpaid = await s.call('uae_gratuity', { basic_salary: 9000, start_date: '2022-01-01', end_date: '2024-12-31', unpaid_leave_days: 365 });
  assert.equal(unpaid.gratuity_days, 42);
});

test('KSA end of service: Art. 84 bands and Art. 85 resignation tiers', async () => {
  const base = { monthly_wage: 12000, start_date: '2016-01-01', end_date: '2023-12-31' }; // exactly 8 years
  const full = await s.call('ksa_end_of_service', base);
  assert.equal(full.full_award, 66000); // 5 × 6000 + 3 × 12000
  assert.equal((await s.call('ksa_end_of_service', { ...base, reason: 'resignation' })).end_of_service_award, 44000);
  const r1 = await s.call('ksa_end_of_service', { monthly_wage: 9000, start_date: '2025-01-01', end_date: '2026-06-30', reason: 'resignation' });
  assert.equal(r1.end_of_service_award, 0);
  const r3 = await s.call('ksa_end_of_service', { monthly_wage: 9000, start_date: '2022-01-01', end_date: '2024-12-31', reason: 'resignation' });
  assert.equal(r3.end_of_service_award, 4500); // 3 × 4500 × 1/3
  const r12 = await s.call('ksa_end_of_service', { monthly_wage: 10000, start_date: '2012-01-01', end_date: '2023-12-31', reason: 'resignation' });
  assert.equal(r12.entitlement_factor, 1);
  assert.equal((await s.call('ksa_end_of_service', { ...base, reason: 'art87_exception' })).end_of_service_award, 66000);
});

test('GOSI: legacy, new schedule steps, cap and non-Saudi', async () => {
  const legacy = await s.call('gosi_contributions', { basic_salary: 10000, housing_allowance: 2500, on_date: '2026-11-01' });
  assert.equal(legacy.employee.total, 1218.75); // 9.75%
  assert.equal(legacy.employer.total, 1468.75); // 11.75%
  const n25 = await s.call('gosi_contributions', { basic_salary: 10000, housing_allowance: 2500, registration_date: '2024-09-01', on_date: '2026-01-15' });
  assert.equal(n25.rates.annuities_each_side, '9.5%'); assert.equal(n25.total_monthly, 2812.5); // 22.5%
  const n26 = await s.call('gosi_contributions', { basic_salary: 10000, housing_allowance: 2500, registration_date: '2024-09-01', on_date: '2026-11-01' });
  assert.equal(n26.total_monthly, 2937.5); // 23.5%
  const n28 = await s.call('gosi_contributions', { basic_salary: 10000, registration_date: '2024-09-01', on_date: '2029-01-01' });
  assert.equal(n28.rates.annuities_each_side, '11%');
  const cap = await s.call('gosi_contributions', { basic_salary: 50000, housing_allowance: 10000, on_date: '2026-11-01' });
  assert.equal(cap.contribution_base, 45000); assert.equal(cap.capped, true);
  const exp = await s.call('gosi_contributions', { basic_salary: 8000, housing_allowance: 2000, nationality: 'non_saudi' });
  assert.equal(exp.employee.total, 0); assert.equal(exp.employer.total, 200);
});

test('annual leave', async () => {
  const ae = await s.call('annual_leave', { country: 'AE', start_date: '2025-01-01', as_of_date: '2025-09-30', basic_salary: 9000 });
  assert.equal(ae.accrued_days, 16); // 8 full months × 2 days
  const ae2 = await s.call('annual_leave', { country: 'AE', start_date: '2024-01-01', as_of_date: '2024-12-31', days_taken: 10, basic_salary: 9000 });
  assert.equal(ae2.balance_days, 20); assert.equal(ae2.encashment_value, 6000);
  const sa = await s.call('annual_leave', { country: 'SA', start_date: '2016-01-01', as_of_date: '2023-12-31' });
  assert.equal(sa.accrued_days, 195); // 5×21 + 3×30
  assert.equal((await s.call('annual_leave', { country: 'AE', start_date: '2026-06-01', as_of_date: '2026-10-01' })).accrued_days, 0);
});

test('overtime', async () => {
  const ae = await s.call('overtime_pay', { country: 'AE', basic_salary: 7200, hours: 10 }); // 30/h basic
  assert.equal(ae.per_hour, 37.5); assert.equal(ae.total, 375);
  assert.equal((await s.call('overtime_pay', { country: 'AE', basic_salary: 7200, hours: 2, type: 'night' })).total, 90);
  const sa = await s.call('overtime_pay', { country: 'SA', basic_salary: 7200, actual_wage: 9600, hours: 10 }); // 40 + 15
  assert.equal(sa.per_hour, 55); assert.equal(sa.total, 550);
});

test('final settlement statement', async () => {
  const r = await s.call('final_settlement', {
    country: 'AE', basic_salary: 9000, gross_salary: 15000, start_date: '2022-01-01', end_date: '2024-12-31',
    leave_balance_days: 10, unpaid_salary_days: 6, deductions: [{ item: 'Advance', amount: 2000 }], other_additions: [{ item: 'Bonus', amount: 1000 }]
  });
  assert.deepEqual(r.lines.map((l) => l.amount), [18900, 3000, 3000, 1000, -2000]);
  assert.equal(r.total, 23900); assert.equal(r.currency, 'AED');
  const sa = await s.call('final_settlement', { country: 'SA', basic_salary: 8000, monthly_wage: 12000, start_date: '2016-01-01', end_date: '2023-12-31', reason: 'resignation' });
  assert.equal(sa.total, 44000); assert.equal(sa.currency, 'SAR');
  assert.match((await s.call('uae_gratuity', { basic_salary: 9000, start_date: '2025-01-01', end_date: '2024-01-01' })).error, /on or after/);
});
