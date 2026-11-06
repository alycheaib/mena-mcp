// Builds a realistic demo database for a Gulf trading company (bilingual names, VAT, invoices).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const CITIES = [['Riyadh', 'الرياض', 'SA'], ['Jeddah', 'جدة', 'SA'], ['Dammam', 'الدمام', 'SA'], ['Dubai', 'دبي', 'AE'], ['Abu Dhabi', 'أبوظبي', 'AE'], ['Doha', 'الدوحة', 'QA'], ['Kuwait City', 'مدينة الكويت', 'KW'], ['Manama', 'المنامة', 'BH'], ['Muscat', 'مسقط', 'OM']];
const COMPANIES = [['Al Noor Trading', 'النور للتجارة'], ['Gulf Star Contracting', 'نجمة الخليج للمقاولات'], ['Desert Rose Hotels', 'وردة الصحراء للفنادق'], ['Falcon Logistics', 'الصقر للخدمات اللوجستية'], ['Oasis Medical Center', 'مركز الواحة الطبي'], ['Pearl Retail Group', 'مجموعة اللؤلؤة للتجزئة'], ['Al Baraka Foods', 'البركة للأغذية'], ['Horizon Tech', 'الأفق للتقنية'], ['Sands Real Estate', 'الرمال العقارية'], ['Majlis Events', 'المجلس للفعاليات'], ['Najd Steel', 'نجد للحديد'], ['Red Sea Marine', 'البحر الأحمر البحرية'], ['Qasr Furniture', 'القصر للأثاث'], ['Zamzam Water', 'زمزم للمياه'], ['Atlas Pharmacy', 'أطلس للصيدلة'], ['Khaleej Motors', 'الخليج للسيارات'], ['Saqr Security', 'صقر للأمن'], ['Bustan Agriculture', 'البستان الزراعية'], ['Dana Fashion', 'دانة للأزياء'], ['Wadi Energy', 'الوادي للطاقة']];
const PRODUCTS = [['Office chair', 'كرسي مكتب', 'Furniture', 450], ['Standing desk', 'مكتب قائم', 'Furniture', 1800], ['Laptop 14"', 'حاسوب محمول', 'IT', 4200], ['27" monitor', 'شاشة 27 بوصة', 'IT', 1150], ['Network switch', 'محول شبكة', 'IT', 2600], ['Printer toner', 'حبر طابعة', 'Supplies', 320], ['A4 paper (box)', 'ورق A4', 'Supplies', 95], ['Water dispenser', 'برادة مياه', 'Appliances', 780], ['CCTV camera', 'كاميرا مراقبة', 'Security', 640], ['Cloud backup (1 yr)', 'نسخ احتياطي سحابي', 'Services', 3600], ['IT support (month)', 'دعم تقني شهري', 'Services', 2500], ['Firewall appliance', 'جدار حماية', 'Security', 7800]];
const VAT = { SA: 0.15, AE: 0.05, BH: 0.10, OM: 0.05, QA: 0, KW: 0 };

function rng(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }

export function createDemoDatabase(file) {
  if (fs.existsSync(file)) fs.rmSync(file);
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT, city TEXT, city_ar TEXT, country TEXT NOT NULL,
      email TEXT, phone TEXT, vat_number TEXT, segment TEXT, created_at TEXT NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT UNIQUE, name TEXT NOT NULL, name_ar TEXT, category TEXT, unit_price REAL NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), order_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','shipped','delivered','cancelled')), currency TEXT NOT NULL);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL, unit_price REAL NOT NULL);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, invoice_no TEXT UNIQUE, order_id INTEGER NOT NULL REFERENCES orders(id), issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL, net_amount REAL NOT NULL, vat_amount REAL NOT NULL, total REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('paid','unpaid','overdue')), paid_date TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, role TEXT);
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE INDEX idx_invoices_status ON invoices(status);
    CREATE VIEW customer_balances AS
      SELECT c.id AS customer_id, c.name, c.country, ROUND(SUM(CASE WHEN i.status != 'paid' THEN i.total ELSE 0 END), 2) AS outstanding,
        ROUND(SUM(i.total), 2) AS lifetime_billed
      FROM customers c JOIN orders o ON o.customer_id = c.id JOIN invoices i ON i.order_id = o.id GROUP BY c.id;
  `);
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const day = (d) => new Date(Date.UTC(2026, 0, 1) + d * 86400000).toISOString().slice(0, 10);
  const ins = (sql) => db.prepare(sql);

  db.exec('BEGIN');
  const cIns = ins('INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  COMPANIES.forEach(([en, ar], i) => {
    const [city, cityAr, cc] = CITIES[i % CITIES.length];
    const slug = en.toLowerCase().replace(/[^a-z]+/g, '');
    const vat = cc === 'SA' ? `3${String(100000000000 + i * 7919).padStart(13, '0')}3` : cc === 'AE' ? `100${String(200000000000 + i * 104729).padStart(12, '0')}` : null;
    cIns.run(i + 1, en, ar, city, cityAr, cc, `accounts@${slug}.example`, `+9665${String(10000000 + i * 1234567).slice(0, 8)}`, vat, pick(['SME', 'Enterprise', 'Government']), day(Math.floor(r() * 60)));
  });
  const pIns = ins('INSERT INTO products VALUES (?,?,?,?,?,?)');
  PRODUCTS.forEach(([en, ar, cat, price], i) => pIns.run(i + 1, `SKU-${1000 + i}`, en, ar, cat, price));
  const oIns = ins('INSERT INTO orders VALUES (?,?,?,?,?)');
  const iIns = ins('INSERT INTO order_items VALUES (?,?,?,?,?)');
  const invIns = ins('INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,?)');
  let itemId = 1;
  const CUR = { SA: 'SAR', AE: 'AED', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR' };
  for (let o = 1; o <= 240; o++) {
    const cust = 1 + Math.floor(r() * COMPANIES.length);
    const cc = CITIES[(cust - 1) % CITIES.length][2];
    const d = Math.floor(r() * 300);
    const status = d > 285 ? 'pending' : r() < 0.05 ? 'cancelled' : d > 270 ? 'shipped' : 'delivered';
    oIns.run(o, cust, day(d), status, CUR[cc]);
    let net = 0;
    const lines = 1 + Math.floor(r() * 4);
    for (let l = 0; l < lines; l++) {
      const p = 1 + Math.floor(r() * PRODUCTS.length);
      const q = 1 + Math.floor(r() * 10);
      const price = PRODUCTS[p - 1][3];
      iIns.run(itemId++, o, p, q, price);
      net += q * price;
    }
    if (status === 'cancelled') continue;
    const vat = Math.round(net * VAT[cc] * 100) / 100;
    const due = d + 30;
    const paid = due < 280 ? r() < 0.85 : r() < 0.3;
    const st = paid ? 'paid' : due < 309 ? 'overdue' : 'unpaid';
    invIns.run(o, `INV-2026-${String(o).padStart(4, '0')}`, o, day(d), day(due), net, vat, Math.round((net + vat) * 100) / 100, st, paid ? day(d + Math.floor(r() * 35)) : null);
  }
  ins('INSERT INTO users VALUES (?,?,?,?)').run(1, 'admin', '$2b$12$abcdefghijklmnopqrstuuJ8Ue0D8wGQOq3m5f1v0Q2', 'admin');
  db.exec('COMMIT');
  db.close();
  return file;
}
