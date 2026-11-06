// VAT, ZATCA QR, VAT-number and IBAN helpers for Gulf / MENA businesses.

// Standard VAT rates (2026). Qatar and Kuwait have not introduced VAT.
export const VAT_RATES = {
  SA: { rate: 0.15, name: 'Saudi Arabia', since: '2020-07-01' },
  AE: { rate: 0.05, name: 'United Arab Emirates', since: '2018-01-01' },
  BH: { rate: 0.10, name: 'Bahrain', since: '2022-01-01' },
  OM: { rate: 0.05, name: 'Oman', since: '2021-04-16' },
  QA: { rate: 0, name: 'Qatar', since: null, note: 'Qatar has not introduced VAT.' },
  KW: { rate: 0, name: 'Kuwait', since: null, note: 'Kuwait has not introduced VAT.' }
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calculateVat({ amount, country = 'SA', inclusive = false, rate }) {
  const c = String(country).toUpperCase();
  const info = VAT_RATES[c];
  if (!info && rate === undefined) throw new Error(`Unknown country ${country}. Use one of ${Object.keys(VAT_RATES).join(', ')} or pass a custom rate.`);
  const r = rate !== undefined ? rate : info.rate;
  if (!(r >= 0 && r < 1)) throw new Error('rate must be a fraction between 0 and 1, e.g. 0.15');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('amount must be a non-negative number');
  const net = inclusive ? amount / (1 + r) : amount;
  const vat = net * r;
  return {
    country: c, rate: r, rate_percent: `${round2(r * 100)}%`,
    net: round2(net), vat: round2(vat), gross: round2(net + vat),
    ...(info?.note ? { note: info.note } : {})
  };
}

// ---------- ZATCA (Saudi) e-invoice QR: TLV, base64 ----------
const ZATCA_TAGS = { 1: 'seller_name', 2: 'vat_number', 3: 'timestamp', 4: 'invoice_total', 5: 'vat_total' };

export function validateVatNumber(country, number) {
  const c = String(country).toUpperCase();
  const n = String(number).replace(/\s/g, '');
  if (c === 'SA') {
    const ok = /^3\d{13}3$/.test(n);
    return { country: c, number: n, valid_format: ok, rule: '15 digits, starting and ending with 3 (ZATCA VAT registration number)' };
  }
  if (c === 'AE') {
    const ok = /^100\d{12}$/.test(n);
    return { country: c, number: n, valid_format: ok, rule: '15-digit TRN, normally starting with 100 (FTA)' };
  }
  if (c === 'BH') {
    const ok = /^\d{15}$/.test(n);
    return { country: c, number: n, valid_format: ok, rule: '15-digit VAT account number (NBR)' };
  }
  throw new Error('Format rules are available for SA, AE and BH. This is a format check only, not a registry lookup.');
}

export function zatcaQrEncode({ seller_name, vat_number, timestamp, invoice_total, vat_total }) {
  if (!seller_name) throw new Error('seller_name is required');
  const vat = validateVatNumber('SA', vat_number);
  if (!vat.valid_format) throw new Error(`vat_number must be ${vat.rule}`);
  const ts = new Date(timestamp);
  if (Number.isNaN(ts.getTime())) throw new Error('timestamp must be an ISO 8601 date-time, e.g. 2026-11-06T14:30:00Z');
  const fmt = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
    return n.toFixed(2);
  };
  const values = [String(seller_name), vat.number, ts.toISOString().replace(/\.\d{3}Z$/, 'Z'), fmt(invoice_total, 'invoice_total'), fmt(vat_total, 'vat_total')];
  const chunks = values.map((v, i) => {
    const bytes = Buffer.from(v, 'utf8');
    if (bytes.length > 255) throw new Error(`Field ${ZATCA_TAGS[i + 1]} is longer than 255 bytes`);
    return Buffer.concat([Buffer.from([i + 1, bytes.length]), bytes]);
  });
  const base64 = Buffer.concat(chunks).toString('base64');
  return { base64, fields: Object.fromEntries(values.map((v, i) => [ZATCA_TAGS[i + 1], v])), note: 'Phase 1 (simplified) QR payload. Phase 2 also needs tags 6-9 (hash, signature, public key) produced by your ZATCA-onboarded e-invoicing solution.' };
}

export function zatcaQrDecode(base64) {
  const buf = Buffer.from(String(base64).trim(), 'base64');
  const fields = {};
  const extra = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 2 > buf.length) throw new Error('Truncated TLV data');
    const tag = buf[i];
    const len = buf[i + 1];
    if (i + 2 + len > buf.length) throw new Error(`Tag ${tag}: length ${len} runs past the end of the data`);
    const value = buf.subarray(i + 2, i + 2 + len);
    if (ZATCA_TAGS[tag]) fields[ZATCA_TAGS[tag]] = value.toString('utf8');
    else extra.push({ tag, length: len, value_base64: value.toString('base64') });
    i += 2 + len;
  }
  const missing = Object.values(ZATCA_TAGS).filter((k) => !(k in fields));
  return { fields, phase2_tags: extra, complete_phase1: missing.length === 0, missing };
}

// ---------- IBAN ----------
export const IBAN_LENGTHS = {
  SA: 24, AE: 23, QA: 29, KW: 30, BH: 22, OM: 23, LB: 28, EG: 29, JO: 30, IQ: 23, PS: 29, TR: 26,
  GB: 22, DE: 22, FR: 27, IT: 27, ES: 24, NL: 18, BE: 16, CH: 21, IE: 22, PT: 25
};

export function validateIban(input) {
  const iban = String(input).replace(/[\s-]/g, '').toUpperCase();
  const country = iban.slice(0, 2);
  const result = { iban, formatted: iban.replace(/(.{4})/g, '$1 ').trim(), country, valid: false };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return { ...result, error: 'IBAN must start with a 2-letter country code and 2 check digits, followed by letters/digits' };
  const expected = IBAN_LENGTHS[country];
  if (expected && iban.length !== expected) return { ...result, expected_length: expected, error: `${country} IBANs are ${expected} characters, this one has ${iban.length}` };
  if (iban.length < 15 || iban.length > 34) return { ...result, error: 'IBAN length must be between 15 and 34 characters' };
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (let i = 0; i < numeric.length; i += 7) rem = Number(String(rem) + numeric.slice(i, i + 7)) % 97;
  const valid = rem === 1;
  const out = { ...result, valid, ...(expected ? { expected_length: expected } : { note: 'Length not checked for this country' }) };
  if (!valid) out.error = 'Checksum (mod 97) failed: the IBAN has a typo';
  if (valid && country === 'SA') out.bank_code = iban.slice(4, 6);
  if (valid && country === 'AE') out.bank_code = iban.slice(4, 7);
  return out;
}
