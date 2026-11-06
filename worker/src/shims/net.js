// Minimal node:net replacement (only the IP helpers infra-audit uses).
export const isIPv4 = (s) => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(String(s));
export const isIPv6 = (s) => {
  const v = String(s);
  if (!v.includes(':') || !/^[0-9a-fA-F:.]+$/.test(v) || (v.match(/::/g) || []).length > 1) return false;
  const parts = v.split(':');
  return parts.length >= 3 && parts.length <= 8 && parts.every((p) => p === '' || /^[0-9a-fA-F]{1,4}$/.test(p) || isIPv4(p));
};
export const isIP = (s) => (isIPv4(s) ? 4 : isIPv6(s) ? 6 : 0);
export default { isIP, isIPv4, isIPv6 };
