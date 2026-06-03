/* ============================================================
   مكتبة المشكاة v4 — app.js
   ✅ XSS Protection   ✅ Secure API calls   ✅ Dark Mode
   ✅ Real-time Admin  ✅ File type validation
   ============================================================ */

// ── إعدادات Supabase ─────────────────────────────────────────
const SUPABASE_URL      = 'https://kfoybahiintyvmrtvzzj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JkpjOOyNx_VIPb5hzocoVw_0T8q8SBc';
const FUNCTIONS_URL     = `${SUPABASE_URL}/functions/v1`;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ─────────────────────────────────────────────────────
let allProducts   = [];
let allCategories = [];
let allPackages   = [];
let cart          = [];
let currentSection     = 'home';
let currentAdminTab    = 'orders';
let adminToken         = sessionStorage.getItem('mishkat_admin_token') ?? null;
let appliedDiscount    = null; // { code, percent } — للعرض فقط، السيرفر يتحقق
let realtimeChannel    = null;

loadCart();

// ============================================================
// ✅ XSS Protection — sanitize كل نص قبل إدراجه في DOM
// ============================================================
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// Navigation
// ============================================================
function showSection(name) {
  if (name === 'admin') {
    if (!adminToken) { showAdminLogin(); return; }
  }
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(name + '-section');
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.remove('active'));
  const navBtn = document.querySelector(`[data-nav="${name}"]`);
  if (navBtn) navBtn.classList.add('active');
  currentSection = name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'shop')  renderProducts();
  if (name === 'admin') { initAdminPanel(); }
}

// ============================================================
// Dark Mode
// ============================================================
function toggleDarkMode() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('mishkat_dark', isDark ? '1' : '0');
  document.getElementById('darkModeBtn').textContent = isDark ? '☀️' : '🌙';
}

function initDarkMode() {
  const saved = localStorage.getItem('mishkat_dark');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === '1' || (!saved && prefersDark)) {
    document.body.classList.add('dark');
    document.getElementById('darkModeBtn').textContent = '☀️';
  }
}

// ============================================================
// Admin Auth
// ============================================================
function showAdminLogin() {
  document.getElementById('adminLoginModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('adminPassword').focus(), 100);
}
function hideAdminLogin() {
  document.getElementById('adminLoginModal').classList.add('hidden');
  document.getElementById('adminPassword').value = '';
}

let loginAttempts = 0;
let lockUntil     = 0;

async function doAdminLogin(e) {
  e.preventDefault();

  // Client-side lockout بعد 5 محاولات فاشلة
  if (Date.now() < lockUntil) {
    const secs = Math.ceil((lockUntil - Date.now()) / 1000);
    toast(`🔒 انتظر ${secs} ثانية`, 'warn'); return;
  }

  const password = document.getElementById('adminPassword').value;
  if (!password) { toast('⚠️ أدخل كلمة المرور', 'warn'); return; }

  const btn = document.getElementById('adminLoginBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> جاري التحقق...';

  try {
    const res = await fetch(`${FUNCTIONS_URL}/admin-login`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@almishkat.com', password }),
    });
    const data = await res.json();

    if (!data.success) {
      loginAttempts++;
      if (loginAttempts >= 5) { lockUntil = Date.now() + 60_000; loginAttempts = 0; }
      toast('⚠️ ' + data.error, 'warn'); return;
    }

    loginAttempts = 0;
    adminToken = data.token;
    sessionStorage.setItem('mishkat_admin_token', adminToken);
    hideAdminLogin();
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    document.getElementById('admin-section').classList.remove('hidden');
    currentSection = 'admin';
    initAdminPanel();
    toast('✅ أهلاً بالمدير');
  } catch (err) {
    toast('⚠️ فشل الاتصال بالخادم', 'warn');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔐 دخول';
  }
}

function adminLogout() {
  adminToken = null;
  sessionStorage.removeItem('mishkat_admin_token');
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
  showSection('home');
  toast('تم تسجيل الخروج');
}

// ============================================================
// Real-time — لوحة التحكم تتحدث تلقائياً
// ============================================================
function subscribeRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = sb
    .channel('admin-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
      if (adminView === 'orders') renderOrdersView();
      if (adminView === 'dashboard') renderDashboard();
      showBadge('badgeOrders');
      toast('🛒 طلب شراء جديد!', 'success', 5000);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'research_requests' }, () => {
      if (adminView === 'research') renderResearchView();
      if (adminView === 'dashboard') renderDashboard();
      showBadge('badgeResearch');
      toast('📝 طلب بحث جديد!', 'success', 5000);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'print_orders' }, () => {
      if (adminView === 'print') renderPrintView();
      showBadge('badgePrint');
      toast('🖨️ طلب طباعة جديد!', 'success', 5000);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'teacher_applications' }, () => {
      if (adminView === 'teachers') renderTeachersView();
      showBadge('badgeTeachers');
      toast('👨‍🏫 تسجيل معلم جديد!', 'success', 5000);
    })
    .subscribe();
}

function showBadge(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const count = parseInt(el.textContent || '0') + 1;
  el.textContent = count;
  el.classList.remove('hidden');
}

// ============================================================
// Load Data
// ============================================================
async function loadCategories() {
  try {
    const { data, error } = await sb.from('categories').select('*').order('display_order');
    if (error) throw error;
    allCategories = (data || []).map(c => ({ ...c, id: String(c.id) }));
    renderCategories();
  } catch { loadDemoData(); }
}

async function loadProducts() {
  renderSkeletons('featuredProducts', 4);
  try {
    const { data, error } = await sb.from('products').select('*').eq('is_active', true).order('id');
    if (error) throw error;
    allProducts = (data || []).map(p => ({ ...p, id: String(p.id) }));
    renderFeatured();
    if (currentSection === 'shop') renderProducts();
  } catch { loadDemoData(); }
}

async function loadPackages() {
  try {
    const { data, error } = await sb.from('packages').select('*').eq('is_active', true);
    if (error) throw error;
    allPackages = (data || []).map(p => ({ ...p, id: String(p.id) }));
    renderPackages();
  } catch { loadDemoData(); }
}

function renderSkeletons(containerId, count) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array(count).fill(`
    <div class="rounded-2xl overflow-hidden shadow-md">
      <div class="skeleton h-40 w-full"></div>
      <div class="p-3 space-y-2">
        <div class="skeleton h-4 w-3/4"></div>
        <div class="skeleton h-4 w-1/2"></div>
        <div class="skeleton h-8 w-full mt-2"></div>
      </div>
    </div>
  `).join('');
}

function loadDemoData() {
  allCategories = [
    { id: 'books', name: 'الكتب المدرسية', icon: '📚' },
    { id: 'stationery', name: 'القرطاسية', icon: '✏️' },
    { id: 'engineering', name: 'أدوات هندسية', icon: '📐' },
    { id: 'computer', name: 'إكسسوارات كمبيوتر', icon: '💻' },
    { id: 'bags', name: 'الحقائب', icon: '🎒' },
    { id: 'art', name: 'أدوات فنية', icon: '🎨' },
  ];
  allProducts = [
    { id:'1', name:'كتاب الرياضيات - الصف العاشر', category_id:'books',       price:8.5,  old_price:10,   image:'📕', rating:4.8, stock:25, is_featured:true  },
    { id:'2', name:'قلم حبر جاف Pilot G2',          category_id:'stationery',  price:1.5,  old_price:null, image:'🖊️', rating:4.9, stock:100, is_featured:true },
    { id:'3', name:'دفتر A4 200 صفحة',              category_id:'stationery',  price:2.25, old_price:null, image:'📓', rating:4.7, stock:50,  is_featured:false },
    { id:'4', name:'حقيبة مدرسية ظهر',              category_id:'bags',        price:18,   old_price:25,   image:'🎒', rating:4.6, stock:15, is_featured:true  },
    { id:'5', name:'فأرة لاسلكية',                  category_id:'computer',    price:7,    old_price:9,    image:'🖱️', rating:4.5, stock:30, is_featured:true  },
    { id:'6', name:'مجموعة هندسة كاملة',            category_id:'engineering', price:5.5,  old_price:null, image:'📐', rating:4.8, stock:40, is_featured:false },
    { id:'7', name:'علبة ألوان خشبية 24 لون',       category_id:'art',         price:4.75, old_price:null, image:'🖍️', rating:4.9, stock:35, is_featured:false },
    { id:'8', name:'فلاش ميموري 32GB',               category_id:'computer',    price:6.5,  old_price:null, image:'💾', rating:4.7, stock:60, is_featured:false },
  ];
  allPackages = [
    { id:'p1', name:'حزمة الصف الأول الأساسي', grade:'الصف الأول',   items_count:15, price:35, old_price:48,  icon:'🎒', color_gradient:'from-pink-400 to-rose-500'    },
    { id:'p2', name:'حزمة الإعدادي الكاملة',   grade:'الصفوف 7-9',   items_count:25, price:55, old_price:75,  icon:'📖', color_gradient:'from-green-400 to-emerald-600' },
    { id:'p3', name:'حزمة الثانوي العلمي',     grade:'الصفوف 10-12', items_count:30, price:75, old_price:100, icon:'🎓', color_gradient:'from-purple-400 to-purple-600' },
  ];
  renderCategories(); renderFeatured(); renderPackages();
}

// ============================================================
// Render — كل النصوص تمر عبر esc() قبل الإدراج
// ============================================================
function renderCategories() {
  const grid = document.getElementById('categoriesGrid');
  if (!grid) return;
  if (allCategories.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500">لا توجد أقسام</div>';
    return;
  }
  grid.innerHTML = allCategories.map(c => `
    <div class="category-card p-5 rounded-2xl shadow-md cursor-pointer text-center"
         onclick="filterByCategory('${esc(c.id)}')">
      <div class="cat-icon text-5xl mb-2">${esc(c.icon)}</div>
      <div class="cat-name font-bold text-mishkat-blue-900">${esc(c.name)}</div>
      <div class="cat-count text-xs text-gray-500 mt-1">تصفح</div>
    </div>
  `).join('');

  const filterCat = document.getElementById('filterCategory');
  if (filterCat) {
    filterCat.innerHTML = '<option value="all">كل الأقسام</option>' +
      allCategories.map(c => `<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</option>`).join('');
  }
}

function filterByCategory(catId) {
  showSection('shop');
  setTimeout(() => {
    document.getElementById('filterCategory').value = catId;
    renderProducts();
  }, 100);
}

function productCard(p) {
  const discount = p.old_price ? Math.round(((p.old_price - p.price) / p.old_price) * 100) : 0;
  const stockBadge = p.stock < 5 ? `<span class="absolute top-2 left-2 bg-orange-500 text-white text-xs px-2 py-1 rounded-full">آخر ${p.stock}!</span>` : '';
  return `
    <div class="product-card bg-white rounded-2xl shadow-md overflow-hidden">
      <div class="relative bg-gradient-to-br from-mishkat-blue-50 to-blue-100 p-8 text-center">
        <div class="text-7xl">${esc(p.image || '📦')}</div>
        ${discount > 0 ? `<span class="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full font-bold">-${discount}%</span>` : ''}
        ${stockBadge}
      </div>
      <div class="p-3">
        <h4 class="font-bold text-sm text-mishkat-blue-900 line-clamp-2 h-10">${esc(p.name)}</h4>
        <div class="flex items-center gap-1 mt-1 text-xs">
          <span class="text-yellow-500">★</span>
          <span class="font-semibold">${esc(String(p.rating))}</span>
          <span class="text-gray-400">• ${esc(String(p.stock))} متوفر</span>
        </div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="font-black text-mishkat-blue-700 text-lg">${esc(String(p.price))} د</span>
          ${p.old_price ? `<span class="text-gray-400 text-xs line-through">${esc(String(p.old_price))} د</span>` : ''}
        </div>
        <button onclick="addToCart('${esc(String(p.id))}')"
          ${p.stock === 0 ? 'disabled' : ''}
          class="btn-primary text-white w-full mt-2 py-2 rounded-lg text-sm font-bold ${p.stock === 0 ? 'opacity-50 cursor-not-allowed' : ''}">
          ${p.stock === 0 ? '❌ نفد المخزون' : '🛒 أضف للسلة'}
        </button>
      </div>
    </div>
  `;
}

function renderFeatured() {
  const featured = allProducts.filter(p => p.is_featured);
  const el = document.getElementById('featuredProducts');
  if (!el) return;
  el.innerHTML = featured.length
    ? featured.map(productCard).join('')
    : '<div class="col-span-full text-center py-8 text-gray-500">لا توجد منتجات مميزة</div>';
}

function renderProducts() {
  const cat    = document.getElementById('filterCategory')?.value ?? 'all';
  const sort   = document.getElementById('filterSort')?.value ?? 'default';
  const search = (document.getElementById('filterSearch')?.value ?? '').toLowerCase();
  let filtered = allProducts.filter(p =>
    (cat === 'all' || p.category_id === cat) &&
    p.name.toLowerCase().includes(search)
  );
  if (sort === 'price-asc')  filtered.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') filtered.sort((a, b) => b.price - a.price);
  if (sort === 'rating')     filtered.sort((a, b) => b.rating - a.rating);
  const el = document.getElementById('shopProducts');
  if (!el) return;
  el.innerHTML = filtered.length
    ? filtered.map(productCard).join('')
    : '<div class="col-span-full text-center py-16 text-gray-500">لا توجد منتجات مطابقة</div>';
}

function renderPackages() {
  const el = document.getElementById('packagesGrid');
  if (!el) return;
  if (allPackages.length === 0) {
    el.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500">لا توجد حزم</div>';
    return;
  }
  el.innerHTML = allPackages.map(p => {
    const discount = p.old_price ? Math.round(((p.old_price - p.price) / p.old_price) * 100) : 0;
    return `
      <div class="bg-white rounded-3xl shadow-lg overflow-hidden product-card">
        <div class="bg-gradient-to-br ${esc(p.color_gradient)} p-8 text-center text-white relative">
          ${discount > 0 ? `<span class="absolute top-3 right-3 bg-white/90 text-red-600 text-xs px-3 py-1 rounded-full font-bold">وفّر ${discount}%</span>` : ''}
          <div class="text-7xl mb-2">${esc(p.icon)}</div>
          <div class="text-sm opacity-90">${esc(p.grade)}</div>
        </div>
        <div class="p-5">
          <h3 class="font-bold text-lg text-mishkat-blue-900 mb-2">${esc(p.name)}</h3>
          <div class="text-sm text-gray-600 mb-3">✓ تحتوي على ${esc(String(p.items_count))} منتج</div>
          <div class="flex items-baseline gap-2 mb-4">
            <span class="font-black text-2xl text-mishkat-blue-700">${esc(String(p.price))} د</span>
            ${p.old_price ? `<span class="text-gray-400 line-through">${esc(String(p.old_price))} د</span>` : ''}
          </div>
          <button onclick="addPackageToCart('${esc(p.id)}')" class="btn-primary text-white w-full py-3 rounded-xl font-bold">
            🛒 اطلب الحزمة
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// Cart
// ============================================================
function addToCart(productId) {
  productId = String(productId);
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  if (product.stock === 0) { toast('❌ هذا المنتج نفد من المخزون', 'warn'); return; }
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    if (existing.qty >= product.stock) { toast(`⚠️ الحد الأقصى المتوفر: ${product.stock}`, 'warn'); return; }
    existing.qty++;
  } else {
    cart.push({ id: productId, name: product.name, price: parseFloat(product.price), image: product.image, qty: 1 });
  }
  updateCartUI();
  toast(`✓ تمت إضافة ${product.name} للسلة`);
}

function addPackageToCart(packageId) {
  const pkg = allPackages.find(p => p.id === packageId);
  if (!pkg) return;
  const cartId = 'pkg-' + pkg.id;
  if (cart.find(i => i.id === cartId)) { toast('⚠️ الحزمة موجودة بالفعل في السلة', 'warn'); return; }
  cart.push({ id: cartId, name: pkg.name, price: parseFloat(pkg.price), image: pkg.icon, qty: 1 });
  updateCartUI();
  toast(`✓ تمت إضافة ${pkg.name} للسلة`);
}

function removeFromCart(id) {
  cart = cart.filter(i => i.id !== id);
  updateCartUI();
}

function changeQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  const product = allProducts.find(p => p.id === id);
  const maxStock = product?.stock ?? 999;
  item.qty = Math.min(maxStock, Math.max(1, item.qty + delta));
  updateCartUI();
}

function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const countEl = document.getElementById('cartCount');
  if (countEl) { countEl.textContent = count; countEl.classList.toggle('hidden', count === 0); }
  const totalEl = document.getElementById('cartTotal');
  if (totalEl) totalEl.textContent = total.toFixed(2) + ' دينار';
  const itemsEl = document.getElementById('cartItems');
  if (itemsEl) {
    itemsEl.innerHTML = cart.length === 0
      ? '<div class="text-center py-12 text-gray-500"><div class="text-6xl mb-3">🛒</div>السلة فارغة</div>'
      : cart.map(i => `
          <div class="flex items-center gap-3 bg-blue-50 p-3 rounded-xl">
            <div class="text-3xl">${esc(i.image)}</div>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm truncate">${esc(i.name)}</div>
              <div class="text-mishkat-blue-700 font-bold">${esc(String(i.price))} د</div>
            </div>
            <div class="flex items-center gap-1 bg-white rounded-lg">
              <button onclick="changeQty('${esc(i.id)}', -1)" class="w-7 h-7 hover:bg-gray-100 rounded-r-lg">−</button>
              <span class="w-6 text-center font-bold">${i.qty}</span>
              <button onclick="changeQty('${esc(i.id)}', 1)" class="w-7 h-7 hover:bg-gray-100 rounded-l-lg">+</button>
            </div>
            <button onclick="removeFromCart('${esc(i.id)}')" class="text-red-500 hover:text-red-700">🗑️</button>
          </div>
        `).join('');
  }
  saveCart();
}

function saveCart() {
  try { localStorage.setItem('almishkat_cart', JSON.stringify(cart)); } catch {}
}
function loadCart() {
  try { const s = localStorage.getItem('almishkat_cart'); if (s) cart = JSON.parse(s); } catch { cart = []; }
}
function toggleCart() {
  const drawer  = document.getElementById('cartDrawer');
  const content = document.getElementById('cartContent');
  if (!drawer || !content) return;
  if (drawer.classList.contains('hidden')) {
    drawer.classList.remove('hidden');
    setTimeout(() => content.style.transform = 'translateX(0)', 10);
  } else {
    content.style.transform = 'translateX(-100%)';
    setTimeout(() => drawer.classList.add('hidden'), 400);
  }
}

// ============================================================
// Checkout — الأسعار والخصم تُحسَب في السيرفر
// ============================================================
function openCheckoutModal() {
  if (cart.length === 0) { toast('⚠️ السلة فارغة', 'warn'); return; }
  appliedDiscount = null;
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  document.getElementById('coOriginalTotal').textContent = total.toFixed(2) + ' دينار';
  document.getElementById('coTotal').textContent         = total.toFixed(2) + ' دينار';
  document.getElementById('coDiscountLine')?.classList.add('hidden');
  if (document.getElementById('coDiscountInput')) document.getElementById('coDiscountInput').value = '';
  if (document.getElementById('discountResult')) document.getElementById('discountResult').textContent = '';
  document.getElementById('checkoutModal').classList.remove('hidden');
}
function closeCheckoutModal() {
  document.getElementById('checkoutModal').classList.add('hidden');
}

// ✅ الخصم يُعرَض تقديرياً فقط — السيرفر هو من يتحقق ويطبّق
async function previewDiscountCode() {
  const code = document.getElementById('coDiscountInput')?.value?.trim()?.toUpperCase();
  const resultEl = document.getElementById('discountResult');
  if (!code) { resultEl.textContent = '⚠️ أدخل كود الخصم'; return; }
  resultEl.textContent = '⌛ جاري التحقق...';

  // نُرسِل كود الخصم مع الطلب إلى السيرفر — لا نقرأ discount_codes مباشرة
  appliedDiscount = { code, percent: null }; // سيتأكد السيرفر من الكود
  resultEl.innerHTML = '<span class="text-green-600">✅ سيُطبَّق الخصم تلقائياً عند تأكيد الطلب</span>';
}

async function completeOrder(e) {
  e.preventDefault();
  const btn = document.getElementById('coSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> جاري التأكيد...';

  try {
    const payload = {
      cartItems:       cart.map(i => ({ id: i.id, qty: i.qty })),
      customerName:    document.getElementById('coName').value.trim(),
      customerPhone:   document.getElementById('coPhone').value.trim(),
      customerEmail:   document.getElementById('coEmail').value.trim() || null,
      deliveryAddress: document.getElementById('coAddress').value.trim(),
      paymentMethod:   document.querySelector('input[name="coPayment"]:checked')?.value,
      discountCode:    appliedDiscount?.code || null,
    };

    const res = await fetch(`${FUNCTIONS_URL}/place-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    const discountMsg = result.discountAmount > 0 ? ` | خصم: ${result.discountAmount.toFixed(2)} د` : '';
    toast(`🎉 تم تأكيد الطلب #${result.orderId}${discountMsg} | الإجمالي: ${result.total.toFixed(2)} د | ${result.earnedPoints} نقطة`, 'success', 6000);
    cart = []; updateCartUI(); closeCheckoutModal(); toggleCart();
    // تحديث المخزون في الذاكرة
    allProducts = allProducts.map(p => {
      const ordered = result.validatedItems?.find(i => i.id === p.id);
      return ordered ? { ...p, stock: Math.max(0, p.stock - ordered.qty) } : p;
    });
    e.target.reset();
  } catch (err) {
    toast('⚠️ ' + (err.message || 'فشل تأكيد الطلب'), 'warn', 5000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🎯 تأكيد الطلب';
  }
}

// ============================================================
// ✅ File Validation — فحص نوع وحجم الملفات
// ============================================================
const ALLOWED_MIME = [
  'image/jpeg','image/png','image/webp','image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
];
const MAX_FILE_SIZE_MB = 20;

function validateFiles(files) {
  const errors = [];
  for (const file of files) {
    if (!ALLOWED_MIME.includes(file.type)) {
      errors.push(`"${file.name}": نوع ملف غير مسموح`);
    } else if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      errors.push(`"${file.name}": الحجم يتجاوز ${MAX_FILE_SIZE_MB}MB`);
    }
  }
  return errors;
}

let selectedFiles = [];
function previewFiles(e) {
  const files  = Array.from(e.target.files);
  const errors = validateFiles(files);
  if (errors.length) { toast('⚠️ ' + errors.join(' | '), 'warn', 5000); e.target.value = ''; return; }
  selectedFiles = files;
  const preview = document.getElementById('filesPreview');
  if (!preview) return;
  preview.innerHTML = selectedFiles.map(f => `
    <div class="file-preview-item">
      <span>${f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
      <span class="truncate max-w-[150px]">${esc(f.name)}</span>
      <span class="text-xs text-gray-500">${(f.size/1024).toFixed(1)} KB</span>
    </div>
  `).join('');
}

function validatePrintFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const errors = validateFiles([file]);
  if (errors.length) {
    toast('⚠️ ' + errors[0], 'warn');
    e.target.value = '';
    document.getElementById('printFileName').textContent = '';
    return;
  }
  document.getElementById('printFileName').textContent = esc(file.name);
}

async function uploadFile(file, bucket, folder = '') {
  // Upload via Edge Function (uses service_role internally, bypasses anon RLS)
  const formData = new FormData();
  formData.append('bucket', bucket);
  formData.append('file', file);
  const res = await fetch(`${FUNCTIONS_URL}/upload-file`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY },
    body: formData,
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.error || 'فشل رفع الملف');
  return result.url;
}

// ============================================================
// Research Request
// ============================================================
function switchInputTab(type) {
  document.querySelectorAll('#requests-section .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + type)?.classList.add('active');
  document.getElementById('textInput')?.classList.toggle('hidden', type !== 'text');
  document.getElementById('voiceInput')?.classList.toggle('hidden', type !== 'voice');
}
function toggleAddress() {
  const val = document.querySelector('input[name="delivery"]:checked')?.value;
  document.getElementById('addressField')?.classList.toggle('hidden', val !== 'address');
}

let mediaRecorder = null, audioChunks = [], isRecording = false;
let recordSeconds = 0, recordInterval = null, recordedBlob = null;

async function toggleRecording() {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(recordedBlob);
        document.getElementById('audioPlayer').src = url;
        document.getElementById('audioPreview').classList.remove('hidden');
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      isRecording = true; recordSeconds = 0;
      document.getElementById('recordBtn').textContent = '⏹️';
      document.getElementById('recordBtn').classList.add('recording-pulse');
      document.getElementById('recordStatus').textContent = 'جاري التسجيل...';
      document.getElementById('waveform')?.classList.remove('hidden');
      document.getElementById('audioPreview')?.classList.add('hidden');
      recordInterval = setInterval(() => {
        recordSeconds++;
        const m = Math.floor(recordSeconds / 60).toString().padStart(2,'0');
        const s = (recordSeconds % 60).toString().padStart(2,'0');
        const el = document.getElementById('recordTimer');
        if (el) el.textContent = `${m}:${s}`;
        if (recordSeconds >= 300) toggleRecording(); // حد 5 دقائق
      }, 1000);
    } catch { toast('⚠️ السماح بالوصول للميكروفون مطلوب', 'warn'); }
  } else {
    mediaRecorder?.stop(); isRecording = false; clearInterval(recordInterval);
    document.getElementById('recordBtn').textContent = '🎙️';
    document.getElementById('recordBtn').classList.remove('recording-pulse');
    document.getElementById('recordStatus').textContent = '✓ تم التسجيل';
    document.getElementById('waveform')?.classList.add('hidden');
  }
}
function deleteRecording() {
  recordedBlob = null;
  document.getElementById('audioPreview')?.classList.add('hidden');
  document.getElementById('recordStatus').textContent = 'اضغط للبدء بالتسجيل';
  const t = document.getElementById('recordTimer'); if (t) t.textContent = '';
}

async function submitRequest(e) {
  e.preventDefault();
  const phone = document.getElementById('phone').value;
  if (!/^07[7-9][0-9]{7}$/.test(phone)) { toast('⚠️ رقم الهاتف غير صحيح', 'warn'); return; }
  const text = document.getElementById('requestText').value.trim();
  if (!text && !recordedBlob) { toast('⚠️ اكتب الطلب أو سجّله صوتياً', 'warn'); return; }
  const btn = document.getElementById('submitRequestBtn');
  btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> جاري الإرسال...';
  try {
    let voiceUrl = null;
    if (recordedBlob) {
      const f = new File([recordedBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
      voiceUrl = await uploadFile(f, 'voice-notes');
    }
    const attachments = [];
    for (const file of selectedFiles) {
      try { attachments.push({ name: file.name, url: await uploadFile(file, 'attachments'), size: file.size }); } catch {}
    }
    const { data, error } = await sb.from('research_requests').insert([{
      customer_name: document.getElementById('fullName').value,
      customer_phone: phone,
      customer_email: document.getElementById('email').value || null,
      user_type: document.getElementById('userType').value,
      request_type: document.querySelector('input[name="reqType"]:checked').value,
      description: text || null,
      voice_note_url: voiceUrl,
      attachments,
      delivery_method: document.querySelector('input[name="delivery"]:checked').value,
      delivery_address: document.getElementById('address').value || null,
      payment_method: document.querySelector('input[name="payment"]:checked').value,
      status: 'pending',
    }]).select();
    if (error) throw error;
    toast(`✓ تم استلام طلبك #${data[0].id} — سنتواصل معك خلال ساعة 🎉`, 'success', 5000);
    e.target.reset(); deleteRecording(); selectedFiles = [];
    document.getElementById('filesPreview').innerHTML = '';
    setTimeout(() => showSection('home'), 1500);
  } catch (err) {
    toast('⚠️ فشل الإرسال: ' + err.message, 'warn', 4000);
  } finally {
    btn.disabled = false; btn.innerHTML = '📤 إرسال الطلب';
  }
}

async function submitPrintOrder(e) {
  e.preventDefault();
  const file = document.getElementById('printFile').files[0];
  if (!file) { toast('⚠️ ارفع ملفاً للطباعة', 'warn'); return; }
  const fileErrors = validateFiles([file]);
  if (fileErrors.length) { toast('⚠️ ' + fileErrors[0], 'warn'); return; }
  const btn = document.getElementById('submitPrintBtn');
  btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> جاري الإرسال...';
  try {
    const fileUrl = await uploadFile(file, 'print-files');
    const { data, error } = await sb.from('print_orders').insert([{
      customer_name:    document.getElementById('printName').value,
      customer_phone:   document.getElementById('printPhone').value,
      file_url: fileUrl, file_name: file.name,
      print_type:   document.getElementById('printType').value,
      paper_size:   document.getElementById('printSize').value,
      copies:       parseInt(document.getElementById('printCopies').value),
      binding:      document.getElementById('printBinding').value,
      delivery_address: document.getElementById('printAddress').value || null,
      notes:        document.getElementById('printNotes').value || null,
      status: 'pending',
    }]).select();
    if (error) throw error;
    toast(`✓ تم استلام طلب الطباعة #${data[0].id}!`, 'success', 4000);
    e.target.reset(); document.getElementById('printFileName').textContent = '';
    setTimeout(() => showSection('home'), 1500);
  } catch (err) {
    toast('⚠️ فشل الإرسال: ' + err.message, 'warn', 4000);
  } finally {
    btn.disabled = false; btn.innerHTML = '🖨️ تأكيد طلب الطباعة';
  }
}

async function submitTeacherForm(e) {
  e.preventDefault();
  const btn = document.getElementById('submitTeacherBtn');
  btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> جاري التسجيل...';
  try {
    const applicationData = {
      full_name:   document.getElementById('tFullName').value,
      school_name: document.getElementById('tSchool').value,
      phone:       document.getElementById('tPhone').value,
      email:       document.getElementById('tEmail').value,
      subject:     document.getElementById('tSubject').value || null,
      governorate: document.getElementById('tGov').value || null,
      status: 'pending',
    };
    const { error } = await sb.from('teacher_applications').insert([applicationData]);
    if (error) throw error;
    try {
      const fnRes = await fetch(FUNCTIONS_URL + '/teacher-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ application: applicationData }),
      });
      const fnResult = await fnRes.json();
      if (fnResult.success && fnResult.discount_code) {
        toast('✅ تم التسجيل! كود الخصم: ' + fnResult.discount_code, 'success', 7000);
      } else {
        toast('✓ تم التسجيل! سنرسل لك كود الخصم خلال 24 ساعة', 'success', 4000);
      }
    } catch { toast('✓ تم التسجيل! سنرسل لك كود الخصم خلال 24 ساعة', 'success', 4000); }
    e.target.reset();
    setTimeout(() => showSection('home'), 1500);
  } catch (err) {
    toast('⚠️ فشل التسجيل: ' + err.message, 'warn', 4000);
  } finally {
    btn.disabled = false; btn.innerHTML = '✅ تسجيل حساب معلم';
  }
}

// ============================================================
// My Orders
// ============================================================
async function trackOrders() {
  const phone = document.getElementById('trackPhone')?.value?.trim();
  if (!phone) { toast('⚠️ أدخل رقم الهاتف', 'warn'); return; }
  if (!/^07[7-9][0-9]{7}$/.test(phone)) { toast('⚠️ رقم هاتف غير صحيح', 'warn'); return; }
  const resultEl = document.getElementById('myOrdersResult');
  resultEl.innerHTML = '<div class="text-center py-8">⏳ جاري البحث...</div>';
  try {
    const [orders, research, prints] = await Promise.all([
      sb.from('orders').select('*').eq('customer_phone', phone).order('created_at', { ascending: false }),
      sb.from('research_requests').select('*').eq('customer_phone', phone).order('created_at', { ascending: false }),
      sb.from('print_orders').select('*').eq('customer_phone', phone).order('created_at', { ascending: false }),
    ]);
    const all = [
      ...(orders.data||[]).map(o => ({ ...o, type:'shopping', icon:'🛒', label:'طلب شراء' })),
      ...(research.data||[]).map(r => ({ ...r, type:'research', icon:'📝', label:'طلب بحث' })),
      ...(prints.data||[]).map(p => ({ ...p, type:'print', icon:'🖨️', label:'طلب طباعة' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (all.length === 0) {
      resultEl.innerHTML = '<div class="bg-white p-8 rounded-2xl shadow-md text-center text-gray-500"><div class="text-5xl mb-3">📭</div>لا توجد طلبات</div>';
      return;
    }
    const statusMap = {
      pending:     { cls:'status-pending',     text:'قيد المراجعة' },
      confirmed:   { cls:'status-confirmed',   text:'تم التأكيد'   },
      preparing:   { cls:'status-preparing',   text:'قيد التحضير'  },
      reviewing:   { cls:'status-reviewing',   text:'قيد المراجعة' },
      in_progress: { cls:'status-in-progress', text:'قيد التنفيذ'  },
      printing:    { cls:'status-printing',    text:'يُطبع الآن'   },
      ready:       { cls:'status-ready',       text:'جاهز'         },
      delivered:   { cls:'status-delivered',   text:'تم التسليم'   },
      cancelled:   { cls:'status-cancelled',   text:'ملغي'         },
    };
    resultEl.innerHTML = all.map(o => {
      const s = statusMap[o.status] ?? statusMap.pending;
      return `
        <div class="bg-white p-5 rounded-2xl shadow-md mb-3">
          <div class="flex justify-between items-start mb-2">
            <div class="flex items-center gap-2">
              <span class="text-2xl">${o.icon}</span>
              <div>
                <div class="font-bold text-mishkat-blue-900">${o.label} #${o.id}</div>
                <div class="text-xs text-gray-500">${new Date(o.created_at).toLocaleString('ar')}</div>
              </div>
            </div>
            <span class="${s.cls} px-3 py-1 rounded-full text-xs font-bold">${s.text}</span>
          </div>
          ${o.total ? `<div class="text-mishkat-blue-700 font-bold mt-2">المجموع: ${esc(String(o.total))} دينار</div>` : ''}
          ${o.request_type ? `<div class="text-sm text-gray-600 mt-1">نوع الطلب: ${esc(o.request_type)}</div>` : ''}
          ${o.file_name ? `<div class="text-sm text-gray-600 mt-1">الملف: ${esc(o.file_name)}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    resultEl.innerHTML = `<div class="bg-red-50 p-4 rounded-xl text-red-700">⚠️ خطأ في تحميل الطلبات</div>`;
  }
}

// ============================================================
// Toast — مع زر إغلاق يدوي
// ============================================================
function toast(msg, type = 'success', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const cls = { success:'toast-success', warn:'toast-warn', error:'toast-error' }[type] ?? 'toast-success';
  const el = document.createElement('div');
  el.className = `toast ${cls} text-white px-5 py-3 rounded-xl shadow-2xl font-semibold mb-2 max-w-md flex items-start gap-2`;
  el.innerHTML = `<span class="flex-1">${esc(msg)}</span><button onclick="this.parentElement.remove()" class="opacity-70 hover:opacity-100 text-lg leading-none">×</button>`;
  container.appendChild(el);
  const timer = setTimeout(() => {
    el.style.opacity = '0'; el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
  el.querySelector('button').addEventListener('click', () => clearTimeout(timer));
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  loadCategories();
  loadProducts();
  loadPackages();
  updateCartUI();

  document.getElementById('searchInput')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      showSection('shop');
      setTimeout(() => {
        document.getElementById('filterSearch').value = e.target.value;
        renderProducts();
      }, 100);
    }
  });
});

// ============================================================
// PWA — Service Worker & Push Notifications
// ============================================================
async function registerPWA() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    console.log('✅ Service Worker registered:', reg.scope);

    // تحقق من تحديثات الـ SW
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }
      });
    });
  } catch (err) {
    console.warn('SW registration failed:', err);
  }
}

function showUpdateBanner() {
  const banner = document.createElement('div');
  banner.className = 'fixed bottom-24 right-4 z-50 bg-mishkat-blue-800 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3';
  banner.innerHTML = `
    <span>🔄 يوجد تحديث جديد</span>
    <button onclick="window.location.reload()" class="bg-yellow-400 text-mishkat-blue-900 px-3 py-1 rounded-lg font-bold text-sm">تحديث الآن</button>
    <button onclick="this.parentElement.remove()" class="opacity-70 hover:opacity-100">✕</button>
  `;
  document.body.appendChild(banner);
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') return;
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    toast('🔔 سيتم إشعارك عند تحديث حالة طلباتك', 'success', 4000);
  }
}

// ── Install Prompt (A2HS) ─────────────────────────────────
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.classList.remove('hidden');
});

async function installApp() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') toast('✅ تم تثبيت التطبيق على هاتفك!', 'success', 4000);
  deferredInstall = null;
  document.getElementById('installBtn')?.classList.add('hidden');
}

window.addEventListener('appinstalled', () => {
  toast('📱 التطبيق جاهز للاستخدام بدون إنترنت!', 'success', 5000);
});

// Init PWA
window.addEventListener('load', () => {
  registerPWA();
  // اطلب إذن الإشعارات بعد 30 ثانية (لا تزعج المستخدم فور الدخول)
  setTimeout(requestNotificationPermission, 30_000);
});