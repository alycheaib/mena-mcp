import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { calculateVat, VAT_RATES, zatcaQrEncode, zatcaQrDecode, validateVatNumber, validateIban } from './finance.js';
import { amountToArabicWords, numberToArabicWords, CURRENCIES } from './tafqeet.js';
import { gregorianToHijri, hijriToGregorian, countWorkingDays, addWorkingDays } from './calendar.js';

export function createServer() {
  const server = new McpServer({ name: 'gulf-business', version: '0.1.0' });
  const ro = { readOnlyHint: true, openWorldHint: false };

  const tool = (name, title, description, inputSchema, fn) =>
    server.registerTool(name, { title, description, inputSchema, annotations: ro }, async (args) => {
      try {
        const out = await fn(args);
        return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }], structuredContent: typeof out === 'object' ? out : { result: out } };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });

  const country = z.string().describe('ISO country code: SA, AE, BH, OM, QA, KW');
  const gdate = z.string().describe('Gregorian date YYYY-MM-DD');

  tool('vat_calculate', 'Gulf VAT calculator',
    'Calculate VAT for a GCC country (SA 15%, AE 5%, BH 10%, OM 5%, QA/KW none). Works from a net (exclusive) or gross (inclusive) amount.',
    { amount: z.number().nonnegative(), country: country.default('SA'), inclusive: z.boolean().default(false).describe('true if amount already includes VAT'), rate: z.number().min(0).max(0.99).optional().describe('Override rate as a fraction, e.g. 0.15') },
    (a) => calculateVat(a));

  tool('vat_rates', 'GCC VAT rates', 'List the standard VAT rates for GCC countries.', {}, () => ({ rates: VAT_RATES }));

  tool('vat_number_validate', 'Validate VAT/TRN number format',
    'Check the format of a Saudi VAT number (15 digits, starts and ends with 3), UAE TRN or Bahrain VAT number. Format check only, not a registry lookup.',
    { country: z.enum(['SA', 'AE', 'BH']), number: z.string() },
    ({ country: c, number }) => validateVatNumber(c, number));

  tool('zatca_qr_encode', 'Build ZATCA e-invoice QR (Phase 1)',
    'Build the base64 TLV payload for a Saudi simplified tax invoice QR code (seller, VAT number, timestamp, total, VAT).',
    { seller_name: z.string().min(1), vat_number: z.string(), timestamp: z.string().describe('ISO 8601, e.g. 2026-11-06T14:30:00Z'), invoice_total: z.number().nonnegative().describe('Total including VAT'), vat_total: z.number().nonnegative() },
    (a) => zatcaQrEncode(a));

  tool('zatca_qr_decode', 'Decode ZATCA e-invoice QR',
    'Decode the base64 TLV text inside a Saudi e-invoice QR code and list its fields; Phase 2 tags (hash, signature, key) are listed separately.',
    { base64: z.string().min(4) },
    ({ base64 }) => zatcaQrDecode(base64));

  tool('iban_validate', 'Validate IBAN',
    'Validate an IBAN (mod-97 checksum and country length). Knows GCC, Lebanon, Egypt, Jordan, Iraq, Turkey and major EU lengths.',
    { iban: z.string().min(4) },
    ({ iban }) => validateIban(iban));

  tool('amount_to_arabic_words', 'Amount in Arabic words (tafqeet)',
    `Write an amount in Arabic words as on invoices and cheques ("فقط ... لا غير"). Currencies: ${Object.keys(CURRENCIES).join(', ')}.`,
    { amount: z.union([z.number(), z.string()]), currency: z.string().default('SAR'), wrap: z.boolean().default(true).describe('Wrap with فقط ... لا غير') },
    ({ amount, currency, wrap }) => ({ amount, currency: currency.toUpperCase(), words: amountToArabicWords(amount, currency, { wrap }) }));

  tool('number_to_arabic_words', 'Integer in Arabic words', 'Write a non-negative integer in Arabic words.',
    { number: z.number().int().nonnegative(), feminine: z.boolean().default(false) },
    ({ number, feminine }) => ({ number, words: numberToArabicWords(number, { feminine }) }));

  tool('hijri_from_gregorian', 'Gregorian to Hijri', 'Convert a Gregorian date to the Umm al-Qura Hijri date (Saudi official calendar).',
    { date: gdate }, ({ date }) => gregorianToHijri(date));

  tool('gregorian_from_hijri', 'Hijri to Gregorian', 'Convert an Umm al-Qura Hijri date (YYYY-MM-DD, e.g. 1448-05-15) to Gregorian.',
    { hijri: z.string() }, ({ hijri }) => hijriToGregorian(hijri));

  const wd = { country: country.optional(), weekend: z.array(z.string()).optional().describe('Override weekend, e.g. ["fri","sat"]'), holidays: z.array(gdate).default([]).describe('Public holidays to skip') };

  tool('working_days_count', 'Count working days', 'Count working days between two dates (inclusive) using the country weekend (UAE Sat-Sun, rest of GCC Fri-Sat).',
    { start: gdate, end: gdate, ...wd }, (a) => countWorkingDays(a));

  tool('working_days_add', 'Add working days', 'Add N working days to a date (e.g. a payment or SLA deadline), skipping the weekend and given holidays.',
    { start: gdate, days: z.number().int().min(0).max(2000), ...wd }, (a) => addWorkingDays(a));

  return server;
}

