/**
 * Edge Function: admin-update-status v2
 * ✅ يستبدل سياسات RLS الخطرة (UPDATE USING TRUE)
 * ✅ يتحقق من JWT المدير قبل أي تعديل
 * ✅ يستخدم service_role لتجاوز RLS بأمان
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_TABLES = ['orders', 'research_requests', 'print_orders', 'teacher_applications'];
const ALLOWED_STATUSES = ['pending','confirmed','preparing','reviewing','in_progress','printing','ready','delivered','cancelled','approved','rejected'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── 1. التحقق من JWT المدير ──────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('غير مصرح', 401);
    }
    const token = authHeader.slice(7);

    // التحقق من صحة التوكن عبر Supabase Auth
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);

    if (authError || !user) {
      return errorResponse('جلسة منتهية — سجّل الدخول مجدداً', 401);
    }

    // التحقق أن المستخدم هو المدير (بالبريد الإلكتروني)
    const adminEmail = Deno.env.get('ADMIN_EMAIL') ?? 'admin@almishkat.com';
    if (user.email !== adminEmail) {
      return errorResponse('ليس لديك صلاحية', 403);
    }

    // ── 2. قراءة الطلب ──────────────────────────────────────
    const { table, id, status, admin_notes, estimated_price } = await req.json();

    if (!ALLOWED_TABLES.includes(table))
      return errorResponse('جدول غير صالح', 400);
    if (!ALLOWED_STATUSES.includes(status))
      return errorResponse('حالة غير صالحة', 400);
    if (!id || typeof id !== 'number')
      return errorResponse('معرف الطلب غير صحيح', 400);

    // ── 3. التحديث بصلاحية service_role ─────────────────────
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const updateData: Record<string, any> = { status };
    if (admin_notes !== undefined) updateData.admin_notes = admin_notes;
    if (estimated_price !== undefined && !isNaN(estimated_price)) {
      updateData.estimated_price = Number(estimated_price);
    }

    const { error } = await adminClient.from(table).update(updateData).eq('id', id);
    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('admin-update-status error:', err);
    return errorResponse(err.message ?? 'خطأ داخلي', 500);
  }
});

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  });
}
