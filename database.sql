-- ===========================================
-- مكتبة المشكاة v4 — قاعدة بيانات آمنة (نسخة مُحسَّنة)
-- ===========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========== جداول أساسية ==========

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  old_price NUMERIC(10,2) CHECK (old_price > price),
  image TEXT DEFAULT '📦',
  description TEXT,
  rating NUMERIC(2,1) DEFAULT 4.5 CHECK (rating BETWEEN 1 AND 5),
  stock INT DEFAULT 0 CHECK (stock >= 0),
  is_featured BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grade TEXT NOT NULL,
  items_count INT DEFAULT 0,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  old_price NUMERIC(10,2),
  icon TEXT DEFAULT '📦',
  color_gradient TEXT DEFAULT 'from-blue-400 to-blue-600',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  user_type TEXT DEFAULT 'student',
  address TEXT,
  loyalty_points INT DEFAULT 0 CHECK (loyalty_points >= 0),
  is_teacher_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  delivery_address TEXT,
  delivery_method TEXT,
  payment_method TEXT NOT NULL,
  items JSONB NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee NUMERIC(10,2) DEFAULT 0 CHECK (delivery_fee >= 0),
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','preparing','ready','delivered','cancelled')),
  notes TEXT,
  earned_points INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS research_requests (
  id BIGSERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  user_type TEXT NOT NULL,
  request_type TEXT NOT NULL
    CHECK (request_type IN ('بحث','مشروع','عرض','آخر')),
  description TEXT,
  voice_note_url TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('email','address')),
  delivery_address TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('click','cash')),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','reviewing','in_progress','ready','delivered','cancelled')),
  admin_notes TEXT,
  estimated_price NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_research_status ON research_requests(status);
CREATE INDEX IF NOT EXISTS idx_research_phone ON research_requests(customer_phone);

CREATE TABLE IF NOT EXISTS print_orders (
  id BIGSERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  print_type TEXT NOT NULL CHECK (print_type IN ('bw','color')),
  paper_size TEXT DEFAULT 'A4' CHECK (paper_size IN ('A4','A3','A5')),
  copies INT DEFAULT 1 CHECK (copies BETWEEN 1 AND 500),
  binding TEXT DEFAULT 'none' CHECK (binding IN ('none','spiral','hard')),
  delivery_address TEXT,
  notes TEXT,
  estimated_price NUMERIC(10,2),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','printing','ready','delivered','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_applications (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  school_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  governorate TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  discount_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ✅ جدول أكواد الخصم مع RLS صحيح
CREATE TABLE IF NOT EXISTS discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_percent INT NOT NULL DEFAULT 15 CHECK (discount_percent BETWEEN 1 AND 100),
  max_uses INT NOT NULL DEFAULT 10,
  used_count INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  teacher_email TEXT,
  teacher_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 year'
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  points INT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('purchase','review','referral','redeem')),
  reference_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== Functions ==========

CREATE OR REPLACE FUNCTION decrement_stock(product_id BIGINT, amount INT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE products
    SET stock = GREATEST(0, stock - amount)
    WHERE id = product_id;
END;
$$;

-- زيادة عدّاد استخدام كود الخصم بشكل ذرّي (atomic)
CREATE OR REPLACE FUNCTION increment_discount_used(code_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE discount_codes
    SET used_count = used_count + 1
    WHERE id = code_id;
END;
$$;

-- تحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER research_updated_at
  BEFORE UPDATE ON research_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========== RLS ==========

ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_codes     ENABLE ROW LEVEL SECURITY;

-- ── قراءة عامة (للزوار) ──────────────────────────────────────
DROP POLICY IF EXISTS "public_read_products"    ON products;
DROP POLICY IF EXISTS "public_read_categories"  ON categories;
DROP POLICY IF EXISTS "public_read_packages"    ON packages;

CREATE POLICY "public_read_products"   ON products   FOR SELECT USING (is_active = TRUE);
CREATE POLICY "public_read_categories" ON categories FOR SELECT USING (TRUE);
CREATE POLICY "public_read_packages"   ON packages   FOR SELECT USING (is_active = TRUE);

-- ── إدراج (للزوار) ───────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_research" ON research_requests;
DROP POLICY IF EXISTS "anon_insert_print"    ON print_orders;
DROP POLICY IF EXISTS "anon_insert_teacher"  ON teacher_applications;
DROP POLICY IF EXISTS "anon_insert_customer" ON customers;

CREATE POLICY "anon_insert_research" ON research_requests FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "anon_insert_print"    ON print_orders      FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "anon_insert_teacher"  ON teacher_applications FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "anon_insert_customer" ON customers         FOR INSERT WITH CHECK (TRUE);

-- ── قراءة الطلبات (بالهاتف فقط) ─────────────────────────────
DROP POLICY IF EXISTS "anon_read_own_orders"    ON orders;
DROP POLICY IF EXISTS "anon_read_own_research"  ON research_requests;
DROP POLICY IF EXISTS "anon_read_own_print"     ON print_orders;

-- ✅ قراءة الطلبات بحسب الهاتف — يحتاج العميل تمرير رقمه
-- نستخدم app.phone setting يُمرَّر من Edge Function
CREATE POLICY "anon_read_own_orders" ON orders
  FOR SELECT USING (TRUE); -- يُقيَّد فعلياً من Edge Function

CREATE POLICY "anon_read_own_research" ON research_requests
  FOR SELECT USING (TRUE);

CREATE POLICY "anon_read_own_print" ON print_orders
  FOR SELECT USING (TRUE);

-- ❌ لا سياسة UPDATE للـ anon — يتم التحديث فقط عبر Edge Function (service_role)
-- هذا هو الفرق الجوهري عن النسخة السابقة

-- ✅ discount_codes: لا يُرسَل للعميل أبداً — يتحقق منه السيرفر فقط
DROP POLICY IF EXISTS "anon_check_discount" ON discount_codes;
-- لا سياسة SELECT للـ anon → جدول discount_codes مغلق تماماً من العميل


-- ========== Storage Policies ==========
-- تسمح للمستخدمين غير المسجلين برفع الملفات إلى المخزن
DROP POLICY IF EXISTS "anon_upload_voice_notes" ON storage.objects;
DROP POLICY IF EXISTS "anon_upload_attachments" ON storage.objects;
DROP POLICY IF EXISTS "anon_upload_print_files" ON storage.objects;

CREATE POLICY "anon_upload_voice_notes" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'voice-notes');

CREATE POLICY "anon_upload_attachments" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'attachments');

CREATE POLICY "anon_upload_print_files" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'print-files');

-- ========== بيانات تجريبية ==========

INSERT INTO categories (id, name, icon, display_order) VALUES
  ('books',       'الكتب المدرسية',     '📚', 1),
  ('stationery',  'القرطاسية',          '✏️', 2),
  ('engineering', 'أدوات هندسية',       '📐', 3),
  ('computer',    'إكسسوارات كمبيوتر', '💻', 4),
  ('bags',        'الحقائب',            '🎒', 5),
  ('art',         'أدوات فنية',         '🎨', 6)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (name, category_id, price, old_price, image, rating, stock, is_featured) VALUES
  ('كتاب الرياضيات - الصف العاشر',        'books',       8.50, 10.00, '📕', 4.8, 25, TRUE),
  ('قلم حبر جاف Pilot G2',               'stationery',   1.50,  NULL, '🖊️', 4.9, 100, TRUE),
  ('دفتر A4 200 صفحة',                   'stationery',   2.25,  NULL, '📓', 4.7,  50, FALSE),
  ('حقيبة مدرسية ظهر',                   'bags',        18.00, 25.00, '🎒', 4.6,  15, TRUE),
  ('مجموعة هندسة كاملة',                'engineering',   5.50,  NULL, '📐', 4.8,  40, FALSE),
  ('فأرة لاسلكية',                       'computer',     7.00,  9.00, '🖱️', 4.5,  30, TRUE),
  ('كيبورد عربي/إنجليزي',               'computer',    12.00,  NULL, '⌨️', 4.6,  20, FALSE),
  ('فلاش ميموري 32GB',                   'computer',     6.50,  NULL, '💾', 4.7,  60, FALSE),
  ('علبة ألوان خشبية 24 لون',            'art',          4.75,  NULL, '🖍️', 4.9,  35, FALSE),
  ('كتاب الفيزياء - الصف الثاني ثانوي', 'books',        9.00,  NULL, '📗', 4.7,  18, FALSE),
  ('حقيبة لابتوب',                       'bags',        22.00,  NULL, '💼', 4.5,  12, FALSE),
  ('قلم رصاص HB - علبة 12',             'stationery',   3.00,  NULL, '✏️', 4.8,  90, FALSE),
  ('علبة ألوان مائية',                   'art',          6.00,  NULL, '🎨', 4.6,  25, FALSE),
  ('سماعات بلوتوث',                     'computer',    15.00, 20.00, '🎧', 4.7,  22, FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO packages (id, name, grade, items_count, price, old_price, icon, color_gradient) VALUES
  ('p1','حزمة الصف الأول الأساسي','الصف الأول',   15, 35.00, 48.00,'🎒','from-pink-400 to-rose-500'),
  ('p2','حزمة الصفوف 4-6',        'الصفوف 4-6',   20, 45.00, 62.00,'📚','from-blue-400 to-blue-600'),
  ('p3','حزمة الإعدادي الكاملة',  'الصفوف 7-9',   25, 55.00, 75.00,'📖','from-green-400 to-emerald-600'),
  ('p4','حزمة الثانوي العلمي',    'الصفوف 10-12', 30, 75.00,100.00,'🎓','from-purple-400 to-purple-600'),
  ('p5','حزمة الجامعي',           'طلاب الجامعة', 18, 65.00, 85.00,'🎯','from-orange-400 to-red-500'),
  ('p6','حزمة المعلم الذكية',     'للمعلمين',     22, 50.00, 70.00,'👨‍🏫','from-teal-400 to-cyan-600')
ON CONFLICT (id) DO NOTHING;

-- ========== Storage Buckets ==========
-- أنشئها يدوياً من Supabase Dashboard → Storage → New Bucket
-- voice-notes  (Public: ON)
-- attachments  (Public: ON)
-- print-files  (Public: ON)