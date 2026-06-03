/* ============================================================
   admin.js — لوحة التحكم الكاملة v4
   ✅ Dashboard   ✅ Orders   ✅ Research   ✅ Print
   ✅ Products CRUD   ✅ Categories CRUD   ✅ Packages CRUD
   ✅ Discount Codes CRUD   ✅ Customers   ✅ Export CSV
   ============================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────────
let adminView       = 'dashboard';
let adminPage       = 0;
let adminFilter     = {};
let deleteCallback  = null;
let editingItem     = null;   // للمنتج/القسم/الحزمة/الكود الجاري تعديله
const PAGE          = 15;

// ── تعيين العناوين ────────────────────────────────────────────
const VIEW_TITLES = {
  dashboard: '📊 لوحة المعلومات',
  orders:    '🛒 طلبات الشراء',
  research:  '📝 طلبات البحوث',
  print:     '🖨️ طلبات الطباعة',
  teachers:  '👨‍🏫 طلبات المعلمين',
  products:  '📦 إدارة المنتجات',
  categories:'🗂️ إدارة الأقسام',
  packages:  '📚 إدارة الحزم',
  discounts: '🎫 أكواد الخصم',
  customers: '👥 العملاء',
};

// ============================================================
// Core API — يستدعي admin-action Edge Function
// ============================================================
async function adminAPI(action, table, options = {}) {
  if (!adminToken) { adminLogout(); return null; }
  try {
    const res = await fetch(`${FUNCTIONS_URL}/admin-action`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action, table, ...options }),
    });
    const json = await res.json();
    if (res.status === 401) { adminLogout(); toast('⚠️ انتهت الجلسة — سجّل الدخول مجدداً', 'warn'); return null; }
    if (!json.success) throw new Error(json.error || 'خطأ غير معروف');
    return json;
  } catch (e) {
    toast('⚠️ ' + e.message, 'warn', 4000);
    return null;
  }
}

// ============================================================
// Navigation — التنقل بين الأقسام
// ============================================================
function showAdminView(view, resetPage = true) {
  adminView = view;
  if (resetPage) { adminPage = 0; adminFilter = {}; }
  document.querySelectorAll('.adm-nav').forEach(b => b.classList.remove('adm-nav-active'));
  document.querySelector(`[data-view="${view}"]`)?.classList.add('adm-nav-active');
  const title = document.getElementById('adminPageTitle');
  if (title) title.textContent = VIEW_TITLES[view] ?? view;
  // مسح الشارة عند زيارة القسم
  const badge = VIEW_BADGE?.[view];
  if (badge) clearBadge(badge);
  // إغلاق الـ sidebar على الموبايل
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar?.classList.contains('open')) toggleAdminSidebar();
  const views = {
    dashboard: renderDashboard, orders: renderOrdersView,
    research:  renderResearchView, print: renderPrintView,
    teachers:  renderTeachersView, products: renderProductsView,
    categories:renderCategoriesView, packages: renderPackagesView,
    discounts: renderDiscountsView, customers: renderCustomersView,
  };
  views[view]?.();
}

function setAdminContent(html) {
  const el = document.getElementById('adminViewContent');
  if (el) el.innerHTML = html;
}

function adminLoading() {
  setAdminContent(`
    <div class="flex items-center justify-center py-24">
      <div class="text-center">
        <div class="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
        <div class="text-gray-500 font-semibold">جاري التحميل...</div>
      </div>
    </div>`);
}

// ============================================================
// Pagination Helper
// ============================================================
function paginationHTML(count, view) {
  const total = Math.ceil(count / PAGE);
  if (total <= 1) return '';
  const pages = [];
  for (let i = 0; i < Math.min(total, 8); i++) {
    pages.push(`<button onclick="adminPage=${i};showAdminView('${view}',false)"
      class="w-9 h-9 rounded-lg text-sm font-bold transition ${i === adminPage
        ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-blue-50 border border-gray-200'}">${i+1}</button>`);
  }
  return `
    <div class="flex items-center justify-between mt-6 flex-wrap gap-3">
      <span class="text-sm text-gray-500">${count} نتيجة | صفحة ${adminPage+1} من ${total}</span>
      <div class="flex gap-1">${pages.join('')}</div>
    </div>`;
}

// ============================================================
// STATUS HELPERS
// ============================================================
const STATUS_MAP = {
  pending:     { cls: 'bg-amber-100 text-amber-800',   label: 'قيد المراجعة', bar: '#d97706' },
  confirmed:   { cls: 'bg-blue-100 text-blue-800',     label: 'مؤكد',         bar: '#1d4ed8' },
  preparing:   { cls: 'bg-purple-100 text-purple-800', label: 'قيد التحضير',  bar: '#7e22ce' },
  reviewing:   { cls: 'bg-indigo-100 text-indigo-800', label: 'يُراجَع',       bar: '#4338ca' },
  in_progress: { cls: 'bg-violet-100 text-violet-800', label: 'قيد التنفيذ',  bar: '#6d28d9' },
  printing:    { cls: 'bg-cyan-100 text-cyan-800',     label: 'يُطبع الآن',    bar: '#0e7490' },
  ready:       { cls: 'bg-green-100 text-green-800',   label: 'جاهز',          bar: '#15803d' },
  delivered:   { cls: 'bg-emerald-100 text-emerald-800',label:'تم التسليم',   bar: '#047857' },
  cancelled:   { cls: 'bg-red-100 text-red-800',       label: 'ملغي',          bar: '#b91c1c' },
  approved:    { cls: 'bg-green-100 text-green-800',   label: 'موافق',         bar: '#15803d' },
  rejected:    { cls: 'bg-red-100 text-red-800',       label: 'مرفوض',         bar: '#b91c1c' },
};
function statusBadge(s) {
  const m = STATUS_MAP[s] ?? STATUS_MAP.pending;
  return `<span class="px-2 py-1 rounded-full text-xs font-bold ${m.cls}">${m.label}</span>`;
}
function statusSelect(current, opts, table, id) {
  return `<select onchange="quickUpdateStatus('${table}',${id},this.value)"
    class="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white">
    ${opts.map(([v,l]) => `<option value="${v}" ${v===current?'selected':''}>${l}</option>`).join('')}
  </select>`;
}
const ORDER_STATUSES    = [['pending','قيد المراجعة'],['confirmed','مؤكد'],['preparing','قيد التحضير'],['ready','جاهز'],['delivered','تم التسليم'],['cancelled','ملغي']];
const RESEARCH_STATUSES = [['pending','قيد المراجعة'],['reviewing','يُراجَع'],['in_progress','قيد التنفيذ'],['ready','جاهز'],['delivered','تم التسليم'],['cancelled','ملغي']];
const PRINT_STATUSES    = [['pending','قيد المراجعة'],['confirmed','مؤكد'],['printing','يُطبع'],['ready','جاهز'],['delivered','تم التسليم'],['cancelled','ملغي']];
const TEACHER_STATUSES  = [['pending','قيد المراجعة'],['approved','موافق'],['rejected','مرفوض']];

// ============================================================
// Image Render - URL to img, emoji to text
// ============================================================
function renderImage(src) {
  if (!src) return '\uD83D\uDCE6';
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return '<img src="' + esc(src) + '" alt="\u0635\u0648\u0631\u0629" class="w-12 h-12 object-cover rounded-xl" onerror="this.outerHTML=\u0027\uD83D\uDCE6\u0027">';
  }
  return esc(src);
}

// ============================================================
// Delete Item
// ============================================================
async function deleteItem(id, table, viewName, label) {
  if (!label) label = '\u0627\u0644\u0633\u062C\u0644';
  if (!confirm('\u26A0\uFE0F \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062D\u0630\u0641\n\u0647\u0644 \u0623\u0646\u062A \u0645\u062A\u0623\u0643\u062F \u0645\u0646 \u062D\u0630\u0641 ' + label + ' #' + id + '\u061F')) return;
  const res = await adminAPI('delete', table, { id });
  if (res) { toast('\u2705 \u062A\u0645 \u0627\u0644\u062D\u0630\u0641', 'success', 2000); showAdminView(viewName); }
}

async function quickUpdateStatus(table, id, status) {
  const res = await adminAPI('update', table, { id, data: { status } });
  if (res) toast('✓ تم تحديث الحالة', 'success', 2000);
}

// ============================================================
// 📊 DASHBOARD
// ============================================================
async function renderDashboard() {
  adminLoading();
  const [orders, research, print, teachers, customers, products] = await Promise.all([
    adminAPI('select', 'orders',              { pageSize: 0 }),
    adminAPI('select', 'research_requests',   { pageSize: 0 }),
    adminAPI('select', 'print_orders',        { pageSize: 0 }),
    adminAPI('select', 'teacher_applications',{ pageSize: 0 }),
    adminAPI('select', 'customers',           { pageSize: 0 }),
    adminAPI('select', 'products',            { pageSize: 0 }),
  ]);

  const totalOrders    = orders?.count  ?? 0;
  const totalResearch  = research?.count ?? 0;
  const totalPrint     = print?.count   ?? 0;
  const totalCustomers = customers?.count ?? 0;
  const totalProducts  = products?.count ?? 0;

  const allOrders  = orders?.data  ?? [];
  const allResearch= research?.data ?? [];

  const revenue  = allOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + (o.total || 0), 0);
  const pending  = allOrders.filter(o => o.status === 'pending').length;
  const pendingR = allResearch.filter(r => r.status === 'pending').length;

  // آخر 5 طلبات
  const recent5 = [...allOrders].slice(0, 5);

  // إيرادات حسب الحالة
  const byStatus = {};
  ORDER_STATUSES.forEach(([v]) => byStatus[v] = allOrders.filter(o => o.status === v).length);

  setAdminContent(`
    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      ${statCard('💰', 'إجمالي الإيرادات', revenue.toFixed(2) + ' د', 'bg-gradient-to-br from-green-400 to-emerald-600')}
      ${statCard('🛒', 'طلبات الشراء', totalOrders, 'bg-gradient-to-br from-blue-400 to-blue-700')}
      ${statCard('📝', 'طلبات البحوث', totalResearch, 'bg-gradient-to-br from-purple-400 to-purple-700')}
      ${statCard('🖨️', 'طلبات الطباعة', totalPrint, 'bg-gradient-to-br from-cyan-400 to-cyan-700')}
      ${statCard('👥', 'العملاء', totalCustomers, 'bg-gradient-to-br from-orange-400 to-red-500')}
      ${statCard('📦', 'المنتجات', totalProducts, 'bg-gradient-to-br from-teal-400 to-teal-700')}
    </div>

    <!-- تنبيهات -->
    ${(pending + pendingR) > 0 ? `
    <div class="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 mb-6 flex items-center gap-3">
      <span class="text-3xl">⚠️</span>
      <div>
        <div class="font-bold text-amber-800">يوجد ${pending + pendingR} طلب بانتظار المراجعة</div>
        <div class="text-sm text-amber-700">
          ${pending > 0 ? `${pending} طلب شراء` : ''}
          ${pending > 0 && pendingR > 0 ? ' | ' : ''}
          ${pendingR > 0 ? `${pendingR} طلب بحث` : ''}
        </div>
      </div>
      <button onclick="showAdminView('orders')" class="mr-auto bg-amber-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-amber-600">
        مراجعة الآن
      </button>
    </div>` : ''}

    <div class="grid lg:grid-cols-2 gap-6">
      <!-- آخر الطلبات -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 class="font-bold text-gray-800">🕐 آخر طلبات الشراء</h3>
          <button onclick="showAdminView('orders')" class="text-blue-600 text-sm hover:underline">عرض الكل</button>
        </div>
        <div class="divide-y divide-gray-50">
          ${recent5.length ? recent5.map(o => `
            <div class="p-4 flex items-center justify-between hover:bg-gray-50 cursor-pointer" onclick="openOrderModal(${o.id})">
              <div>
                <div class="font-semibold text-sm">${esc(o.customer_name)}</div>
                <div class="text-xs text-gray-500">${esc(o.customer_phone)} · ${new Date(o.created_at).toLocaleDateString('ar')}</div>
              </div>
              <div class="text-right">
                <div class="font-bold text-blue-700 text-sm">${o.total?.toFixed(2)} د</div>
                ${statusBadge(o.status)}
              </div>
            </div>
          `).join('') : '<div class="p-6 text-center text-gray-400">لا توجد طلبات</div>'}
        </div>
      </div>

      <!-- توزيع الحالات -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h3 class="font-bold text-gray-800 mb-4">📈 توزيع حالات الطلبات</h3>
        <div class="space-y-3">
          ${ORDER_STATUSES.map(([v,l]) => {
            const n   = byStatus[v] || 0;
            const pct = totalOrders > 0 ? Math.round((n / totalOrders) * 100) : 0;
            const m   = STATUS_MAP[v];
            return `
              <div>
                <div class="flex justify-between text-sm mb-1">
                  <span class="font-semibold">${l}</span>
                  <span class="font-bold">${n} (${pct}%)</span>
                </div>
                <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div class="h-full rounded-full" style="width:${pct}%;background-color:${m.bar}"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  `);
}

function statCard(icon, label, value, gradient) {
  return `
    <div class="${gradient} text-white p-4 rounded-2xl shadow-md">
      <div class="text-3xl mb-1">${icon}</div>
      <div class="text-2xl font-black">${value}</div>
      <div class="text-sm opacity-90 mt-1">${label}</div>
    </div>`;
}

// ============================================================
// 🛒 ORDERS VIEW
// ============================================================
async function renderOrdersView() {
  adminLoading();
  const res = await adminAPI('select', 'orders', {
    filters: adminFilter, page: adminPage, pageSize: PAGE,
  });
  if (!res) return;
  const items = res.data ?? [];
  const count = res.count ?? 0;

  setAdminContent(`
    ${filterBar('orders', [
      { key: 'status', label: 'الحالة', opts: [['','الكل'],...ORDER_STATUSES] },
    ], 'بحث باسم أو هاتف')}

    ${items.length === 0 ? emptyState('🛒', 'لا توجد طلبات') : `
      <div class="space-y-3">
        ${items.map(o => orderCard(o)).join('')}
      </div>
      ${paginationHTML(count, 'orders')}
    `}

    <!-- Order Detail Modal -->
    <div id="orderModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="modal-overlay absolute inset-0" onclick="closeOrderModal()"></div>
      <div class="relative bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" id="orderModalBody"></div>
    </div>
  `);
}

function orderCard(o) {
  const items = (o.items || []).map(i => `
    <div class="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
      <span>${esc(i.name)} × ${i.qty}</span>
      <span class="font-bold">${(i.price * i.qty).toFixed(2)} د</span>
    </div>`).join('');

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition">
      <div class="p-4">
        <!-- Header -->
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="flex items-center gap-2">
            <span class="bg-blue-100 text-blue-700 font-black text-sm px-3 py-1 rounded-full">#${o.id}</span>
            ${statusBadge(o.status)}
          </div>
          <span class="text-xs text-gray-400">${new Date(o.created_at).toLocaleString('ar')}</span>
        </div>

        <!-- Customer -->
        <div class="grid md:grid-cols-2 gap-2 mb-3">
          <div class="bg-gray-50 rounded-xl p-3">
            <div class="text-xs text-gray-500 mb-1">العميل</div>
            <div class="font-bold">${esc(o.customer_name)}</div>
            <a href="tel:${esc(o.customer_phone)}" class="text-blue-600 text-sm">📞 ${esc(o.customer_phone)}</a>
            ${o.customer_email ? `<div class="text-xs text-gray-500">${esc(o.customer_email)}</div>` : ''}
          </div>
          <div class="bg-gray-50 rounded-xl p-3">
            <div class="text-xs text-gray-500 mb-1">التوصيل</div>
            <div class="text-sm">${esc(o.delivery_address || 'لم يحدد')}</div>
            <div class="text-xs mt-1">${o.payment_method === 'click' ? '💳 CliQ' : '💵 نقدي'}</div>
          </div>
        </div>

        <!-- Items (collapsible) -->
        <details class="mb-3">
          <summary class="cursor-pointer text-sm font-bold text-blue-700 hover:text-blue-900 list-none flex items-center gap-1">
            📋 المنتجات (${(o.items||[]).length} صنف) <span class="mr-auto">▾</span>
          </summary>
          <div class="mt-2 bg-gray-50 rounded-xl p-3">${items}</div>
        </details>

        <!-- Totals + Actions -->
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex gap-4 text-sm">
            <span>المجموع: <b>${o.subtotal?.toFixed(2)} د</b></span>
            ${o.discount_amount > 0 ? `<span class="text-green-600">خصم: <b>-${o.discount_amount.toFixed(2)} د</b></span>` : ''}
            <span>التوصيل: <b>${o.delivery_fee?.toFixed(2)} د</b></span>
            <span class="text-blue-700 font-black">الإجمالي: ${o.total?.toFixed(2)} د</span>
          </div>
          <div class="flex gap-2 mr-auto">
            ${statusSelect(o.status, ORDER_STATUSES, 'orders', o.id)}
            <button onclick="openOrderModal(${o.id})" class="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-blue-700">
              ✏️ تفاصيل
            </button>
            <a href="https://wa.me/962${esc(o.customer_phone?.slice(1))}" target="_blank"
               class="bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-green-600">
              💬 واتساب
            </a>
            <button onclick="deleteItem('${o.id}', 'orders', 'orders', 'الطلب')" class="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-red-700">
              🗑️ حذف
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// بيانات الطلب بالكامل (مودال)
async function openOrderModal(orderId) {
  const res = await adminAPI('select', 'orders', { id: orderId });
  const o = res?.data?.[0];
  if (!o) return;

  const modal = document.getElementById('orderModal');
  const body  = document.getElementById('orderModalBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <div class="bg-gray-800 text-white p-5 rounded-t-2xl flex items-center justify-between">
      <h3 class="font-bold text-lg">طلب رقم #${o.id}</h3>
      <button onclick="closeOrderModal()" class="text-2xl hover:opacity-70">✕</button>
    </div>
    <div class="p-5 space-y-4">
      <!-- معلومات العميل -->
      <div class="bg-blue-50 rounded-xl p-4">
        <h4 class="font-bold mb-2 text-blue-900">👤 بيانات العميل</h4>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div><span class="text-gray-500">الاسم:</span> <b>${esc(o.customer_name)}</b></div>
          <div><span class="text-gray-500">الهاتف:</span> <a href="tel:${esc(o.customer_phone)}" class="text-blue-600 font-bold">${esc(o.customer_phone)}</a></div>
          <div><span class="text-gray-500">البريد:</span> ${esc(o.customer_email || '-')}</div>
          <div><span class="text-gray-500">الدفع:</span> ${o.payment_method === 'click' ? '💳 CliQ' : '💵 نقدي'}</div>
          <div class="col-span-2"><span class="text-gray-500">العنوان:</span> ${esc(o.delivery_address || '-')}</div>
        </div>
      </div>

      <!-- المنتجات -->
      <div>
        <h4 class="font-bold mb-2">🛍️ المنتجات</h4>
        <div class="border rounded-xl overflow-hidden">
          ${(o.items||[]).map(i => `
            <div class="flex justify-between p-3 border-b last:border-0 text-sm hover:bg-gray-50">
              <span>${esc(i.name)} × ${i.qty}</span>
              <span class="font-bold">${(i.price * i.qty).toFixed(2)} د</span>
            </div>`).join('')}
        </div>
        <div class="mt-2 text-sm space-y-1 text-left" dir="ltr">
          <div class="flex justify-between"><span>Subtotal</span><span>${o.subtotal?.toFixed(2)} د</span></div>
          ${o.discount_amount > 0 ? `<div class="flex justify-between text-green-600"><span>Discount</span><span>-${o.discount_amount?.toFixed(2)} د</span></div>` : ''}
          <div class="flex justify-between"><span>Delivery</span><span>${o.delivery_fee?.toFixed(2)} د</span></div>
          <div class="flex justify-between font-black text-blue-700 text-base border-t pt-1"><span>Total</span><span>${o.total?.toFixed(2)} د</span></div>
        </div>
      </div>

      <!-- تحديث الحالة -->
      <div class="bg-gray-50 rounded-xl p-4">
        <h4 class="font-bold mb-3">⚙️ تحديث الحالة</h4>
        <div class="flex flex-wrap gap-2 mb-3">
          ${ORDER_STATUSES.map(([v,l]) => `
            <button onclick="updateOrderFromModal(${o.id},'${v}')"
              class="px-3 py-1 rounded-full text-xs font-bold border-2 transition ${o.status===v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:border-blue-400 text-gray-700'}">
              ${l}
            </button>`).join('')}
        </div>
        <label class="block text-sm font-bold mb-1">ملاحظات المدير:</label>
        <textarea id="orderNotes_${o.id}" rows="2" placeholder="أضف ملاحظة..."
          class="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:border-blue-500">${esc(o.notes || '')}</textarea>
        <button onclick="saveOrderNotes(${o.id})" class="mt-2 bg-gray-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-900">
          💾 حفظ الملاحظة
        </button>
      </div>

      <!-- WhatsApp -->
      <a href="https://wa.me/962${esc(o.customer_phone?.slice(1))}?text=${encodeURIComponent('مرحباً ' + o.customer_name + '، طلبك رقم #' + o.id + ' تم تحديثه.')}"
         target="_blank" class="flex items-center justify-center gap-2 bg-green-500 text-white py-3 rounded-xl font-bold hover:bg-green-600">
        💬 تواصل مع العميل عبر واتساب
      </a>
    </div>`;

  modal.classList.remove('hidden');
}

function closeOrderModal() { document.getElementById('orderModal')?.classList.add('hidden'); }

async function updateOrderFromModal(id, status) {
  const res = await adminAPI('update', 'orders', { id, data: { status } });
  if (res) { toast('✓ تم تحديث الحالة', 'success', 2000); closeOrderModal(); renderOrdersView(); }
}
async function saveOrderNotes(id) {
  const notes = document.getElementById(`orderNotes_${id}`)?.value;
  const res   = await adminAPI('update', 'orders', { id, data: { notes } });
  if (res) toast('✓ تم حفظ الملاحظة', 'success', 2000);
}

// ============================================================
// 📝 RESEARCH VIEW
// ============================================================
async function renderResearchView() {
  adminLoading();
  const res = await adminAPI('select', 'research_requests', {
    filters: adminFilter, page: adminPage, pageSize: PAGE,
  });
  if (!res) return;
  const items = res.data ?? [];
  const count = res.count ?? 0;

  setAdminContent(`
    ${filterBar('research', [
      { key: 'status', label: 'الحالة', opts: [['','الكل'],...RESEARCH_STATUSES] },
    ], 'بحث بالهاتف')}
    ${items.length === 0 ? emptyState('📝','لا توجد طلبات بحث') : `
      <div class="space-y-3">${items.map(r => researchCard(r)).join('')}</div>
      ${paginationHTML(count, 'research')}
    `}
  `);
}

function researchCard(r) {
  const attachLinks = (r.attachments || []).map(a =>
    `<a href="${esc(a.url)}" target="_blank" rel="noopener"
       class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs hover:bg-blue-100">
       📎 ${esc(a.name)}
     </a>`).join('');

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="flex items-center gap-2">
          <span class="bg-purple-100 text-purple-700 font-black text-sm px-3 py-1 rounded-full">#${r.id}</span>
          <span class="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-full">${esc(r.request_type)}</span>
          ${statusBadge(r.status)}
        </div>
        <span class="text-xs text-gray-400">${new Date(r.created_at).toLocaleString('ar')}</span>
      </div>

      <div class="grid md:grid-cols-2 gap-3 mb-3">
        <div class="bg-gray-50 rounded-xl p-3">
          <div class="font-bold text-sm">${esc(r.customer_name)}</div>
          <a href="tel:${esc(r.customer_phone)}" class="text-blue-600 text-sm">📞 ${esc(r.customer_phone)}</a>
          <div class="text-xs text-gray-500 mt-1">${r.user_type === 'teacher' ? '👨‍🏫 معلم' : '👨‍🎓 طالب'} | ${r.delivery_method === 'email' ? '📧 بريد' : '🏠 توصيل'}</div>
        </div>
        ${r.description ? `<div class="bg-blue-50 rounded-xl p-3 text-sm">${esc(r.description)}</div>` : '<div></div>'}
      </div>

      ${r.voice_note_url ? `<div class="mb-3"><div class="text-xs font-bold text-gray-500 mb-1">🎙️ تسجيل صوتي</div><audio controls class="w-full h-10" src="${esc(r.voice_note_url)}"></audio></div>` : ''}
      ${attachLinks ? `<div class="flex flex-wrap gap-2 mb-3">${attachLinks}</div>` : ''}

      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-sm font-bold">الحالة:</label>
          ${statusSelect(r.status, RESEARCH_STATUSES, 'research_requests', r.id)}
        </div>
        <div class="flex items-center gap-2">
          <label class="text-sm font-bold">السعر المقدر:</label>
          <input type="number" id="rPrice_${r.id}" value="${r.estimated_price||''}" placeholder="0.00"
            class="w-24 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-blue-500">
          <button onclick="saveResearchPrice(${r.id})" class="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-blue-700">
            💾 حفظ
          </button>
        </div>
        <a href="https://wa.me/962${esc(r.customer_phone?.slice(1))}" target="_blank"
           class="mr-auto bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-green-600">
          💬 واتساب
        </a>
      </div>
        <button onclick="deleteItem('${r.id}', 'research_requests', 'research', 'طلب البحث')" class="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-red-700">
          🗑️ حذف
        </button>
    </div>`;
}

async function saveResearchPrice(id) {
  const price = parseFloat(document.getElementById(`rPrice_${id}`)?.value);
  if (isNaN(price)) { toast('⚠️ أدخل سعراً صحيحاً', 'warn'); return; }
  const res = await adminAPI('update', 'research_requests', { id, data: { estimated_price: price } });
  if (res) toast('✓ تم حفظ السعر', 'success', 2000);
}

// ============================================================
// 🖨️ PRINT VIEW
// ============================================================
async function renderPrintView() {
  adminLoading();
  const res = await adminAPI('select', 'print_orders', {
    filters: adminFilter, page: adminPage, pageSize: PAGE,
  });
  if (!res) return;
  const items = res.data ?? [];
  const count = res.count ?? 0;

  setAdminContent(`
    ${filterBar('print', [
      { key: 'status', label: 'الحالة', opts: [['','الكل'],...PRINT_STATUSES] },
    ], 'بحث بالهاتف')}
    ${items.length === 0 ? emptyState('🖨️','لا توجد طلبات طباعة') : `
      <div class="space-y-3">${items.map(p => printCard(p)).join('')}</div>
      ${paginationHTML(count, 'print')}
    `}
  `);
}

function printCard(p) {
  const specs = [
    p.print_type === 'bw' ? 'أبيض/أسود' : 'ملون',
    esc(p.paper_size), `${p.copies} نسخة`,
    p.binding === 'none' ? 'بدون تجليد' : p.binding === 'spiral' ? 'حلزوني' : 'حراري',
  ].join(' · ');

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="flex items-center gap-2">
          <span class="bg-cyan-100 text-cyan-700 font-black text-sm px-3 py-1 rounded-full">#${p.id}</span>
          ${statusBadge(p.status)}
        </div>
        <span class="text-xs text-gray-400">${new Date(p.created_at).toLocaleString('ar')}</span>
      </div>
      <div class="grid md:grid-cols-3 gap-3 mb-3 text-sm">
        <div class="bg-gray-50 rounded-xl p-3">
          <div class="font-bold">${esc(p.customer_name)}</div>
          <a href="tel:${esc(p.customer_phone)}" class="text-blue-600">📞 ${esc(p.customer_phone)}</a>
        </div>
        <div class="bg-gray-50 rounded-xl p-3">
          <div class="text-gray-500 text-xs mb-1">الملف</div>
          <a href="${esc(p.file_url)}" target="_blank" rel="noopener"
             class="text-blue-600 hover:underline flex items-center gap-1 text-xs">
            📄 ${esc(p.file_name)} ⬇️
          </a>
        </div>
        <div class="bg-gray-50 rounded-xl p-3">
          <div class="text-gray-500 text-xs mb-1">المواصفات</div>
          <div class="text-xs">${specs}</div>
        </div>
      </div>
      ${p.notes ? `<div class="bg-yellow-50 rounded-xl p-3 text-sm mb-3">💬 ${esc(p.notes)}</div>` : ''}
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-sm font-bold">الحالة:</label>
          ${statusSelect(p.status, PRINT_STATUSES, 'print_orders', p.id)}
        </div>
        <a href="https://wa.me/962${esc(p.customer_phone?.slice(1))}" target="_blank"
           class="mr-auto bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-green-600">
          💬 واتساب
        </a>
      </div>
        <button onclick="deleteItem('${p.id}', 'print_orders', 'print', 'طلب الطباعة')" class="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-red-700">
          🗑️ حذف
        </button>
    </div>`;
}

// ============================================================
// 👨‍🏫 TEACHERS VIEW
// ============================================================
async function renderTeachersView() {
  adminLoading();
  const res = await adminAPI('select', 'teacher_applications', {
    filters: adminFilter, page: adminPage, pageSize: PAGE,
  });
  if (!res) return;
  const items = res.data ?? [];
  const count = res.count ?? 0;

  setAdminContent(`
    ${filterBar('teachers', [
      { key: 'status', label: 'الحالة', opts: [['','الكل'],...TEACHER_STATUSES] },
    ])}
    ${items.length === 0 ? emptyState('👨‍🏫','لا توجد طلبات معلمين') : `
      <div class="space-y-3">${items.map(t => teacherCard(t)).join('')}</div>
      ${paginationHTML(count, 'teachers')}
    `}
  `);
}

function teacherCard(t) {
  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="flex items-center gap-2">
          <span class="bg-indigo-100 text-indigo-700 font-black text-sm px-3 py-1 rounded-full">#${t.id}</span>
          ${statusBadge(t.status)}
        </div>
        <span class="text-xs text-gray-400">${new Date(t.created_at).toLocaleString('ar')}</span>
      </div>
      <div class="grid md:grid-cols-2 gap-3 mb-3 text-sm">
        <div class="bg-gray-50 rounded-xl p-3">
          <div class="font-bold text-base">${esc(t.full_name)}</div>
          <div class="text-gray-600">${esc(t.school_name)}</div>
          ${t.subject ? `<div class="text-gray-500 text-xs">📚 ${esc(t.subject)}</div>` : ''}
          ${t.governorate ? `<div class="text-gray-500 text-xs">📍 ${esc(t.governorate)}</div>` : ''}
        </div>
        <div class="bg-gray-50 rounded-xl p-3">
          <a href="tel:${esc(t.phone)}" class="text-blue-600 block">📞 ${esc(t.phone)}</a>
          <a href="mailto:${esc(t.email)}" class="text-blue-600 text-xs">✉️ ${esc(t.email)}</a>
          ${t.discount_code ? `<div class="mt-2 bg-green-100 text-green-800 px-2 py-1 rounded-lg text-xs font-bold">🎫 ${esc(t.discount_code)}</div>` : ''}
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        ${t.status !== 'approved' ? `
          <button onclick="approveTeacher(${t.id}, '${esc(t.email)}', '${esc(t.full_name)}')"
            class="bg-green-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-green-600">
            ✅ موافقة وإرسال كود
          </button>` : ''}
        ${t.status !== 'rejected' ? `
          <button onclick="rejectTeacher(${t.id})"
            class="bg-red-100 text-red-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-200">
            ❌ رفض
          </button>` : ''}
        <a href="https://wa.me/962${esc(t.phone?.slice(1))}" target="_blank"
           class="bg-green-500 text-white px-3 py-2 rounded-xl text-sm font-bold hover:bg-green-600">
          💬 واتساب
        </a>
        ${statusSelect(t.status, TEACHER_STATUSES, 'teacher_applications', t.id)}
      </div>
        <button onclick="deleteItem('${t.id}', 'teacher_applications', 'teachers', 'طلب المعلم')" class="bg-red-500 text-white px-3 py-2 rounded-xl text-sm font-bold hover:bg-red-700">
          🗑️ حذف
        </button>
    </div>`;
}

async function approveTeacher(id, email, name) {
  const code = 'TEACHER' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const [updateRes, codeRes] = await Promise.all([
    adminAPI('update', 'teacher_applications', { id, data: { status: 'approved', discount_code: code } }),
    adminAPI('insert', 'discount_codes', { data: {
      code, discount_percent: 20, max_uses: 100, is_active: true,
      teacher_email: email, teacher_name: name, notes: `معلم: ${name}`,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    }}),
  ]);
  if (updateRes && codeRes) {
    toast(`✅ تمت الموافقة! كود الخصم: ${code}`, 'success', 6000);
    renderTeachersView();
  }
}

async function rejectTeacher(id) {
  openDeleteConfirm('هل تريد رفض هذا الطلب؟', async () => {
    const res = await adminAPI('update', 'teacher_applications', { id, data: { status: 'rejected' } });
    if (res) { toast('تم رفض الطلب', 'warn', 2000); renderTeachersView(); }
  });
}

// ============================================================
// 📦 PRODUCTS VIEW — CRUD
// ============================================================
async function renderProductsView() {
  adminLoading();
  const [prodRes, catRes] = await Promise.all([
    adminAPI('select', 'products', { filters: adminFilter, page: adminPage, pageSize: PAGE }),
    adminAPI('select', 'categories', { pageSize: 0 }),
  ]);
  if (!prodRes) return;
  const items = prodRes.data ?? [];
  const count = prodRes.count ?? 0;
  const cats  = catRes?.data ?? [];

  setAdminContent(`
    <div class="flex justify-between items-center mb-4">
      <h3 class="font-bold text-gray-700">${count} منتج</h3>
      <button onclick="openProductModal()" class="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700">
        ➕ إضافة منتج
      </button>
    </div>
    ${filterBar('products', [
      { key: 'category_id', label: 'القسم', opts: [['','الكل'],...cats.map(c => [c.id, c.icon+' '+c.name])] },
    ], 'بحث عن منتج')}

    ${items.length === 0 ? emptyState('📦','لا توجد منتجات') : `
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-100">
            <tr>
              <th class="px-4 py-3 text-right font-bold text-gray-600">المنتج</th>
              <th class="px-4 py-3 text-right font-bold text-gray-600 hidden md:table-cell">القسم</th>
              <th class="px-4 py-3 text-right font-bold text-gray-600">السعر</th>
              <th class="px-4 py-3 text-right font-bold text-gray-600 hidden md:table-cell">المخزون</th>
              <th class="px-4 py-3 text-right font-bold text-gray-600">الحالة</th>
              <th class="px-4 py-3 text-right font-bold text-gray-600">إجراءات</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            ${items.map(p => {
              const cat = cats.find(c => c.id === p.category_id);
              return `
              <tr class="hover:bg-gray-50 transition">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <span class="text-2xl">${renderImage(p.image)}</span>
                    <div>
                      <div class="font-semibold">${esc(p.name)}</div>
                      ${p.is_featured ? '<span class="text-xs bg-yellow-100 text-yellow-700 px-1 rounded">⭐ مميز</span>' : ''}
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 hidden md:table-cell text-gray-500">${cat ? esc(cat.icon + ' ' + cat.name) : '-'}</td>
                <td class="px-4 py-3">
                  <div class="font-bold text-blue-700">${p.price} د</div>
                  ${p.old_price ? `<div class="text-xs text-gray-400 line-through">${p.old_price} د</div>` : ''}
                </td>
                <td class="px-4 py-3 hidden md:table-cell">
                  <span class="${p.stock < 5 ? 'text-red-600 font-bold' : 'text-gray-700'}">${p.stock}</span>
                </td>
                <td class="px-4 py-3">
                  <button onclick="toggleProductActive(${p.id}, ${p.is_active})"
                    class="${p.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} px-2 py-1 rounded-full text-xs font-bold hover:opacity-80">
                    ${p.is_active ? '✅ نشط' : '❌ معطل'}
                  </button>
                </td>
                <td class="px-4 py-3">
                  <div class="flex gap-1">
                    <button onclick="openProductModal(${p.id})" class="bg-blue-100 text-blue-700 px-2 py-1 rounded-lg text-xs hover:bg-blue-200">✏️</button>
                    <button onclick="deleteProduct(${p.id}, '${esc(p.name)}')" class="bg-red-100 text-red-700 px-2 py-1 rounded-lg text-xs hover:bg-red-200">🗑️</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${paginationHTML(count, 'products')}
    `}

    <!-- Product Modal -->
    <div id="productModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="modal-overlay absolute inset-0" onclick="closeProductModal()"></div>
      <div class="relative bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div class="bg-gray-800 text-white p-4 rounded-t-2xl flex items-center justify-between sticky top-0">
          <h3 id="productModalTitle" class="font-bold">إضافة منتج</h3>
          <button onclick="closeProductModal()" class="text-xl hover:opacity-70">✕</button>
        </div>
        <form id="productForm" onsubmit="saveProduct(event, ${JSON.stringify(cats.map(c=>({id:c.id,name:c.name,icon:c.icon})))?.replace(/"/g,'&quot;')})" class="p-5 space-y-3">
          <input type="hidden" id="pId">
          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2">
              <label class="block text-sm font-bold mb-1">اسم المنتج *</label>
              <input id="pName" required class="adm-input w-full" placeholder="اسم المنتج">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">القسم</label>
              <select id="pCategory" class="adm-input w-full">
                <option value="">-- اختر --</option>
                ${cats.map(c => `<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">الأيقونة / رابط الصورة</label>
              <input id="pImage" class="adm-input w-full" placeholder="📦 أو رابط URL">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">السعر * (دينار)</label>
              <input type="number" id="pPrice" required step="0.01" min="0" class="adm-input w-full" placeholder="0.00">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">السعر القديم (دينار)</label>
              <input type="number" id="pOldPrice" step="0.01" min="0" class="adm-input w-full" placeholder="0.00">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">المخزون</label>
              <input type="number" id="pStock" min="0" value="0" class="adm-input w-full">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">التقييم (1-5)</label>
              <input type="number" id="pRating" step="0.1" min="1" max="5" value="4.5" class="adm-input w-full">
            </div>
            <div class="col-span-2">
              <label class="block text-sm font-bold mb-1">الوصف</label>
              <textarea id="pDesc" rows="2" class="adm-input w-full resize-none" placeholder="وصف اختياري..."></textarea>
            </div>
            <div class="flex items-center gap-2">
              <input type="checkbox" id="pFeatured" class="w-4 h-4 accent-blue-600">
              <label for="pFeatured" class="text-sm font-semibold">منتج مميز ⭐</label>
            </div>
            <div class="flex items-center gap-2">
              <input type="checkbox" id="pActive" checked class="w-4 h-4 accent-blue-600">
              <label for="pActive" class="text-sm font-semibold">نشط ✅</label>
            </div>
          </div>
          <button type="submit" class="btn-primary text-white w-full py-3 rounded-xl font-bold mt-2">
            💾 حفظ المنتج
          </button>
        </form>
      </div>
    </div>
  `);
}

function openProductModal(productId = null) {
  editingItem = productId;
  document.getElementById('productModalTitle').textContent = productId ? 'تعديل المنتج' : 'إضافة منتج جديد';
  document.getElementById('productForm').reset();
  document.getElementById('pActive').checked = true;

  if (productId) {
    adminAPI('select', 'products', { id: productId }).then(res => {
      const p = res?.data?.[0];
      if (!p) return;
      document.getElementById('pId').value        = p.id;
      document.getElementById('pName').value      = p.name;
      document.getElementById('pImage').value     = p.image || '';
      document.getElementById('pPrice').value     = p.price;
      document.getElementById('pOldPrice').value  = p.old_price || '';
      document.getElementById('pStock').value     = p.stock;
      document.getElementById('pRating').value    = p.rating;
      document.getElementById('pDesc').value      = p.description || '';
      document.getElementById('pCategory').value  = p.category_id || '';
      document.getElementById('pFeatured').checked= !!p.is_featured;
      document.getElementById('pActive').checked  = !!p.is_active;
    });
  }
  document.getElementById('productModal').classList.remove('hidden');
}
function closeProductModal() { document.getElementById('productModal')?.classList.add('hidden'); }

async function saveProduct(e) {
  e.preventDefault();
  const id   = document.getElementById('pId').value;
  const data = {
    name:        document.getElementById('pName').value.trim(),
    category_id: document.getElementById('pCategory').value || null,
    image:       document.getElementById('pImage').value.trim() || '📦',
    price:       parseFloat(document.getElementById('pPrice').value),
    old_price:   parseFloat(document.getElementById('pOldPrice').value) || null,
    stock:       parseInt(document.getElementById('pStock').value) || 0,
    rating:      parseFloat(document.getElementById('pRating').value) || 4.5,
    description: document.getElementById('pDesc').value.trim() || null,
    is_featured: document.getElementById('pFeatured').checked,
    is_active:   document.getElementById('pActive').checked,
  };
  const res = id
    ? await adminAPI('update', 'products', { id: parseInt(id), data })
    : await adminAPI('insert', 'products', { data });
  if (res) {
    toast(id ? '✓ تم تعديل المنتج' : '✓ تم إضافة المنتج', 'success', 2000);
    closeProductModal();
    renderProductsView();
  }
}

async function deleteProduct(id, name) {
  openDeleteConfirm(`هل تريد حذف "${name}"؟ لا يمكن التراجع عن هذا الإجراء.`, async () => {
    const res = await adminAPI('delete', 'products', { id });
    if (res) { toast('تم حذف المنتج', 'warn', 2000); renderProductsView(); }
  });
}

async function toggleProductActive(id, current) {
  const res = await adminAPI('update', 'products', { id, data: { is_active: !current } });
  if (res) { toast(current ? '⚠️ تم إخفاء المنتج' : '✅ تم تفعيل المنتج', 'success', 2000); renderProductsView(); }
}

// ============================================================
// 🗂️ CATEGORIES VIEW — CRUD
// ============================================================
async function renderCategoriesView() {
  adminLoading();
  const res = await adminAPI('select', 'categories', { pageSize: 0 });
  if (!res) return;
  const items = res.data ?? [];

  setAdminContent(`
    <div class="flex justify-between items-center mb-4">
      <h3 class="font-bold text-gray-700">${items.length} قسم</h3>
      <button onclick="openCategoryModal()" class="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700">
        ➕ إضافة قسم
      </button>
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${items.map(c => `
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
          <div class="text-4xl">${esc(c.icon)}</div>
          <div class="flex-1">
            <div class="font-bold">${esc(c.name)}</div>
            <div class="text-xs text-gray-500">ترتيب: ${c.display_order ?? 0}</div>
          </div>
          <div class="flex gap-1">
            <button onclick="openCategoryModal('${esc(c.id)}')" class="bg-blue-100 text-blue-700 px-2 py-1 rounded-lg text-xs hover:bg-blue-200">✏️</button>
            <button onclick="deleteCategory('${esc(c.id)}', '${esc(c.name)}')" class="bg-red-100 text-red-700 px-2 py-1 rounded-lg text-xs hover:bg-red-200">🗑️</button>
          </div>
        </div>`).join('')}
    </div>

    <!-- Category Modal -->
    <div id="categoryModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="modal-overlay absolute inset-0" onclick="closeCategoryModal()"></div>
      <div class="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div class="bg-gray-800 text-white p-4 flex items-center justify-between">
          <h3 id="catModalTitle" class="font-bold">إضافة قسم</h3>
          <button onclick="closeCategoryModal()" class="text-xl hover:opacity-70">✕</button>
        </div>
        <form id="categoryForm" onsubmit="saveCategory(event)" class="p-5 space-y-3">
          <input type="hidden" id="cId">
          <div>
            <label class="block text-sm font-bold mb-1">معرّف القسم (بالإنجليزي) *</label>
            <input id="cKey" required class="adm-input w-full" placeholder="مثال: books, stationery">
          </div>
          <div>
            <label class="block text-sm font-bold mb-1">اسم القسم *</label>
            <input id="cName" required class="adm-input w-full" placeholder="الكتب المدرسية">
          </div>
          <div>
            <label class="block text-sm font-bold mb-1">الأيقونة (إيموجي)</label>
            <input id="cIcon" class="adm-input w-full" placeholder="📚">
          </div>
          <div>
            <label class="block text-sm font-bold mb-1">ترتيب العرض</label>
            <input type="number" id="cOrder" value="0" min="0" class="adm-input w-full">
          </div>
          <button type="submit" class="btn-primary text-white w-full py-3 rounded-xl font-bold">💾 حفظ</button>
        </form>
      </div>
    </div>
  `);
}

function openCategoryModal(id = null) {
  editingItem = id;
  document.getElementById('catModalTitle').textContent = id ? 'تعديل القسم' : 'إضافة قسم جديد';
  document.getElementById('categoryForm').reset();
  if (id) {
    adminAPI('select', 'categories', { id }).then(res => {
      const c = res?.data?.[0];
      if (!c) return;
      document.getElementById('cId').value    = c.id;
      document.getElementById('cKey').value   = c.id;
      document.getElementById('cName').value  = c.name;
      document.getElementById('cIcon').value  = c.icon;
      document.getElementById('cOrder').value = c.display_order ?? 0;
    });
  }
  document.getElementById('categoryModal').classList.remove('hidden');
}
function closeCategoryModal() { document.getElementById('categoryModal')?.classList.add('hidden'); }

async function saveCategory(e) {
  e.preventDefault();
  const isEdit = !!editingItem;
  const data   = {
    id:            document.getElementById('cKey').value.trim().toLowerCase(),
    name:          document.getElementById('cName').value.trim(),
    icon:          document.getElementById('cIcon').value.trim() || '📁',
    display_order: parseInt(document.getElementById('cOrder').value) || 0,
  };
  const res = isEdit
    ? await adminAPI('update', 'categories', { id: editingItem, data })
    : await adminAPI('insert', 'categories', { data });
  if (res) { toast(isEdit ? '✓ تم تعديل القسم' : '✓ تم إضافة القسم', 'success'); closeCategoryModal(); renderCategoriesView(); }
}
async function deleteCategory(id, name) {
  openDeleteConfirm(`هل تريد حذف قسم "${name}"؟`, async () => {
    const res = await adminAPI('delete', 'categories', { id });
    if (res) { toast('تم حذف القسم', 'warn', 2000); renderCategoriesView(); }
  });
}

// ============================================================
// 📚 PACKAGES VIEW — CRUD
// ============================================================
const GRADIENTS = [
  'from-pink-400 to-rose-500','from-blue-400 to-blue-700','from-green-400 to-emerald-600',
  'from-purple-400 to-purple-700','from-orange-400 to-red-500','from-teal-400 to-teal-700',
  'from-cyan-400 to-cyan-700','from-indigo-400 to-indigo-700',
];

async function renderPackagesView() {
  adminLoading();
  const res = await adminAPI('select', 'packages', { pageSize: 0 });
  if (!res) return;
  const items = res.data ?? [];

  setAdminContent(`
    <div class="flex justify-between items-center mb-4">
      <h3 class="font-bold text-gray-700">${items.length} حزمة</h3>
      <button onclick="openPackageModal()" class="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700">
        ➕ إضافة حزمة
      </button>
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${items.map(p => `
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="bg-gradient-to-br ${esc(p.color_gradient)} p-4 text-white text-center">
            <div class="text-4xl mb-1">${esc(p.icon)}</div>
            <div class="font-bold">${esc(p.name)}</div>
            <div class="text-xs opacity-80">${esc(p.grade)}</div>
          </div>
          <div class="p-4">
            <div class="flex justify-between text-sm mb-2">
              <span class="text-gray-500">${p.items_count} منتج</span>
              <div>
                <span class="font-black text-blue-700">${p.price} د</span>
                ${p.old_price ? `<span class="text-xs text-gray-400 line-through mr-1">${p.old_price} د</span>` : ''}
              </div>
            </div>
            <div class="flex gap-2">
              <span class="${p.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} px-2 py-1 rounded-full text-xs font-bold">
                ${p.is_active ? '✅ نشط' : '❌ معطل'}
              </span>
              <button onclick="openPackageModal('${esc(p.id)}')" class="bg-blue-100 text-blue-700 px-2 py-1 rounded-lg text-xs hover:bg-blue-200">✏️</button>
              <button onclick="deletePackage('${esc(p.id)}', '${esc(p.name)}')" class="bg-red-100 text-red-700 px-2 py-1 rounded-lg text-xs hover:bg-red-200">🗑️</button>
            </div>
          </div>
        </div>`).join('')}
    </div>

    <!-- Package Modal -->
    <div id="packageModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="modal-overlay absolute inset-0" onclick="closePackageModal()"></div>
      <div class="relative bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div class="bg-gray-800 text-white p-4 rounded-t-2xl flex items-center justify-between sticky top-0">
          <h3 id="pkgModalTitle" class="font-bold">إضافة حزمة</h3>
          <button onclick="closePackageModal()" class="text-xl hover:opacity-70">✕</button>
        </div>
        <form id="packageForm" onsubmit="savePackage(event)" class="p-5 space-y-3">
          <input type="hidden" id="pkgId">
          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2">
              <label class="block text-sm font-bold mb-1">اسم الحزمة *</label>
              <input id="pkgName" required class="adm-input w-full" placeholder="حزمة الصف العاشر">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">معرّف (ID)</label>
              <input id="pkgKey" class="adm-input w-full" placeholder="p10">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">الصف الدراسي</label>
              <input id="pkgGrade" class="adm-input w-full" placeholder="الصف العاشر">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">عدد المنتجات</label>
              <input type="number" id="pkgItems" value="0" min="0" class="adm-input w-full">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">الأيقونة</label>
              <input id="pkgIcon" class="adm-input w-full" placeholder="📦">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">السعر *</label>
              <input type="number" id="pkgPrice" required step="0.01" min="0" class="adm-input w-full">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">السعر القديم</label>
              <input type="number" id="pkgOldPrice" step="0.01" min="0" class="adm-input w-full">
            </div>
            <div class="col-span-2">
              <label class="block text-sm font-bold mb-1">لون التدرج</label>
              <div class="flex flex-wrap gap-2">
                ${GRADIENTS.map(g => `
                  <button type="button" onclick="selectGradient('${g}')" data-grad="${g}"
                    class="gradient-btn w-8 h-8 rounded-full bg-gradient-to-br ${g} border-2 border-transparent hover:border-white shadow-sm">
                  </button>`).join('')}
              </div>
              <input type="hidden" id="pkgGradient" value="${GRADIENTS[0]}">
            </div>
            <div class="flex items-center gap-2">
              <input type="checkbox" id="pkgActive" checked class="w-4 h-4 accent-blue-600">
              <label for="pkgActive" class="text-sm font-semibold">نشط ✅</label>
            </div>
          </div>
          <button type="submit" class="btn-primary text-white w-full py-3 rounded-xl font-bold">💾 حفظ الحزمة</button>
        </form>
      </div>
    </div>
  `);
}

function selectGradient(grad) {
  document.getElementById('pkgGradient').value = grad;
  document.querySelectorAll('.gradient-btn').forEach(b => {
    b.classList.toggle('border-white', b.dataset.grad === grad);
    b.classList.toggle('border-transparent', b.dataset.grad !== grad);
    b.classList.toggle('scale-110', b.dataset.grad === grad);
  });
}

function openPackageModal(id = null) {
  editingItem = id;
  document.getElementById('pkgModalTitle').textContent = id ? 'تعديل الحزمة' : 'إضافة حزمة جديدة';
  document.getElementById('packageForm').reset();
  document.getElementById('pkgActive').checked = true;
  document.getElementById('pkgGradient').value = GRADIENTS[0];
  if (id) {
    adminAPI('select', 'packages', { id }).then(res => {
      const p = res?.data?.[0];
      if (!p) return;
      document.getElementById('pkgId').value       = p.id;
      document.getElementById('pkgKey').value      = p.id;
      document.getElementById('pkgName').value     = p.name;
      document.getElementById('pkgGrade').value    = p.grade;
      document.getElementById('pkgItems').value    = p.items_count;
      document.getElementById('pkgIcon').value     = p.icon;
      document.getElementById('pkgPrice').value    = p.price;
      document.getElementById('pkgOldPrice').value = p.old_price || '';
      document.getElementById('pkgActive').checked = !!p.is_active;
      document.getElementById('pkgGradient').value = p.color_gradient || GRADIENTS[0];
    });
  }
  document.getElementById('packageModal').classList.remove('hidden');
}
function closePackageModal() { document.getElementById('packageModal')?.classList.add('hidden'); }

async function savePackage(e) {
  e.preventDefault();
  const isEdit = !!editingItem;
  const data   = {
    id:             document.getElementById('pkgKey').value.trim() || ('p' + Date.now()),
    name:           document.getElementById('pkgName').value.trim(),
    grade:          document.getElementById('pkgGrade').value.trim(),
    items_count:    parseInt(document.getElementById('pkgItems').value) || 0,
    icon:           document.getElementById('pkgIcon').value.trim() || '📦',
    price:          parseFloat(document.getElementById('pkgPrice').value),
    old_price:      parseFloat(document.getElementById('pkgOldPrice').value) || null,
    color_gradient: document.getElementById('pkgGradient').value,
    is_active:      document.getElementById('pkgActive').checked,
  };
  const res = isEdit
    ? await adminAPI('update', 'packages', { id: editingItem, data })
    : await adminAPI('insert', 'packages', { data });
  if (res) { toast(isEdit ? '✓ تم تعديل الحزمة' : '✓ تم إضافة الحزمة', 'success'); closePackageModal(); renderPackagesView(); }
}
async function deletePackage(id, name) {
  openDeleteConfirm(`هل تريد حذف حزمة "${name}"؟`, async () => {
    const res = await adminAPI('delete', 'packages', { id });
    if (res) { toast('تم حذف الحزمة', 'warn', 2000); renderPackagesView(); }
  });
}

// ============================================================
// 🎫 DISCOUNT CODES VIEW — CRUD
// ============================================================
async function renderDiscountsView() {
  adminLoading();
  const res = await adminAPI('select', 'discount_codes', { pageSize: 0 });
  if (!res) return;
  const items = res.data ?? [];

  setAdminContent(`
    <div class="flex justify-between items-center mb-4">
      <h3 class="font-bold text-gray-700">${items.length} كود</h3>
      <button onclick="openDiscountModal()" class="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700">
        ➕ إنشاء كود خصم
      </button>
    </div>
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[600px]">
          <thead class="bg-gray-50 border-b border-gray-100">
            <tr>
              <th class="px-4 py-3 text-right font-bold">الكود</th>
              <th class="px-4 py-3 text-right font-bold">الخصم</th>
              <th class="px-4 py-3 text-right font-bold">الاستخدام</th>
              <th class="px-4 py-3 text-right font-bold">المعلم</th>
              <th class="px-4 py-3 text-right font-bold">الانتهاء</th>
              <th class="px-4 py-3 text-right font-bold">الحالة</th>
              <th class="px-4 py-3 text-right font-bold">إجراءات</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            ${items.map(c => {
              const expired   = new Date(c.expires_at) < new Date();
              const exhausted = c.used_count >= c.max_uses;
              const usePct    = Math.round((c.used_count / c.max_uses) * 100);
              return `
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 font-mono font-bold text-blue-700">${esc(c.code)}</td>
                <td class="px-4 py-3"><span class="bg-green-100 text-green-700 px-2 py-1 rounded-full font-bold">${c.discount_percent}%</span></td>
                <td class="px-4 py-3">
                  <div class="text-xs mb-1">${c.used_count}/${c.max_uses}</div>
                  <div class="w-20 h-2 bg-gray-100 rounded-full">
                    <div class="h-full bg-blue-500 rounded-full" style="width:${usePct}%"></div>
                  </div>
                </td>
                <td class="px-4 py-3 text-xs text-gray-600">${esc(c.teacher_name || '-')}</td>
                <td class="px-4 py-3 text-xs ${expired ? 'text-red-600 font-bold' : 'text-gray-500'}">${new Date(c.expires_at).toLocaleDateString('ar')}</td>
                <td class="px-4 py-3">
                  ${!c.is_active ? '<span class="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-bold">معطل</span>'
                    : expired ? '<span class="bg-orange-100 text-orange-700 px-2 py-1 rounded-full text-xs font-bold">منتهي</span>'
                    : exhausted ? '<span class="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs font-bold">مستنفد</span>'
                    : '<span class="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-bold">نشط</span>'}
                </td>
                <td class="px-4 py-3">
                  <div class="flex gap-1">
                    <button onclick="toggleDiscountCode('${esc(c.id)}', ${c.is_active})"
                      class="${c.is_active ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'} px-2 py-1 rounded-lg text-xs">
                      ${c.is_active ? '🚫' : '✅'}
                    </button>
                    <button onclick="deleteDiscountCode('${esc(c.id)}', '${esc(c.code)}')"
                      class="bg-red-100 text-red-700 px-2 py-1 rounded-lg text-xs hover:bg-red-200">🗑️</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${items.length === 0 ? emptyState('🎫','لا توجد أكواد خصم') : ''}

    <!-- Discount Modal -->
    <div id="discountModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="modal-overlay absolute inset-0" onclick="closeDiscountModal()"></div>
      <div class="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div class="bg-gray-800 text-white p-4 flex items-center justify-between">
          <h3 class="font-bold">إنشاء كود خصم جديد</h3>
          <button onclick="closeDiscountModal()" class="text-xl hover:opacity-70">✕</button>
        </div>
        <form id="discountForm" onsubmit="saveDiscountCode(event)" class="p-5 space-y-3">
          <div>
            <label class="block text-sm font-bold mb-1">الكود *</label>
            <div class="flex gap-2">
              <input id="dcCode" required class="adm-input flex-1" placeholder="TEACHER20"
                oninput="this.value=this.value.toUpperCase()">
              <button type="button" onclick="document.getElementById('dcCode').value='CODE'+Math.random().toString(36).slice(2,7).toUpperCase()"
                class="bg-gray-100 text-gray-700 px-3 py-2 rounded-lg text-xs hover:bg-gray-200">توليد</button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-bold mb-1">نسبة الخصم %</label>
              <input type="number" id="dcPercent" required min="1" max="100" value="15" class="adm-input w-full">
            </div>
            <div>
              <label class="block text-sm font-bold mb-1">الحد الأقصى للاستخدام</label>
              <input type="number" id="dcMaxUses" required min="1" value="10" class="adm-input w-full">
            </div>
          </div>
          <div>
            <label class="block text-sm font-bold mb-1">اسم المعلم (اختياري)</label>
            <input id="dcTeacherName" class="adm-input w-full" placeholder="أ. محمد أحمد">
          </div>
          <div>
            <label class="block text-sm font-bold mb-1">بريد المعلم (اختياري)</label>
            <input type="email" id="dcTeacherEmail" class="adm-input w-full" placeholder="teacher@school.com">
          </div>
          <div>
            <label class="block text-sm font-bold mb-1">ملاحظات</label>
            <input id="dcNotes" class="adm-input w-full" placeholder="وصف اختياري">
          </div>
          <div>
            <label class="block text-sm font-bold mb-1">تاريخ الانتهاء</label>
            <input type="date" id="dcExpiry" class="adm-input w-full"
              value="${new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0]}">
          </div>
          <button type="submit" class="btn-primary text-white w-full py-3 rounded-xl font-bold">🎫 إنشاء الكود</button>
        </form>
      </div>
    </div>
  `);
}

function openDiscountModal()  { document.getElementById('discountModal')?.classList.remove('hidden'); }
function closeDiscountModal() { document.getElementById('discountModal')?.classList.add('hidden'); }

async function saveDiscountCode(e) {
  e.preventDefault();
  const data = {
    code:            document.getElementById('dcCode').value.trim().toUpperCase(),
    discount_percent:parseInt(document.getElementById('dcPercent').value),
    max_uses:        parseInt(document.getElementById('dcMaxUses').value),
    teacher_name:    document.getElementById('dcTeacherName').value.trim() || null,
    teacher_email:   document.getElementById('dcTeacherEmail').value.trim() || null,
    notes:           document.getElementById('dcNotes').value.trim() || null,
    expires_at:      new Date(document.getElementById('dcExpiry').value).toISOString(),
    is_active: true, used_count: 0,
  };
  const res = await adminAPI('insert', 'discount_codes', { data });
  if (res) { toast(`✓ تم إنشاء الكود: ${data.code}`, 'success', 4000); closeDiscountModal(); renderDiscountsView(); }
}
async function toggleDiscountCode(id, active) {
  const res = await adminAPI('update', 'discount_codes', { id, data: { is_active: !active } });
  if (res) { toast(active ? '🚫 تم تعطيل الكود' : '✅ تم تفعيل الكود', 'success', 2000); renderDiscountsView(); }
}
async function deleteDiscountCode(id, code) {
  openDeleteConfirm(`هل تريد حذف الكود "${code}"؟`, async () => {
    const res = await adminAPI('delete', 'discount_codes', { id });
    if (res) { toast('تم حذف الكود', 'warn', 2000); renderDiscountsView(); }
  });
}

// ============================================================
// 👥 CUSTOMERS VIEW
// ============================================================
async function renderCustomersView() {
  adminLoading();
  const res = await adminAPI('select', 'customers', {
    filters: adminFilter, page: adminPage, pageSize: PAGE,
  });
  if (!res) return;
  const items = res.data ?? [];
  const count = res.count ?? 0;

  setAdminContent(`
    <div class="flex justify-between items-center mb-4">
      <h3 class="font-bold text-gray-700">${count} عميل</h3>
      <button onclick="exportCustomersCSV()" class="bg-green-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-green-700">
        ⬇️ تصدير CSV
      </button>
    </div>
    ${filterBar('customers', [], 'بحث بالاسم أو الهاتف')}
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[500px]">
          <thead class="bg-gray-50 border-b border-gray-100">
            <tr>
              <th class="px-4 py-3 text-right font-bold">العميل</th>
              <th class="px-4 py-3 text-right font-bold">الهاتف</th>
              <th class="px-4 py-3 text-right font-bold">النقاط</th>
              <th class="px-4 py-3 text-right font-bold">النوع</th>
              <th class="px-4 py-3 text-right font-bold">التسجيل</th>
              <th class="px-4 py-3 text-right font-bold">إجراءات</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            ${items.map(c => `
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-3">
                  <div class="font-semibold">${esc(c.full_name)}</div>
                  ${c.email ? `<div class="text-xs text-gray-500">${esc(c.email)}</div>` : ''}
                </td>
                <td class="px-4 py-3"><a href="tel:${esc(c.phone)}" class="text-blue-600">${esc(c.phone)}</a></td>
                <td class="px-4 py-3">
                  <span class="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-bold">
                    ⭐ ${c.loyalty_points ?? 0}
                  </span>
                </td>
                <td class="px-4 py-3 text-xs">
                  ${c.user_type === 'teacher' ? '👨‍🏫 معلم' : '👨‍🎓 طالب'}
                  ${c.is_teacher_verified ? '<span class="text-green-600">✓</span>' : ''}
                </td>
                <td class="px-4 py-3 text-xs text-gray-500">${new Date(c.created_at).toLocaleDateString('ar')}</td>
                <td class="px-4 py-3">
                  <div class="flex gap-1">
                    <a href="https://wa.me/962${esc(c.phone?.slice(1))}" target="_blank"
                       class="bg-green-100 text-green-700 px-2 py-1 rounded-lg text-xs hover:bg-green-200">💬</a>
                    <button onclick="showAdminView('orders');adminFilter={phone:'${esc(c.phone)}'};renderOrdersView()"
                       class="bg-blue-100 text-blue-700 px-2 py-1 rounded-lg text-xs hover:bg-blue-200">طلباته</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${items.length === 0 ? emptyState('👥','لا يوجد عملاء') : paginationHTML(count, 'customers')}
  `);
}

async function exportCustomersCSV() {
  const res = await adminAPI('select', 'customers', { pageSize: 0 });
  if (!res) return;
  const data = res.data ?? [];
  const csv  = [
    ['ID','الاسم','الهاتف','البريد','النوع','النقاط','تاريخ التسجيل'],
    ...data.map(c => [c.id, c.full_name, c.phone, c.email||'', c.user_type, c.loyalty_points||0, new Date(c.created_at).toLocaleDateString('ar')]),
  ].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,%EF%BB%BF' + encodeURIComponent(csv);
  a.download = `customers_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  toast('✓ تم تصدير بيانات العملاء', 'success');
}

// ============================================================
// SHARED UI HELPERS
// ============================================================
function filterBar(view, selects = [], searchPlaceholder = '') {
  const selectHTML = selects.map(s => `
    <select onchange="adminFilter.${s.key}=this.value;adminPage=0;showAdminView('${view}',false)"
      class="adm-input text-sm">
      ${s.opts.map(([v, l]) => `<option value="${v}" ${adminFilter[s.key]===v?'selected':''}>${esc(l)}</option>`).join('')}
    </select>`).join('');

  const searchHTML = searchPlaceholder ? `
    <input type="text" placeholder="${searchPlaceholder}"
      value="${esc(adminFilter.search||'')}"
      oninput="clearTimeout(window._st);window._st=setTimeout(()=>{adminFilter.search=this.value;adminPage=0;showAdminView('${view}',false)},400)"
      class="adm-input flex-1 min-w-[160px] text-sm">` : '';

  return `
    <div class="bg-white rounded-2xl border border-gray-100 p-3 mb-4 flex flex-wrap gap-2 items-center shadow-sm">
      ${selectHTML}
      ${searchHTML}
      ${Object.keys(adminFilter).some(k=>adminFilter[k]) ? `
        <button onclick="adminFilter={};adminPage=0;showAdminView('${view}',false)"
          class="bg-red-100 text-red-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-red-200">
          ✕ مسح الفلتر
        </button>` : ''}
    </div>`;
}

function emptyState(icon, text) {
  return `<div class="bg-white rounded-2xl shadow-sm border border-gray-100 py-16 text-center">
    <div class="text-7xl mb-4">${icon}</div>
    <div class="text-gray-500 font-semibold">${text}</div>
  </div>`;
}

// ── Delete Confirm ────────────────────────────────────────────
function openDeleteConfirm(text, callback) {
  deleteCallback = callback;
  document.getElementById('deleteConfirmText').textContent = text;
  document.getElementById('deleteConfirmModal').classList.remove('hidden');
}
function closeDeleteConfirm() {
  deleteCallback = null;
  document.getElementById('deleteConfirmModal').classList.add('hidden');
}
async function confirmDelete() {
  if (!deleteCallback) return;
  const btn = document.getElementById('deleteConfirmBtn');
  btn.disabled = true;
  btn.textContent = '⏳ ...';
  try { await deleteCallback(); } finally {
    btn.disabled = false;
    btn.textContent = 'حذف';
    closeDeleteConfirm();
  }
}

// ── Mobile Sidebar ────────────────────────────────────────────
function toggleAdminSidebar() {
  const sidebar  = document.getElementById('adminSidebar');
  const overlay  = document.getElementById('adminSidebarOverlay');
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  overlay?.classList.toggle('open', !isOpen);
  overlay?.classList.toggle('hidden', isOpen);
}

// ── Clear badge when entering a view ─────────────────────────
function clearBadge(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ''; el.classList.add('hidden'); }
}

const VIEW_BADGE = {
  orders:'badgeOrders', research:'badgeResearch', print:'badgePrint', teachers:'badgeTeachers'
};

// ── Init admin on login ───────────────────────────────────────
function initAdminPanel() {
  showAdminView('dashboard');
  subscribeRealtime();
  // تحديث شارات الانتظار عند الدخول
  updatePendingBadges();
}

async function updatePendingBadges() {
  const tables = [
    ['orders','badgeOrders'],['research_requests','badgeResearch'],
    ['print_orders','badgePrint'],['teacher_applications','badgeTeachers'],
  ];
  for (const [table, badge] of tables) {
    const res = await adminAPI('select', table, { filters:{ status:'pending' }, pageSize:0 });
    const count = res?.count ?? 0;
    const el = document.getElementById(badge);
    if (!el) continue;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }
}
