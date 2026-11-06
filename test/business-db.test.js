import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers.js';
import { guardSql } from '../packages/business-db/src/db.js';

let s;
before(async () => { s = await connect('business-db', { args: ['--demo'], env: { BUSINESS_DB_MAX_ROWS: '50' } }); });
after(() => s.close());

test('lists the demo schema', async () => {
  const { tools } = await s.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['database_info', 'describe_table', 'explain_query', 'list_tables', 'run_query', 'sample_rows']);
  const { tables } = await s.call('list_tables');
  const names = tables.map((t) => t.name);
  for (const n of ['customers', 'orders', 'order_items', 'invoices', 'products', 'customer_balances']) assert.ok(names.includes(n), n);
  assert.equal(tables.find((t) => t.name === 'customers').rows, 20);
  const info = await s.call('database_info');
  assert.equal(info.read_only, true);
  assert.equal(info.max_rows, 50);
});

test('describe shows keys, PII and hidden columns', async () => {
  const d = await s.call('describe_table', { table: 'orders' });
  assert.deepEqual(d.foreign_keys, [{ column: 'customer_id', references: 'customers.id' }]);
  const c = await s.call('describe_table', { table: 'customers' });
  assert.equal(c.columns.find((x) => x.name === 'email').pii, true);
  const u = await s.call('describe_table', { table: 'users' });
  assert.equal(u.columns.find((x) => x.name === 'password_hash').hidden, true);
});

test('answers a business question with parameters', async () => {
  const r = await s.call('run_query', {
    sql: `SELECT c.country, COUNT(*) AS n, ROUND(SUM(i.total),2) AS amount FROM invoices i JOIN orders o ON o.id = i.order_id
          JOIN customers c ON c.id = o.customer_id WHERE i.status = ? GROUP BY c.country ORDER BY amount DESC`,
    params: ['overdue']
  });
  assert.ok(r.row_count > 0);
  assert.deepEqual(r.columns, ['country', 'n', 'amount']);
  assert.ok(r.rows.every((x) => x.amount > 0));
  const v = await s.call('run_query', { sql: 'SELECT name, outstanding FROM customer_balances ORDER BY outstanding DESC LIMIT 3' });
  assert.equal(v.row_count, 3);
});

test('masks personal data and hides secrets', async () => {
  const r = await s.call('sample_rows', { table: 'customers', limit: 2 });
  for (const row of r.rows) {
    assert.match(row.email, /^a\*\*\*@.\*\*\*\.example$/);
    assert.match(row.phone, /^\*+\d{4}$/);
    if (row.vat_number) assert.match(row.vat_number, /^\d+$/); // business IDs are not masked
  }
  const u = await s.call('run_query', { sql: 'SELECT * FROM users' });
  assert.equal(u.rows[0].password_hash, null);
  const t = await s.call('run_query', { sql: "SELECT 'reach me at ali@example.com or +966 50 123 4567' AS note, 'INV-2026-0001' AS ref" });
  assert.equal(t.rows[0].note, 'reach me at a***@e***.com or ***567');
  assert.equal(t.rows[0].ref, 'INV-2026-0001');
});

test('caps rows', async () => {
  const r = await s.call('run_query', { sql: 'SELECT * FROM order_items' });
  assert.equal(r.row_count, 50);
  assert.equal(r.truncated, true);
});

test('blocks every write and escape attempt', async () => {
  const attacks = [
    'DELETE FROM customers', "UPDATE invoices SET status = 'paid'", 'DROP TABLE orders', "INSERT INTO users VALUES (2,'x','y','admin')",
    'SELECT 1; DROP TABLE orders', "ATTACH DATABASE 'evil.db' AS e", 'PRAGMA writable_schema = 1', 'SELECT * FROM sqlite_master',
    'WITH x AS (SELECT 1) DELETE FROM customers', "SELECT load_extension('evil')", 'CREATE TABLE t (a)', "VACUUM INTO 'copy.db'"
  ];
  for (const sql of attacks) {
    const r = await s.call('run_query', { sql });
    assert.ok(r.error, `not blocked: ${sql}`);
  }
  const still = await s.call('run_query', { sql: 'SELECT COUNT(*) AS n FROM customers' });
  assert.equal(still.rows[0].n, 20);
});

test('engine-level authorizer backs up the text guard', async () => {
  // Keywords inside string literals are fine...
  assert.doesNotThrow(() => guardSql("SELECT 'delete' AS word"));
  assert.equal((await s.call('run_query', { sql: "SELECT 'delete' AS word" })).rows[0].word, 'delete');
  // ...and a query that passes the text guard is still denied by SQLite's authorizer when it touches internals
  const m = await s.call('run_query', { sql: 'SELECT name FROM sqlite_schema' });
  assert.match(m.error, /prohibited|not authorized/i);
});

test('explain uses indexes', async () => {
  const r = await s.call('explain_query', { sql: 'SELECT * FROM orders WHERE customer_id = 3' });
  assert.match(r.plan.join(' '), /idx_orders_customer/);
});

test('table deny-list (including views over denied tables)', async () => {
  const s2 = await connect('business-db', { args: ['--demo'], env: { BUSINESS_DB_DENY_TABLES: 'users,invoices' } });
  try {
    const { tables } = await s2.call('list_tables');
    assert.ok(!tables.some((t) => t.name === 'users' || t.name === 'invoices'));
    assert.ok((await s2.call('run_query', { sql: 'SELECT * FROM invoices' })).error);
    assert.ok((await s2.call('run_query', { sql: 'SELECT * FROM customer_balances' })).error, 'view over a denied table must be blocked');
  } finally {
    await s2.close();
  }
});
