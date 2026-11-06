// node:tls is not used on Workers: checkTls is served by the certificate-transparency provider (see ../tls-ct.js).
const unsupported = () => { throw new Error('Raw TLS sockets are not available on this runtime'); };
export const connect = unsupported;
export const checkServerIdentity = () => undefined;
export default { connect, checkServerIdentity };
