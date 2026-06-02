/**
 * Edge Function: teacher-notify
 * 
 * تُستدعى بعد تسجيل المعلم:
 * 1. توليد كود خصم فريد
 * 2. حفظه في جدول discount_codes
 * 3. إرسال إيميل تأكيد للمعلم
 * 4. إرسال إشعار للمدير
 *
 * متغيرات البيئة المطلوبة:
 *   RESEND_API_KEY=re_...     (من https://resend.com)
 *   ADMIN_EMAIL=admin@example.com
 *   DISCOUNT_PERCENT=15
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { application } = await req.json();
    if (!application || !application.full_name || !application.email) {
      return errorResponse('بيانات الطلب ناقصة', 400);
    }

    // 1. توليد كود خصم
    const firstName = application.full_name.split(' ')[0];
    const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    const discountCode = `${firstName}-${randomPart}`;
    const discountPercent = parseInt(Deno.env.get('DISCOUNT_PERCENT') ?? '15');

    // 2. إنشاء Supabase Admin Client (service_role bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 3. حفظ كود الخصم في قاعدة البيانات
    const { error: dbError } = await supabaseAdmin
      .from('discount_codes')
      .insert({
        code: discountCode,
        discount_percent: discountPercent,
        max_uses: 10,
        teacher_email: application.email,
        teacher_name: application.full_name,
        notes: `تسجيل معلم - ${application.full_name}`,
      });

    if (dbError) {
      console.error('DB insert error:', dbError);
    }

    // 4. إرسال إيميل للمعلم
    const teacherEmailSent = await sendEmail(
      application.email,
      '🎉 مرحباً بك في برنامج المعلمين - مكتبة المشكاة',
      buildTeacherEmail(application.full_name, discountCode, discountPercent)
    );

    // 5. إرسال إشعار للمدير
    const adminEmail = Deno.env.get('ADMIN_EMAIL');
    if (adminEmail) {
      await sendEmail(
        adminEmail,
        '🆕 تسجيل معلم جديد - مكتبة المشكاة',
        buildAdminEmail(application, discountCode)
      );
    }

    return new Response(JSON.stringify({
      success: true,
      discount_code: discountCode,
      discount_percent: discountPercent,
      teacher_email_sent: teacherEmailSent,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error(err);
    return errorResponse(err.message, 500);
  }
});

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.warn('RESEND_API_KEY not configured — email not sent');
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'مكتبة المشكاة <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('Resend error:', errText);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Email send error:', err);
    return false;
  }
}

function buildTeacherEmail(name: string, code: string, percent: number): string {
  return `
    <div dir="rtl" style="font-family: 'Tajawal', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1e3a5f, #0f2440); color: white; padding: 30px; text-align: center; border-radius: 16px 16px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">مكتبة المشكاة</h1>
        <p style="margin: 8px 0 0; opacity: 0.8;">نور العلم بين يديك</p>
      </div>
      <div style="padding: 30px; background: #f8fafc; border-radius: 0 0 16px 16px;">
        <h2 style="color: #1e3a5f;">مرحباً ${name} 👋</h2>
        <p>تم تسجيلك بنجاح في برنامج المعلمين. إليك كود الخصم الخاص بك:</p>
        <div style="background: white; border: 2px dashed #f59e0b; text-align: center; padding: 20px; margin: 20px 0; border-radius: 12px;">
          <div style="font-size: 28px; font-weight: bold; color: #1e3a5f; letter-spacing: 2px;">${code}</div>
          <div style="color: #f59e0b; font-weight: bold; margin-top: 8px;">${percent}% خصم على جميع المنتجات</div>
        </div>
        <p style="color: #64748b; font-size: 14px;">يمكنك استخدام هذا الكود عند إتمام الطلب في موقعنا. الكود صالح لمدة عام.</p>
        <p style="color: #64748b; font-size: 14px;">مع خالص الشكر،<br>فريق مكتبة المشكاة</p>
      </div>
    </div>
  `;
}

function buildAdminEmail(app: any, code: string): string {
  return `
    <div dir="rtl" style="font-family: 'Tajawal', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #dc2626, #991b1b); color: white; padding: 20px; text-align: center; border-radius: 16px 16px 0 0;">
        <h2 style="margin: 0;">🆕 تسجيل معلم جديد</h2>
      </div>
      <div style="padding: 20px; background: #f8fafc;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px; font-weight: bold;">الاسم:</td><td style="padding: 8px;">${app.full_name}</td></tr>
          <tr style="background: #f1f5f9;"><td style="padding: 8px; font-weight: bold;">المدرسة:</td><td style="padding: 8px;">${app.school || ''}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">الهاتف:</td><td style="padding: 8px; direction: ltr;">${app.phone || ''}</td></tr>
          <tr style="background: #f1f5f9;"><td style="padding: 8px; font-weight: bold;">البريد:</td><td style="padding: 8px;">${app.email}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">المادة:</td><td style="padding: 8px;">${app.subject || app.specialization || ''}</td></tr>
          <tr style="background: #f1f5f9;"><td style="padding: 8px; font-weight: bold;">المحافظة:</td><td style="padding: 8px;">${app.governorate || ''}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">كود الخصم:</td><td style="padding: 8px; direction: ltr; font-weight: bold; color: #dc2626;">${code}</td></tr>
        </table>
        <p style="margin-top: 16px;"><a href="https://supabase.com/dashboard/project/kfoybahiintyvmrtvzzj" style="background: #1e3a5f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">فتح لوحة التحكم</a></p>
      </div>
    </div>
  `;
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}