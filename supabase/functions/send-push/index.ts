/**
 * Edge Function: send-push
 * إرسال Push Notifications للعملاء والمدير
 *
 * متغيرات البيئة المطلوبة:
 *   VAPID_SUBJECT=mailto:admin@almishkat.com
 *   VAPID_PUBLIC_KEY=...
 *   VAPID_PRIVATE_KEY=...
 *
 * توليد المفاتيح:
 *   npx web-push generate-vapid-keys
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@almishkat.com';

    if (!vapidPublic || !vapidPrivate) {
      return new Response(JSON.stringify({ success: false, error: 'VAPID keys not configured' }), {
        status: 500, headers: corsHeaders,
      });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const { subscription, title, body, url } = await req.json();
    if (!subscription || !title) {
      return new Response(JSON.stringify({ success: false, error: 'Missing subscription or title' }), {
        status: 400, headers: corsHeaders,
      });
    }

    await webpush.sendNotification(subscription, JSON.stringify({ title, body, url: url ?? '/' }));

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('send-push error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
});
