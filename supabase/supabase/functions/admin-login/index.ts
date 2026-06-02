/**
 * Edge Function: admin-login
 * 
 * يستخدم Supabase Auth لتسجيل دخول المسؤول
 * بدلاً من JWT مخصص — لا حاجة لـ ADMIN_JWT_SECRET
 *
 * المتغيرات المطلوبة:
 *   ADMIN_EMAIL    (اختياري — سيستخدم admin@almishkat.com إن لم يوجد)
 *   ADMIN_PASSWORD (إلزامي — كلمة سر حساب المسؤول في Auth)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { email, password } = await req.json();

    const adminEmail = email || Deno.env.get('ADMIN_EMAIL') || 'admin@almishkat.com';
    const adminPassword = password || Deno.env.get('ADMIN_PASSWORD');

    if (!adminPassword) {
      return errorResponse('لم يتم ضبط بيانات الدخول بعد', 500);
    }

    // إنشاء عميل Supabase (باستخدام anon key — signIn يعمل معه)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });

    if (error) {
      // تأخير للحماية من Brute Force
      await new Promise(r => setTimeout(r, 1000));
      return errorResponse('البريد أو كلمة المرور غير صحيحة', 401);
    }

    return new Response(JSON.stringify({
      success: true,
      token: data.session.access_token,
      user: { id: data.user.id, email: data.user.email },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error(err);
    return errorResponse(err.message, 500);
  }
});

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  });
}