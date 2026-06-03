/**
 * Edge Function: admin-action v2
 * التحكم الكامل — CRUD لكل الجداول
 * يتحقق من JWT المدير قبل كل عملية
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED: Record<string, string[]> = {
  products:             ['select','insert','update','delete'],
  categories:           ['select','insert','update','delete'],
  packages:             ['select','insert','update','delete'],
  discount_codes:       ['select','insert','update','delete'],
  customers:            ['select','update'],
  orders:               ['select','update','delete'],
  research_requests:    ['select','update','delete'],
  print_orders:         ['select','update','delete'],
  teacher_applications: ['select','update','delete'],
  loyalty_transactions: ['select'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // ── 1. تحقق من JWT ──────────────────────────────────────
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return err('غير مصرح', 401);
    const token = auth.slice(7);

    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: { user }, error: authErr } = await anon.auth.getUser(token);
    if (authErr || !user) return err('جلسة منتهية — سجّل الدخول مجدداً', 401);

    const adminEmail = Deno.env.get('ADMIN_EMAIL') ?? 'admin@almishkat.com';
    if (user.email !== adminEmail) return err('ليس لديك صلاحية', 403);

    // ── 2. Client بصلاحية service_role ──────────────────────
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json();
    const { action, table, id, data, filters = {}, page = 0, pageSize = 20 } = body;

    if (!ALLOWED[table]?.includes(action)) return err(`عملية "${action}" غير مسموحة على "${table}"`, 403);

    // ── 3. تنفيذ العملية ─────────────────────────────────────
    let result: any;

    switch (action) {

      case 'select': {
        // ── جلب صف واحد بمعرّفه (يتفادى تحميل الجدول كاملاً) ──
        if (id !== undefined && id !== null) {
          const single = await db.from(table).select('*').eq('id', id).maybeSingle();
          result = { data: single.data ? [single.data] : [], count: single.data ? 1 : 0, error: single.error };
          break;
        }

        let q = db.from(table).select('*', { count: 'exact' });

        // فلاتر عامة
        if (filters.status)     q = q.eq('status', filters.status);
        if (filters.is_active !== undefined) q = q.eq('is_active', filters.is_active);
        if (filters.category_id) q = q.eq('category_id', filters.category_id);
        if (filters.phone)       q = q.eq(table === 'customers' ? 'phone' : 'customer_phone', filters.phone);

        // بحث نصي
        if (filters.search) {
          const s = filters.search;
          if (table === 'products')          q = q.ilike('name', `%${s}%`);
          else if (table === 'customers')    q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%`);
          else if (table === 'orders')       q = q.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`);
          else if (table === 'research_requests') q = q.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`);
          else if (table === 'print_orders') q = q.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`);
          else if (table === 'teacher_applications') q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
          else if (table === 'categories')   q = q.ilike('name', `%${s}%`);
          else if (table === 'discount_codes') q = q.ilike('code', `%${s}%`);
        }

        // ترتيب — categories تستخدم display_order، الباقي created_at
        if (table === 'categories') {
          q = q.order('display_order', { ascending: true });
        } else {
          q = q.order('created_at', { ascending: false });
        }

        // Pagination
        if (pageSize > 0) q = q.range(page * pageSize, (page + 1) * pageSize - 1);

        result = await q;
        break;
      }

      case 'insert': {
        if (!data) return err('البيانات مطلوبة', 400);
        // صحّح البيانات — احذف حقول فارغة
        const cleaned: any = {};
        for (const [k, v] of Object.entries(data)) {
          if (v !== '' && v !== null && v !== undefined) cleaned[k] = v;
        }
        result = await db.from(table).insert(cleaned).select().single();
        break;
      }

      case 'update': {
        if (!id) return err('id مطلوب', 400);
        if (!data) return err('البيانات مطلوبة', 400);
        const cleaned: any = {};
        for (const [k, v] of Object.entries(data)) {
          cleaned[k] = v === '' ? null : v;
        }
        result = await db.from(table).update(cleaned).eq('id', id).select().single();
        break;
      }

      case 'delete': {
        if (!id) return err('id مطلوب', 400);
        // حذف آمن — تحقق من وجود الصف أولاً
        const { data: existing } = await db.from(table).select('id').eq('id', id).single();
        if (!existing) return err('السجل غير موجود', 404);
        result = await db.from(table).delete().eq('id', id);
        break;
      }
    }

    if (result?.error) throw result.error;

    return new Response(JSON.stringify({
      success: true,
      data:    result?.data  ?? null,
      count:   result?.count ?? null,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error('admin-action error:', e);
    return err(e.message ?? 'خطأ داخلي في الخادم', 500);
  }
});

function err(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  });
}
