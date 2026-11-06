// Arabic "tafqeet": writes an amount in Arabic words, as printed on Gulf invoices and cheques.
// e.g. 1250.50 SAR -> "فقط ألف ومائتان وخمسون ريالاً سعودياً وخمسون هللة لا غير"

const ONES_M = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const ONES_F = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع', 'عشر'];
const TEENS_M = ['', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TEENS_F = ['', 'إحدى عشرة', 'اثنتا عشرة', 'ثلاث عشرة', 'أربع عشرة', 'خمس عشرة', 'ست عشرة', 'سبع عشرة', 'ثماني عشرة', 'تسع عشرة'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

// [singular, dual, plural (3-10), accusative singular (11-99)]
const SCALES = [
  null,
  ['ألف', 'ألفان', 'آلاف', 'ألفاً'],
  ['مليون', 'مليونان', 'ملايين', 'مليوناً'],
  ['مليار', 'ملياران', 'مليارات', 'ملياراً'],
  ['تريليون', 'تريليونان', 'تريليونات', 'تريليوناً']
];

// Currency nouns: forms = [singular, dual, plural, accusative], f = feminine noun, sub = minor unit, per = minor units per major.
export const CURRENCIES = {
  SAR: { forms: ['ريال سعودي', 'ريالان سعوديان', 'ريالات سعودية', 'ريالاً سعودياً'], f: false,
    sub: { forms: ['هللة', 'هللتان', 'هللات', 'هللة'], f: true }, per: 100 },
  AED: { forms: ['درهم إماراتي', 'درهمان إماراتيان', 'دراهم إماراتية', 'درهماً إماراتياً'], f: false,
    sub: { forms: ['فلس', 'فلسان', 'فلوس', 'فلساً'], f: false }, per: 100 },
  QAR: { forms: ['ريال قطري', 'ريالان قطريان', 'ريالات قطرية', 'ريالاً قطرياً'], f: false,
    sub: { forms: ['درهم', 'درهمان', 'دراهم', 'درهماً'], f: false }, per: 100 },
  KWD: { forms: ['دينار كويتي', 'ديناران كويتيان', 'دنانير كويتية', 'ديناراً كويتياً'], f: false,
    sub: { forms: ['فلس', 'فلسان', 'فلوس', 'فلساً'], f: false }, per: 1000 },
  BHD: { forms: ['دينار بحريني', 'ديناران بحرينيان', 'دنانير بحرينية', 'ديناراً بحرينياً'], f: false,
    sub: { forms: ['فلس', 'فلسان', 'فلوس', 'فلساً'], f: false }, per: 1000 },
  OMR: { forms: ['ريال عماني', 'ريالان عمانيان', 'ريالات عمانية', 'ريالاً عمانياً'], f: false,
    sub: { forms: ['بيسة', 'بيستان', 'بيسات', 'بيسة'], f: true }, per: 1000 },
  JOD: { forms: ['دينار أردني', 'ديناران أردنيان', 'دنانير أردنية', 'ديناراً أردنياً'], f: false,
    sub: { forms: ['فلس', 'فلسان', 'فلوس', 'فلساً'], f: false }, per: 1000 },
  EGP: { forms: ['جنيه مصري', 'جنيهان مصريان', 'جنيهات مصرية', 'جنيهاً مصرياً'], f: false,
    sub: { forms: ['قرش', 'قرشان', 'قروش', 'قرشاً'], f: false }, per: 100 },
  LBP: { forms: ['ليرة لبنانية', 'ليرتان لبنانيتان', 'ليرات لبنانية', 'ليرة لبنانية'], f: true, sub: null, per: 1 },
  USD: { forms: ['دولار أمريكي', 'دولاران أمريكيان', 'دولارات أمريكية', 'دولاراً أمريكياً'], f: false,
    sub: { forms: ['سنت', 'سنتان', 'سنتات', 'سنتاً'], f: false }, per: 100 },
  EUR: { forms: ['يورو', 'يوروان', 'يوروهات', 'يورو'], f: false,
    sub: { forms: ['سنت', 'سنتان', 'سنتات', 'سنتاً'], f: false }, per: 100 }
};

// 1..999 in words. `fem` applies to the units/teens only (hundreds and tens are gender-neutral).
function below1000(n, fem) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    const ones = fem ? ONES_F : ONES_M;
    if (r <= 10) parts.push(ones[r]);
    else if (r < 20) parts.push((fem ? TEENS_F : TEENS_M)[r - 10]);
    else {
      const u = r % 10;
      const t = TENS[Math.floor(r / 10)];
      parts.push(u ? `${(fem && u === 1) ? 'إحدى' : ones[u]} و${t}` : t);
    }
  }
  return parts.join(' و');
}

function scaled(n, scale) {
  const [sing, dual, plural, acc] = SCALES[scale];
  if (n === 1) return sing;
  if (n === 2) return dual;
  if (n >= 3 && n <= 10) return `${below1000(n, false)} ${plural}`;
  const r = n % 100;
  return `${below1000(n, false)} ${r >= 11 && r <= 99 ? acc : sing}`;
}

/** Integer to Arabic words (no noun). */
export function numberToArabicWords(n, { feminine = false } = {}) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Expected a non-negative safe integer');
  if (n === 0) return 'صفر';
  const groups = [];
  let x = n;
  while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
  if (groups.length > SCALES.length) throw new Error('Number too large');
  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    words.push(i === 0 ? below1000(g, feminine) : scaled(g, i));
  }
  return words.join(' و');
}

// Number + counted noun with correct agreement.
function countNoun(n, noun) {
  const [sing, dual, plural, acc] = noun.forms;
  if (n === 1) return `${sing} ${noun.f ? 'واحدة' : 'واحد'}`;
  if (n === 2) return dual;
  let words = numberToArabicWords(n, { feminine: noun.f });
  const r = n % 100;
  // A scale word directly followed by the counted noun takes the construct form: "أحد عشر ألف ريال", not "ألفاً ريال".
  if (r === 0 && n % 1000 === 0) {
    for (const s of SCALES.slice(1)) if (words.endsWith(s[3])) { words = words.slice(0, -s[3].length) + s[0]; break; }
  }
  if (r >= 3 && r <= 10) return `${words} ${plural}`;
  if (r >= 11 && r <= 99) return `${words} ${acc}`;
  return `${words} ${sing}`;
}

/** Amount (number or numeric string) to the invoice phrase "فقط ... لا غير". */
export function amountToArabicWords(amount, currency = 'SAR', { wrap = true } = {}) {
  const cur = CURRENCIES[String(currency).toUpperCase()];
  if (!cur) throw new Error(`Unsupported currency ${currency}. Supported: ${Object.keys(CURRENCIES).join(', ')}`);
  const value = typeof amount === 'string' ? Number(amount.replace(/[,\s]/g, '')) : amount;
  if (!Number.isFinite(value) || value < 0) throw new Error('Amount must be a non-negative number');
  const digits = Math.round(Math.log10(cur.per));
  const [intStr, fracStr = ''] = value.toFixed(digits).split('.');
  const major = Number(intStr);
  const minor = digits ? Number(fracStr) : 0;
  if (!Number.isSafeInteger(major)) throw new Error('Amount too large');

  const parts = [];
  if (major > 0 || minor === 0) parts.push(major === 0 ? `صفر ${cur.forms[0]}` : countNoun(major, cur));
  if (minor > 0 && cur.sub) parts.push(countNoun(minor, cur.sub));
  const text = parts.join(' و');
  return wrap ? `فقط ${text} لا غير` : text;
}
