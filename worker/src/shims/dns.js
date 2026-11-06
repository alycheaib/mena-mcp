// node:dns/promises replacement for Cloudflare Workers, using DNS-over-HTTPS (JSON API).
const DOH = 'https://cloudflare-dns.com/dns-query';
const TYPES = { A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CAA: 257, SOA: 6 };

function err(code, name) {
  const e = new Error(`queryDns ${code} ${name}`);
  e.code = code;
  return e;
}

async function query(name, type) {
  const r = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
  if (!r.ok) throw err('ESERVFAIL', name);
  const j = await r.json();
  if (j.Status === 3) throw err('ENOTFOUND', name);
  if (j.Status !== 0) throw err('ESERVFAIL', name);
  const answers = (j.Answer || []).filter((a) => a.type === TYPES[type]);
  if (!answers.length) throw err('ENODATA', name);
  return answers.map((a) => a.data);
}

// "\"v=spf1 ...\" \"more\"" -> ['v=spf1 ...', 'more']
const txtChunks = (d) => {
  const parts = [...d.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  return parts.length ? parts : [d];
};

// Wire-format CAA in "\# len hex" form, or presentation "0 issue \"ca\"".
function parseCaa(d) {
  const m = /^(\d+)\s+(\w+)\s+"?(.*?)"?$/.exec(d);
  if (m) return { critical: Number(m[1]), [m[2]]: m[3] };
  const hex = d.replace(/^\\#\s+\d+\s+/, '').replace(/\s+/g, '');
  const bytes = hex.match(/../g)?.map((h) => parseInt(h, 16)) || [];
  const tagLen = bytes[1] || 0;
  const tag = String.fromCharCode(...bytes.slice(2, 2 + tagLen));
  return { critical: bytes[0] || 0, [tag]: String.fromCharCode(...bytes.slice(2 + tagLen)) };
}

export async function lookup(host, opts = {}) {
  const [a, aaaa] = await Promise.allSettled([query(host, 'A'), query(host, 'AAAA')]);
  const out = [
    ...(a.status === 'fulfilled' ? a.value.map((address) => ({ address, family: 4 })) : []),
    ...(aaaa.status === 'fulfilled' ? aaaa.value.map((address) => ({ address, family: 6 })) : [])
  ];
  if (!out.length) throw err('ENOTFOUND', host);
  return opts.all ? out : out[0];
}
export const resolve4 = (n) => query(n, 'A');
export const resolve6 = (n) => query(n, 'AAAA');
export const resolveNs = async (n) => (await query(n, 'NS')).map((x) => x.replace(/\.$/, ''));
export const resolveTxt = async (n) => (await query(n, 'TXT')).map(txtChunks);
export const resolveCaa = async (n) => (await query(n, 'CAA')).map(parseCaa);
export async function resolveMx(n) {
  return (await query(n, 'MX')).map((d) => {
    const [priority, exchange] = d.split(/\s+/);
    return { priority: Number(priority), exchange: exchange.replace(/\.$/, '') };
  });
}
export async function resolveSoa(n) {
  const [d] = await query(n, 'SOA');
  const [nsname, hostmaster, serial, refresh, retry, expire, minttl] = d.split(/\s+/);
  return { nsname: nsname.replace(/\.$/, ''), hostmaster: hostmaster.replace(/\.$/, ''), serial: +serial, refresh: +refresh, retry: +retry, expire: +expire, minttl: +minttl };
}
export default { lookup, resolve4, resolve6, resolveNs, resolveTxt, resolveCaa, resolveMx, resolveSoa };
