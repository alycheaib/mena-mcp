import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { uaeGratuity, ksaEndOfService, gosiContributions, annualLeave, overtimePay, finalSettlement } from './hr.js';

export function createServer(options = {}) {
  const server = new McpServer({ name: 'gcc-hr', version: '0.1.0' }, options);
  const ann = { readOnlyHint: true, openWorldHint: false, idempotentHint: true };
  const tool = (name, title, description, inputSchema, fn) =>
    server.registerTool(name, { title, description, inputSchema, annotations: ann }, async (args) => {
      try {
        const out = await fn(args);
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });

  const date = (d) => z.string().describe(`${d} (YYYY-MM-DD)`);
  const svc = { start_date: date('First day of employment'), end_date: date('Last working day'), unpaid_leave_days: z.number().min(0).default(0).describe('Unpaid absence days to exclude from service') };

  tool('uae_gratuity', 'UAE end-of-service gratuity',
    'UAE private-sector gratuity under Decree-Law 33/2021: 21 days of basic wage per year for the first 5 years, 30 days after, capped at 2 years of wage; nothing under 1 year. Same for resignation or termination.',
    { basic_salary: z.number().positive().describe('Last monthly BASIC salary, AED'), ...svc, daily_wage_basis: z.enum(['30', '365']).default('30').describe('Daily wage = basic/30 (common) or basic×12/365') },
    (a) => uaeGratuity(a));

  tool('ksa_end_of_service', 'Saudi end-of-service award',
    'Saudi end-of-service award (Labor Law Art. 84/85/87): half a month of wage per year for the first 5 years, a full month after; reduced on resignation (under 2 yrs nothing, 2–5 one third, 5–10 two thirds, 10+ full).',
    { monthly_wage: z.number().positive().describe('Last actual monthly wage incl. housing and fixed allowances, SAR'), ...svc,
      reason: z.enum(['contract_end', 'employer_termination', 'resignation', 'art87_exception', 'art80_dismissal']).default('contract_end') },
    (a) => ksaEndOfService(a));

  tool('gosi_contributions', 'Saudi GOSI contributions',
    'Monthly GOSI contributions for an employee in Saudi Arabia: annuities, SANED and occupational hazards for employee and employer. Handles the legacy and post-July-2024 schedules and the SAR 45,000 cap.',
    { basic_salary: z.number().positive(), housing_allowance: z.number().min(0).default(0), nationality: z.enum(['saudi', 'non_saudi']).default('saudi'),
      registration_date: date('First GOSI registration date; registrations from 2024-07-03 use the new schedule').optional(), on_date: date('Payroll month date (default today)').optional() },
    (a) => gosiContributions(a));

  tool('annual_leave', 'Annual leave balance', 'Accrued annual leave and balance for UAE or KSA employees, plus the encashment value of unused days.',
    { country: z.enum(['AE', 'SA']), start_date: date('Employment start'), as_of_date: date('Calculate up to'), days_taken: z.number().min(0).default(0), basic_salary: z.number().positive().optional() },
    (a) => annualLeave(a));

  tool('overtime_pay', 'Overtime pay', 'Overtime pay for UAE (basic + 25%, or + 50% at night or on a rest day) or KSA (hourly wage + 50% of basic hourly).',
    { country: z.enum(['AE', 'SA']), basic_salary: z.number().positive(), actual_wage: z.number().positive().optional().describe('KSA: full monthly wage'),
      hours: z.number().min(0), type: z.enum(['normal', 'night', 'rest_day']).default('normal'), hours_per_day: z.number().min(1).max(12).default(8) },
    (a) => overtimePay(a));

  tool('final_settlement', 'Final settlement statement',
    'Full final-settlement statement for a leaving employee (UAE or KSA): end-of-service, unused leave, unpaid salary days, other additions and deductions, with a total.',
    { country: z.enum(['AE', 'SA']), basic_salary: z.number().positive(), monthly_wage: z.number().positive().optional().describe('KSA actual wage; defaults to basic'),
      gross_salary: z.number().positive().optional(), ...svc,
      reason: z.enum(['contract_end', 'employer_termination', 'resignation', 'art87_exception', 'art80_dismissal']).default('contract_end'),
      daily_wage_basis: z.enum(['30', '365']).default('30'), leave_balance_days: z.number().min(0).default(0), unpaid_salary_days: z.number().min(0).default(0),
      other_additions: z.array(z.object({ item: z.string(), amount: z.number() })).default([]), deductions: z.array(z.object({ item: z.string(), amount: z.number() })).default([]) },
    (a) => finalSettlement(a));

  return server;
}
