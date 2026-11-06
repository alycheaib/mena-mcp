import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers.js';
import { amountToArabicWords, numberToArabicWords } from '../packages/gulf-business/src/tafqeet.js';
import { validateIban, zatcaQrEncode, zatcaQrDecode, calculateVat } from '../packages/gulf-business/src/finance.js';

let s;
before(async () => { s = await connect('gulf-business'); });
after(() => s.close());

test('exposes all tools with read-only annotations', async () => {
  const { tools } = await s.client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['amount_to_arabic_words', 'gregorian_from_hijri', 'hijri_from_gregorian', 'iban_validate', 'number_to_arabic_words', 'vat_calculate', 'vat_number_validate', 'vat_rates', 'working_days_add', 'working_days_count', 'zatca_qr_decode', 'zatca_qr_encode']);
  for (const t of tools) assert.equal(t.annotations.readOnlyHint, true, t.name);
});

test('VAT: exclusive, inclusive and zero-VAT countries', async () => {
  assert.deepEqual(await s.call('vat_calculate', { amount: 1000, country: 'SA' }), { country: 'SA', rate: 0.15, rate_percent: '15%', net: 1000, vat: 150, gross: 1150 });
  const inc = await s.call('vat_calculate', { amount: 105, country: 'AE', inclusive: true });
  assert.equal(inc.net, 100);
  assert.equal(inc.vat, 5);
  assert.equal((await s.call('vat_calculate', { amount: 100, country: 'QA' })).vat, 0);
  assert.match((await s.call('vat_calculate', { amount: 100, country: 'XX' })).error, /Unknown country/);
  assert.equal(calculateVat({ amount: 99.99, country: 'BH' }).gross, 109.99);
});

test('ZATCA QR round-trip (Phase 1 TLV)', async () => {
  const enc = await s.call('zatca_qr_encode', { seller_name: 'شركة النور', vat_number: '310122393500003', timestamp: '2026-11-06T10:00:00Z', invoice_total: 1150, vat_total: 150 });
  const dec = await s.call('zatca_qr_decode', { base64: enc.base64 });
  assert.equal(dec.complete_phase1, true);
  assert.equal(dec.fields.seller_name, 'شركة النور');
  assert.equal(dec.fields.invoice_total, '1150.00');
  // Reference payload in the published ZATCA sample format
  assert.equal(zatcaQrEncode({ seller_name: 'Bobs Records', vat_number: '310122393500003', timestamp: '2022-04-25T15:30:00Z', invoice_total: 1000, vat_total: 150 }).base64,
    'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==');
  assert.match((await s.call('zatca_qr_encode', { seller_name: 'x', vat_number: '123', timestamp: '2026-01-01T00:00:00Z', invoice_total: 1, vat_total: 0 })).error, /vat_number/);
  assert.throws(() => zatcaQrDecode('AQ=='), /Truncated|runs past/);
});

test('VAT number formats', async () => {
  assert.equal((await s.call('vat_number_validate', { country: 'SA', number: '310122393500003' })).valid_format, true);
  assert.equal((await s.call('vat_number_validate', { country: 'SA', number: '210122393500003' })).valid_format, false);
  assert.equal((await s.call('vat_number_validate', { country: 'AE', number: '100123456700003' })).valid_format, true);
});

test('IBAN validation incl. Gulf and Lebanon', async () => {
  assert.equal((await s.call('iban_validate', { iban: 'GB82 WEST 1234 5698 7654 32' })).valid, true);
  const sa = await s.call('iban_validate', { iban: 'SA03 8000 0000 6080 1016 7519' });
  assert.equal(sa.valid, true);
  assert.equal(sa.bank_code, '80');
  assert.equal(validateIban('AE070331234567890123456').valid, true);
  assert.equal(validateIban('LB62099900000001001901229114').valid, true);
  assert.equal(validateIban('SA0380000000608010167518').valid, false);
  assert.match(validateIban('SA038000').error, /24 characters/);
});

test('Arabic amount in words (tafqeet)', async () => {
  const r = await s.call('amount_to_arabic_words', { amount: 1250.5, currency: 'SAR' });
  assert.equal(r.words, 'فقط ألف ومائتان وخمسون ريالاً سعودياً وخمسون هللة لا غير');
  assert.equal(amountToArabicWords(1, 'SAR'), 'فقط ريال سعودي واحد لا غير');
  assert.equal(amountToArabicWords(2, 'AED'), 'فقط درهمان إماراتيان لا غير');
  assert.equal(amountToArabicWords(5, 'USD'), 'فقط خمسة دولارات أمريكية لا غير');
  assert.equal(amountToArabicWords(11000, 'SAR'), 'فقط أحد عشر ألف ريال سعودي لا غير');
  assert.equal(amountToArabicWords(21.001, 'KWD'), 'فقط واحد وعشرون ديناراً كويتياً وفلس واحد لا غير');
  assert.equal(amountToArabicWords(3.25, 'SAR'), 'فقط ثلاثة ريالات سعودية وخمس وعشرون هللة لا غير');
  assert.equal(amountToArabicWords('1,000,000', 'AED', { wrap: false }), 'مليون درهم إماراتي');
  assert.equal(numberToArabicWords(2345678), 'مليونان وثلاثمائة وخمسة وأربعون ألفاً وستمائة وثمانية وسبعون');
  assert.match((await s.call('amount_to_arabic_words', { amount: 1, currency: 'XYZ' })).error, /Unsupported currency/);
});

test('Hijri <-> Gregorian (Umm al-Qura)', async () => {
  const h = await s.call('hijri_from_gregorian', { date: '2026-02-18' });
  assert.equal(h.hijri, '1447-09-01');
  assert.equal(h.month_name_en, 'Ramadan');
  assert.equal((await s.call('gregorian_from_hijri', { hijri: '1447-09-01' })).gregorian, '2026-02-18');
  for (const d of ['2025-06-26', '2026-11-06', '2030-01-15']) {
    const x = await s.call('hijri_from_gregorian', { date: d });
    assert.equal((await s.call('gregorian_from_hijri', { hijri: x.hijri })).gregorian, d);
  }
  assert.match((await s.call('hijri_from_gregorian', { date: '2026-02-30' })).error, /Invalid date/);
});

test('working days use country weekends and holidays', async () => {
  // Nov 2026 has 30 days; KSA weekend is Fri/Sat, UAE is Sat/Sun
  assert.equal((await s.call('working_days_count', { start: '2026-11-01', end: '2026-11-30', country: 'SA' })).working_days, 22);
  assert.equal((await s.call('working_days_count', { start: '2026-11-01', end: '2026-11-30', country: 'AE' })).working_days, 21);
  assert.equal((await s.call('working_days_count', { start: '2026-11-01', end: '2026-11-30', country: 'SA', holidays: ['2026-11-02'] })).working_days, 21);
  // Thu 2026-11-05 + 1 working day: KSA -> Sun 11-08, UAE -> Fri 11-06
  assert.equal((await s.call('working_days_add', { start: '2026-11-05', days: 1, country: 'SA' })).result, '2026-11-08');
  assert.equal((await s.call('working_days_add', { start: '2026-11-05', days: 1, country: 'AE' })).result, '2026-11-06');
});
