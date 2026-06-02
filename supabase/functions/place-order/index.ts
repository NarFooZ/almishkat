/**
 * Edge Function: place-order v2
 * ✅ التحقق من كود الخصم على السيرفر — لا يُكشَف للعميل أبداً
 * ✅ التحقق من الأسعار من قاعدة البيانات مباشرةً
 * ✅ Rate limiting بسيط بالهاتف
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limit: ذاكرة مؤقتة داخل instance الـ Function
const recentOrders = new Map<string, number[]>();

function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const windowMs = 60_000; // نافذة دقيقة واحدة
  const maxOrders = 3;      // حد أقصى 3 طلبات/دقيقة لنفس الرقم

  const times = (recentOrders.get(phone) ?? []).filter(t => now - t < windowMs);
  if (times.length >= maxOrders) return true;
  recentOrders.set(phone, [...times, now]);
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const {
      cartItems, customerName, customerPhone, customerEmail,
      deliveryAddress, paymentMethod,
      discountCode   // ✅ يُتحقَّق منه هنا، لا على العميل
    } = body;

    // ── 1. التحقق من المدخلات ────────────────────────────────
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0)
      return errorResponse('السلة فارغة', 400);
    if (!customerName?.trim())
      return errorResponse('الاسم مطلوب', 400);
    if (!/^07[7-9][0-9]{7}$/.test(customerPhone))
      return errorResponse('رقم الهاتف غير صحيح', 400);
    if (!deliveryAddress?.trim())
      return errorResponse('العنوان مطلوب', 400);
    if (!['click', 'cash'].includes(paymentMethod))
      return errorResponse('طريقة دفع غير صحيحة', 400);
    if (cartItems.length > 50)
      return errorResponse('الحد الأقصى 50 منتج في الطلب الواحد', 400);

    // ── 2. Rate Limiting ─────────────────────────────────────
    if (isRateLimited(customerPhone))
      return errorResponse('طلبات كثيرة جداً، انتظر دقيقة ثم حاول', 429);

    // ── 3. جلب الأسعار من قاعدة البيانات ────────────────────
    const productIds = cartItems
      .filter((i: any) => !String(i.id).startsWith('pkg-'))
      .map((i: any) => Number(i.id));

    const packageIds = cartItems
      .filter((i: any) => String(i.id).startsWith('pkg-'))
      .map((i: any) => String(i.id).replace('pkg-', ''));

    const [productsResult, packagesResult] = await Promise.all([
      productIds.length > 0
        ? supabase.from('products').select('id, name, price, stock, is_active').in('id', productIds)
        : Promise.resolve({ data: [], error: null }),
      packageIds.length > 0
        ? supabase.from('packages').select('id, name, price, is_active').in('id', packageIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (productsResult.error) throw productsResult.error;
    if (packagesResult.error) throw packagesResult.error;

    const dbProducts = new Map((productsResult.data ?? []).map((p: any) => [String(p.id), p]));
    const dbPackages = new Map((packagesResult.data ?? []).map((p: any) => [String(p.id), p]));

    // ── 4. بناء قائمة المنتجات المُتحقَّق منها ───────────────
    const validatedItems: any[] = [];
    let subtotal = 0;
    const errors: string[] = [];

    for (const item of cartItems) {
      const qty = Math.min(Math.max(1, Math.floor(Number(item.qty) || 1)), 100);

      if (String(item.id).startsWith('pkg-')) {
        const pkgId = String(item.id).replace('pkg-', '');
        const pkg = dbPackages.get(pkgId);
        if (!pkg || !pkg.is_active) {
          errors.push(`الحزمة غير متوفرة`);
          continue;
        }
        const lineTotal = pkg.price * qty;
        subtotal += lineTotal;
        validatedItems.push({ id: item.id, name: pkg.name, price: pkg.price, qty, lineTotal });
      } else {
        const product = dbProducts.get(String(item.id));
        if (!product || !product.is_active) {
          errors.push(`المنتج غير متوفر`);
          continue;
        }
        if (product.stock < qty) {
          errors.push(`${product.name}: الكمية المطلوبة تتجاوز المخزون (${product.stock})`);
          continue;
        }
        const lineTotal = product.price * qty;
        subtotal += lineTotal;
        validatedItems.push({ id: item.id, name: product.name, price: product.price, qty, lineTotal });
      }
    }

    if (errors.length > 0) return errorResponse(errors.join(' | '), 422);
    if (validatedItems.length === 0) return errorResponse('لا توجد منتجات صالحة', 400);

    // ── 5. ✅ التحقق من كود الخصم على السيرفر ────────────────
    let discountPercent = 0;
    let discountCodeId: string | null = null;

    if (discountCode && typeof discountCode === 'string' && discountCode.trim()) {
      const cleanCode = discountCode.trim().toUpperCase();
      const { data: codeRow } = await supabase
        .from('discount_codes')
        .select('id, discount_percent, max_uses, used_count, is_active, expires_at')
        .eq('code', cleanCode)
        .maybeSingle();

      if (
        codeRow &&
        codeRow.is_active &&
        codeRow.used_count < codeRow.max_uses &&
        new Date(codeRow.expires_at) > new Date()
      ) {
        discountPercent = codeRow.discount_percent;
        discountCodeId = codeRow.id;
      }
      // لا نُخبر العميل إن كان الكود خاطئاً هنا — نتجاهله بصمت (أو يمكن الإخبار)
    }

    // ── 6. حساب الإجماليات من السيرفر ───────────────────────
    const discountAmount = Math.round(subtotal * discountPercent) / 100;
    const afterDiscount  = subtotal - discountAmount;
    const deliveryFee    = afterDiscount >= 20 ? 0 : 2;
    const total          = afterDiscount + deliveryFee;
    const earnedPoints   = Math.floor(subtotal * 10);

    // ── 7. إنشاء/تحديث العميل ───────────────────────────────
    let customerId: number | null = null;
    const { data: existingCustomer } = await supabase
      .from('customers').select('id, loyalty_points').eq('phone', customerPhone).maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      await supabase.from('customers')
        .update({ loyalty_points: existingCustomer.loyalty_points + earnedPoints })
        .eq('id', customerId);
    } else {
      const { data: newCustomer } = await supabase.from('customers')
        .insert({ full_name: customerName, phone: customerPhone, email: customerEmail || null, loyalty_points: earnedPoints })
        .select('id').single();
      customerId = newCustomer?.id ?? null;
    }

    // ── 8. حفظ الطلب ────────────────────────────────────────
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      customer_id:      customerId,
      customer_name:    customerName,
      customer_phone:   customerPhone,
      customer_email:   customerEmail || null,
      delivery_address: deliveryAddress,
      delivery_method:  'delivery',
      payment_method:   paymentMethod,
      items:            validatedItems,
      subtotal,
      delivery_fee:     deliveryFee,
      discount_amount:  discountAmount,
      total,
      earned_points:    earnedPoints,
      status:           'pending',
    }).select('id').single();

    if (orderError) throw orderError;

    // ── 9. تخفيض المخزون ────────────────────────────────────
    await Promise.all(
      validatedItems
        .filter((i: any) => !String(i.id).startsWith('pkg-'))
        .map((i: any) => supabase.rpc('decrement_stock', { product_id: Number(i.id), amount: i.qty }))
    );

    // ── 10. تسجيل نقاط الولاء ───────────────────────────────
    if (customerId) {
      await supabase.from('loyalty_transactions').insert({
        customer_id: customerId, points: earnedPoints,
        reason: 'purchase', reference_id: String(order.id),
      });
    }

    // ── 11. تحديث عداد استخدام كود الخصم (atomic عبر دالة SQL) ──
    if (discountCodeId) {
      const { error: incErr } = await supabase.rpc('increment_discount_used', { code_id: discountCodeId });
      if (incErr) console.error('increment_discount_used failed:', incErr);
    }

    return new Response(JSON.stringify({
      success: true,
      orderId: order.id,
      total,
      subtotal,
      discountAmount,
      deliveryFee,
      earnedPoints,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('place-order error:', err);
    return errorResponse(err.message ?? 'خطأ داخلي', 500);
  }
});

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  });
}
