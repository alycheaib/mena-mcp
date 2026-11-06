// Safe, read-only access to a business database for AI assistants.
// Defence in depth: read-only connection + engine-level authorizer (SQLite) / READ ONLY transaction (Postgres)
// + single-statement guard + row limit + statement timeout + PII masking + table allow/deny lists.
import { DatabaseSync, constants as C } from 'node:sqlite';
import path from 'node:path';

const PII_COLUMN = /(e[-_]?mail|phone|mobile|tel(ephone)?$|whatsapp|iban|account_?(no|number)|card|cc_?num|cvv|ssn|national_?id|emirates_?id|iqama|passport|tax_?id|dob|birth|address|password|passwd|secret|token|api_?key)/i;
const HIDDEN_COLUMN = /(password|passwd|secret|token|api_?key|hash|salt|cvv)/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?<![\w+])(?:\+|00)\d{1,3}[\s-]?\d[\d\s-]{6,13}\d(?![\w])/g; // international format only (+966..., 00971...)

const list = (s) => (s ? String(s).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : []);

export function loadConfig(env = process.env) {
  const url = env.BUSINESS_DB_URL || env.DATABASE_URL;
  if (!url) throw new Error('Set BUSINESS_DB_URL to a SQLite file path (or sqlite:/path/file.db) or a postgres:// URL. Run with --demo for a sample database.');
  return {
    url,
    kind: /^postgres(ql)?:\/\//i.test(url) ? 'postgres' : 'sqlite',
    maxRows: Math.min(Number(env.BUSINESS_DB_MAX_ROWS || 200), 5000),
    timeoutMs: Number(env.BUSINESS_DB_TIMEOUT_MS || 10000),
    maskPii: env.BUSINESS_DB_MASK_PII !== '0',
    allowTables: list(env.BUSINESS_DB_ALLOW_TABLES),
    denyTables: list(env.BUSINESS_DB_DENY_TABLES)
  };
}

// ---------- statement guard (both engines) ----------
export function guardSql(sql) {
  const s = String(sql || '').trim().replace(/;\s*$/, '');
  if (!s) throw new Error('Empty query');
  // strip string literals, quoted identifiers and comments before inspecting
  const bare = s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (bare.includes(';')) throw new Error('Only a single statement is allowed');
  if (!/^\s*(select|with|values|explain)\b/i.test(bare)) throw new Error('Only read queries (SELECT / WITH / VALUES / EXPLAIN) are allowed');
  const banned = /\b(insert|update|delete|drop|alter|create|replace|truncate|grant|revoke|attach|detach|pragma|vacuum|reindex|copy|call|do|lock|set|reset|load_extension|pg_sleep|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|into)\b/i;
  const m = banned.exec(bare);
  if (m) throw new Error(`Keyword "${m[1].toUpperCase()}" is not allowed in read-only mode`);
  return s;
}

function maskValue(col, v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    if (PII_COLUMN.test(col)) {
      if (EMAIL_RE.test(v)) { EMAIL_RE.lastIndex = 0; return v.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, '$1***$2***$3'); }
      return v.length <= 4 ? '****' : `${'*'.repeat(Math.max(4, v.length - 4))}${v.slice(-4)}`;
    }
    return v.replace(EMAIL_RE, (e) => e.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, '$1***$2***$3')).replace(PHONE_RE, (p) => `***${p.replace(/\D/g, '').slice(-3)}`);
  }
  if (PII_COLUMN.test(col) && typeof v === 'number') return '****';
  return v;
}

const plain = (v) => (typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()) : v instanceof Uint8Array ? `<blob ${v.length} bytes>` : v);

function shapeRows(rows, cfg) {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    const p = plain(v);
    return [k, cfg.maskPii ? maskValue(k, p) : p];
  })));
}

function tableAllowed(cfg, t) {
  const name = String(t || '').toLowerCase();
  if (!name || name.startsWith('sqlite_')) return name === 'sqlite_master' || name === 'sqlite_schema' ? false : true;
  if (cfg.denyTables.includes(name)) return false;
  return !cfg.allowTables.length || cfg.allowTables.includes(name);
}

// ---------- SQLite ----------
class SqliteDb {
  constructor(cfg) {
    this.cfg = cfg;
    const file = cfg.url.replace(/^sqlite:(\/\/)?/i, '');
    this.file = path.resolve(file);
    this.db = new DatabaseSync(this.file, { readOnly: true, enableForeignKeyConstraints: false });
    this.internal = false;
    this.db.setAuthorizer((action, a1, a2) => {
      if (this.internal) return C.SQLITE_OK;
      switch (action) {
        case C.SQLITE_SELECT:
        case C.SQLITE_RECURSIVE:
          return C.SQLITE_OK;
        case C.SQLITE_READ:
          if (!tableAllowed(cfg, a1)) return C.SQLITE_DENY;
          return HIDDEN_COLUMN.test(a2 || '') ? C.SQLITE_IGNORE : C.SQLITE_OK;
        case C.SQLITE_FUNCTION:
          return /^(load_extension|readfile|writefile|fts3_tokenizer|edit)$/i.test(a2 || '') ? C.SQLITE_DENY : C.SQLITE_OK;
        default:
          return C.SQLITE_DENY;
      }
    });
  }

  internalAll(sql, ...params) {
    this.internal = true;
    try { return this.db.prepare(sql).all(...params); } finally { this.internal = false; }
  }

  async tables() {
    return this.internalAll("SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .filter((t) => tableAllowed(this.cfg, t.name))
      .map((t) => ({ name: t.name, type: t.type, rows: t.type === 'table' ? Number(this.internalAll(`SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '""')}"`)[0].n) : null }));
  }

  async describe(table) {
    if (!tableAllowed(this.cfg, table)) throw new Error(`Table ${table} is not available`);
    const q = `"${String(table).replace(/"/g, '""')}"`;
    const cols = this.internalAll(`PRAGMA table_info(${q})`);
    if (!cols.length) throw new Error(`Table ${table} not found`);
    const fks = this.internalAll(`PRAGMA foreign_key_list(${q})`);
    const idx = this.internalAll(`PRAGMA index_list(${q})`);
    return {
      table,
      columns: cols.map((c) => ({ name: c.name, type: c.type || null, nullable: !c.notnull, primary_key: !!c.pk, default: c.dflt_value, pii: PII_COLUMN.test(c.name), hidden: HIDDEN_COLUMN.test(c.name) })),
      foreign_keys: fks.map((f) => ({ column: f.from, references: `${f.table}.${f.to}` })),
      indexes: idx.map((i) => ({ name: i.name, unique: !!i.unique }))
    };
  }

  async query(sql, params = []) {
    const s = guardSql(sql);
    const started = Date.now();
    const stmt = this.db.prepare(s);
    const rows = [];
    let truncated = false;
    for (const r of stmt.iterate(...params)) {
      if (rows.length >= this.cfg.maxRows) { truncated = true; break; }
      rows.push(r);
      if (Date.now() - started > this.cfg.timeoutMs) { truncated = true; break; }
    }
    return { columns: stmt.columns().map((c) => c.name), rows: shapeRows(rows, this.cfg), row_count: rows.length, truncated, elapsed_ms: Date.now() - started };
  }

  async explain(sql) {
    const s = guardSql(sql);
    const plan = this.db.prepare(`EXPLAIN QUERY PLAN ${s.replace(/^\s*explain\s+(query\s+plan\s+)?/i, '')}`).all();
    return { plan: plan.map((p) => p.detail) };
  }

  info() { return { engine: 'sqlite', file: path.basename(this.file), read_only: true }; }
  close() { this.db.close(); }
}

// ---------- PostgreSQL (needs the optional "pg" package) ----------
class PostgresDb {
  constructor(cfg) { this.cfg = cfg; }

  async connect() {
    let pg;
    try { pg = (await import('pg')).default; } catch { throw new Error('PostgreSQL support needs the "pg" package: npm install pg'); }
    this.pool = new pg.Pool({ connectionString: this.cfg.url, max: 3, statement_timeout: this.cfg.timeoutMs, options: '-c default_transaction_read_only=on' });
    return this;
  }

  async run(sql, params = []) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN READ ONLY');
      await c.query(`SET LOCAL statement_timeout = ${Math.floor(this.cfg.timeoutMs)}`);
      const r = await c.query(sql, params);
      return r;
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  }

  async tables() {
    const r = await this.run(`SELECT table_schema AS schema, table_name AS name, table_type AS type, c.reltuples::bigint AS approx_rows
      FROM information_schema.tables t LEFT JOIN pg_class c ON c.relname = t.table_name
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
      WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`);
    return r.rows.filter((t) => tableAllowed(this.cfg, t.name)).map((t) => ({ ...t, approx_rows: plain(t.approx_rows) }));
  }

  async describe(table) {
    if (!tableAllowed(this.cfg, table.split('.').pop())) throw new Error(`Table ${table} is not available`);
    const [schema, name] = table.includes('.') ? table.split('.') : ['public', table];
    const cols = await this.run(`SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable, column_default AS "default"
      FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [schema, name]);
    if (!cols.rows.length) throw new Error(`Table ${table} not found`);
    const fks = await this.run(`SELECT kcu.column_name AS column, ccu.table_name || '.' || ccu.column_name AS references
      FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`, [schema, name]);
    return { table, columns: cols.rows.map((c) => ({ ...c, pii: PII_COLUMN.test(c.name), hidden: HIDDEN_COLUMN.test(c.name) })), foreign_keys: fks.rows };
  }

  async query(sql, params = []) {
    const s = guardSql(sql);
    const started = Date.now();
    const r = await this.run(`SELECT * FROM (${s}) AS _q LIMIT ${this.cfg.maxRows + 1}`, params);
    const truncated = r.rows.length > this.cfg.maxRows;
    const rows = r.rows.slice(0, this.cfg.maxRows).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, HIDDEN_COLUMN.test(k) ? null : v])));
    return { columns: r.fields.map((f) => f.name), rows: shapeRows(rows, this.cfg), row_count: rows.length, truncated, elapsed_ms: Date.now() - started };
  }

  async explain(sql) {
    const s = guardSql(sql).replace(/^\s*explain\s+/i, '');
    const r = await this.run(`EXPLAIN ${s}`);
    return { plan: r.rows.map((x) => x['QUERY PLAN']) };
  }

  info() { return { engine: 'postgres', host: new URL(this.cfg.url).hostname, read_only: true }; }
  close() { return this.pool?.end(); }
}

export async function openDatabase(cfg = loadConfig()) {
  return cfg.kind === 'postgres' ? new PostgresDb(cfg).connect() : new SqliteDb(cfg);
}

export async function sampleRows(db, table, limit = 5) {
  const t = String(table);
  if (!/^[A-Za-z_][\w.]*$/.test(t)) throw new Error('Invalid table name');
  const ident = t.split('.').map((p) => `"${p}"`).join('.');
  return db.query(`SELECT * FROM ${ident} LIMIT ${Math.min(Math.max(1, limit), 50)}`);
}
