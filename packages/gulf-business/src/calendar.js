// Hijri (Umm al-Qura) conversion and Gulf working-day calculations.

const DAY = 86400000;
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Weekends in 2026: UAE moved to Saturday-Sunday in 2022; the rest of the GCC uses Friday-Saturday.
export const WEEKENDS = {
  SA: ['fri', 'sat'], QA: ['fri', 'sat'], KW: ['fri', 'sat'], BH: ['fri', 'sat'], OM: ['fri', 'sat'],
  AE: ['sat', 'sun']
};

const HIJRI_MONTHS_AR = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
const HIJRI_MONTHS_EN = ['Muharram', 'Safar', "Rabi' al-awwal", "Rabi' al-thani", 'Jumada al-awwal', 'Jumada al-thani', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah'];

const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });

function parseGregorian(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Gregorian date must be YYYY-MM-DD');
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error(`Invalid date ${s}`);
  return d;
}

function hijriParts(d) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: parseInt(p.relatedYear || p.year, 10), month: Number(p.month), day: Number(p.day) };
}

export function gregorianToHijri(date) {
  const d = parseGregorian(date);
  const { year, month, day } = hijriParts(d);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    gregorian: date,
    hijri: `${year}-${pad(month)}-${pad(day)}`,
    year, month, day,
    month_name_ar: HIJRI_MONTHS_AR[month - 1],
    month_name_en: HIJRI_MONTHS_EN[month - 1],
    text_ar: `${day} ${HIJRI_MONTHS_AR[month - 1]} ${year} هـ`,
    calendar: 'Umm al-Qura'
  };
}

export function hijriToGregorian(hijri) {
  const m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(hijri);
  if (!m) throw new Error('Hijri date must be YYYY-MM-DD, e.g. 1448-05-15');
  const [hy, hm, hd] = m.slice(1).map(Number);
  if (hm < 1 || hm > 12 || hd < 1 || hd > 30) throw new Error('Hijri month must be 1-12 and day 1-30');
  // Estimate: 1 Muharram 1 AH ≈ 622-07-16; mean Hijri year = 354.367 days.
  const est = Date.UTC(622, 6, 16) + ((hy - 1) * 354.367 + (hm - 1) * 29.53 + (hd - 1)) * DAY;
  for (let off = -40; off <= 40; off++) {
    const d = new Date(est + off * DAY);
    const p = hijriParts(d);
    if (p.year === hy && p.month === hm && p.day === hd) {
      return { hijri: `${hy}-${String(hm).padStart(2, '0')}-${String(hd).padStart(2, '0')}`, gregorian: d.toISOString().slice(0, 10), calendar: 'Umm al-Qura' };
    }
  }
  throw new Error(`${hijri} does not exist in the Umm al-Qura calendar (that month may have only 29 days)`);
}

function weekendFor(country, weekend) {
  if (weekend?.length) return weekend.map((w) => String(w).toLowerCase().slice(0, 3));
  const w = WEEKENDS[String(country || '').toUpperCase()];
  if (!w) throw new Error(`No default weekend for ${country}. Pass weekend, e.g. ["sat","sun"]. Defaults exist for ${Object.keys(WEEKENDS).join(', ')}.`);
  return w;
}

const isWorking = (d, weekend, holidays) =>
  !weekend.includes(WEEKDAY_KEYS[d.getUTCDay()]) && !holidays.has(d.toISOString().slice(0, 10));

export function countWorkingDays({ start, end, country, weekend, holidays = [] }) {
  const a = parseGregorian(start);
  const b = parseGregorian(end);
  if (b < a) throw new Error('end must be on or after start');
  if ((b - a) / DAY > 3660) throw new Error('Range too long (max 10 years)');
  const wk = weekendFor(country, weekend);
  const hol = new Set(holidays);
  let working = 0;
  let total = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += DAY) {
    total++;
    if (isWorking(new Date(t), wk, hol)) working++;
  }
  return { start, end, weekend: wk, holidays_excluded: holidays.length, calendar_days: total, working_days: working, note: 'Both start and end dates are included. Public holidays are only excluded if you pass them.' };
}

export function addWorkingDays({ start, days, country, weekend, holidays = [] }) {
  if (!Number.isInteger(days) || days < 0 || days > 2000) throw new Error('days must be an integer between 0 and 2000');
  const wk = weekendFor(country, weekend);
  const hol = new Set(holidays);
  let d = parseGregorian(start);
  let left = days;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (isWorking(d, wk, hol)) left--;
  }
  const result = d.toISOString().slice(0, 10);
  return { start, working_days_added: days, result, result_weekday: WEEKDAY_KEYS[d.getUTCDay()], weekend: wk };
}
