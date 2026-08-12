const { useState, useEffect, useMemo, useRef } = React;
const h = React.createElement;

const API_URL = '/api/gas';
const CACHE_KEY = 'jastipperPro:v9:data';
const SETTINGS_CACHE_KEY = 'jastipperPro:v9:settings';

const DEFAULT_SETTINGS = {
  bankAccounts: [
    { bankName:'BCA', accountNumber:'1234567890', accountHolder:'Jastipper Pro', isPrimary:true },
    { bankName:'', accountNumber:'', accountHolder:'', isPrimary:false },
    { bankName:'', accountNumber:'', accountHolder:'', isPrimary:false },
    { bankName:'', accountNumber:'', accountHolder:'', isPrimary:false },
    { bankName:'', accountNumber:'', accountHolder:'', isPrimary:false }
  ],
  defaultCurrency:'AED',
  currencyRates:{ IDR:1, JPY:105, SGD:12000, USD:15500, SAR:4200, AED:4250, QAR:4250, KWD:51000, BHD:41500, OMR:40500 }
};

const formatIDR = (val) => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(val) || 0);
const formatNumber = (val, digits=2) => new Intl.NumberFormat('id-ID', { maximumFractionDigits:digits }).format(Number(val) || 0);
const formatForeign = (currency, val) => `${currency || ''} ${formatNumber(val, 2)}`.trim();
const formatDate = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', { day:'2-digit', month:'short', year:'numeric' }).format(d);
};
const formatDateTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(d);
};
const n = (v, fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v,min,max) => Math.min(max, Math.max(min,v));
const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g,' ').trim();
const safeJSONParse = (v, fallback=null) => { try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } };
const clone = (v) => JSON.parse(JSON.stringify(v));
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random()*10000)}`;
const bool = (v) => v === true || v === 1 || ['true','1','ya','yes'].includes(String(v || '').toLowerCase());
const slugify = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100);

const SMART_CASE_EXACT = {
  'aed':'AED', 'idr':'IDR', 'usd':'USD', 'jpy':'JPY', 'b-ready':'B-Ready', 'iphone':'iPhone', 'ipad':'iPad', 'ebay':'eBay'
};
function smartProductTitle(value) {
  const raw = String(value || '').trim().replace(/\s+/g,' ');
  if (!raw) return '';
  return raw.split(' ').map(token => {
    const lower = token.toLowerCase();
    if (SMART_CASE_EXACT[lower]) return SMART_CASE_EXACT[lower];
    if (/^[A-Z0-9]{2,6}$/.test(token)) return token;
    return token.split('-').map(part => {
      const key = part.toLowerCase();
      if (SMART_CASE_EXACT[key]) return SMART_CASE_EXACT[key];
      if (!part) return part;
      if (/^\d/.test(part)) return part.charAt(0) + part.slice(1).toLowerCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('-');
  }).join(' ');
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const source = Array.isArray(src.bankAccounts) ? src.bankAccounts : [];
  let bankAccounts = Array.from({length:5}, (_,i) => ({
    bankName: source[i]?.bankName || DEFAULT_SETTINGS.bankAccounts[i]?.bankName || '',
    accountNumber: source[i]?.accountNumber || DEFAULT_SETTINGS.bankAccounts[i]?.accountNumber || '',
    accountHolder: source[i]?.accountHolder || DEFAULT_SETTINGS.bankAccounts[i]?.accountHolder || '',
    isPrimary: !!source[i]?.isPrimary
  }));
  const usable = bankAccounts.findIndex(a => a.bankName && a.accountNumber);
  if (!bankAccounts.some(a => a.isPrimary) && usable >= 0) bankAccounts[usable].isPrimary = true;
  let found = false;
  bankAccounts = bankAccounts.map(a => {
    if (a.isPrimary && !found) { found = true; return a; }
    return {...a, isPrimary:false};
  });
  return {
    bankAccounts,
    defaultCurrency: src.defaultCurrency || DEFAULT_SETTINGS.defaultCurrency,
    currencyRates:{ ...DEFAULT_SETTINGS.currencyRates, ...(src.currencyRates || {}) }
  };
}

function effectivePurchased(order) {
  const q = Math.max(1, parseInt(order?.quantity,10) || 1);
  const p = Number(order?.purchasedQuantity);
  if (Number.isFinite(p) && String(order?.purchasedQuantity ?? '') !== '') return clamp(p,0,q);
  return order?.itemStatus === 'Dibeli' ? q : 0;
}
function effectivePacked(order) {
  const q = Math.max(1, parseInt(order?.quantity,10) || 1);
  const p = Number(order?.packedQuantity);
  if (Number.isFinite(p) && String(order?.packedQuantity ?? '') !== '') return clamp(p,0,q);
  return order?.packingStatus === 'Selesai' ? q : 0;
}
function getPaidAmount(order) {
  const selling = n(order?.sellingPriceIdr);
  const explicit = Number(order?.paidAmountIdr);
  if (Number.isFinite(explicit) && String(order?.paidAmountIdr ?? '') !== '') return clamp(explicit,0,Math.max(0,selling));
  const remaining = Number(order?.remainingBalanceIdr);
  if (Number.isFinite(remaining)) return Math.max(0, selling - remaining);
  return order?.paymentStatus === 'Lunas' ? selling : 0;
}
function normalizeOrder(order) {
  const q = Math.max(1, parseInt(order?.quantity,10) || 1);
  const cancelled = order?.itemStatus === 'Dibatalkan' || order?.cancelStatus === 'Dibatalkan';
  const purchased = effectivePurchased({...order, quantity:q});
  const packed = effectivePacked({...order, quantity:q});
  const selling = n(order?.sellingPriceIdr);
  const paid = getPaidAmount(order);
  const remaining = cancelled ? 0 : Math.max(0, selling - paid);
  const itemStatus = cancelled ? 'Dibatalkan' : purchased >= q ? 'Dibeli' : purchased > 0 ? 'Sebagian' : (order?.itemStatus || 'Menunggu');
  const paymentStatus = cancelled ? (paid > 0 ? 'Kredit/Refund' : 'Dibatalkan') : remaining === 0 && selling > 0 ? 'Lunas' : paid > 0 ? 'DP Diterima' : 'Belum Lunas';
  return {
    ...order,
    quantity:q,
    purchasedQuantity:purchased,
    packedQuantity:packed,
    itemStatus,
    packingStatus: packed >= q ? 'Selesai' : 'Belum',
    paidAmountIdr:paid,
    remainingBalanceIdr:remaining,
    paymentStatus,
    unit: order?.unit || 'pcs',
    actualBaseCostIdr:n(order?.actualBaseCostIdr),
    actualForeignCost:n(order?.actualForeignCost)
  };
}
function normalizeCatalogItem(item) {
  return {
    ...item,
    unit:item?.unit || 'pcs',
    aliases:item?.aliases || '',
    alternateStores:item?.alternateStores || '',
    isArchived:bool(item?.isArchived),
    isPublished:bool(item?.isPublished),
    availabilityStatus:item?.availabilityStatus || 'Pre-Order',
    slug:item?.slug || slugify(item?.name)
  };
}

function loadScript(src, globalName) {
  return new Promise((resolve,reject) => {
    if (globalName && window[globalName]) return resolve(window[globalName]);
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), {once:true});
      existing.addEventListener('error', reject, {once:true});
      return;
    }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.src = src;
    s.onload = () => resolve(globalName ? window[globalName] : true);
    s.onerror = () => reject(new Error('Gagal memuat library report'));
    document.head.appendChild(s);
  });
}

function Icon({name,size=20,className=''}) {
  const common = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round', className };
  const paths = {
    dashboard:[h('rect',{key:1,x:3,y:3,width:7,height:7,rx:2}),h('rect',{key:2,x:14,y:3,width:7,height:7,rx:2}),h('rect',{key:3,x:3,y:14,width:7,height:7,rx:2}),h('rect',{key:4,x:14,y:14,width:7,height:7,rx:2})],
    orders:[h('path',{key:1,d:'M8 6h13M8 12h13M8 18h13'}),h('path',{key:2,d:'M3 6h.01M3 12h.01M3 18h.01'})],
    shop:[h('path',{key:1,d:'M6 7V5a6 6 0 0112 0v2'}),h('path',{key:2,d:'M4 7h16l-1 14H5L4 7z'})],
    customers:[h('path',{key:1,d:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2'}),h('circle',{key:2,cx:9,cy:7,r:4}),h('path',{key:3,d:'M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75'})],
    catalog:[h('path',{key:1,d:'M20 12V5H4v14h9'}),h('path',{key:2,d:'M8 9h8M8 13h5'}),h('circle',{key:3,cx:18,cy:18,r:3}),h('path',{key:4,d:'M21 21l-1.5-1.5'})],
    add:[h('path',{key:1,d:'M12 5v14M5 12h14'})],
    search:[h('circle',{key:1,cx:11,cy:11,r:7}),h('path',{key:2,d:'M20 20l-3.5-3.5'})],
    settings:[h('path',{key:1,d:'M4 6h10m4 0h2M4 12h2m4 0h10M4 18h7m4 0h5M14 4v4M6 10v4m5 2v4'})],
    bank:[h('path',{key:1,d:'M3 10h18M5 10V8l7-4 7 4v2M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18'})],
    download:[h('path',{key:1,d:'M12 3v12m0 0l4-4m-4 4l-4-4M4 21h16'})],
    chevron:[h('path',{key:1,d:'M9 18l6-6-6-6'})],
    down:[h('path',{key:1,d:'M6 9l6 6 6-6'})],
    close:[h('path',{key:1,d:'M6 6l12 12M18 6L6 18'})],
    check:[h('path',{key:1,d:'M20 6L9 17l-5-5'})],
    wa:[h('path',{key:1,d:'M21 11.5a8.5 8.5 0 01-12.5 7.5L3 21l2-5.3A8.5 8.5 0 1121 11.5z'}),h('path',{key:2,d:'M8.5 8.5c.5 3 2 4.5 5 5'})],
    more:[h('circle',{key:1,cx:5,cy:12,r:1,fill:'currentColor',stroke:'none'}),h('circle',{key:2,cx:12,cy:12,r:1,fill:'currentColor',stroke:'none'}),h('circle',{key:3,cx:19,cy:12,r:1,fill:'currentColor',stroke:'none'})],
    warning:[h('path',{key:1,d:'M10.3 2.9L1.8 17a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 2.9a2 2 0 00-3.4 0z'}),h('path',{key:2,d:'M12 9v4M12 17h.01'})],
    box:[h('path',{key:1,d:'M21 8l-9 5-9-5 9-5 9 5z'}),h('path',{key:2,d:'M3 8v8l9 5 9-5V8M12 13v8'})],
    card:[h('rect',{key:1,x:3,y:5,width:18,height:14,rx:2}),h('path',{key:2,d:'M3 10h18M7 15h4'})],
    history:[h('path',{key:1,d:'M3 12a9 9 0 109-9 9 9 0 00-7.4 3.9L3 9'}),h('path',{key:2,d:'M3 4v5h5M12 7v5l3 2'})],
    map:[h('path',{key:1,d:'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1116 0z'}),h('circle',{key:2,cx:12,cy:10,r:2})],
    lock:[h('rect',{key:1,x:5,y:10,width:14,height:10,rx:2}),h('path',{key:2,d:'M8 10V7a4 4 0 018 0v3'})],
    unlock:[h('rect',{key:1,x:5,y:10,width:14,height:10,rx:2}),h('path',{key:2,d:'M8 10V7a4 4 0 017-2'})]
  };
  return h('svg', common, ...(paths[name] || paths.more));
}

function Toast({config}) {
  if (!config?.visible) return null;
  return h('div',{className:`fixed z-[3000] top-3 left-3 right-3 md:left-auto md:w-[390px] rounded-2xl px-4 py-3 shadow-xl text-white flex items-center gap-3 ${config.type==='error'?'bg-red-600':config.type==='warn'?'bg-amber-600':'bg-slate-950'}`},
    h(Icon,{name:config.type==='error'||config.type==='warn'?'warning':'check',size:20,className:'shrink-0'}),
    h('div',{className:'text-xs font-bold leading-relaxed flex-1'},config.message)
  );
}

function ConfirmModal({dialog,onClose}) {
  if (!dialog) return null;
  const danger = dialog.tone === 'danger';
  return h('div',{className:'fixed inset-0 z-[2500] bg-slate-950/50 backdrop-blur-sm p-4 flex items-center justify-center'},
    h('div',{className:'w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 fade-in'},
      h('div',{className:'flex gap-3 items-start'},
        h('div',{className:`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger?'bg-red-50 text-red-600':'bg-blue-50 text-blue-600'}`},h(Icon,{name:danger?'warning':'check',size:20})),
        h('div',{className:'min-w-0'},
          h('h3',{className:'font-black text-slate-900 text-base'},dialog.title || 'Konfirmasi'),
          h('p',{className:'text-xs text-slate-500 mt-1 leading-relaxed whitespace-pre-line'},dialog.message || '')
        )
      ),
      h('div',{className:'grid grid-cols-2 gap-2 mt-5'},
        h('button',{onClick:()=>{dialog.onCancel?.(); onClose();},className:'py-2.5 rounded-xl border border-slate-200 text-xs font-black text-slate-600'},dialog.cancelLabel || 'Batal'),
        h('button',{onClick:()=>{dialog.onConfirm?.();},className:`py-2.5 rounded-xl text-white text-xs font-black ${danger?'bg-red-600':'bg-slate-950'}`},dialog.confirmLabel || 'Lanjut')
      )
    )
  );
}

function ModalShell({title,subtitle,onClose,children,max='max-w-lg'}) {
  return h('div',{className:'fixed inset-0 z-[2200] bg-slate-950/55 backdrop-blur-sm flex flex-col justify-end sm:justify-center sm:p-4'},
    h('div',{className:`bg-white w-full ${max} mx-auto rounded-t-3xl sm:rounded-3xl shadow-2xl modal-sheet flex flex-col fade-in overflow-hidden`},
      h('div',{className:'px-4 pt-4 pb-3 border-b border-slate-100 flex items-start gap-3 shrink-0'},
        h('div',{className:'min-w-0 flex-1'},
          h('h3',{className:'font-black text-slate-900 text-base'},title),
          subtitle ? h('p',{className:'text-[10px] font-semibold text-slate-400 mt-0.5 leading-relaxed'},subtitle) : null
        ),
        h('button',{onClick:onClose,className:'tap-target w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0'},h(Icon,{name:'close',size:18}))
      ),
      h('div',{className:'overflow-y-auto no-scrollbar flex-1'},children)
    )
  );
}

function Field({label,children,hint}) {
  return h('label',{className:'block'},
    h('span',{className:'block text-[9px] uppercase tracking-wider font-black text-slate-400 mb-1'},label),
    children,
    hint ? h('span',{className:'block text-[9px] text-slate-400 mt-1 leading-relaxed'},hint) : null
  );
}

function EmptyState({title,subtitle}) {
  return h('div',{className:'compact-card py-8 px-4 text-center'},
    h('div',{className:'mx-auto w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-2'},h(Icon,{name:'box',size:20})),
    h('div',{className:'text-xs font-black text-slate-700'},title),
    subtitle ? h('div',{className:'text-[10px] text-slate-400 mt-1'},subtitle) : null
  );
}

function App() {
  const initialCacheRef = useRef((() => {
    const cached = safeJSONParse(localStorage.getItem(CACHE_KEY));
    if (!cached || !Array.isArray(cached.trips)) return null;
    return {
      ...cached,
      catalog:(cached.catalog || []).map(normalizeCatalogItem),
      orders:(cached.orders || []).map(normalizeOrder),
      payments:Array.isArray(cached.payments) ? cached.payments : [],
      adjustments:Array.isArray(cached.adjustments) ? cached.adjustments : [],
      priceHistory:Array.isArray(cached.priceHistory) ? cached.priceHistory : [],
      shoppingSessions:Array.isArray(cached.shoppingSessions) ? cached.shoppingSessions : [],
      purchaseBatches:Array.isArray(cached.purchaseBatches) ? cached.purchaseBatches : []
    };
  })());
  const initial = initialCacheRef.current;
  const localSettings = safeJSONParse(localStorage.getItem(SETTINGS_CACHE_KEY));

  const [settings,setSettings] = useState(() => normalizeSettings(initial?.settings || localSettings || DEFAULT_SETTINGS));
  const [settingsDraft,setSettingsDraft] = useState(() => normalizeSettings(initial?.settings || localSettings || DEFAULT_SETTINGS));
  const [trips,setTrips] = useState(() => initial?.trips || []);
  const [activeTripId,setActiveTripId] = useState(() => initial?.activeTripId || null);
  const [customers,setCustomers] = useState(() => initial?.customers || []);
  const [catalog,setCatalog] = useState(() => initial?.catalog || []);
  const [orders,setOrders] = useState(() => initial?.orders || []);
  const [payments,setPayments] = useState(() => initial?.payments || []);
  const [adjustments,setAdjustments] = useState(() => initial?.adjustments || []);
  const [priceHistory,setPriceHistory] = useState(() => initial?.priceHistory || []);
  const [shoppingSessions,setShoppingSessions] = useState(() => initial?.shoppingSessions || []);
  const [purchaseBatches,setPurchaseBatches] = useState(() => initial?.purchaseBatches || []);

  const [currentTab,setCurrentTab] = useState('dashboard');
  const [summaryTripId,setSummaryTripId] = useState(() => initial?.activeTripId || null);
  const [searchQuery,setSearchQuery] = useState('');
  const [globalSearchQuery,setGlobalSearchQuery] = useState('');
  const [filters,setFilters] = useState({shopping:'ALL',payment:'ALL',packing:'ALL'});
  const [orderSort,setOrderSort] = useState('priority');
  const [shopGroupBy,setShopGroupBy] = useState('store');
  const [shopSearch,setShopSearch] = useState('');
  const [showArchivedProducts,setShowArchivedProducts] = useState(false);
  const [selectedOrderIds,setSelectedOrderIds] = useState([]);
  const [bulkAction,setBulkAction] = useState({item:'',payment:'',packing:''});
  const [modalType,setModalType] = useState(null);
  const [confirmDialog,setConfirmDialog] = useState(null);
  const [toast,setToast] = useState({visible:false,message:'',type:'success'});
  const [syncStatus,setSyncStatus] = useState(initial ? 'cached' : 'connecting');
  const [lastSyncAt,setLastSyncAt] = useState(initial?.savedAt || null);
  const [initialBlocking,setInitialBlocking] = useState(!initial);
  const [globalLoading,setGlobalLoading] = useState(false);
  const [editingId,setEditingId] = useState(null);
  const [selectedCustomer,setSelectedCustomer] = useState(null);
  const [selectedOrder,setSelectedOrder] = useState(null);
  const [activeWAGroup,setActiveWAGroup] = useState(null);
  const [waMode,setWaMode] = useState('auto');
  const [waPreview,setWaPreview] = useState('');
  const [waBankIndexes,setWaBankIndexes] = useState([]);
  const [waQueue,setWaQueue] = useState([]);
  const [bulkWhatsAppText,setBulkWhatsAppText] = useState('');
  const [undoState,setUndoState] = useState(null);
  const undoTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const cacheTimerRef = useRef(null);
  const [archivedEditTripId,setArchivedEditTripId] = useState(null);

  const [orderForm,setOrderForm] = useState({});
  const [customerForm,setCustomerForm] = useState({});
  const [catalogForm,setCatalogForm] = useState({});
  const [tripForm,setTripForm] = useState({title:'',destination:''});
  const [paymentForm,setPaymentForm] = useState({amount:'',method:'Transfer',bankAccountId:'',note:''});
  const [adjustmentForm,setAdjustmentForm] = useState({shippingFee:'',packingFee:'',otherFee:'',discount:'',note:''});
  const [purchaseTarget,setPurchaseTarget] = useState(null);
  const [purchaseForm,setPurchaseForm] = useState({quantity:'',unitForeignCost:'',currency:'AED',exchangeRate:'',store:''});
  const [packingGroup,setPackingGroup] = useState(null);
  const [packingDraft,setPackingDraft] = useState({});
  const [sessionForm,setSessionForm] = useState({store:'',note:''});
  const [lastSessionSummary,setLastSessionSummary] = useState(null);
  const [reportBusy,setReportBusy] = useState(false);

  const activeTrip = useMemo(() => trips.find(t => String(t.id) === String(activeTripId)) || null,[trips,activeTripId]);
  const activeOrders = useMemo(() => orders.filter(o => String(o.tripId) === String(activeTripId)),[orders,activeTripId]);
  const activePayments = useMemo(() => payments.filter(p => String(p.tripId) === String(activeTripId)),[payments,activeTripId]);
  const activeAdjustments = useMemo(() => adjustments.filter(a => String(a.tripId) === String(activeTripId)),[adjustments,activeTripId]);
  const activeSession = useMemo(() => shoppingSessions.find(s => String(s.tripId) === String(activeTripId) && s.status === 'Aktif') || null,[shoppingSessions,activeTripId]);
  const tripReadOnly = !!(activeTrip && activeTrip.status === 'Selesai' && String(archivedEditTripId) !== String(activeTrip.id));

  const showToast = (message,type='success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({visible:true,message,type});
    toastTimerRef.current = setTimeout(() => setToast(t => ({...t,visible:false})),3200);
  };

  const callAPI = async (action,payload={},opts={}) => {
    let retries = Number.isInteger(opts.retries) ? opts.retries : 1;
    while (retries >= 0) {
      try {
        const r = await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({action,...payload})});
        const text = await r.text();
        let json;
        try { json = JSON.parse(text); } catch (_) { throw new Error(`Respons server tidak valid (HTTP ${r.status})`); }
        if (!r.ok || json.status !== 'success') throw new Error(json.message || `Server error HTTP ${r.status}`);
        return json.data;
      } catch (err) {
        if (retries <= 0) {
          if (!opts.silent) showToast(err.message || 'Gagal menghubungi server','error');
          throw err;
        }
        retries--;
        await new Promise(res => setTimeout(res,350));
      }
    }
  };

  const writeCache = (snapshot=null) => {
    try {
      const data = snapshot || {
        version:9,savedAt:Date.now(),trips,activeTripId,customers,catalog,orders,payments,adjustments,priceHistory,shoppingSessions,purchaseBatches,settings
      };
      localStorage.setItem(CACHE_KEY,JSON.stringify(data));
      localStorage.setItem(SETTINGS_CACHE_KEY,JSON.stringify(data.settings || settings));
    } catch (_) {}
  };

  const mergeOrders = (incoming) => {
    if (!Array.isArray(incoming) || !incoming.length) return;
    const map = new Map(orders.map(o => [String(o.id),o]));
    incoming.map(normalizeOrder).forEach(o => map.set(String(o.id),o));
    setOrders(Array.from(map.values()));
  };

  const applyServerData = (res) => {
    if (!res) return;
    const nextTrips = Array.isArray(res.trips) ? res.trips : [];
    const nextCustomers = Array.isArray(res.customers) ? res.customers : [];
    const nextCatalog = Array.isArray(res.catalog) ? res.catalog.map(normalizeCatalogItem) : [];
    const nextOrders = Array.isArray(res.orders) ? res.orders.map(normalizeOrder) : [];
    const nextPayments = Array.isArray(res.payments) ? res.payments : [];
    const nextAdjustments = Array.isArray(res.adjustments) ? res.adjustments : [];
    const nextHistory = Array.isArray(res.priceHistory) ? res.priceHistory : [];
    const nextSessions = Array.isArray(res.shoppingSessions) ? res.shoppingSessions : [];
    const nextBatches = Array.isArray(res.purchaseBatches) ? res.purchaseBatches : [];
    const nextSettings = res.settings ? normalizeSettings(res.settings) : settings;
    setTrips(nextTrips); setCustomers(nextCustomers); setCatalog(nextCatalog); setOrders(nextOrders);
    setPayments(nextPayments); setAdjustments(nextAdjustments); setPriceHistory(nextHistory); setShoppingSessions(nextSessions); setPurchaseBatches(nextBatches);
    if (res.settings) { setSettings(nextSettings); setSettingsDraft(clone(nextSettings)); }
    const resolved = nextTrips.some(t => String(t.id) === String(activeTripId)) ? activeTripId : ((nextTrips.find(t=>t.status==='Aktif') || nextTrips[0])?.id || null);
    setActiveTripId(resolved);
    setSummaryTripId(prev => nextTrips.some(t=>String(t.id)===String(prev)) ? prev : resolved);
    const now = Date.now(); setLastSyncAt(now);
    writeCache({version:9,savedAt:now,trips:nextTrips,activeTripId:resolved,customers:nextCustomers,catalog:nextCatalog,orders:nextOrders,payments:nextPayments,adjustments:nextAdjustments,priceHistory:nextHistory,shoppingSessions:nextSessions,purchaseBatches:nextBatches,settings:nextSettings});
  };

  const refreshFromServer = async ({silent=true}={}) => {
    setSyncStatus('syncing');
    try {
      const res = await callAPI('getAllData',{}, {silent,retries:1});
      applyServerData(res); setSyncStatus('synced'); return res;
    } catch (_) {
      setSyncStatus(initialCacheRef.current ? 'cached' : 'error'); return null;
    } finally { setInitialBlocking(false); }
  };

  useEffect(() => { refreshFromServer({silent:!!initialCacheRef.current}); },[]);
  useEffect(() => {
    if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);
    cacheTimerRef.current = setTimeout(() => writeCache(),180);
    return () => cacheTimerRef.current && clearTimeout(cacheTimerRef.current);
  },[trips,activeTripId,customers,catalog,orders,payments,adjustments,priceHistory,shoppingSessions,purchaseBatches,settings]);

  const registerUndo = (label,handler) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({label,handler});
    undoTimerRef.current = setTimeout(() => setUndoState(null),8000);
  };
  const doUndo = async () => {
    if (!undoState) return;
    const task = undoState; setUndoState(null);
    try { await task.handler(); showToast('Perubahan dibatalkan'); } catch (e) { showToast(`Undo gagal: ${e.message}`,'error'); }
  };

  const adjustmentFor = (customerId,tripId=activeTripId) => adjustments.find(a => String(a.customerId)===String(customerId) && String(a.tripId)===String(tripId)) || null;
  const paymentsFor = (customerId,tripId=activeTripId) => payments.filter(p => String(p.customerId)===String(customerId) && String(p.tripId)===String(tripId));
  const netPaidFor = (customerId,tripId=activeTripId) => paymentsFor(customerId,tripId).reduce((s,p)=>s+n(p.amount),0);
  const orderGoodsTotalFor = (customerId,tripId=activeTripId) => orders.filter(o => String(o.customerId)===String(customerId) && String(o.tripId)===String(tripId) && o.itemStatus!=='Dibatalkan').reduce((s,o)=>s+n(o.sellingPriceIdr),0);
  const adjustmentNet = (a) => a ? n(a.shippingFee)+n(a.packingFee)+n(a.otherFee)-n(a.discount) : 0;
  const totalBillFor = (customerId,tripId=activeTripId) => Math.max(0,orderGoodsTotalFor(customerId,tripId)+adjustmentNet(adjustmentFor(customerId,tripId)));
  const outstandingFor = (customerId,tripId=activeTripId) => Math.max(0,totalBillFor(customerId,tripId)-netPaidFor(customerId,tripId));
  const creditFor = (customerId,tripId=activeTripId) => Math.max(0,netPaidFor(customerId,tripId)-totalBillFor(customerId,tripId));

  const activeNonCancelled = useMemo(() => activeOrders.filter(o => o.itemStatus !== 'Dibatalkan'),[activeOrders]);

  const stats = useMemo(() => {
    const customersSet = new Set(activeNonCancelled.map(o=>String(o.customerId)));
    const units = activeNonCancelled.reduce((s,o)=>s+n(o.quantity,1),0);
    const goodsRevenue = activeNonCancelled.reduce((s,o)=>s+n(o.sellingPriceIdr),0);
    const adjustmentTotal = activeAdjustments.reduce((s,a)=>s+adjustmentNet(a),0);
    const revenue = Math.max(0,goodsRevenue+adjustmentTotal);
    let projectedCost = 0, actualCost = 0, actualQty = 0;
    activeNonCancelled.forEach(o => {
      const q = Math.max(1,n(o.quantity,1));
      const purchased = effectivePurchased(o);
      const estimatedTotal = n(o.baseCostIdr) || (n(o.foreignAmount)*n(o.exchangeRate,1)*q);
      const estUnit = q > 0 ? estimatedTotal/q : 0;
      const actual = n(o.actualBaseCostIdr);
      actualCost += actual;
      actualQty += purchased;
      projectedCost += actual + Math.max(0,q-purchased)*estUnit;
    });
    const paid = activePayments.reduce((s,p)=>s+n(p.amount),0);
    return {
      tripCustomers:customersSet.size,
      orderTypes:activeNonCancelled.length,
      totalUnits:units,
      catalogCount:catalog.filter(c=>!c.isArchived).length,
      goodsRevenue, adjustmentTotal, revenue, projectedCost, actualCost, actualQty,
      profit:revenue-projectedCost,
      paid,
      outstanding:Math.max(0,revenue-paid),
      credit:Math.max(0,paid-revenue)
    };
  },[activeNonCancelled,activeAdjustments,activePayments,catalog]);

  const actionStats = useMemo(() => {
    const unboughtUnits = activeNonCancelled.reduce((s,o)=>s+Math.max(0,n(o.quantity,1)-effectivePurchased(o)),0);
    const unpackedUnits = activeNonCancelled.reduce((s,o)=>s+Math.max(0,n(o.quantity,1)-effectivePacked(o)),0);
    const customerIds = Array.from(new Set(activeNonCancelled.map(o=>String(o.customerId))));
    let unpaid = 0, partial = 0, paid = 0;
    customerIds.forEach(id => {
      const bill = totalBillFor(id); const p = netPaidFor(id);
      if (p <= 0 && bill > 0) unpaid++;
      else if (p > 0 && p < bill) partial++;
      else if (bill > 0 && p >= bill) paid++;
    });
    const boughtUnits = Math.max(0,stats.totalUnits-unboughtUnits);
    const packedUnits = Math.max(0,stats.totalUnits-unpackedUnits);
    return {
      unboughtUnits,unpackedUnits,unpaidCustomers:unpaid,partialCustomers:partial,paidCustomers:paid,
      shoppingProgress:stats.totalUnits ? Math.round(boughtUnits/stats.totalUnits*100) : 0,
      paymentProgress:stats.revenue ? Math.round(Math.min(stats.paid,stats.revenue)/stats.revenue*100) : 0,
      packingProgress:stats.totalUnits ? Math.round(packedUnits/stats.totalUnits*100) : 0
    };
  },[activeNonCancelled,stats,activePayments,activeAdjustments]);

  const healthIssues = useMemo(() => {
    const issues = [];
    const duplicateMap = new Map();
    catalog.filter(c=>!c.isArchived).forEach(c => {
      const key = norm(c.name);
      if (!key) return;
      duplicateMap.set(key,(duplicateMap.get(key)||0)+1);
    });
    const duplicates = Array.from(duplicateMap.values()).filter(v=>v>1).reduce((s,v)=>s+v,0);
    if (duplicates) issues.push({type:'catalog',severity:'warn',label:`${duplicates} produk katalog berpotensi duplikat`});
    const missingWA = new Set(activeNonCancelled.filter(o=>!String(o.whatsapp||'').trim()).map(o=>String(o.customerId))).size;
    if (missingWA) issues.push({type:'customer',severity:'warn',label:`${missingWA} pelanggan belum punya nomor WhatsApp`});
    const missingCost = activeNonCancelled.filter(o => n(o.baseCostIdr)<=0 && n(o.foreignAmount)<=0 && n(o.actualBaseCostIdr)<=0).length;
    if (missingCost) issues.push({type:'cost',severity:'warn',label:`${missingCost} pesanan belum memiliki modal`});
    const lossRows = activeNonCancelled.filter(o => {
      const projected = n(o.actualBaseCostIdr) || n(o.baseCostIdr);
      return projected > 0 && n(o.sellingPriceIdr) < projected;
    }).length;
    if (lossRows) issues.push({type:'loss',severity:'error',label:`${lossRows} pesanan harga jual lebih rendah dari modal`});
    const badResi = activeNonCancelled.filter(o => String(o.trackingNumber||'').trim() && effectivePacked(o) < n(o.quantity,1)).length;
    if (badResi) issues.push({type:'packing',severity:'warn',label:`${badResi} pesanan punya resi tetapi packing belum selesai`});
    const refundRows = activeOrders.filter(o=>o.itemStatus==='Dibatalkan' && o.refundStatus==='Diperlukan').length;
    if (refundRows) issues.push({type:'refund',severity:'error',label:`${refundRows} pesanan masih membutuhkan refund`});
    const credits = Array.from(new Set(activeOrders.map(o=>String(o.customerId)))).filter(id=>creditFor(id)>0).length;
    if (credits) issues.push({type:'credit',severity:'warn',label:`${credits} pelanggan memiliki kelebihan pembayaran/kredit`});
    return issues;
  },[catalog,activeNonCancelled,activeOrders,activePayments,activeAdjustments]);

  const orderMatchesFilters = (o) => {
    if (o.itemStatus === 'Dibatalkan' && filters.shopping !== 'CANCELLED') return false;
    if (filters.shopping === 'TODO' && effectivePurchased(o) >= n(o.quantity,1)) return false;
    if (filters.shopping === 'MENUNGGU' && o.itemStatus !== 'Menunggu') return false;
    if (filters.shopping === 'DICARI' && o.itemStatus !== 'Dicari') return false;
    if (filters.shopping === 'SEBAGIAN' && o.itemStatus !== 'Sebagian') return false;
    if (filters.shopping === 'DIBELI' && o.itemStatus !== 'Dibeli') return false;
    if (filters.shopping === 'CANCELLED' && o.itemStatus !== 'Dibatalkan') return false;
    const paid = getPaidAmount(o), remaining = n(o.remainingBalanceIdr);
    if (filters.payment === 'UNPAID' && !(paid <= 0 && n(o.sellingPriceIdr)>0)) return false;
    if (filters.payment === 'PARTIAL' && !(paid > 0 && remaining > 0)) return false;
    if (filters.payment === 'PAID' && !(remaining <= 0 && n(o.sellingPriceIdr)>0)) return false;
    if (filters.payment === 'OUTSTANDING' && !(remaining > 0)) return false;
    if (filters.packing === 'UNPACKED' && !(effectivePacked(o) < n(o.quantity,1))) return false;
    if (filters.packing === 'DONE' && !(effectivePacked(o) >= n(o.quantity,1))) return false;
    return true;
  };

  const priorityScore = (items,customerId) => {
    let score = 0;
    if (items.some(o=>effectivePurchased(o)<n(o.quantity,1))) score += 40;
    if (outstandingFor(customerId)>0) score += 30;
    if (items.some(o=>effectivePacked(o)<n(o.quantity,1))) score += 20;
    if (items.some(o=>o.refundStatus==='Diperlukan')) score += 50;
    return score;
  };

  const groupedOrders = useMemo(() => {
    const q = norm(searchQuery);
    const visible = activeOrders.filter(o => {
      if (!orderMatchesFilters(o)) return false;
      if (!q) return true;
      return norm(o.customerName).includes(q) || norm(o.itemName).includes(q) || norm(o.whatsapp).includes(q) || norm(o.trackingNumber).includes(q);
    });
    const map = new Map();
    visible.forEach(o => {
      const key = String(o.customerId || o.customerName);
      if (!map.has(key)) map.set(key,{customerId:o.customerId,customerName:o.customerName||'Tanpa Nama',whatsapp:o.whatsapp||'',items:[]});
      map.get(key).items.push(o);
    });
    const groups = Array.from(map.values()).map(g => {
      const all = activeOrders.filter(o=>String(o.customerId)===String(g.customerId));
      const activeAll = all.filter(o=>o.itemStatus!=='Dibatalkan');
      return {
        ...g,
        allItems:all,
        totalTypes:activeAll.length,
        totalUnits:activeAll.reduce((s,o)=>s+n(o.quantity,1),0),
        totalBill:totalBillFor(g.customerId),
        totalPaid:netPaidFor(g.customerId),
        totalUnpaid:outstandingFor(g.customerId),
        credit:creditFor(g.customerId),
        priority:priorityScore(activeAll,g.customerId)
      };
    });
    groups.forEach(g=>g.items.sort((a,b)=>String(a.itemName).localeCompare(String(b.itemName),'id')));
    if (orderSort === 'name') groups.sort((a,b)=>a.customerName.localeCompare(b.customerName,'id'));
    else if (orderSort === 'recent') groups.sort((a,b)=>Math.max(...b.items.map(x=>new Date(x.updatedAt||x.createdAt||0).getTime()))-Math.max(...a.items.map(x=>new Date(x.updatedAt||x.createdAt||0).getTime())));
    else groups.sort((a,b)=>b.priority-a.priority || a.customerName.localeCompare(b.customerName,'id'));
    return groups;
  },[activeOrders,searchQuery,filters,orderSort,payments,adjustments]);

  const customerGroupsAll = useMemo(() => {
    const map = new Map();
    activeOrders.forEach(o => {
      const key = String(o.customerId);
      if (!map.has(key)) map.set(key,{customerId:o.customerId,customerName:o.customerName||'',whatsapp:o.whatsapp||'',items:[]});
      map.get(key).items.push(o);
    });
    return Array.from(map.values()).map(g=>({
      ...g,
      allItems:g.items,
      totalTypes:g.items.filter(o=>o.itemStatus!=='Dibatalkan').length,
      totalUnits:g.items.filter(o=>o.itemStatus!=='Dibatalkan').reduce((s,o)=>s+n(o.quantity,1),0),
      totalBill:totalBillFor(g.customerId), totalPaid:netPaidFor(g.customerId), totalUnpaid:outstandingFor(g.customerId), credit:creditFor(g.customerId)
    }));
  },[activeOrders,payments,adjustments]);

  const filteredCustomers = useMemo(() => {
    const q = norm(searchQuery);
    return customers.filter(c => !q || norm(c.name).includes(q) || norm(c.whatsapp).includes(q) || norm(c.address).includes(q)).sort((a,b)=>String(a.name).localeCompare(String(b.name),'id'));
  },[customers,searchQuery]);

  const filteredCatalog = useMemo(() => {
    const q = norm(searchQuery);
    return catalog.filter(c => (showArchivedProducts || !c.isArchived) && (!q || [c.name,c.category,c.store,c.aliases,c.alternateStores].some(v=>norm(v).includes(q)))).sort((a,b)=>String(a.name).localeCompare(String(b.name),'id'));
  },[catalog,searchQuery,showArchivedProducts]);

  const shoppingProducts = useMemo(() => {
    const map = new Map();
    activeNonCancelled.forEach(o => {
      const cat = catalog.find(c=>String(c.id)===String(o.catalogId)) || catalog.find(c=>norm(c.name)===norm(o.itemName));
      const store = o.sourceStore || cat?.store || 'Tanpa Toko';
      const key = `${o.catalogId || norm(o.itemName)}|${store}`;
      if (!map.has(key)) map.set(key,{key,catalogId:o.catalogId||cat?.id||'',name:o.itemName,store,currency:o.foreignCurrency||cat?.currency||settings.defaultCurrency,estimatedCost:n(o.foreignAmount, n(cat?.foreignCost)),unit:o.unit||cat?.unit||'pcs',orders:[],required:0,purchased:0});
      const g = map.get(key);
      g.orders.push(o); g.required += n(o.quantity,1); g.purchased += effectivePurchased(o);
    });
    let list = Array.from(map.values()).map(g=>({...g,remaining:Math.max(0,g.required-g.purchased)}));
    const q = norm(shopSearch);
    if (q) list = list.filter(g=>norm(g.name).includes(q)||norm(g.store).includes(q));
    if (activeSession) list = list.filter(g=>norm(g.store)===norm(activeSession.store));
    return list.sort((a,b)=>a.store.localeCompare(b.store,'id') || a.name.localeCompare(b.name,'id'));
  },[activeNonCancelled,catalog,shopSearch,activeSession,settings]);

  const shoppingByStore = useMemo(() => {
    const map = new Map();
    shoppingProducts.forEach(p => {
      if (!map.has(p.store)) map.set(p.store,{store:p.store,items:[],required:0,purchased:0,remaining:0});
      const g = map.get(p.store); g.items.push(p); g.required+=p.required; g.purchased+=p.purchased; g.remaining+=p.remaining;
    });
    return Array.from(map.values()).sort((a,b)=>a.store.localeCompare(b.store,'id'));
  },[shoppingProducts]);

  const summaryTrip = trips.find(t=>String(t.id)===String(summaryTripId||activeTripId)) || activeTrip;
  const summaryOrders = useMemo(() => orders.filter(o=>String(o.tripId)===String(summaryTrip?.id)),[orders,summaryTrip?.id]);
  const summaryData = useMemo(() => {
    const tripId = summaryTrip?.id;
    const active = summaryOrders.filter(o=>o.itemStatus!=='Dibatalkan');
    const adj = adjustments.filter(a=>String(a.tripId)===String(tripId));
    const pay = payments.filter(p=>String(p.tripId)===String(tripId));
    const revenueGoods = active.reduce((s,o)=>s+n(o.sellingPriceIdr),0);
    const adjNet = adj.reduce((s,a)=>s+adjustmentNet(a),0);
    const revenue = Math.max(0,revenueGoods+adjNet);
    let projectedCost=0, actualCost=0, purchasedUnits=0;
    active.forEach(o=>{
      const q=n(o.quantity,1), p=effectivePurchased(o), est=n(o.baseCostIdr) || n(o.foreignAmount)*n(o.exchangeRate,1)*q, estUnit=q?est/q:0, actual=n(o.actualBaseCostIdr);
      projectedCost += actual + Math.max(0,q-p)*estUnit; actualCost += actual; purchasedUnits += p;
    });
    const paid = pay.reduce((s,p)=>s+n(p.amount),0);
    const customerIds = Array.from(new Set(active.map(o=>String(o.customerId))));
    const customerBreakdown = customerIds.map(id=>{
      const rows=active.filter(o=>String(o.customerId)===id); const customer=customers.find(c=>String(c.id)===id);
      const bill=Math.max(0,rows.reduce((s,o)=>s+n(o.sellingPriceIdr),0)+adjustmentNet(adj.find(a=>String(a.customerId)===id)));
      const p=pay.filter(x=>String(x.customerId)===id).reduce((s,x)=>s+n(x.amount),0);
      const cost=rows.reduce((s,o)=>s+(n(o.actualBaseCostIdr)||n(o.baseCostIdr)),0);
      return {id,name:customer?.name||rows[0]?.customerName||'-',rows:rows.length,units:rows.reduce((s,o)=>s+n(o.quantity,1),0),revenue:bill,paid:p,outstanding:Math.max(0,bill-p),margin:bill-cost};
    }).sort((a,b)=>b.revenue-a.revenue);
    const productMap=new Map();
    active.forEach(o=>{const k=norm(o.itemName); if(!productMap.has(k))productMap.set(k,{name:o.itemName,qty:0,revenue:0}); const g=productMap.get(k);g.qty+=n(o.quantity,1);g.revenue+=n(o.sellingPriceIdr);});
    const products=Array.from(productMap.values()).sort((a,b)=>b.qty-a.qty);
    return {
      customersCount:customerIds.length,orderTypes:active.length,units:active.reduce((s,o)=>s+n(o.quantity,1),0),revenue,revenueGoods,adjustmentNet:adjNet,
      projectedCost,actualCost,profit:revenue-projectedCost,paid,outstanding:Math.max(0,revenue-paid),credit:Math.max(0,paid-revenue),purchasedUnits,
      cancelled:summaryOrders.filter(o=>o.itemStatus==='Dibatalkan').length,refundDue:summaryOrders.filter(o=>o.refundStatus==='Diperlukan').reduce((s,o)=>s+n(o.refundAmountIdr),0),
      customerBreakdown,topCustomer:customerBreakdown[0]||null,topProduct:products[0]||null,products
    };
  },[summaryOrders,summaryTrip?.id,adjustments,payments,customers]);

  const globalResults = useMemo(() => {
    const q = norm(globalSearchQuery);
    if (!q) return [];
    const out=[];
    customers.filter(c=>[c.name,c.whatsapp,c.address].some(v=>norm(v).includes(q))).slice(0,6).forEach(c=>out.push({type:'Pelanggan',title:c.name,subtitle:c.whatsapp||c.address||'',action:()=>{setSearchQuery(c.name);setCurrentTab('customers');setModalType(null);}}));
    orders.filter(o=>[o.itemName,o.customerName,o.whatsapp,o.trackingNumber].some(v=>norm(v).includes(q))).slice(0,10).forEach(o=>out.push({type:'Pesanan',title:o.itemName,subtitle:`${o.customerName} • ${trips.find(t=>String(t.id)===String(o.tripId))?.title||'Trip'}`,action:()=>{setActiveTripId(o.tripId);setSearchQuery(o.customerName);setCurrentTab('orders');setModalType(null);}}));
    catalog.filter(c=>[c.name,c.aliases,c.store,c.category].some(v=>norm(v).includes(q))).slice(0,8).forEach(c=>out.push({type:'Produk',title:c.name,subtitle:`${c.store||'Tanpa toko'} • ${formatIDR(c.sellingPriceIdr)}`,action:()=>{setSearchQuery(c.name);setCurrentTab('catalog');setModalType(null);}}));
    trips.filter(t=>[t.title,t.destination].some(v=>norm(v).includes(q))).slice(0,5).forEach(t=>out.push({type:'Trip',title:t.title,subtitle:`${t.destination||''} • ${t.status}`,action:()=>{setActiveTripId(t.id);setModalType(null);setCurrentTab('dashboard');}}));
    return out.slice(0,24);
  },[globalSearchQuery,customers,orders,catalog,trips]);

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
  const tinyInputCls = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-800 outline-none focus:border-blue-500';

  const openAddOrder = (data=null) => {
    if (tripReadOnly) { showToast('Trip lama sedang read-only. Buka Edit Trip Lama jika memang ingin mengubahnya.','warn'); return; }
    setEditingId(data?.id || null);
    if (data) setOrderForm({...normalizeOrder(data)});
    else {
      const curr=settings.defaultCurrency||'AED';
      setOrderForm({
        id:'',customerId:'',catalogId:'',itemName:'',quantity:1,unit:'pcs',sourceStore:'',foreignCurrency:curr,foreignAmount:'',exchangeRate:n(settings.currencyRates[curr],1),
        markupPercent:30,sellingPriceIdr:'',paidAmountIdr:0,itemStatus:'Menunggu',packingStatus:'Belum',trackingNumber:''
      });
    }
    setModalType('ORDER_FORM');
  };
  const openCustomerForm = (data=null) => {
    setEditingId(data?.id || null);
    setCustomerForm(data ? {...data} : {id:'',name:'',whatsapp:'',notes:'',recipientName:'',shippingPhone:'',address:'',postalCode:'',shippingNote:''});
    setModalType('CUSTOMER_FORM');
  };
  const openCatalogForm = (data=null) => {
    setEditingId(data?.id || null);
    const curr=settings.defaultCurrency||'AED';
    setCatalogForm(data ? {...normalizeCatalogItem(data)} : {
      id:'',name:'',category:'Umum',store:'',currency:curr,foreignCost:'',markupPercent:30,sellingPriceIdr:'',unit:'pcs',alternateStores:'',aliases:'',
      isArchived:false,lastPurchaseCost:'',lastPurchaseCurrency:curr,lastPurchasedAt:'',isPublished:false,publicDescription:'',publicCategory:'',imageUrl:'',availabilityStatus:'Pre-Order',slug:''
    });
    setModalType('CATALOG_FORM');
  };
  const openCustomerDetail = (customer) => { setSelectedCustomer(customer); setModalType('CUSTOMER_DETAIL'); };
  const openOrderDetail = (order) => { setSelectedOrder(order); setModalType('ORDER_DETAIL'); };

  const selectCatalogForOrder = (catId) => {
    const item=catalog.find(c=>String(c.id)===String(catId));
    if (!item) return;
    const q=Math.max(1,n(orderForm.quantity,1));
    const rate=n(settings.currencyRates[item.currency],1);
    const base=n(item.foreignCost)*rate*q;
    const total=n(item.sellingPriceIdr)>0 ? n(item.sellingPriceIdr)*q : Math.round(base*(1+n(item.markupPercent)/100));
    setOrderForm(prev=>({...prev,catalogId:item.id,itemName:item.name,unit:item.unit||'pcs',sourceStore:item.store||'',foreignCurrency:item.currency||settings.defaultCurrency,foreignAmount:n(item.foreignCost),exchangeRate:rate,markupPercent:n(item.markupPercent),sellingPriceIdr:total}));
  };

  const handleOrderQty = (value) => {
    const q=Math.max(1,parseInt(value,10)||1);
    setOrderForm(prev=>{
      const oldQ=Math.max(1,n(prev.quantity,1));
      const cat=catalog.find(c=>String(c.id)===String(prev.catalogId));
      let selling=n(prev.sellingPriceIdr);
      if (cat && n(cat.sellingPriceIdr)>0) selling=n(cat.sellingPriceIdr)*q;
      else if (oldQ>0 && selling>0) selling=Math.round((selling/oldQ)*q);
      return {...prev,quantity:q,sellingPriceIdr:selling};
    });
  };

  const persistOrder = async () => {
    if (!orderForm.customerId || !String(orderForm.itemName||'').trim()) return showToast('Pelanggan dan nama barang wajib diisi','error');
    if (!activeTripId) return showToast('Pilih Trip terlebih dahulu','error');
    const customer=customers.find(c=>String(c.id)===String(orderForm.customerId));
    if (!customer) return showToast('Pelanggan tidak ditemukan','error');
    const q=Math.max(1,n(orderForm.quantity,1));
    const selling=Math.max(0,n(orderForm.sellingPriceIdr));
    const estimatedBase=n(orderForm.foreignAmount)*n(orderForm.exchangeRate,1)*q;
    const existing=editingId ? orders.find(o=>String(o.id)===String(editingId)) : null;
    const paid=existing ? getPaidAmount(existing) : n(orderForm.paidAmountIdr);
    const data=normalizeOrder({
      ...orderForm,
      itemName:smartProductTitle(orderForm.itemName),
      id:editingId||makeId('ORD'),tripId:activeTripId,customerId:customer.id,customerName:customer.name,whatsapp:customer.whatsapp||'',
      quantity:q,baseCostIdr:estimatedBase,sellingPriceIdr:selling,dpAmountIdr:Math.round(selling*.5),paidAmountIdr:paid,
      purchasedQuantity:existing?effectivePurchased(existing):0,packedQuantity:existing?effectivePacked(existing):0,
      actualBaseCostIdr:existing?n(existing.actualBaseCostIdr):0,actualForeignCost:existing?n(existing.actualForeignCost):0,
      cancelStatus:existing?.cancelStatus||'',cancelledAt:existing?.cancelledAt||'',refundAmountIdr:existing?.refundAmountIdr||0,refundStatus:existing?.refundStatus||'',
      createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()
    });
    setGlobalLoading(true); setSyncStatus('syncing');
    try {
      const res=await callAPI('saveOrder',{data});
      if (Array.isArray(res?.updatedOrders)) {
        setOrders(prev=>{
          const map=new Map(prev.map(o=>[String(o.id),o]));
          res.updatedOrders.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));
          if (!map.has(String(data.id))) map.set(String(data.id),data);
          return Array.from(map.values());
        });
      } else setOrders(prev=>editingId?prev.map(o=>String(o.id)===String(editingId)?data:o):[data,...prev]);
      setModalType(null); setSyncStatus('synced'); setLastSyncAt(Date.now()); showToast(editingId?'Pesanan diperbarui':'Pesanan baru dicatat');
    } catch (_) { setSyncStatus('error'); } finally { setGlobalLoading(false); }
  };

  const saveOrder = (e) => {
    e?.preventDefault?.();
    const q=Math.max(1,n(orderForm.quantity,1)); const selling=n(orderForm.sellingPriceIdr); const base=n(orderForm.foreignAmount)*n(orderForm.exchangeRate,1)*q;
    const existing=editingId?orders.find(o=>String(o.id)===String(editingId)):null;
    const warnings=[];
    if (base>0 && selling<base) warnings.push(`Harga jual ${formatIDR(selling)} lebih rendah dari estimasi modal ${formatIDR(base)}.`);
    if (q>50) warnings.push(`Qty ${q} cukup besar. Pastikan tidak salah input.`);
    if (existing && n(existing.sellingPriceIdr)>0 && Math.abs(selling-n(existing.sellingPriceIdr))/n(existing.sellingPriceIdr)>.5) warnings.push(`Harga berubah cukup besar dari ${formatIDR(existing.sellingPriceIdr)} menjadi ${formatIDR(selling)}.`);
    if (warnings.length) {
      setConfirmDialog({title:'Periksa Pesanan',tone:'action',message:warnings.join('\n')+'\n\nTetap simpan?',confirmLabel:'Simpan',onConfirm:()=>{setConfirmDialog(null);persistOrder();}}); return;
    }
    persistOrder();
  };

  const saveCustomer = async (e) => {
    e?.preventDefault?.();
    if (!String(customerForm.name||'').trim()) return showToast('Nama pelanggan wajib diisi','error');
    const data={...customerForm,id:editingId||makeId('CUST')};
    setGlobalLoading(true);
    try {
      await callAPI('saveCustomer',{data});
      setCustomers(prev=>editingId?prev.map(c=>String(c.id)===String(editingId)?data:c):[...prev,data]);
      setModalType(null); showToast(editingId?'Pelanggan diperbarui':'Pelanggan ditambahkan');
    } finally { setGlobalLoading(false); }
  };

  const persistCatalog = async (forceDuplicate=false) => {
    const cleanName=smartProductTitle(catalogForm.name);
    if (!cleanName) return showToast('Nama produk wajib diisi','error');
    const duplicate=catalog.find(c=>String(c.id)!==String(editingId||'') && norm(c.name)===norm(cleanName) && !c.isArchived);
    if (duplicate && !forceDuplicate) {
      setConfirmDialog({title:'Produk Serupa Sudah Ada',tone:'action',message:`${duplicate.name} sudah ada di Master Katalog.\n\nTetap buat produk terpisah?`,confirmLabel:'Tetap Simpan',onConfirm:()=>{setConfirmDialog(null);persistCatalog(true);}}); return;
    }
    const existing=editingId?catalog.find(c=>String(c.id)===String(editingId)):null;
    const data=normalizeCatalogItem({
      ...catalogForm,id:editingId||makeId('CAT'),name:cleanName,slug:catalogForm.slug||slugify(cleanName),updatedAt:new Date().toISOString()
    });
    const priceChanged=existing && (n(existing.sellingPriceIdr)!==n(data.sellingPriceIdr) || n(existing.foreignCost)!==n(data.foreignCost));
    setGlobalLoading(true); setSyncStatus('syncing');
    try {
      const saved=normalizeCatalogItem(await callAPI('saveCatalog',{data}));
      setCatalog(prev=>editingId?prev.map(c=>String(c.id)===String(editingId)?saved:c):[...prev,saved]);
      setModalType(null); setSyncStatus('synced'); setLastSyncAt(Date.now());
      showToast(priceChanged?'Katalog diperbarui. Harga lama tetap aman di transaksi & riwayat harga.':(editingId?'Katalog diperbarui':'Produk ditambahkan'));
      if (priceChanged) setTimeout(()=>refreshFromServer({silent:true}),250);
    } catch (_) { setSyncStatus('error'); } finally { setGlobalLoading(false); }
  };
  const saveCatalog = (e) => { e?.preventDefault?.(); persistCatalog(false); };

  const toggleArchiveProduct = async (product) => {
    const data={...normalizeCatalogItem(product),isArchived:!product.isArchived,updatedAt:new Date().toISOString()};
    setGlobalLoading(true);
    try {
      const saved=normalizeCatalogItem(await callAPI('saveCatalog',{data}));
      setCatalog(prev=>prev.map(c=>String(c.id)===String(product.id)?saved:c)); setModalType(null);
      showToast(saved.isArchived?'Produk diarsipkan':'Produk diaktifkan kembali');
    } finally { setGlobalLoading(false); }
  };

  const saveTrip = async (e) => {
    e?.preventDefault?.();
    if (!String(tripForm.title||'').trim()) return showToast('Nama Trip wajib diisi','error');
    const data={id:makeId('TRIP'),title:tripForm.title.trim(),destination:tripForm.destination.trim(),status:'Aktif',createdAt:new Date().toISOString(),closedAt:''};
    setGlobalLoading(true);
    try { await callAPI('saveTrip',{data}); setTrips(prev=>[...prev,data]); setActiveTripId(data.id); setSummaryTripId(data.id); setArchivedEditTripId(null); setModalType(null); showToast('Trip baru dibuat'); }
    finally { setGlobalLoading(false); }
  };

  const saveSettingsConfig = async () => {
    const next=normalizeSettings(settingsDraft); setSettings(next); setModalType(null); localStorage.setItem(SETTINGS_CACHE_KEY,JSON.stringify(next)); setSyncStatus('syncing');
    try { await callAPI('saveSettings',{settings:next},{silent:true}); setSyncStatus('synced'); setLastSyncAt(Date.now()); showToast('Pengaturan tersimpan'); }
    catch(e){setSyncStatus('error');showToast('Tersimpan lokal, sinkron server gagal','warn');}
  };

  const openPayment = (groupOrCustomer) => {
    const customerId=groupOrCustomer.customerId||groupOrCustomer.id;
    const customer=customers.find(c=>String(c.id)===String(customerId)) || groupOrCustomer;
    const remaining=outstandingFor(customerId);
    const primaryIndex=settings.bankAccounts.findIndex(a=>a.isPrimary && a.bankName && a.accountNumber);
    setSelectedCustomer(customer);
    setPaymentForm({amount:remaining>0?remaining:'',method:'Transfer',bankAccountId:primaryIndex>=0?String(primaryIndex):'',note:''});
    setModalType('PAYMENT');
  };

  const addPayment = async (e) => {
    e?.preventDefault?.();
    if (!selectedCustomer) return;
    const amount=n(paymentForm.amount);
    if (amount<=0) return showToast('Nominal pembayaran harus lebih dari 0','error');
    const data={tripId:activeTripId,customerId:selectedCustomer.id,customerName:selectedCustomer.name,amount,method:paymentForm.method,bankAccountId:paymentForm.bankAccountId,note:paymentForm.note,createdAt:new Date().toISOString()};
    setGlobalLoading(true); setSyncStatus('syncing');
    try {
      const res=await callAPI('addPayment',{data});
      if (res?.payment) setPayments(prev=>[...prev,res.payment]);
      if (Array.isArray(res?.updatedOrders)) setOrders(prev=>{const map=new Map(prev.map(o=>[String(o.id),o]));res.updatedOrders.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));return Array.from(map.values());});
      setModalType(null); setSyncStatus('synced'); showToast(`Pembayaran ${formatIDR(amount)} tercatat`);
    } catch(_) {setSyncStatus('error');} finally{setGlobalLoading(false);}
  };

  const openAdjustment = (customer) => {
    const a=adjustmentFor(customer.id) || {};
    setSelectedCustomer(customer);
    setAdjustmentForm({shippingFee:a.shippingFee||'',packingFee:a.packingFee||'',otherFee:a.otherFee||'',discount:a.discount||'',note:a.note||''});
    setModalType('ADJUSTMENT');
  };
  const saveAdjustment = async (e) => {
    e?.preventDefault?.(); if(!selectedCustomer)return;
    const existing=adjustmentFor(selectedCustomer.id);
    const data={id:existing?.id||`ADJ-${activeTripId}-${selectedCustomer.id}`,tripId:activeTripId,customerId:selectedCustomer.id,...adjustmentForm};
    setGlobalLoading(true);
    try {const saved=await callAPI('saveAdjustment',{data});setAdjustments(prev=>existing?prev.map(a=>String(a.id)===String(existing.id)?saved:a):[...prev,saved]);setModalType('CUSTOMER_DETAIL');showToast('Biaya/diskon pelanggan disimpan');}
    finally{setGlobalLoading(false);}
  };

  const isSelected = (id) => selectedOrderIds.includes(String(id));
  const toggleSelected = (id) => setSelectedOrderIds(prev=>prev.includes(String(id))?prev.filter(x=>x!==String(id)):[...prev,String(id)]);
  const setGroupSelected = (group,checked) => {
    const ids=group.items.map(o=>String(o.id));
    setSelectedOrderIds(prev=>{const s=new Set(prev);ids.forEach(id=>checked?s.add(id):s.delete(id));return Array.from(s);});
  };
  const selectedOrders = useMemo(()=>{const s=new Set(selectedOrderIds);return activeOrders.filter(o=>s.has(String(o.id)));},[activeOrders,selectedOrderIds]);
  const selectedStats = useMemo(()=>({rows:selectedOrders.length,units:selectedOrders.reduce((s,o)=>s+n(o.quantity,1),0),customers:new Set(selectedOrders.map(o=>String(o.customerId))).size}),[selectedOrders]);

  const bulkPaymentByLedger = async (mode,items) => {
    const groups=new Map();
    items.filter(o=>o.itemStatus!=='Dibatalkan').forEach(o=>{
      const id=String(o.customerId);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(o);
    });
    const created=[]; const updated=[];
    for (const [customerId,rows] of groups.entries()) {
      let amount=0;
      if (mode==='Lunas') amount=rows.reduce((s,o)=>s+n(o.remainingBalanceIdr),0);
      else if (mode==='DP Diterima') amount=rows.reduce((s,o)=>{
        if (getPaidAmount(o)>0) return s;
        return s + Math.min(n(o.sellingPriceIdr), n(o.dpAmountIdr,Math.round(n(o.sellingPriceIdr)*.5)));
      },0);
      if (amount<=0) continue;
      const customer=customers.find(c=>String(c.id)===customerId);
      const res=await callAPI('addPayment',{data:{tripId:activeTripId,customerId,customerName:customer?.name||rows[0]?.customerName||'',amount,method:'Bulk',bankAccountId:'',note:mode==='Lunas'?'Pelunasan massal':'DP massal',source:'bulk-v9'}},{silent:true,retries:1});
      if(res?.payment)created.push(res.payment); if(Array.isArray(res?.updatedOrders))updated.push(...res.updatedOrders);
    }
    if(created.length)setPayments(prev=>[...prev,...created]);
    if(updated.length)setOrders(prev=>{const map=new Map(prev.map(o=>[String(o.id),o]));updated.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));return Array.from(map.values());});
    return created;
  };

  const applyBulk = () => {
    if (!selectedOrders.length) return showToast('Pilih pesanan terlebih dahulu','error');
    if (!bulkAction.item && !bulkAction.payment && !bulkAction.packing) return showToast('Pilih minimal satu perubahan','error');
    const labels=[]; if(bulkAction.item)labels.push(`Belanja → ${bulkAction.item}`);if(bulkAction.payment)labels.push(`Pembayaran → ${bulkAction.payment}`);if(bulkAction.packing)labels.push(`Packing → ${bulkAction.packing}`);
    setConfirmDialog({title:'Terapkan Perubahan Massal',tone:'action',confirmLabel:'Terapkan',message:`${labels.join(' • ')}\n${selectedStats.rows} jenis • ${selectedStats.units} unit • ${selectedStats.customers} pelanggan`,onConfirm:async()=>{
      setConfirmDialog(null); const before=selectedOrders.map(o=>({id:o.id,itemStatus:o.itemStatus,paymentStatus:o.paymentStatus,packingStatus:o.packingStatus,purchasedQuantity:o.purchasedQuantity,packedQuantity:o.packedQuantity,paidAmountIdr:o.paidAmountIdr,remainingBalanceIdr:o.remainingBalanceIdr}));
      setGlobalLoading(true);setSyncStatus('syncing');
      try {
        const changes={};if(bulkAction.item)changes.item=bulkAction.item;if(bulkAction.packing)changes.packing=bulkAction.packing;
        if(Object.keys(changes).length) await callAPI('bulkUpdateOrdersMulti',{orderIds:selectedOrderIds,changes},{silent:true,retries:1});
        let createdBulkPayments=[];
        if(bulkAction.payment==='Lunas'||bulkAction.payment==='DP Diterima') createdBulkPayments=await bulkPaymentByLedger(bulkAction.payment,selectedOrders);
        else if(bulkAction.payment==='Belum Lunas') showToast('Reset pembayaran tidak dilakukan karena V9 memakai riwayat pembayaran. Hapus/koreksi melalui ledger jika diperlukan.','warn');
        await refreshFromServer({silent:true});
        const customerIds=Array.from(new Set(selectedOrders.map(o=>String(o.customerId))));
        const queue=customerIds.map(id=>customerGroupsAll.find(g=>String(g.customerId)===id)).filter(Boolean).map(g=>({...g,sent:false}));
        setWaQueue(queue);
        const selectedCount=selectedOrderIds.length; setSelectedOrderIds([]);setBulkAction({item:'',payment:'',packing:''});setSyncStatus('synced');
        const statusBefore=before.map(x=>({id:x.id,itemStatus:x.itemStatus,packingStatus:x.packingStatus,purchasedQuantity:x.purchasedQuantity,packedQuantity:x.packedQuantity}));
        registerUndo(`${selectedCount} pesanan diperbarui`,async()=>{
          const paymentUpdates=[];
          for(const pay of createdBulkPayments){
            const rr=await callAPI('deletePayment',{id:pay.id},{silent:true,retries:1});
            if(Array.isArray(rr?.updatedOrders))paymentUpdates.push(...rr.updatedOrders);
          }
          if(createdBulkPayments.length)setPayments(prev=>prev.filter(p=>!createdBulkPayments.some(x=>String(x.id)===String(p.id))));
          const res=await callAPI('bulkPatchOrders',{patches:statusBefore});
          const allUpdates=[...(paymentUpdates||[]),...(res?.updatedOrders||[])];
          if(allUpdates.length)setOrders(prev=>{const map=new Map(prev.map(o=>[String(o.id),o]));allUpdates.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));return Array.from(map.values());});
        });
        setModalType(queue.length?'POST_BULK':null);
      } catch(e){setSyncStatus('error');showToast(`Bulk gagal: ${e.message}`,'error');} finally{setGlobalLoading(false);}
    }});
  };

  const openPurchase = (product) => {
    if(tripReadOnly)return showToast('Trip lama read-only','warn');
    setPurchaseTarget(product);
    setPurchaseForm({quantity:product.remaining||1,unitForeignCost:product.estimatedCost||'',currency:product.currency||settings.defaultCurrency,exchangeRate:n(settings.currencyRates[product.currency||settings.defaultCurrency],1),store:product.store||''});
    setModalType('PURCHASE');
  };
  const savePurchase = async (e) => {
    e?.preventDefault?.(); if(!purchaseTarget)return;
    let qty=Math.min(Math.max(1,n(purchaseForm.quantity,1)),purchaseTarget.remaining);
    const allocations=[];let left=qty;
    purchaseTarget.orders.forEach(o=>{if(left<=0)return;const remain=Math.max(0,n(o.quantity,1)-effectivePurchased(o));const take=Math.min(remain,left);if(take>0){allocations.push({orderId:o.id,qty:take});left-=take;}});
    if(!allocations.length)return showToast('Tidak ada qty yang perlu dibeli','warn');
    setGlobalLoading(true);setSyncStatus('syncing');
    try {
      const res=await callAPI('recordPurchase',{data:{tripId:activeTripId,catalogId:purchaseTarget.catalogId,itemName:purchaseTarget.name,store:purchaseForm.store,currency:purchaseForm.currency,exchangeRate:n(purchaseForm.exchangeRate,1),unitForeignCost:n(purchaseForm.unitForeignCost),allocations,sessionId:activeSession?.id||''}});
      if(Array.isArray(res?.updatedOrders))setOrders(prev=>{const map=new Map(prev.map(o=>[String(o.id),o]));res.updatedOrders.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));return Array.from(map.values());});
      if(res?.batch)setPurchaseBatches(prev=>[...prev,res.batch]);
      if(res?.catalogItem)setCatalog(prev=>prev.map(c=>String(c.id)===String(res.catalogItem.id)?normalizeCatalogItem(res.catalogItem):c));
      setModalType(null);setSyncStatus('synced');showToast(`${qty} ${purchaseTarget.unit} ${purchaseTarget.name} dicatat dibeli`);
    }catch(_){setSyncStatus('error');}finally{setGlobalLoading(false);}
  };
  const markShoppingIssue = async (product,note) => {
    const ids=product.orders.filter(o=>effectivePurchased(o)<n(o.quantity,1)).map(o=>o.id);if(!ids.length)return;
    setGlobalLoading(true);try{const res=await callAPI('markShoppingIssue',{orderIds:ids,note});if(Array.isArray(res?.updatedOrders))setOrders(prev=>{const map=new Map(prev.map(o=>[String(o.id),o]));res.updatedOrders.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));return Array.from(map.values());});showToast(`Dicatat: ${note}`);setModalType(null);}finally{setGlobalLoading(false);}
  };

  const startSession = async (e) => {
    e?.preventDefault?.();if(!sessionForm.store)return showToast('Pilih toko','error');
    setGlobalLoading(true);try{const s=await callAPI('startShoppingSession',{data:{tripId:activeTripId,store:sessionForm.store,note:sessionForm.note}});setShoppingSessions(prev=>[...prev,s]);setModalType(null);showToast(`Sesi ${s.store} dimulai`);}finally{setGlobalLoading(false);}
  };
  const endSession = async () => {
    if(!activeSession)return;
    setGlobalLoading(true);try{const ended=await callAPI('endShoppingSession',{data:{id:activeSession.id}});setShoppingSessions(prev=>prev.map(s=>String(s.id)===String(ended.id)?ended:s));const start=new Date(activeSession.startedAt).getTime();const batches=purchaseBatches.filter(b=>String(b.sessionId)===String(activeSession.id)||((!b.sessionId)&&norm(b.store)===norm(activeSession.store)&&new Date(b.createdAt).getTime()>=start));setLastSessionSummary({store:activeSession.store,units:batches.reduce((s,b)=>s+n(b.quantity),0),cost:batches.reduce((s,b)=>s+n(b.totalBaseCostIdr),0),batches:batches.length});setModalType('SESSION_SUMMARY');showToast('Sesi belanja selesai');}finally{setGlobalLoading(false);}
  };

  const openPacking = (group) => {
    if(tripReadOnly)return showToast('Trip lama read-only','warn');
    const all=activeOrders.filter(o=>String(o.customerId)===String(group.customerId)&&o.itemStatus!=='Dibatalkan');
    const draft={};all.forEach(o=>draft[String(o.id)]=effectivePacked(o));
    setPackingGroup({...group,allItems:all});setPackingDraft(draft);setModalType('PACKING');
  };
  const changePacked = (order,delta) => {
    const max=effectivePurchased(order);setPackingDraft(prev=>({...prev,[String(order.id)]:clamp(n(prev[String(order.id)])+delta,0,max)}));
  };
  const savePacking = async () => {
    if(!packingGroup)return;const patches=packingGroup.allItems.map(o=>({id:o.id,packedQuantity:n(packingDraft[String(o.id)]),complete:n(packingDraft[String(o.id)])>=n(o.quantity,1)}));
    setGlobalLoading(true);try{const res=await callAPI('savePacking',{patches});if(Array.isArray(res?.updatedOrders))setOrders(prev=>{const map=new Map(prev.map(o=>[String(o.id),o]));res.updatedOrders.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));return Array.from(map.values());});setModalType(null);showToast('Packing diperbarui');}finally{setGlobalLoading(false);}
  };

  const cancelOrder = (order) => {
    if(tripReadOnly)return showToast('Trip lama read-only','warn');
    setConfirmDialog({title:'Batalkan Pesanan',tone:'danger',message:`${order.itemName}\n${order.customerName}\n\nPesanan tidak dihapus dari histori. Jika sudah ada pembayaran, sistem menandai refund.`,confirmLabel:'Batalkan Pesanan',onConfirm:async()=>{setConfirmDialog(null);setGlobalLoading(true);try{const res=await callAPI('cancelOrder',{id:order.id});if(Array.isArray(res?.updatedOrders))setOrders(prev=>{const map=new Map(prev.map(o=>[String(o.id),o]));res.updatedOrders.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));return Array.from(map.values());});setModalType(null);showToast('Pesanan dibatalkan');}finally{setGlobalLoading(false);}}});
  };
  const completeRefund = (order) => {
    setConfirmDialog({title:'Tandai Refund Selesai',tone:'action',message:`Refund ${formatIDR(order.refundAmountIdr)} untuk ${order.itemName}?`,confirmLabel:'Refund Selesai',onConfirm:async()=>{setConfirmDialog(null);setGlobalLoading(true);try{const res=await callAPI('completeRefund',{id:order.id});if(res?.payment)setPayments(prev=>[...prev,res.payment]);if(Array.isArray(res?.updatedOrders))setOrders(prev=>{const map=new Map(prev.map(o=>[String(o.id),o]));res.updatedOrders.map(normalizeOrder).forEach(o=>map.set(String(o.id),o));return Array.from(map.values());});setModalType(null);showToast('Refund tercatat selesai');}finally{setGlobalLoading(false);}}});
  };

  const openTripSummary = (id) => {setSummaryTripId(id||activeTripId);setCurrentTab('summary');setModalType(null);setSearchQuery('');};
  const closeTrip = async (trip) => {
    const tripRows=orders.filter(o=>String(o.tripId)===String(trip.id));
    const activeRows=tripRows.filter(o=>o.itemStatus!=='Dibatalkan');
    const tripPayments=payments.filter(p=>String(p.tripId)===String(trip.id));
    const tripAdjustments=adjustments.filter(a=>String(a.tripId)===String(trip.id));
    const customerIds=Array.from(new Set(activeRows.map(o=>String(o.customerId))));
    const shoppingUnits=activeRows.reduce((sum,o)=>sum+Math.max(0,n(o.quantity,1)-effectivePurchased(o)),0);
    const packingUnits=activeRows.reduce((sum,o)=>sum+Math.max(0,n(o.quantity,1)-effectivePacked(o)),0);
    const missingCostRows=activeRows.filter(o=>n(o.baseCostIdr)<=0&&n(o.actualBaseCostIdr)<=0).length;
    const refundRows=tripRows.filter(o=>o.refundStatus==='Diperlukan').length;
    let unpaidCustomers=0;
    let revenue=0;
    let paid=tripPayments.reduce((sum,p)=>sum+n(p.amount),0);
    customerIds.forEach(id=>{
      const goods=activeRows.filter(o=>String(o.customerId)===id).reduce((sum,o)=>sum+n(o.sellingPriceIdr),0);
      const adj=tripAdjustments.find(a=>String(a.customerId)===id);
      const bill=Math.max(0,goods+adjustmentNet(adj));
      const customerPaid=tripPayments.filter(p=>String(p.customerId)===id).reduce((sum,p)=>sum+n(p.amount),0);
      revenue+=bill;
      if(bill-customerPaid>0.5)unpaidCustomers++;
    });
    const cost=activeRows.reduce((sum,o)=>sum+(n(o.actualBaseCostIdr)||n(o.baseCostIdr)),0);
    const tripUnits=activeRows.reduce((sum,o)=>sum+n(o.quantity,1),0);
    const issueText=[];
    if(shoppingUnits)issueText.push(`${shoppingUnits} unit belum dibeli`);
    if(unpaidCustomers)issueText.push(`${unpaidCustomers} pelanggan belum lunas`);
    if(packingUnits)issueText.push(`${packingUnits} unit belum packing`);
    if(missingCostRows)issueText.push(`${missingCostRows} pesanan belum punya modal`);
    if(refundRows)issueText.push(`${refundRows} refund belum selesai`);
    if(issueText.length){
      setConfirmDialog({
        title:'Trip Belum Siap Ditutup',tone:'action',message:issueText.join('\n'),confirmLabel:'Kembali Cek',cancelLabel:'Tutup',onConfirm:()=>setConfirmDialog(null)
      });
      return;
    }
    setConfirmDialog({
      title:'Selesaikan Trip',tone:'action',
      message:`${trip.title}\n${customerIds.length} pelanggan • ${activeRows.length} jenis • ${tripUnits} unit\nOmzet ${formatIDR(revenue)}\nProfit ${formatIDR(revenue-cost)}\nPiutang ${formatIDR(Math.max(0,revenue-paid))}\n\nSetelah ditutup Trip menjadi read-only secara default.`,
      confirmLabel:'Selesaikan & Arsipkan',
      onConfirm:async()=>{
        setConfirmDialog(null);setGlobalLoading(true);
        try{
          const res=await callAPI('closeTrip',{id:trip.id});
          if(!res?.closed){showToast('Server masih menemukan data yang belum selesai','warn');return;}
          setTrips(prev=>prev.map(t=>String(t.id)===String(trip.id)?res.trip:t));
          setArchivedEditTripId(null);openTripSummary(trip.id);showToast('Trip selesai dan diarsipkan');
        }finally{setGlobalLoading(false);}
      }
    });
  };

  const refreshGroup = (group) => customerGroupsAll.find(g=>String(g.customerId)===String(group?.customerId)) || group;
  const statusCustomerText = (o) => o.itemStatus==='Dibeli'?'Dibeli':o.itemStatus==='Sebagian'?`${effectivePurchased(o)}/${n(o.quantity,1)} dibeli`:o.itemStatus==='Dicari'?'Dicari':o.itemStatus==='Dibatalkan'?'Dibatalkan':'Menunggu';
  const buildWAMessage = (group,mode='auto',bankIndexes=waBankIndexes) => {
    group=refreshGroup(group);
    const customer=customers.find(c=>String(c.id)===String(group.customerId));
    const active=group.allItems.filter(o=>o.itemStatus!=='Dibatalkan');
    const bill=totalBillFor(group.customerId); const paid=netPaidFor(group.customerId); const remaining=Math.max(0,bill-paid); const credit=Math.max(0,paid-bill);
    const allPacked=active.length>0&&active.every(o=>effectivePacked(o)>=n(o.quantity,1));
    const allBought=active.length>0&&active.every(o=>effectivePurchased(o)>=n(o.quantity,1));
    const hasResi=active.some(o=>String(o.trackingNumber||'').trim());
    let resolved=mode;
    if(mode==='auto') resolved=hasResi?'resi':(allPacked&&remaining<=0?'ship':remaining<=0?'paid':paid>0?'settlement':'dp');
    let msg=`Halo Kak ${group.customerName || customer?.name || ''} 👋\n`;
    msg+=`Update *${activeTrip?.title || 'Jastip'}* ya kak.\n\n`;
    msg+='*Rincian Pesanan:*\n';
    active.forEach((o,i)=>{msg+=`${i+1}. ${o.itemName} ×${n(o.quantity,1)} — ${statusCustomerText(o)} — ${formatIDR(o.sellingPriceIdr)}\n`;});
    const adj=adjustmentFor(group.customerId);
    if(adj){if(n(adj.shippingFee)>0)msg+=`Ongkir — ${formatIDR(adj.shippingFee)}\n`;if(n(adj.packingFee)>0)msg+=`Packing — ${formatIDR(adj.packingFee)}\n`;if(n(adj.otherFee)>0)msg+=`Biaya lain — ${formatIDR(adj.otherFee)}\n`;if(n(adj.discount)>0)msg+=`Diskon — -${formatIDR(adj.discount)}\n`;}
    msg+='\n';
    msg+=`Total: *${formatIDR(bill)}*\nSudah Dibayar: *${formatIDR(paid)}*\nSisa: *${formatIDR(remaining)}*\n`;
    if(credit>0)msg+=`Kredit/kelebihan pembayaran: *${formatIDR(credit)}*\n`;
    const usable=(bankIndexes||[]).map(i=>settings.bankAccounts[Number(i)]).filter(a=>a?.bankName&&a?.accountNumber).slice(0,3);
    if((resolved==='dp'||resolved==='settlement')&&remaining>0&&usable.length){msg+='\nPembayaran bisa ke:\n';usable.forEach(a=>{msg+=`🏦 ${a.bankName} — ${a.accountNumber} a.n ${a.accountHolder}\n`;});}
    if(resolved==='dp'&&remaining>0)msg+='\nBoleh DP dulu ya kak. Setelah transfer, kirim bukti pembayarannya ke sini 🙏';
    else if(resolved==='settlement'&&remaining>0)msg+='\nBarangnya sudah kami proses. Boleh dibantu pelunasannya ya kak 🙏';
    else if(resolved==='paid'&&allBought)msg+='\nPembayaran sudah lunas. Terima kasih banyak kak 🙏';
    else if(resolved==='ship'){
      msg+='\nPesanan sudah lengkap dan siap dikirim.';
      if(customer?.address)msg+=`\nAlamat tersimpan:\n${customer.recipientName||customer.name}\n${customer.shippingPhone||customer.whatsapp||''}\n${customer.address}${customer.postalCode?`\n${customer.postalCode}`:''}\n\nMohon konfirmasi apakah alamat ini masih benar ya kak.`;
      else msg+='\nBoleh kirim nama penerima, nomor HP, dan alamat lengkap untuk pengiriman ya kak.';
    }
    if(resolved==='resi'){
      const resi=active.filter(o=>String(o.trackingNumber||'').trim()).map(o=>o.trackingNumber).filter((v,i,a)=>a.indexOf(v)===i);
      msg+=`\n\nPesanan sudah dikirim${resi.length?` dengan resi: *${resi.join(', ')}*`:''}. Terima kasih kak 🙏`;
    }
    return msg;
  };
  const openWA = (group,mode='auto') => {
    const primary=settings.bankAccounts.findIndex(a=>a.isPrimary&&a.bankName&&a.accountNumber);
    const indexes=primary>=0?[String(primary)]:settings.bankAccounts.map((a,i)=>a.bankName&&a.accountNumber?String(i):null).filter(Boolean).slice(0,1);
    const fresh=refreshGroup(group);setActiveWAGroup(fresh);setWaMode(mode);setWaBankIndexes(indexes);setWaPreview(buildWAMessage(fresh,mode,indexes));setModalType('WA');
  };
  const toggleWABank = (idx) => {
    const sid=String(idx);let next=waBankIndexes.includes(sid)?waBankIndexes.filter(x=>x!==sid):[...waBankIndexes,sid];if(next.length>3){showToast('Maksimal 3 rekening untuk satu pesan WA','warn');return;}setWaBankIndexes(next);setWaPreview(buildWAMessage(activeWAGroup,waMode,next));
  };
  const openWhatsApp = (group,message) => {
    const phone=String(group?.whatsapp||'').replace(/[^0-9]/g,'').replace(/^0/,'62');
    if(!phone)return showToast('Nomor WhatsApp pelanggan belum tersedia','error');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
  };
  const sendQueueItem = (idx) => {
    const item=waQueue[idx];if(!item)return;const msg=buildWAMessage(item,'auto',settings.bankAccounts.map((a,i)=>a.isPrimary?String(i):null).filter(Boolean));openWhatsApp(item,msg);setWaQueue(prev=>prev.map((x,i)=>i===idx?{...x,sent:true}:x));
  };

  const stableHash = (value) => {let hash=2166136261;const str=String(value||'');for(let i=0;i<str.length;i++){hash^=str.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(36).toUpperCase();};
  const parseIDR = (value) => {const c=String(value??'').replace(/[^0-9-]/g,'');if(!c||c==='-')return null;const x=parseInt(c,10);return Number.isFinite(x)?x:null;};
  const parseDecimal = (value) => {const c=String(value??'').trim().replace(',','.').replace(/[^0-9.\-]/g,'');if(!c||c==='-'||c==='.')return null;const x=parseFloat(c);return Number.isFinite(x)?x:null;};
  const handleBulkImport = () => {
    if(!bulkWhatsAppText.trim())return showToast('Masukkan teks pesanan','error');if(!activeTripId)return showToast('Pilih Trip aktif','error');
    try{
      const parsed=[];let current=null,parsing=false;
      const start=()=>{if(current&&(current.name||current.items.length))parsed.push(current);current={name:'',wa:'',items:[]};parsing=false;};
      const ensure=()=>{if(!current)current={name:'',wa:'',items:[]};return current;};
      bulkWhatsAppText.split(/\r?\n/).forEach(raw=>{const l=raw.trim();if(!l)return;const lower=l.toLowerCase();if(lower.includes('data pelanggan')){start();return;}if(lower.startsWith('nama:')){const c=ensure();if(c.name&&c.items.length)start();ensure().name=l.substring(l.indexOf(':')+1).trim();return;}if(lower.startsWith('wa:')){ensure().wa=l.substring(l.indexOf(':')+1).trim();return;}if(lower.includes('daftar pesanan')){ensure();parsing=true;return;}if(parsing&&l.startsWith('-')){const parts=l.substring(1).trim().split('|').map(x=>x.trim()).filter(Boolean);const name=parts[0];if(!name)return;let qty=1,harga=null,cost=null;parts.slice(1).forEach(part=>{const p=part.toLowerCase(),v=part.split(':').slice(1).join(':').trim();if(p.startsWith('qty:'))qty=Math.max(1,parseInt(v,10)||1);else if(p.startsWith('harga:'))harga=parseIDR(v);else if(p.startsWith('aed:'))cost=parseDecimal(v);});ensure().items.push({name:smartProductTitle(name),qty,harga,cost});}});if(current&&(current.name||current.items.length))parsed.push(current);
      if(!parsed.length)return showToast('Format import tidak terbaca','error');
      const customerPayload=[],catalogMap=new Map(),orderPayload=[];let units=0;const missing=[];
      parsed.forEach(pc=>{if(!pc.name||!pc.items.length)return;let cust=customers.find(c=>norm(c.name)===norm(pc.name));const customerId=cust?.id||`CUST-MIG-${stableHash(norm(pc.name))}`;const cdata={...(cust||{}),id:customerId,name:pc.name,whatsapp:pc.wa||cust?.whatsapp||'',notes:cust?.notes||'Dari Import Massal'};customerPayload.push(cdata);
        const itemMap=new Map();pc.items.forEach(it=>{const key=`${norm(it.name)}|${it.cost===null?'?':it.cost}|${it.harga===null?'?':it.harga}`;if(!itemMap.has(key))itemMap.set(key,{...it});else itemMap.get(key).qty+=it.qty;});
        itemMap.forEach(it=>{let cat=catalog.find(x=>norm(x.name)===norm(it.name));const catId=cat?.id||`CAT-MIG-${stableHash(norm(it.name))}`;const unitPrice=it.harga===null?n(cat?.sellingPriceIdr):it.harga;if(!unitPrice)missing.push(it.name);const curr='AED';const rate=n(settings.currencyRates[curr],1);const foreign=it.cost===null?n(cat?.foreignCost):it.cost;const catData=normalizeCatalogItem({...cat,id:catId,name:it.name,category:cat?.category||'Umum',store:cat?.store||'',currency:curr,foreignCost:foreign,markupPercent:cat?.markupPercent||0,sellingPriceIdr:unitPrice,unit:cat?.unit||'pcs',aliases:cat?.aliases||'',alternateStores:cat?.alternateStores||'',isArchived:false,isPublished:cat?.isPublished||false,availabilityStatus:cat?.availabilityStatus||'Pre-Order',slug:cat?.slug||slugify(it.name)});catalogMap.set(catId,catData);units+=it.qty;const total=unitPrice*it.qty;const key=[activeTripId,norm(pc.name),norm(it.name),it.cost===null?'AED?':it.cost,unitPrice].join('|');orderPayload.push(normalizeOrder({id:`ORD-MIG-${stableHash(key)}`,tripId:activeTripId,customerId,customerName:pc.name,whatsapp:cdata.whatsapp,catalogId:catId,itemName:it.name,quantity:it.qty,unit:catData.unit,sourceStore:catData.store,foreignCurrency:curr,foreignAmount:foreign,exchangeRate:rate,baseCostIdr:foreign*rate*it.qty,actualForeignCost:0,actualBaseCostIdr:0,purchasedQuantity:0,shoppingNote:'',markupPercent:0,sellingPriceIdr:total,dpAmountIdr:Math.round(total*.5),remainingBalanceIdr:total,itemStatus:'Menunggu',paymentStatus:'Belum Lunas',packedQuantity:0,packingStatus:'Belum',trackingNumber:'',paidAmountIdr:0,createdAt:new Date().toISOString()}));});});
      if(missing.length)return showToast(`Harga jual belum tersedia. Contoh: ${missing[0]}`,'error');
      const cats=Array.from(catalogMap.values());
      setConfirmDialog({title:'Konfirmasi Import Massal',tone:'action',confirmLabel:'Import',message:`${customerPayload.length} pelanggan • ${orderPayload.length} jenis • ${units} unit • ${cats.length} produk katalog akan disinkronkan.`,onConfirm:async()=>{setConfirmDialog(null);setGlobalLoading(true);try{await callAPI('saveMultiCustomerImport',{customers:customerPayload,orders:orderPayload,catalogItems:cats});const merge=(old,incoming)=>{const m=new Map(old.map(x=>[String(x.id),x]));incoming.forEach(x=>m.set(String(x.id),x));return Array.from(m.values());};setCustomers(prev=>merge(prev,customerPayload));setOrders(prev=>merge(prev,orderPayload));setCatalog(prev=>merge(prev,cats));setBulkWhatsAppText('');setModalType(null);showToast(`Import berhasil: ${customerPayload.length} pelanggan, ${orderPayload.length} jenis, ${units} unit`);}finally{setGlobalLoading(false);}}});
    }catch(e){showToast(`Import gagal: ${e.message}`,'error');}
  };

  const ensureXLSX = async () => {if(window.XLSX)return window.XLSX;await loadScript('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js','XLSX');return window.XLSX;};
  const ensurePDF = async () => {if(!window.jspdf)await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');if(!window.jspdf?.jsPDF?.API?.autoTable)await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js');return window.jspdf.jsPDF;};
  const reportTripData = (tripId=activeTripId) => {
    const trip=trips.find(t=>String(t.id)===String(tripId));const rows=orders.filter(o=>String(o.tripId)===String(tripId));const active=rows.filter(o=>o.itemStatus!=='Dibatalkan');const pay=payments.filter(p=>String(p.tripId)===String(tripId));const adj=adjustments.filter(a=>String(a.tripId)===String(tripId));
    const custIds=Array.from(new Set(active.map(o=>String(o.customerId))));const customerRows=custIds.map(id=>{const c=customers.find(x=>String(x.id)===id);const os=active.filter(o=>String(o.customerId)===id);const a=adj.find(x=>String(x.customerId)===id);const bill=Math.max(0,os.reduce((s,o)=>s+n(o.sellingPriceIdr),0)+adjustmentNet(a));const paid=pay.filter(p=>String(p.customerId)===id).reduce((s,p)=>s+n(p.amount),0);const cost=os.reduce((s,o)=>s+(n(o.actualBaseCostIdr)||n(o.baseCostIdr)),0);return {name:c?.name||os[0]?.customerName||'-',types:os.length,units:os.reduce((s,o)=>s+n(o.quantity,1),0),bill,paid,outstanding:Math.max(0,bill-paid),margin:bill-cost};});
    const revenue=customerRows.reduce((s,c)=>s+c.bill,0);const paid=pay.reduce((s,p)=>s+n(p.amount),0);const cost=active.reduce((s,o)=>s+(n(o.actualBaseCostIdr)||n(o.baseCostIdr)),0);
    return {trip,rows,active,pay,adj,customerRows,revenue,paid,cost,profit:revenue-cost,outstanding:Math.max(0,revenue-paid),units:active.reduce((s,o)=>s+n(o.quantity,1),0)};
  };

  const styleSheet = (ws,headerRows=1) => {
    if(!ws['!ref'])return;const range=window.XLSX.utils.decode_range(ws['!ref']);for(let r=range.s.r;r<=range.e.r;r++){for(let c=range.s.c;c<=range.e.c;c++){const cell=ws[window.XLSX.utils.encode_cell({r,c})];if(!cell)continue;cell.s=cell.s||{};cell.s.font={name:'Arial',sz:10,bold:r<headerRows,color:r<headerRows?{rgb:'FFFFFF'}:{rgb:'0F172A'}};cell.s.fill=r<headerRows?{fgColor:{rgb:'0F172A'}}:{fgColor:{rgb:r%2?'F8FAFC':'FFFFFF'}};cell.s.alignment={vertical:'center',wrapText:true};cell.s.border={bottom:{style:'thin',color:{rgb:'E2E8F0'}}};}}ws['!autofilter']={ref:window.XLSX.utils.encode_range({s:{r:0,c:0},e:{r:0,c:range.e.c}})};
  };

  const exportExcel = async () => {
    setReportBusy(true);try{const XLSX=await ensureXLSX();const d=reportTripData(summaryTrip?.id||activeTripId);const wb=XLSX.utils.book_new();
      const summary=[['JASTIPPER PRO — RINGKASAN TRIP','Nilai'],['Trip',d.trip?.title||'-'],['Status',d.trip?.status||'-'],['Pelanggan',d.customerRows.length],['Jenis Pesanan',d.active.length],['Unit Barang',d.units],['Omzet',d.revenue],['Modal',d.cost],['Profit',d.profit],['Sudah Dibayar',d.paid],['Piutang',d.outstanding]];const ws1=XLSX.utils.aoa_to_sheet(summary);ws1['!cols']=[{wch:28},{wch:24}];styleSheet(ws1,1);['B7','B8','B9','B10','B11'].forEach(a=>{if(ws1[a])ws1[a].z='Rp #,##0';});XLSX.utils.book_append_sheet(wb,ws1,'Ringkasan');
      const orderData=d.rows.map(o=>({'Pelanggan':o.customerName,'Barang':o.itemName,'Qty':n(o.quantity,1),'Unit':o.unit||'pcs','Harga Jual':n(o.sellingPriceIdr),'Sudah Dibayar':n(o.paidAmountIdr),'Sisa':n(o.remainingBalanceIdr),'Belanja':o.itemStatus,'Qty Dibeli':effectivePurchased(o),'Packing':o.packingStatus,'Qty Packing':effectivePacked(o),'Toko':o.sourceStore,'Mata Uang':o.foreignCurrency,'Modal Estimasi/Unit':n(o.foreignAmount),'Modal Aktual Total':n(o.actualBaseCostIdr),'Resi':o.trackingNumber||'','Refund':o.refundStatus||''}));const ws2=XLSX.utils.json_to_sheet(orderData);ws2['!cols']=[{wch:20},{wch:36},{wch:7},{wch:8},{wch:16},{wch:16},{wch:16},{wch:13},{wch:11},{wch:12},{wch:12},{wch:20},{wch:10},{wch:18},{wch:18},{wch:22},{wch:14}];styleSheet(ws2,1);XLSX.utils.book_append_sheet(wb,ws2,'Pesanan');
      const custData=d.customerRows.map(c=>({'Pelanggan':c.name,'Jenis':c.types,'Unit':c.units,'Total Tagihan':c.bill,'Sudah Dibayar':c.paid,'Sisa':c.outstanding,'Margin':c.margin}));const ws3=XLSX.utils.json_to_sheet(custData);ws3['!cols']=[{wch:24},{wch:8},{wch:8},{wch:18},{wch:18},{wch:18},{wch:18}];styleSheet(ws3,1);XLSX.utils.book_append_sheet(wb,ws3,'Pelanggan');
      const prodData=catalog.map(c=>({'Produk':c.name,'Kategori':c.category,'Toko Utama':c.store,'Toko Alternatif':c.alternateStores,'Unit':c.unit,'Mata Uang':c.currency,'Modal Estimasi':n(c.foreignCost),'Harga Jual':n(c.sellingPriceIdr),'Harga Beli Terakhir':n(c.lastPurchaseCost),'Terakhir Dibeli':c.lastPurchasedAt,'Publish':c.isPublished?'Ya':'Tidak','Arsip':c.isArchived?'Ya':'Tidak'}));const ws4=XLSX.utils.json_to_sheet(prodData);ws4['!cols']=[{wch:38},{wch:16},{wch:22},{wch:26},{wch:8},{wch:10},{wch:16},{wch:16},{wch:18},{wch:18},{wch:10},{wch:10}];styleSheet(ws4,1);XLSX.utils.book_append_sheet(wb,ws4,'Produk');
      const payData=d.pay.map(p=>({'Tanggal':p.createdAt,'Pelanggan':p.customerName,'Jenis':p.type||'Pembayaran','Nominal':n(p.amount),'Metode':p.method,'Rekening':p.bankAccountId,'Catatan':p.note}));const ws5=XLSX.utils.json_to_sheet(payData);ws5['!cols']=[{wch:20},{wch:22},{wch:14},{wch:18},{wch:14},{wch:12},{wch:30}];styleSheet(ws5,1);XLSX.utils.book_append_sheet(wb,ws5,'Pembayaran');
      XLSX.writeFile(wb,`Jastipper_${(d.trip?.title||'Trip').replace(/[^a-z0-9]+/gi,'_')}_V9.xlsx`);showToast('Excel lengkap berhasil dibuat');setModalType(null);
    }catch(e){showToast(`Gagal membuat Excel: ${e.message}`,'error');}finally{setReportBusy(false);}
  };

  const exportPDF = async (full=false) => {
    setReportBusy(true);try{const jsPDF=await ensurePDF();const d=reportTripData(summaryTrip?.id||activeTripId);const doc=new jsPDF({unit:'mm',format:'a4'});const navy=[15,23,42];doc.setFillColor(...navy);doc.rect(0,0,210,42,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text('Jastipper Pro',14,16);doc.setFontSize(11);doc.text(d.trip?.title||'Trip',14,25);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(`${d.customerRows.length} pelanggan • ${d.active.length} jenis • ${d.units} unit • ${d.trip?.status||''}`,14,32);
      doc.setTextColor(15,23,42);const cards=[['Omzet',d.revenue],['Modal',d.cost],['Profit',d.profit],['Piutang',d.outstanding]];cards.forEach((c,i)=>{const x=14+(i%2)*91,y=50+Math.floor(i/2)*24;doc.setFillColor(248,250,252);doc.roundedRect(x,y,85,19,3,3,'F');doc.setFontSize(7);doc.setTextColor(100,116,139);doc.text(c[0],x+4,y+6);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(15,23,42);doc.text(formatIDR(c[1]).replace(/\u00a0/g,' '),x+4,y+14);doc.setFont('helvetica','normal');});
      const startY=103;doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('Breakdown Pelanggan',14,startY-4);doc.autoTable({startY,head:[['Pelanggan','Jenis/Unit','Tagihan','Dibayar','Sisa']],body:d.customerRows.slice(0,full?999:10).map(c=>[c.name,`${c.types} / ${c.units}`,formatIDR(c.bill),formatIDR(c.paid),formatIDR(c.outstanding)]),theme:'grid',styles:{fontSize:7,cellPadding:2},headStyles:{fillColor:navy},margin:{left:14,right:14}});
      if(full){doc.addPage();doc.setFont('helvetica','bold');doc.setFontSize(13);doc.text('Detail Transaksi',14,16);doc.autoTable({startY:22,head:[['Pelanggan','Barang','Qty','Harga','Bayar','Sisa','Belanja','Packing']],body:d.rows.map(o=>[o.customerName,o.itemName,n(o.quantity,1),formatIDR(o.sellingPriceIdr),formatIDR(o.paidAmountIdr),formatIDR(o.remainingBalanceIdr),o.itemStatus,o.packingStatus]),theme:'grid',styles:{fontSize:6.5,cellPadding:1.6},headStyles:{fillColor:navy},margin:{left:8,right:8}});}
      doc.save(`Jastipper_${(d.trip?.title||'Trip').replace(/[^a-z0-9]+/gi,'_')}_${full?'Lengkap':'Ringkasan'}.pdf`);showToast(`PDF ${full?'lengkap':'ringkasan'} berhasil dibuat`);setModalType(null);
    }catch(e){showToast(`Gagal membuat PDF: ${e.message}`,'error');}finally{setReportBusy(false);}
  };

  const statusColor = (status) => {
    if(['Dibeli','Lunas','Selesai'].includes(status))return 'text-emerald-600';
    if(['Sebagian','DP Diterima','Kredit/Refund'].includes(status))return 'text-orange-600';
    if(['Dicari'].includes(status))return 'text-blue-600';
    if(['Dibatalkan'].includes(status))return 'text-red-500';
    return 'text-slate-500';
  };
  const customerMetrics = (id) => {
    const rows=orders.filter(o=>String(o.customerId)===String(id));const active=rows.filter(o=>o.itemStatus!=='Dibatalkan');
    return {trips:new Set(active.map(o=>String(o.tripId))).size,units:active.reduce((s,o)=>s+n(o.quantity,1),0),revenue:active.reduce((s,o)=>s+n(o.sellingPriceIdr),0),outstanding:outstandingFor(id),credit:creditFor(id)};
  };
  const historyFor = (catalogId) => priceHistory.filter(p=>String(p.catalogId)===String(catalogId)).sort((a,b)=>new Date(b.changedAt)-new Date(a.changedAt));
  const activeFilterCount = [filters.shopping,filters.payment,filters.packing].filter(v=>v!=='ALL').length;
  const setActionFilter = (kind,value) => {setFilters(prev=>({...prev,[kind]:value}));setCurrentTab('orders');setSearchQuery('');};

  const renderHeader = () => {
    if(currentTab==='summary')return null;
    const syncLabel=syncStatus==='synced'?'Tersinkron':syncStatus==='syncing'?'Menyinkron':syncStatus==='cached'?'Cache':'Offline';
    const dot=syncStatus==='synced'?'bg-emerald-500':syncStatus==='syncing'?'bg-blue-500 animate-pulse':syncStatus==='cached'?'bg-amber-500':'bg-red-500';
    return h('header',{className:'sticky top-0 z-30 bg-white/95 backdrop-blur-xl border-b border-slate-200'},
      h('div',{className:'max-w-5xl mx-auto px-3.5 h-[58px] flex items-center gap-2'},
        h('button',{onClick:()=>setModalType('TRIPS'),className:'min-w-0 flex-1 flex items-center gap-2.5 text-left'},
          h('img',{src:'/jastipper-logo.png',alt:'Jastipper',className:'w-9 h-9 rounded-xl object-cover shrink-0 shadow-sm'}),
          h('div',{className:'min-w-0'},
            h('div',{className:'flex items-center gap-1'},h('h1',{className:'font-black text-[13px] leading-tight truncate max-w-[150px] sm:max-w-none'},activeTrip?.title||'Pilih / Buat Trip'),h(Icon,{name:'down',size:13,className:'text-slate-400 shrink-0'})),
            h('div',{className:'flex items-center gap-2 mt-0.5'},h('span',{className:'text-[9px] font-bold text-slate-500'},activeTrip?.status||'Belum ada Trip'),h('span',{className:'flex items-center gap-1 text-[9px] font-bold text-slate-400'},h('span',{className:`w-1.5 h-1.5 rounded-full ${dot}`}),syncLabel))
          )
        ),
        h('div',{className:'flex items-center gap-1'},
          h('button',{onClick:()=>{setGlobalSearchQuery('');setModalType('GLOBAL_SEARCH');},title:'Cari Global',className:'tap-target w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-600 flex items-center justify-center'},h(Icon,{name:'search',size:18})),
          h('button',{onClick:()=>{setSettingsDraft(clone(settings));setModalType('BANKS');},title:'Rekening Pembayaran',className:'tap-target w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-600 flex items-center justify-center'},h(Icon,{name:'bank',size:18})),
          h('button',{onClick:()=>{setSettingsDraft(clone(settings));setModalType('SETTINGS');},title:'Pengaturan App',className:'tap-target w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-600 flex items-center justify-center'},h(Icon,{name:'settings',size:18})),
          h('button',{onClick:()=>setModalType('REPORT'),title:'Unduh Report',className:'tap-target w-10 h-10 rounded-xl bg-slate-950 text-white flex items-center justify-center'},h(Icon,{name:'download',size:18}))
        )
      )
    );
  };

  const renderDashboard = () => h('div',{className:'fade-in space-y-3'},
    tripReadOnly ? h('div',{className:'rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-center gap-2'},h(Icon,{name:'lock',size:16,className:'text-amber-700'}),h('div',{className:'text-[10px] font-bold text-amber-800 flex-1'},'Trip selesai — mode read-only.'),h('button',{onClick:()=>setArchivedEditTripId(activeTripId),className:'text-[10px] font-black text-amber-800 underline'},'Edit Trip Lama')) : null,
    h('section',{className:'compact-card soft-shadow overflow-hidden'},
      h('div',{className:'grid grid-cols-4 divide-x divide-slate-100 py-3'},[
        ['Pelanggan',stats.tripCustomers],['Jenis',stats.orderTypes],['Unit',stats.totalUnits],['Produk',stats.catalogCount]
      ].map(([label,value])=>h('div',{key:label,className:'text-center px-1'},h('div',{className:'text-lg sm:text-xl font-black tabular-nums leading-none'},value),h('div',{className:'text-[9px] font-bold text-slate-400 mt-1'},label))))
    ),
    h('section',{className:'rounded-2xl bg-slate-950 text-white px-4 py-4 relative overflow-hidden'},
      h('div',{className:'text-[9px] uppercase tracking-[.16em] font-black text-slate-400'},stats.actualQty>=stats.totalUnits&&stats.totalUnits>0?'Profit Aktual':'Estimasi Profit'),
      h('div',{className:'text-[27px] font-black mt-1 money-tight tabular-nums'},formatIDR(stats.profit)),
      h('div',{className:'grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/10'},
        [['Omzet',stats.revenue],['Modal',stats.projectedCost],['Piutang',stats.outstanding]].map(([label,val],i)=>h('div',{key:label,className:i?'border-l border-white/10 pl-2':''},h('div',{className:'text-[9px] text-slate-400 font-bold'},label),h('div',{className:'text-[11px] sm:text-xs font-black tabular-nums mt-0.5 whitespace-nowrap'},formatIDR(val))))
      )
    ),
    h('section',{className:'compact-card p-3'},
      h('div',{className:'flex items-center justify-between mb-2'},h('div',null,h('h2',{className:'text-xs font-black'},'Perlu Tindakan'),h('p',{className:'text-[9px] text-slate-400 font-semibold'},'Tap untuk langsung membuka filter terkait')),healthIssues.length?h('button',{onClick:()=>setModalType('HEALTH'),className:'text-[9px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg'},`⚠ ${healthIssues.length} data`):h('button',{onClick:()=>setModalType('HEALTH'),className:'text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg'},'✓ Data sehat')),
      h('div',{className:'grid grid-cols-4 gap-1.5'},
        h('button',{onClick:()=>setActionFilter('shopping','TODO'),className:'rounded-xl bg-amber-50 border border-amber-100 px-2 py-2 text-left'},h('div',{className:'text-base font-black text-amber-700'},actionStats.unboughtUnits),h('div',{className:'text-[8px] font-bold text-amber-700/75 leading-tight'},'Belum Dibeli')),
        h('button',{onClick:()=>setActionFilter('payment','UNPAID'),className:'rounded-xl bg-red-50 border border-red-100 px-2 py-2 text-left'},h('div',{className:'text-base font-black text-red-700'},actionStats.unpaidCustomers),h('div',{className:'text-[8px] font-bold text-red-700/75 leading-tight'},'Belum Bayar')),
        h('button',{onClick:()=>setActionFilter('payment','PARTIAL'),className:'rounded-xl bg-orange-50 border border-orange-100 px-2 py-2 text-left'},h('div',{className:'text-base font-black text-orange-700'},actionStats.partialCustomers),h('div',{className:'text-[8px] font-bold text-orange-700/75 leading-tight'},'Sudah DP')),
        h('button',{onClick:()=>setActionFilter('packing','UNPACKED'),className:'rounded-xl bg-purple-50 border border-purple-100 px-2 py-2 text-left'},h('div',{className:'text-base font-black text-purple-700'},actionStats.unpackedUnits),h('div',{className:'text-[8px] font-bold text-purple-700/75 leading-tight'},'Belum Packing'))
      ),
      h('div',{className:'grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-slate-100'},[['Belanja',actionStats.shoppingProgress],['Pembayaran',actionStats.paymentProgress],['Packing',actionStats.packingProgress]].map(([label,pct])=>h('div',{key:label},h('div',{className:'flex justify-between text-[8px] font-bold text-slate-400 mb-1'},h('span',null,label),h('span',null,`${pct}%`)),h('div',{className:'h-1.5 rounded-full bg-slate-100 overflow-hidden'},h('div',{className:'h-full bg-slate-950 rounded-full',style:{width:`${pct}%`}})))))
    ),
    h('div',{className:'grid grid-cols-2 gap-2'},
      h('button',{onClick:()=>openAddOrder(),className:'h-11 rounded-xl bg-slate-950 text-white text-xs font-black flex items-center justify-center gap-2'},h(Icon,{name:'add',size:17}),'Catat Pesanan'),
      h('button',{onClick:()=>{if(tripReadOnly)return showToast('Trip lama read-only','warn');setBulkWhatsAppText('');setModalType('IMPORT');},className:'h-11 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-black flex items-center justify-center gap-2'},h(Icon,{name:'wa',size:17}),'Import')
    )
  );

  const renderOrders = () => h('div',{className:'fade-in'},
    h('div',{className:'flex gap-2 mb-2'},
      h('div',{className:'relative flex-1'},h('span',{className:'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'},h(Icon,{name:'search',size:15})),h('input',{value:searchQuery,onChange:e=>setSearchQuery(e.target.value),placeholder:'Cari pelanggan / barang / resi...',className:`${inputCls} pl-9 py-2`})),
      h('button',{onClick:()=>openAddOrder(),disabled:tripReadOnly,className:'tap-target px-3 rounded-xl bg-slate-950 text-white disabled:opacity-40'},h(Icon,{name:'add',size:18}))
    ),
    h('div',{className:'grid grid-cols-4 gap-1.5 mb-2'},
      h('select',{value:filters.shopping,onChange:e=>setFilters(p=>({...p,shopping:e.target.value})),className:'min-w-0 bg-white border border-slate-200 rounded-lg px-1.5 py-2 text-[9px] font-black'},h('option',{value:'ALL'},'Belanja'),h('option',{value:'TODO'},'Belum Dibeli'),h('option',{value:'MENUNGGU'},'Menunggu'),h('option',{value:'DICARI'},'Dicari'),h('option',{value:'SEBAGIAN'},'Sebagian'),h('option',{value:'DIBELI'},'Dibeli'),h('option',{value:'CANCELLED'},'Dibatalkan')),
      h('select',{value:filters.payment,onChange:e=>setFilters(p=>({...p,payment:e.target.value})),className:'min-w-0 bg-white border border-slate-200 rounded-lg px-1.5 py-2 text-[9px] font-black'},h('option',{value:'ALL'},'Pembayaran'),h('option',{value:'UNPAID'},'Belum Bayar'),h('option',{value:'PARTIAL'},'Sudah DP'),h('option',{value:'PAID'},'Lunas'),h('option',{value:'OUTSTANDING'},'Ada Sisa')),
      h('select',{value:filters.packing,onChange:e=>setFilters(p=>({...p,packing:e.target.value})),className:'min-w-0 bg-white border border-slate-200 rounded-lg px-1.5 py-2 text-[9px] font-black'},h('option',{value:'ALL'},'Packing'),h('option',{value:'UNPACKED'},'Belum'),h('option',{value:'DONE'},'Selesai')),
      h('select',{value:orderSort,onChange:e=>setOrderSort(e.target.value),className:'min-w-0 bg-white border border-slate-200 rounded-lg px-1.5 py-2 text-[9px] font-black'},h('option',{value:'priority'},'Prioritas'),h('option',{value:'name'},'Nama'),h('option',{value:'recent'},'Terbaru'))
    ),
    activeFilterCount?h('div',{className:'flex gap-1.5 flex-wrap mb-2 text-[9px] font-bold'},filters.shopping!=='ALL'?h('button',{onClick:()=>setFilters(p=>({...p,shopping:'ALL'})),className:'bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-full'},`Belanja: ${filters.shopping} ×`):null,filters.payment!=='ALL'?h('button',{onClick:()=>setFilters(p=>({...p,payment:'ALL'})),className:'bg-orange-50 text-orange-700 border border-orange-100 px-2 py-1 rounded-full'},`Bayar: ${filters.payment} ×`):null,filters.packing!=='ALL'?h('button',{onClick:()=>setFilters(p=>({...p,packing:'ALL'})),className:'bg-purple-50 text-purple-700 border border-purple-100 px-2 py-1 rounded-full'},`Packing: ${filters.packing} ×`):null):null,
    groupedOrders.length===0?h(EmptyState,{title:'Tidak ada pesanan yang cocok',subtitle:'Ubah pencarian atau filter.'}):h('div',{className:'space-y-2'},groupedOrders.map(group=>{
      const allSelected=group.items.length>0&&group.items.every(o=>isSelected(o.id));
      return h('section',{key:group.customerId,className:'compact-card overflow-hidden'},
        h('div',{className:'flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50/60'},
          h('input',{type:'checkbox',checked:allSelected,onChange:e=>setGroupSelected(group,e.target.checked),className:'w-4 h-4 accent-blue-600 shrink-0'}),
          h('button',{onClick:()=>openCustomerDetail(customers.find(c=>String(c.id)===String(group.customerId))||{id:group.customerId,name:group.customerName,whatsapp:group.whatsapp}),className:'min-w-0 flex-1 text-left'},h('div',{className:'flex items-center gap-1.5'},h('h3',{className:'font-black text-sm text-slate-900 truncate'},group.customerName),h('span',{className:'text-[8px] font-black text-slate-500 bg-slate-200/60 px-1.5 py-0.5 rounded'},`${group.totalUnits} unit`)),h('div',{className:'text-[9px] font-semibold text-slate-400 mt-0.5'},`${group.totalTypes} jenis${group.whatsapp?` • ${group.whatsapp}`:''}`)),
          h('div',{className:'text-right shrink-0'},h('div',{className:'text-[8px] font-bold text-slate-400'},'Sisa'),h('div',{className:`text-[12px] font-black tabular-nums ${group.totalUnpaid>0?'text-red-600':'text-emerald-600'}`},formatIDR(group.totalUnpaid)))
        ),
        h('div',{className:'divide-y divide-slate-100'},group.items.map(o=>h('div',{key:o.id,className:`flex items-start gap-2 px-3 py-2 ${isSelected(o.id)?'bg-blue-50/50':'bg-white'}`},
          h('label',{className:'pt-0.5 shrink-0'},h('input',{type:'checkbox',checked:isSelected(o.id),onChange:()=>toggleSelected(o.id),className:'w-4 h-4 accent-blue-600'})),
          h('button',{onClick:()=>openOrderDetail(o),className:'min-w-0 flex-1 text-left'},
            h('div',{className:'product-title font-bold text-[13px] leading-[1.25] text-slate-900'},o.itemName,h('span',{className:'ml-1.5 text-[9px] font-black text-slate-500 whitespace-nowrap'},`×${n(o.quantity,1)}`)),
            h('div',{className:'flex items-center justify-between gap-2 mt-1'},h('div',{className:'min-w-0 text-[9px] font-bold whitespace-nowrap overflow-hidden'},h('span',{className:statusColor(o.itemStatus)},o.itemStatus),h('span',{className:'text-slate-300 mx-1'},'•'),h('span',{className:statusColor(o.paymentStatus)},o.paymentStatus==='DP Diterima'?'DP':o.paymentStatus),h('span',{className:'text-slate-300 mx-1'},'•'),h('span',{className:statusColor(o.packingStatus)},o.packingStatus==='Selesai'?'Packing ✓':'Belum Packing')),h('span',{className:'text-[11px] font-black tabular-nums text-slate-900 shrink-0'},formatIDR(o.sellingPriceIdr)))
          )
        ))),
        h('div',{className:'px-3 py-2 border-t border-slate-100 flex items-center gap-1.5'},h('div',{className:'min-w-0 flex-1 text-[9px] text-slate-400 font-semibold'},`${group.totalTypes} jenis • ${group.totalUnits} unit • Tagihan ${formatIDR(group.totalBill)}`),h('button',{onClick:()=>openPayment(group),disabled:tripReadOnly,className:'px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-[9px] font-black disabled:opacity-40'},'Bayar'),h('button',{onClick:()=>openPacking(group),disabled:tripReadOnly,className:'px-2.5 py-1.5 rounded-lg bg-purple-50 border border-purple-100 text-purple-700 text-[9px] font-black disabled:opacity-40'},'Packing'),h('button',{onClick:()=>openWA(group),className:'px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 text-[9px] font-black'},'WA'))
      );
    }))
  );

  const renderShopping = () => h('div',{className:'fade-in space-y-2.5'},
    tripReadOnly?h('div',{className:'rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800'},'Trip selesai — Mode Belanja read-only.'):null,
    activeSession?h('div',{className:'rounded-xl bg-slate-950 text-white px-3 py-2.5 flex items-center gap-2'},h(Icon,{name:'shop',size:18,className:'shrink-0'}),h('div',{className:'min-w-0 flex-1'},h('div',{className:'text-[9px] text-slate-400 font-bold uppercase tracking-wider'},'Sesi Belanja Aktif'),h('div',{className:'text-xs font-black truncate'},activeSession.store)),h('button',{onClick:endSession,disabled:tripReadOnly,className:'px-2.5 py-1.5 rounded-lg bg-white text-slate-950 text-[9px] font-black disabled:opacity-40'},'Akhiri')):h('button',{onClick:()=>{const stores=Array.from(new Set(shoppingProducts.map(p=>p.store))).filter(Boolean);setSessionForm({store:stores[0]||'',note:''});setModalType('START_SESSION');},disabled:tripReadOnly,className:'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 flex items-center justify-between disabled:opacity-40'},h('span',{className:'flex items-center gap-2 text-xs font-black'},h(Icon,{name:'shop',size:17}),'Mulai Sesi Belanja'),h(Icon,{name:'chevron',size:16,className:'text-slate-400'})),
    h('div',{className:'flex gap-2'},h('div',{className:'relative flex-1'},h('span',{className:'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'},h(Icon,{name:'search',size:15})),h('input',{value:shopSearch,onChange:e=>setShopSearch(e.target.value),placeholder:'Cari barang / toko...',className:`${inputCls} pl-9 py-2`})),h('div',{className:'grid grid-cols-2 bg-slate-100 rounded-xl p-1 shrink-0'},h('button',{onClick:()=>setShopGroupBy('store'),className:`px-2.5 rounded-lg text-[9px] font-black ${shopGroupBy==='store'?'bg-white shadow-sm text-slate-900':'text-slate-400'}`},'Toko'),h('button',{onClick:()=>setShopGroupBy('product'),className:`px-2.5 rounded-lg text-[9px] font-black ${shopGroupBy==='product'?'bg-white shadow-sm text-slate-900':'text-slate-400'}`},'Barang'))),
    shoppingProducts.length===0?h(EmptyState,{title:'Belanja selesai 🎉',subtitle:activeSession?'Tidak ada barang tersisa di sesi toko ini.':'Tidak ada barang yang perlu dibeli.'}):shopGroupBy==='store'?h('div',{className:'space-y-2'},shoppingByStore.map(store=>h('section',{key:store.store,className:'compact-card overflow-hidden'},
      h('div',{className:'px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2'},h(Icon,{name:'map',size:15,className:'text-slate-500'}),h('div',{className:'min-w-0 flex-1'},h('div',{className:'text-xs font-black truncate'},store.store),h('div',{className:'text-[9px] text-slate-400 font-semibold'},`${store.items.length} jenis • ${store.required} unit • sisa ${store.remaining}`)),h('div',{className:'text-[10px] font-black text-slate-600'},`${store.required?Math.round(store.purchased/store.required*100):100}%`)),
      h('div',{className:'divide-y divide-slate-100'},store.items.map(p=>h('button',{key:p.key,onClick:()=>openPurchase(p),disabled:tripReadOnly||p.remaining<=0,className:'w-full px-3 py-2 text-left flex items-center gap-2 disabled:opacity-60'},h('div',{className:`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${p.remaining?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'}`},p.remaining?h(Icon,{name:'shop',size:15}):h(Icon,{name:'check',size:15})),h('div',{className:'min-w-0 flex-1'},h('div',{className:'product-title text-[12px] leading-tight font-black'},p.name),h('div',{className:'text-[9px] font-semibold text-slate-400 mt-0.5'},`${p.purchased}/${p.required} ${p.unit} dibeli${p.remaining?` • sisa ${p.remaining}`:''}`)),h('span',{className:'text-[9px] font-black text-slate-400'},p.remaining?'Beli':'Selesai'))))
    ))):h('div',{className:'space-y-2'},shoppingProducts.map(p=>h('button',{key:p.key,onClick:()=>openPurchase(p),disabled:tripReadOnly||p.remaining<=0,className:'compact-card w-full px-3 py-2.5 text-left flex items-center gap-2 disabled:opacity-60'},h('div',{className:'min-w-0 flex-1'},h('div',{className:'product-title text-[13px] leading-tight font-black'},p.name),h('div',{className:'text-[9px] text-slate-400 font-semibold mt-1'},`${p.store} • ${p.purchased}/${p.required} ${p.unit} • sisa ${p.remaining}`)),h('div',{className:'text-right shrink-0'},h('div',{className:'text-[10px] font-black text-slate-900'},formatForeign(p.currency,p.estimatedCost)),h('div',{className:'text-[8px] text-slate-400'},'estimasi/unit')))))
  );

  const renderCustomers = () => h('div',{className:'fade-in'},
    h('div',{className:'flex items-center gap-2 mb-2'},h('div',{className:'relative flex-1'},h('span',{className:'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'},h(Icon,{name:'search',size:15})),h('input',{value:searchQuery,onChange:e=>setSearchQuery(e.target.value),placeholder:'Cari pelanggan / WA / alamat...',className:`${inputCls} pl-9 py-2`})),h('button',{onClick:()=>openCustomerForm(),className:'tap-target px-3 rounded-xl bg-slate-950 text-white'},h(Icon,{name:'add',size:18}))),
    h('div',{className:'space-y-1.5'},filteredCustomers.length?filteredCustomers.map(c=>{const m=customerMetrics(c.id);return h('button',{key:c.id,onClick:()=>openCustomerDetail(c),className:'compact-card w-full px-3 py-2.5 flex items-center gap-2 text-left'},h('div',{className:'w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-black shrink-0'},String(c.name||'?').slice(0,1).toUpperCase()),h('div',{className:'min-w-0 flex-1'},h('div',{className:'font-black text-[13px] text-slate-900'},c.name),h('div',{className:'text-[9px] text-slate-400 font-semibold mt-0.5 truncate'},`${c.whatsapp||'Tanpa WA'} • ${m.units} unit • ${m.trips} trip`)),m.outstanding>0?h('div',{className:'text-right shrink-0'},h('div',{className:'text-[8px] text-slate-400 font-bold'},'Piutang'),h('div',{className:'text-[10px] font-black text-red-600'},formatIDR(m.outstanding))):m.credit>0?h('div',{className:'text-right shrink-0'},h('div',{className:'text-[8px] text-slate-400 font-bold'},'Kredit'),h('div',{className:'text-[10px] font-black text-orange-600'},formatIDR(m.credit))):h(Icon,{name:'chevron',size:16,className:'text-slate-300 shrink-0'}));}):h(EmptyState,{title:'Pelanggan tidak ditemukan'}))
  );

  const renderCatalog = () => h('div',{className:'fade-in'},
    h('div',{className:'flex items-center gap-2 mb-2'},h('div',{className:'relative flex-1'},h('span',{className:'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'},h(Icon,{name:'search',size:15})),h('input',{value:searchQuery,onChange:e=>setSearchQuery(e.target.value),placeholder:'Cari produk / alias / toko...',className:`${inputCls} pl-9 py-2`})),h('button',{onClick:()=>openCatalogForm(),className:'tap-target px-3 rounded-xl bg-slate-950 text-white'},h(Icon,{name:'add',size:18}))),
    h('div',{className:'flex items-center justify-between mb-2 px-1'},h('div',{className:'text-[9px] text-slate-400 font-semibold'},`${filteredCatalog.length} produk ditampilkan`),h('label',{className:'flex items-center gap-1.5 text-[9px] font-bold text-slate-500'},h('input',{type:'checkbox',checked:showArchivedProducts,onChange:e=>setShowArchivedProducts(e.target.checked),className:'accent-slate-900'}),'Tampilkan Arsip')),
    h('div',{className:'space-y-1.5'},filteredCatalog.length?filteredCatalog.map(c=>h('button',{key:c.id,onClick:()=>{setCatalogForm({...c});setEditingId(c.id);setModalType('CATALOG_DETAIL');},className:`compact-card w-full px-3 py-2.5 text-left ${c.isArchived?'opacity-55':''}`},
      h('div',{className:'product-title text-[13px] font-black leading-[1.25] text-slate-900'},c.name),
      h('div',{className:'flex items-end justify-between gap-2 mt-1'},h('div',{className:'min-w-0 text-[9px] text-slate-400 font-semibold'},h('div',{className:'truncate'},`${c.category||'Umum'} • ${c.store||'Tanpa toko'}${c.unit?` • ${c.unit}`:''}`),h('div',{className:'mt-0.5'},`Modal ${formatForeign(c.currency,c.foreignCost)}${n(c.lastPurchaseCost)>0?` • terakhir ${formatForeign(c.lastPurchaseCurrency||c.currency,c.lastPurchaseCost)}`:''}`)),h('div',{className:'text-right shrink-0'},h('div',{className:'text-[12px] font-black tabular-nums'},formatIDR(c.sellingPriceIdr)),h('div',{className:`text-[8px] font-bold mt-0.5 ${c.isPublished?'text-emerald-600':'text-slate-400'}`},c.isArchived?'Diarsipkan':c.isPublished?'Storefront ✓':'Internal')))
    )):h(EmptyState,{title:'Produk tidak ditemukan'}))
  );

  const renderSummary = () => h('div',{className:'bg-slate-950 text-white min-h-[100dvh] px-4 pt-3 pb-8 fade-in'},
    h('div',{className:'max-w-5xl mx-auto'},
      h('div',{className:'flex items-center justify-between mb-4'},h('button',{onClick:()=>setCurrentTab('dashboard'),className:'tap-target -ml-2 px-2 flex items-center gap-1 text-xs font-black'},h('span',{className:'rotate-180'},h(Icon,{name:'chevron',size:17})),'Kembali'),h('div',{className:'flex gap-1.5'},h('button',{onClick:()=>setModalType('REPORT'),className:'tap-target w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center'},h(Icon,{name:'download',size:17})),h('button',{onClick:()=>setModalType('TRIPS'),className:'tap-target w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center'},h(Icon,{name:'more',size:17})))),
      h('div',{className:'mb-5'},h('div',{className:'text-[9px] uppercase tracking-[.16em] font-black text-red-400'},summaryTrip?.status==='Aktif'?'Trip Aktif':'Riwayat Trip'),h('h1',{className:'text-2xl font-black mt-1'},summaryTrip?.title||'Trip'),h('div',{className:'text-3xl sm:text-4xl font-black mt-4 money-tight tabular-nums'},formatIDR(summaryData.revenue)),h('div',{className:'text-[10px] text-slate-400 font-semibold mt-1'},`${summaryData.customersCount} pelanggan • ${summaryData.orderTypes} jenis • ${summaryData.units} unit`)),
      h('div',{className:'grid grid-cols-2 gap-2 mb-3'},[['Modal',summaryData.projectedCost,'text-white'],['Profit',summaryData.profit,'text-emerald-400'],['Sudah Dibayar',summaryData.paid,'text-blue-300'],['Piutang',summaryData.outstanding,'text-amber-400']].map(([label,val,cls])=>h('div',{key:label,className:'rounded-xl bg-white/[.06] border border-white/[.07] p-3'},h('div',{className:'text-[9px] text-slate-500 font-bold'},label),h('div',{className:`text-[15px] font-black mt-1 tabular-nums money-tight ${cls}`},formatIDR(val))))),
      h('div',{className:'grid grid-cols-2 gap-2 mb-3'},h('div',{className:'rounded-xl bg-white/[.06] border border-white/[.07] p-3'},h('div',{className:'text-[9px] uppercase tracking-wider font-black text-red-400'},'Top Pelanggan'),h('div',{className:'text-sm font-black mt-1'},summaryData.topCustomer?.name||'-'),h('div',{className:'text-[10px] text-slate-400 mt-1'},summaryData.topCustomer?formatIDR(summaryData.topCustomer.revenue):'-')),h('div',{className:'rounded-xl bg-white/[.06] border border-white/[.07] p-3'},h('div',{className:'text-[9px] uppercase tracking-wider font-black text-red-400'},'Top Produk'),h('div',{className:'text-sm font-black mt-1 product-title'},summaryData.topProduct?.name||'-'),h('div',{className:'text-[10px] text-slate-400 mt-1'},summaryData.topProduct?`${summaryData.topProduct.qty} unit`:'-'))),
      summaryData.refundDue>0?h('div',{className:'rounded-xl bg-red-500/10 border border-red-500/20 p-3 mb-3 text-[10px] font-bold text-red-300'},`Refund belum selesai: ${formatIDR(summaryData.refundDue)} • ${summaryData.cancelled} pesanan dibatalkan`):null,
      h('div',{className:'text-[9px] font-black uppercase tracking-[.15em] text-slate-500 mb-2'},'Breakdown per Pelanggan'),
      h('div',{className:'space-y-1.5'},summaryData.customerBreakdown.map((c,i)=>h('div',{key:c.id,className:'rounded-xl bg-white/[.06] border border-white/[.07] px-3 py-2.5 flex items-center gap-2'},h('div',{className:'w-7 h-7 rounded-full bg-white/[.08] flex items-center justify-center text-[9px] font-black shrink-0'},i+1),h('div',{className:'min-w-0 flex-1'},h('div',{className:'text-[12px] font-black'},c.name),h('div',{className:'text-[9px] text-slate-500 mt-0.5'},`${c.units} unit • ${c.rows} jenis • sisa ${formatIDR(c.outstanding)}`)),h('div',{className:'text-right shrink-0'},h('div',{className:'text-[11px] font-black tabular-nums'},formatIDR(c.revenue)),h('div',{className:'text-[8px] font-bold text-emerald-400'},`margin ${formatIDR(c.margin)}`))))),
      summaryTrip?.status==='Aktif'?h('button',{onClick:()=>closeTrip(summaryTrip),className:'w-full mt-4 py-3 rounded-xl bg-red-500 text-white text-xs font-black'},'Selesaikan Trip'):null
    )
  );

  const renderBottomNav = () => currentTab==='summary'?null:h('nav',{className:'fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-xl border-t border-slate-200',style:{paddingBottom:'env(safe-area-inset-bottom, 0px)'}},h('div',{className:'max-w-md mx-auto grid grid-cols-5 h-[66px]'},[
    ['dashboard','dashboard','Ringkasan'],['orders','orders','Pesanan'],['shopping','shop','Belanja'],['customers','customers','Pelanggan'],['catalog','catalog','Katalog']
  ].map(([tab,icon,label])=>h('button',{key:tab,onClick:()=>{setCurrentTab(tab);setSearchQuery('');setSelectedOrderIds([]);},className:`flex flex-col items-center justify-center gap-0.5 ${currentTab===tab?'text-slate-950':'text-slate-400'}`},h('div',{className:`w-8 h-8 rounded-xl flex items-center justify-center ${currentTab===tab?(tab==='shopping'?'bg-red-50 text-red-600':'bg-slate-100'):''}`},h(Icon,{name:icon,size:19})),h('span',{className:'text-[8px] font-black'},label)))));

  const renderBulkToolbar = () => currentTab==='orders'&&selectedOrderIds.length>0?h('div',{className:'fixed left-0 right-0 z-40 px-3 pointer-events-none',style:{bottom:'calc(66px + env(safe-area-inset-bottom, 0px) + 6px)'}},h('div',{className:'max-w-3xl mx-auto rounded-2xl bg-slate-950 text-white shadow-2xl p-3 pointer-events-auto'},
    h('div',{className:'flex items-center justify-between mb-2'},h('div',{className:'text-[10px] font-black'},`${selectedStats.rows} jenis • ${selectedStats.units} unit • ${selectedStats.customers} pelanggan`),h('button',{onClick:()=>{setSelectedOrderIds([]);setBulkAction({item:'',payment:'',packing:''});},className:'text-[9px] font-bold text-slate-400'},'Batal pilih')),
    h('div',{className:'grid grid-cols-3 gap-1.5'},
      h('select',{value:bulkAction.item,onChange:e=>setBulkAction(p=>({...p,item:e.target.value})),className:'min-w-0 rounded-lg bg-white text-slate-900 px-1.5 py-2 text-[9px] font-black'},h('option',{value:''},'Belanja: —'),h('option',{value:'Menunggu'},'Menunggu'),h('option',{value:'Dicari'},'Dicari'),h('option',{value:'Dibeli'},'Dibeli')),
      h('select',{value:bulkAction.payment,onChange:e=>setBulkAction(p=>({...p,payment:e.target.value})),className:'min-w-0 rounded-lg bg-white text-slate-900 px-1.5 py-2 text-[9px] font-black'},h('option',{value:''},'Bayar: —'),h('option',{value:'DP Diterima'},'Catat DP 50%'),h('option',{value:'Lunas'},'Lunaskan')),
      h('select',{value:bulkAction.packing,onChange:e=>setBulkAction(p=>({...p,packing:e.target.value})),className:'min-w-0 rounded-lg bg-white text-slate-900 px-1.5 py-2 text-[9px] font-black'},h('option',{value:''},'Packing: —'),h('option',{value:'Belum'},'Belum'),h('option',{value:'Selesai'},'Selesai'))
    ),
    h('button',{onClick:applyBulk,disabled:!bulkAction.item&&!bulkAction.payment&&!bulkAction.packing,className:'w-full mt-2 py-2.5 rounded-xl bg-white text-slate-950 text-[10px] font-black disabled:bg-white/10 disabled:text-slate-500'},'Terapkan Perubahan')
  )):null;

  const renderModal = () => {
    if(!modalType)return null;
    if(modalType==='GLOBAL_SEARCH')return h(ModalShell,{title:'Cari Global',subtitle:'Pelanggan, barang, nomor WA, resi, produk, atau Trip.',onClose:()=>setModalType(null)},h('div',{className:'p-4'},h('div',{className:'relative'},h('span',{className:'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'},h(Icon,{name:'search',size:17})),h('input',{autoFocus:true,value:globalSearchQuery,onChange:e=>setGlobalSearchQuery(e.target.value),placeholder:'Cari apa saja...',className:`${inputCls} pl-10`})),h('div',{className:'mt-3 space-y-1.5'},globalSearchQuery&&!globalResults.length?h(EmptyState,{title:'Tidak ada hasil'}):globalResults.map((r,i)=>h('button',{key:`${r.type}-${i}`,onClick:r.action,className:'w-full rounded-xl border border-slate-100 px-3 py-2.5 text-left flex items-center gap-2'},h('span',{className:'text-[8px] font-black uppercase tracking-wider text-slate-400 w-16 shrink-0'},r.type),h('div',{className:'min-w-0 flex-1'},h('div',{className:'text-xs font-black product-title'},r.title),h('div',{className:'text-[9px] text-slate-400 truncate mt-0.5'},r.subtitle)),h(Icon,{name:'chevron',size:14,className:'text-slate-300'}))))));

    if(modalType==='TRIPS') {
      const tripCards = trips.map(t => h('div',{
        key:t.id,
        className:`rounded-xl border p-3 ${String(t.id)===String(activeTripId)?'border-slate-900 bg-slate-50':'border-slate-200'}`
      },
        h('div',{className:'flex items-start gap-2'},
          h('button',{
            onClick:()=>{setActiveTripId(t.id);setSummaryTripId(t.id);setArchivedEditTripId(null);setModalType(null);setCurrentTab('dashboard');},
            className:'min-w-0 flex-1 text-left'
          },
            h('div',{className:'font-black text-sm'},t.title),
            h('div',{className:'text-[9px] text-slate-400 mt-0.5'},`${t.destination||'Tanpa tujuan'} • ${t.status}`)
          ),
          h('span',{className:`text-[8px] font-black px-2 py-1 rounded-lg ${t.status==='Aktif'?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'}`},t.status)
        ),
        h('div',{className:'grid grid-cols-3 gap-1.5 mt-2'},
          h('button',{onClick:()=>openTripSummary(t.id),className:'py-2 rounded-lg bg-slate-950 text-white text-[9px] font-black'},'Rangkuman'),
          t.status==='Selesai'
            ? h('button',{onClick:()=>{setActiveTripId(t.id);setArchivedEditTripId(t.id);setModalType(null);setCurrentTab('orders');showToast('Edit Trip Lama dibuka. Perubahan akan menyentuh histori.','warn');},className:'py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-black'},'Edit Lama')
            : h('button',{onClick:()=>{setActiveTripId(t.id);setModalType(null);setCurrentTab('shopping');},className:'py-2 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-[9px] font-black'},'Belanja'),
          t.status==='Aktif'
            ? h('button',{onClick:()=>closeTrip(t),className:'py-2 rounded-lg bg-red-50 border border-red-100 text-red-700 text-[9px] font-black'},'Selesaikan')
            : h('div',null)
        )
      ));
      return h(ModalShell,{
        title:'Trip & Riwayat',
        subtitle:'Tap nama Trip untuk menjadikannya konteks kerja. Trip selesai read-only secara default.',
        onClose:()=>setModalType(null),
        max:'max-w-md'
      },
        h('div',{className:'p-4 space-y-2'},
          ...tripCards,
          trips.length ? h('div',{className:'border-t border-slate-100 pt-3 mt-3'}) : null,
          h('form',{onSubmit:saveTrip,className:'space-y-2'},
            h('div',{className:'text-[9px] font-black uppercase tracking-wider text-slate-400'},'Buat Trip Baru'),
            h('input',{value:tripForm.title,onChange:e=>setTripForm(p=>({...p,title:e.target.value})),placeholder:'Nama Trip, mis. Abu Dhabi Agustus',className:inputCls}),
            h('input',{value:tripForm.destination,onChange:e=>setTripForm(p=>({...p,destination:e.target.value})),placeholder:'Tujuan / asal belanja',className:inputCls}),
            h('button',{type:'submit',className:'w-full py-2.5 rounded-xl bg-slate-950 text-white text-xs font-black'},'Buat Trip')
          )
        )
      );
    }

    if(modalType==='BANKS')return h(ModalShell,{title:'Rekening Pembayaran',subtitle:'Tandai satu rekening utama. Saat WA, Anda bisa memilih sampai 3 rekening.',onClose:()=>setModalType(null)},h('div',{className:'p-4 space-y-3'},settingsDraft.bankAccounts.map((a,i)=>h('div',{key:i,className:'rounded-xl border border-slate-200 p-3'},h('div',{className:'flex items-center justify-between mb-2'},h('span',{className:'text-[9px] font-black text-slate-400 uppercase'},`Rekening ${i+1}`),h('label',{className:'flex items-center gap-1 text-[9px] font-bold text-slate-500'},h('input',{type:'radio',name:'primaryBank',checked:!!a.isPrimary,onChange:()=>setSettingsDraft(p=>({...p,bankAccounts:p.bankAccounts.map((x,j)=>({...x,isPrimary:j===i}))}))}),'Utama')),h('div',{className:'grid grid-cols-2 gap-2'},h('input',{value:a.bankName,onChange:e=>setSettingsDraft(p=>({...p,bankAccounts:p.bankAccounts.map((x,j)=>j===i?{...x,bankName:e.target.value}:x)})),placeholder:'Bank',className:tinyInputCls}),h('input',{value:a.accountNumber,onChange:e=>setSettingsDraft(p=>({...p,bankAccounts:p.bankAccounts.map((x,j)=>j===i?{...x,accountNumber:e.target.value}:x)})),placeholder:'Nomor rekening',className:tinyInputCls}),h('input',{value:a.accountHolder,onChange:e=>setSettingsDraft(p=>({...p,bankAccounts:p.bankAccounts.map((x,j)=>j===i?{...x,accountHolder:e.target.value}:x)})),placeholder:'Nama pemilik',className:`${tinyInputCls} col-span-2`})))),h('button',{onClick:saveSettingsConfig,className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},'Simpan Rekening')));

    if(modalType==='SETTINGS')return h(ModalShell,{title:'Pengaturan App & Kurs',subtitle:'Kurs dipakai sebagai estimasi modal sebelum harga aktual belanja dicatat.',onClose:()=>setModalType(null)},h('div',{className:'p-4 space-y-3'},h(Field,{label:'Mata Uang Default'},h('select',{value:settingsDraft.defaultCurrency,onChange:e=>setSettingsDraft(p=>({...p,defaultCurrency:e.target.value})),className:inputCls},Object.keys(settingsDraft.currencyRates).map(k=>h('option',{key:k,value:k},k)))),h('div',{className:'grid grid-cols-2 gap-2'},Object.keys(settingsDraft.currencyRates).map(k=>h(Field,{key:k,label:`Kurs ${k} → IDR`},h('input',{type:'number',value:settingsDraft.currencyRates[k],onChange:e=>setSettingsDraft(p=>({...p,currencyRates:{...p.currencyRates,[k]:n(e.target.value)}})),className:tinyInputCls})))),h('button',{onClick:saveSettingsConfig,className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},'Simpan Pengaturan')));

    if(modalType==='REPORT')return h(ModalShell,{title:'Unduh Report',subtitle:'Nominal tampil penuh. PDF untuk dibaca, Excel untuk analisis lanjutan.',onClose:()=>setModalType(null),max:'max-w-md'},h('div',{className:'p-4 space-y-2'},h('button',{onClick:()=>exportPDF(false),disabled:reportBusy,className:'w-full rounded-xl border border-slate-200 p-3 text-left flex items-center gap-3 disabled:opacity-50'},h('div',{className:'w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center'},h(Icon,{name:'download'})),h('div',null,h('div',{className:'text-xs font-black'},'PDF Ringkasan'),h('div',{className:'text-[9px] text-slate-400 mt-0.5'},'Keuangan, pelanggan, unit, dan breakdown utama.'))),h('button',{onClick:()=>exportPDF(true),disabled:reportBusy,className:'w-full rounded-xl border border-slate-200 p-3 text-left flex items-center gap-3 disabled:opacity-50'},h('div',{className:'w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center'},h(Icon,{name:'orders'})),h('div',null,h('div',{className:'text-xs font-black'},'PDF Laporan Lengkap'),h('div',{className:'text-[9px] text-slate-400 mt-0.5'},'Ringkasan + tabel transaksi lengkap.'))),h('button',{onClick:exportExcel,disabled:reportBusy,className:'w-full rounded-xl border border-slate-200 p-3 text-left flex items-center gap-3 disabled:opacity-50'},h('div',{className:'w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center'},h(Icon,{name:'catalog'})),h('div',null,h('div',{className:'text-xs font-black'},'Excel Lengkap'),h('div',{className:'text-[9px] text-slate-400 mt-0.5'},'Ringkasan, Pesanan, Pelanggan, Produk, Pembayaran.')))));

    if(modalType==='HEALTH')return h(ModalShell,{title:'Data Health Center',subtitle:'Pemeriksaan otomatis sebelum laporan atau penutupan Trip.',onClose:()=>setModalType(null),max:'max-w-md'},h('div',{className:'p-4'},healthIssues.length?h('div',{className:'space-y-2'},healthIssues.map((x,i)=>h('div',{key:i,className:`rounded-xl border p-3 flex gap-2 ${x.severity==='error'?'border-red-200 bg-red-50':'border-amber-200 bg-amber-50'}`},h(Icon,{name:'warning',size:17,className:x.severity==='error'?'text-red-600':'text-amber-600'}),h('div',{className:`text-[10px] font-bold ${x.severity==='error'?'text-red-700':'text-amber-800'}`},x.label)))):h('div',{className:'text-center py-8'},h('div',{className:'w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center'},h(Icon,{name:'check',size:24})),h('div',{className:'text-sm font-black mt-3'},'Semua data sehat'),h('div',{className:'text-[10px] text-slate-400 mt-1'},'Tidak ada masalah utama yang terdeteksi.'))));

    if(modalType==='ORDER_FORM')return h(ModalShell,{title:editingId?'Edit Pesanan':'Catat Pesanan',subtitle:'Harga jual adalah TOTAL untuk baris pesanan. Pembayaran lama tetap dipertahankan saat harga diedit.',onClose:()=>setModalType(null)},h('form',{onSubmit:saveOrder,className:'p-4 space-y-3'},
      h(Field,{label:'Pelanggan'},h('select',{value:orderForm.customerId||'',onChange:e=>setOrderForm(p=>({...p,customerId:e.target.value})),className:inputCls},h('option',{value:''},'Pilih pelanggan'),customers.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'id')).map(c=>h('option',{key:c.id,value:c.id},c.name)))),
      h(Field,{label:'Pilih dari Master Produk'},h('select',{value:orderForm.catalogId||'',onChange:e=>selectCatalogForOrder(e.target.value),className:inputCls},h('option',{value:''},'Manual / pilih produk'),catalog.filter(c=>!c.isArchived).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'id')).map(c=>h('option',{key:c.id,value:c.id},`${c.name} — ${formatIDR(c.sellingPriceIdr)}`)))),
      h(Field,{label:'Nama Barang'},h('input',{value:orderForm.itemName||'',onChange:e=>setOrderForm(p=>({...p,itemName:e.target.value})),placeholder:'Nama barang',className:inputCls})),
      h('div',{className:'grid grid-cols-3 gap-2'},h(Field,{label:'Qty'},h('input',{type:'number',min:1,value:orderForm.quantity||1,onChange:e=>handleOrderQty(e.target.value),className:tinyInputCls})),h(Field,{label:'Unit'},h('input',{value:orderForm.unit||'pcs',onChange:e=>setOrderForm(p=>({...p,unit:e.target.value})),className:tinyInputCls})),h(Field,{label:'Toko'},h('input',{value:orderForm.sourceStore||'',onChange:e=>setOrderForm(p=>({...p,sourceStore:e.target.value})),className:tinyInputCls}))),
      h('div',{className:'grid grid-cols-3 gap-2'},h(Field,{label:'Mata Uang'},h('select',{value:orderForm.foreignCurrency||settings.defaultCurrency,onChange:e=>setOrderForm(p=>({...p,foreignCurrency:e.target.value,exchangeRate:n(settings.currencyRates[e.target.value],1)})),className:tinyInputCls},Object.keys(settings.currencyRates).map(k=>h('option',{key:k,value:k},k)))),h(Field,{label:'Modal Estimasi / Unit'},h('input',{type:'number',step:'0.01',value:orderForm.foreignAmount??'',onChange:e=>setOrderForm(p=>({...p,foreignAmount:e.target.value})),className:tinyInputCls})),h(Field,{label:'Kurs'},h('input',{type:'number',value:orderForm.exchangeRate??'',onChange:e=>setOrderForm(p=>({...p,exchangeRate:e.target.value})),className:tinyInputCls}))),
      h(Field,{label:'Harga Jual Total',hint:'Total untuk seluruh Qty pada baris ini.'},h('input',{type:'number',value:orderForm.sellingPriceIdr??'',onChange:e=>setOrderForm(p=>({...p,sellingPriceIdr:e.target.value})),className:inputCls})),
      editingId?h('div',{className:'rounded-xl bg-slate-50 border border-slate-200 p-3 text-[10px]'},h('div',{className:'grid grid-cols-2 gap-2'},h('div',null,h('div',{className:'text-slate-400 font-bold'},'Sudah dibayar'),h('div',{className:'font-black mt-0.5'},formatIDR(getPaidAmount(orders.find(o=>String(o.id)===String(editingId))||orderForm)))),h('div',null,h('div',{className:'text-slate-400 font-bold'},'Sisa setelah harga baru'),h('div',{className:'font-black mt-0.5'},formatIDR(Math.max(0,n(orderForm.sellingPriceIdr)-getPaidAmount(orders.find(o=>String(o.id)===String(editingId))||orderForm))))))):null,
      h(Field,{label:'Nomor Resi (opsional)'},h('input',{value:orderForm.trackingNumber||'',onChange:e=>setOrderForm(p=>({...p,trackingNumber:e.target.value})),className:inputCls})),
      h('button',{type:'submit',className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},editingId?'Simpan Perubahan':'Simpan Pesanan')
    ));

    if(modalType==='ORDER_DETAIL'&&selectedOrder){const o=orders.find(x=>String(x.id)===String(selectedOrder.id))||selectedOrder;return h(ModalShell,{title:o.itemName,subtitle:`${o.customerName} • ${n(o.quantity,1)} ${o.unit||'pcs'}`,onClose:()=>setModalType(null),max:'max-w-md'},h('div',{className:'p-4 space-y-3'},
      h('div',{className:'grid grid-cols-2 gap-2'},[['Harga Jual',formatIDR(o.sellingPriceIdr)],['Sudah Dibayar',formatIDR(o.paidAmountIdr)],['Sisa',formatIDR(o.remainingBalanceIdr)],['Modal Estimasi',formatIDR(o.baseCostIdr)]].map(([a,b])=>h('div',{key:a,className:'rounded-xl bg-slate-50 border border-slate-100 p-3'},h('div',{className:'text-[8px] font-bold text-slate-400'},a),h('div',{className:'text-[11px] font-black mt-1'},b)))),
      h('div',{className:'rounded-xl border border-slate-200 p-3 text-[10px] space-y-1.5'},h('div',{className:'flex justify-between'},h('span',{className:'text-slate-400'},'Belanja'),h('span',{className:`font-black ${statusColor(o.itemStatus)}`},o.itemStatus==='Sebagian'?`${o.itemStatus} ${effectivePurchased(o)}/${n(o.quantity,1)}`:o.itemStatus)),h('div',{className:'flex justify-between'},h('span',{className:'text-slate-400'},'Pembayaran'),h('span',{className:`font-black ${statusColor(o.paymentStatus)}`},o.paymentStatus)),h('div',{className:'flex justify-between'},h('span',{className:'text-slate-400'},'Packing'),h('span',{className:`font-black ${statusColor(o.packingStatus)}`},`${effectivePacked(o)}/${n(o.quantity,1)} • ${o.packingStatus}`)),h('div',{className:'flex justify-between'},h('span',{className:'text-slate-400'},'Modal Aktual'),h('span',{className:'font-black'},n(o.actualBaseCostIdr)>0?formatIDR(o.actualBaseCostIdr):'Belum dicatat')),o.shoppingNote?h('div',{className:'pt-2 mt-2 border-t border-slate-100 text-amber-700 font-bold'},`Catatan belanja: ${o.shoppingNote}`):null,o.trackingNumber?h('div',{className:'pt-2 mt-2 border-t border-slate-100'},`Resi: ${o.trackingNumber}`):null),
      o.itemStatus==='Dibatalkan'?h('div',{className:'rounded-xl bg-red-50 border border-red-100 p-3'},h('div',{className:'text-[9px] font-black text-red-700'},`Pesanan Dibatalkan • Refund ${o.refundStatus||'Tidak Perlu'}`),n(o.refundAmountIdr)>0?h('div',{className:'text-[11px] font-black text-red-700 mt-1'},formatIDR(o.refundAmountIdr)):null,o.refundStatus==='Diperlukan'?h('button',{onClick:()=>completeRefund(o),className:'mt-2 w-full py-2 rounded-lg bg-red-600 text-white text-[9px] font-black'},'Tandai Refund Selesai'):null):null,
      o.itemStatus!=='Dibatalkan'?h('div',{className:'grid grid-cols-2 gap-2'},h('button',{onClick:()=>openAddOrder(o),disabled:tripReadOnly,className:'py-2.5 rounded-xl bg-slate-950 text-white text-[10px] font-black disabled:opacity-40'},'Edit Pesanan'),h('button',{onClick:()=>cancelOrder(o),disabled:tripReadOnly,className:'py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[10px] font-black disabled:opacity-40'},'Batalkan')):null
    ));}

    if(modalType==='CUSTOMER_FORM')return h(ModalShell,{title:editingId?'Edit Pelanggan':'Tambah Pelanggan',subtitle:'Alamat tersimpan bisa dipakai kembali untuk pengiriman Trip berikutnya.',onClose:()=>setModalType(null)},h('form',{onSubmit:saveCustomer,className:'p-4 space-y-3'},h(Field,{label:'Nama'},h('input',{value:customerForm.name||'',onChange:e=>setCustomerForm(p=>({...p,name:e.target.value})),className:inputCls})),h(Field,{label:'WhatsApp'},h('input',{value:customerForm.whatsapp||'',onChange:e=>setCustomerForm(p=>({...p,whatsapp:e.target.value})),placeholder:'62812...',className:inputCls})),h('div',{className:'border-t border-slate-100 pt-3'},h('div',{className:'text-[9px] font-black uppercase tracking-wider text-slate-400 mb-2'},'Pengiriman Default'),h('div',{className:'grid grid-cols-2 gap-2'},h(Field,{label:'Nama Penerima'},h('input',{value:customerForm.recipientName||'',onChange:e=>setCustomerForm(p=>({...p,recipientName:e.target.value})),className:tinyInputCls})),h(Field,{label:'HP Penerima'},h('input',{value:customerForm.shippingPhone||'',onChange:e=>setCustomerForm(p=>({...p,shippingPhone:e.target.value})),className:tinyInputCls}))),h(Field,{label:'Alamat'},h('textarea',{rows:3,value:customerForm.address||'',onChange:e=>setCustomerForm(p=>({...p,address:e.target.value})),className:inputCls})),h('div',{className:'grid grid-cols-2 gap-2'},h(Field,{label:'Kode Pos'},h('input',{value:customerForm.postalCode||'',onChange:e=>setCustomerForm(p=>({...p,postalCode:e.target.value})),className:tinyInputCls})),h(Field,{label:'Catatan Pengiriman'},h('input',{value:customerForm.shippingNote||'',onChange:e=>setCustomerForm(p=>({...p,shippingNote:e.target.value})),className:tinyInputCls})))),h(Field,{label:'Catatan Internal'},h('textarea',{rows:2,value:customerForm.notes||'',onChange:e=>setCustomerForm(p=>({...p,notes:e.target.value})),className:inputCls})),h('button',{type:'submit',className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},'Simpan Pelanggan')));

    if(modalType==='CUSTOMER_DETAIL'&&selectedCustomer){const c=customers.find(x=>String(x.id)===String(selectedCustomer.id))||selectedCustomer;const m=customerMetrics(c.id);const ledger=paymentsFor(c.id).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));const group=customerGroupsAll.find(g=>String(g.customerId)===String(c.id));return h(ModalShell,{title:c.name,subtitle:c.whatsapp||'Tanpa WhatsApp',onClose:()=>setModalType(null)},h('div',{className:'p-4 space-y-3'},
      h('div',{className:'grid grid-cols-3 gap-2'},[['Trip',m.trips],['Unit',m.units],['Piutang',formatIDR(outstandingFor(c.id))]].map(([a,b])=>h('div',{key:a,className:'rounded-xl bg-slate-50 border border-slate-100 p-2.5'},h('div',{className:'text-[8px] font-bold text-slate-400'},a),h('div',{className:'text-[11px] font-black mt-0.5'},b)))),
      c.address?h('div',{className:'rounded-xl border border-slate-200 p-3'},h('div',{className:'text-[8px] font-black uppercase tracking-wider text-slate-400'},'Alamat Tersimpan'),h('div',{className:'text-[10px] font-bold mt-1 whitespace-pre-line'},`${c.recipientName||c.name}\n${c.shippingPhone||c.whatsapp||''}\n${c.address}${c.postalCode?`\n${c.postalCode}`:''}`),c.shippingNote?h('div',{className:'text-[9px] text-slate-400 mt-1'},c.shippingNote):null):h('div',{className:'rounded-xl border border-dashed border-slate-200 p-3 text-[9px] text-slate-400'},'Alamat pengiriman belum disimpan.'),
      h('div',{className:'grid grid-cols-4 gap-1.5'},h('button',{onClick:()=>openPayment(c),disabled:tripReadOnly,className:'py-2 rounded-lg bg-blue-50 text-blue-700 text-[9px] font-black disabled:opacity-40'},'Bayar'),h('button',{onClick:()=>openAdjustment(c),disabled:tripReadOnly,className:'py-2 rounded-lg bg-orange-50 text-orange-700 text-[9px] font-black disabled:opacity-40'},'Biaya'),h('button',{onClick:()=>openCustomerForm(c),className:'py-2 rounded-lg bg-slate-100 text-slate-700 text-[9px] font-black'},'Edit'),group?h('button',{onClick:()=>openWA(group),className:'py-2 rounded-lg bg-emerald-50 text-emerald-700 text-[9px] font-black'},'WA'):h('div',null)),
      h('div',null,h('div',{className:'text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1.5'},'Riwayat Pembayaran'),ledger.length?h('div',{className:'space-y-1.5'},ledger.map(p=>h('div',{key:p.id,className:'rounded-xl border border-slate-100 px-3 py-2 flex items-center gap-2'},h('div',{className:'min-w-0 flex-1'},h('div',{className:'text-[10px] font-black'},`${p.type||'Pembayaran'} • ${p.method||'-'}`),h('div',{className:'text-[8px] text-slate-400 mt-0.5'},`${formatDateTime(p.createdAt)}${p.note?` • ${p.note}`:''}`)),h('div',{className:`text-[10px] font-black tabular-nums ${n(p.amount)<0?'text-red-600':'text-emerald-600'}`},formatIDR(p.amount))))):h('div',{className:'text-[9px] text-slate-400'},'Belum ada pembayaran pada Trip ini.'))
    ));}

    if(modalType==='PAYMENT'&&selectedCustomer)return h(ModalShell,{title:'Catat Pembayaran',subtitle:`${selectedCustomer.name} • Sisa saat ini ${formatIDR(outstandingFor(selectedCustomer.id))}`,onClose:()=>setModalType(null),max:'max-w-md'},h('form',{onSubmit:addPayment,className:'p-4 space-y-3'},h(Field,{label:'Nominal Pembayaran'},h('input',{type:'number',autoFocus:true,value:paymentForm.amount,onChange:e=>setPaymentForm(p=>({...p,amount:e.target.value})),className:inputCls})),h('div',{className:'grid grid-cols-2 gap-2'},h(Field,{label:'Metode'},h('select',{value:paymentForm.method,onChange:e=>setPaymentForm(p=>({...p,method:e.target.value})),className:tinyInputCls},['Transfer','Cash','QRIS','Lainnya'].map(x=>h('option',{key:x,value:x},x)))),h(Field,{label:'Rekening'},h('select',{value:paymentForm.bankAccountId,onChange:e=>setPaymentForm(p=>({...p,bankAccountId:e.target.value})),className:tinyInputCls},h('option',{value:''},'Tidak dicatat'),settings.bankAccounts.map((a,i)=>a.bankName&&a.accountNumber?h('option',{key:i,value:String(i)},a.bankName):null)))),h(Field,{label:'Catatan'},h('input',{value:paymentForm.note,onChange:e=>setPaymentForm(p=>({...p,note:e.target.value})),placeholder:'DP / pelunasan / dll',className:inputCls})),h('div',{className:'grid grid-cols-2 gap-2'},h('button',{type:'button',onClick:()=>setPaymentForm(p=>({...p,amount:Math.max(0,Math.round(outstandingFor(selectedCustomer.id)*.5))})),className:'py-2.5 rounded-xl border border-slate-200 text-[10px] font-black'},'Isi 50% Sisa'),h('button',{type:'button',onClick:()=>setPaymentForm(p=>({...p,amount:outstandingFor(selectedCustomer.id)})),className:'py-2.5 rounded-xl border border-slate-200 text-[10px] font-black'},'Isi Pelunasan')),h('button',{type:'submit',className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},'Simpan Pembayaran')));

    if(modalType==='ADJUSTMENT'&&selectedCustomer)return h(ModalShell,{title:'Biaya & Diskon',subtitle:`Tambahan tagihan khusus ${selectedCustomer.name} pada Trip ini.`,onClose:()=>setModalType('CUSTOMER_DETAIL'),max:'max-w-md'},h('form',{onSubmit:saveAdjustment,className:'p-4 space-y-3'},h('div',{className:'grid grid-cols-2 gap-2'},h(Field,{label:'Ongkir'},h('input',{type:'number',value:adjustmentForm.shippingFee,onChange:e=>setAdjustmentForm(p=>({...p,shippingFee:e.target.value})),className:tinyInputCls})),h(Field,{label:'Packing'},h('input',{type:'number',value:adjustmentForm.packingFee,onChange:e=>setAdjustmentForm(p=>({...p,packingFee:e.target.value})),className:tinyInputCls})),h(Field,{label:'Biaya Lain'},h('input',{type:'number',value:adjustmentForm.otherFee,onChange:e=>setAdjustmentForm(p=>({...p,otherFee:e.target.value})),className:tinyInputCls})),h(Field,{label:'Diskon'},h('input',{type:'number',value:adjustmentForm.discount,onChange:e=>setAdjustmentForm(p=>({...p,discount:e.target.value})),className:tinyInputCls}))),h(Field,{label:'Catatan'},h('input',{value:adjustmentForm.note,onChange:e=>setAdjustmentForm(p=>({...p,note:e.target.value})),className:inputCls})),h('button',{type:'submit',className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},'Simpan')));

    if(modalType==='CATALOG_FORM')return h(ModalShell,{title:editingId?'Edit Produk':'Tambah Produk',subtitle:'Nama produk otomatis dirapikan ke Smart Title Case saat disimpan.',onClose:()=>setModalType(null)},h('form',{onSubmit:saveCatalog,className:'p-4 space-y-3'},
      h(Field,{label:'Nama Produk',hint:'Saat disimpan menjadi format rapi, mis. Dubai Chocolake Pistachio.'},h('input',{value:catalogForm.name||'',onChange:e=>setCatalogForm(p=>({...p,name:e.target.value})),placeholder:'mis. Dubai chocolake pistachio',className:inputCls})),
      h('div',{className:'grid grid-cols-2 gap-2'},h(Field,{label:'Kategori'},h('input',{value:catalogForm.category||'',onChange:e=>setCatalogForm(p=>({...p,category:e.target.value})),className:tinyInputCls})),h(Field,{label:'Satuan'},h('input',{value:catalogForm.unit||'pcs',onChange:e=>setCatalogForm(p=>({...p,unit:e.target.value})),placeholder:'pcs / box / kg',className:tinyInputCls}))),
      h(Field,{label:'Toko Utama'},h('input',{value:catalogForm.store||'',onChange:e=>setCatalogForm(p=>({...p,store:e.target.value})),className:inputCls})),
      h(Field,{label:'Toko Alternatif',hint:'Pisahkan dengan koma.'},h('input',{value:catalogForm.alternateStores||'',onChange:e=>setCatalogForm(p=>({...p,alternateStores:e.target.value})),placeholder:'Carrefour, Lulu, Day to Day',className:inputCls})),
      h(Field,{label:'Alias Pencarian',hint:'Hanya untuk memudahkan pencarian. Nama resmi produk tidak berubah.'},h('input',{value:catalogForm.aliases||'',onChange:e=>setCatalogForm(p=>({...p,aliases:e.target.value})),placeholder:'diamond pistachio, kunafa diamond',className:inputCls})),
      h('div',{className:'grid grid-cols-3 gap-2'},h(Field,{label:'Mata Uang'},h('select',{value:catalogForm.currency||settings.defaultCurrency,onChange:e=>setCatalogForm(p=>({...p,currency:e.target.value})),className:tinyInputCls},Object.keys(settings.currencyRates).map(k=>h('option',{key:k,value:k},k)))),h(Field,{label:'Modal Estimasi'},h('input',{type:'number',step:'0.01',value:catalogForm.foreignCost??'',onChange:e=>setCatalogForm(p=>({...p,foreignCost:e.target.value})),className:tinyInputCls})),h(Field,{label:'Markup %'},h('input',{type:'number',step:'0.1',value:catalogForm.markupPercent??'',onChange:e=>setCatalogForm(p=>({...p,markupPercent:e.target.value})),className:tinyInputCls}))),
      h(Field,{label:'Harga Jual Saat Ini',hint:editingId?'Mengubah harga di sini tidak mengubah harga pesanan lama. Riwayat harga disimpan otomatis.':'Harga ini menjadi default untuk order baru.'},h('input',{type:'number',value:catalogForm.sellingPriceIdr??'',onChange:e=>setCatalogForm(p=>({...p,sellingPriceIdr:e.target.value})),className:inputCls})),
      h('details',{className:'rounded-xl border border-slate-200 p-3'},h('summary',{className:'text-[10px] font-black cursor-pointer select-none'},'Storefront / Data Publik'),h('div',{className:'space-y-3 mt-3'},h('label',{className:'flex items-center justify-between text-[10px] font-bold'},h('span',null,'Tampilkan di Storefront'),h('input',{type:'checkbox',checked:!!catalogForm.isPublished,onChange:e=>setCatalogForm(p=>({...p,isPublished:e.target.checked})),className:'w-4 h-4 accent-slate-900'})),h('div',{className:'grid grid-cols-2 gap-2'},h(Field,{label:'Kategori Publik'},h('input',{value:catalogForm.publicCategory||'',onChange:e=>setCatalogForm(p=>({...p,publicCategory:e.target.value})),className:tinyInputCls})),h(Field,{label:'Status'},h('select',{value:catalogForm.availabilityStatus||'Pre-Order',onChange:e=>setCatalogForm(p=>({...p,availabilityStatus:e.target.value})),className:tinyInputCls},['Pre-Order','Tersedia','Habis','Closed'].map(x=>h('option',{key:x,value:x},x))))),h(Field,{label:'Foto URL'},h('input',{value:catalogForm.imageUrl||'',onChange:e=>setCatalogForm(p=>({...p,imageUrl:e.target.value})),placeholder:'https://...',className:inputCls})),h(Field,{label:'Deskripsi Publik'},h('textarea',{rows:3,value:catalogForm.publicDescription||'',onChange:e=>setCatalogForm(p=>({...p,publicDescription:e.target.value})),className:inputCls})),h(Field,{label:'Slug'},h('input',{value:catalogForm.slug||'',onChange:e=>setCatalogForm(p=>({...p,slug:e.target.value})),placeholder:slugify(catalogForm.name),className:inputCls})))),
      h('button',{type:'submit',className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},editingId?'Simpan Perubahan':'Tambah Produk')
    ));

    if(modalType==='CATALOG_DETAIL'){const c=catalog.find(x=>String(x.id)===String(editingId))||normalizeCatalogItem(catalogForm);const hist=historyFor(c.id);return h(ModalShell,{title:c.name,subtitle:`${c.category||'Umum'} • ${c.store||'Tanpa toko'}`,onClose:()=>setModalType(null)},h('div',{className:'p-4 space-y-3'},
      h('div',{className:'grid grid-cols-2 gap-2'},h('div',{className:'rounded-xl bg-slate-50 border border-slate-100 p-3'},h('div',{className:'text-[8px] font-bold text-slate-400'},'Harga Sekarang'),h('div',{className:'text-[14px] font-black mt-1'},formatIDR(c.sellingPriceIdr))),h('div',{className:'rounded-xl bg-slate-50 border border-slate-100 p-3'},h('div',{className:'text-[8px] font-bold text-slate-400'},'Modal Estimasi'),h('div',{className:'text-[14px] font-black mt-1'},formatForeign(c.currency,c.foreignCost)))),
      n(c.lastPurchaseCost)>0?h('div',{className:'rounded-xl bg-blue-50 border border-blue-100 p-3'},h('div',{className:'text-[8px] font-bold text-blue-500'},'Harga Beli Terakhir'),h('div',{className:'text-[12px] font-black text-blue-800 mt-1'},`${formatForeign(c.lastPurchaseCurrency||c.currency,c.lastPurchaseCost)} • ${formatDate(c.lastPurchasedAt)}`)):null,
      h('div',{className:'rounded-xl border border-slate-200 p-3 text-[10px] space-y-1'},h('div',null,h('span',{className:'text-slate-400'},'Satuan: '),h('b',null,c.unit||'pcs')),h('div',null,h('span',{className:'text-slate-400'},'Toko alternatif: '),h('b',null,c.alternateStores||'-')),h('div',null,h('span',{className:'text-slate-400'},'Alias: '),h('b',null,c.aliases||'-')),h('div',null,h('span',{className:'text-slate-400'},'Storefront: '),h('b',{className:c.isPublished?'text-emerald-600':''},c.isPublished?'Dipublikasikan':'Internal'))),
      h('div',null,h('div',{className:'text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1.5'},'Riwayat Harga'),hist.length?h('div',{className:'space-y-1.5'},hist.slice(0,12).map(p=>h('div',{key:p.id,className:'rounded-xl border border-slate-100 p-2.5'},h('div',{className:'flex items-center justify-between gap-2'},h('span',{className:'text-[9px] font-bold text-slate-400'},formatDateTime(p.changedAt)),h('span',{className:'text-[9px] font-black'},`${formatIDR(p.oldSellingPriceIdr)} → ${formatIDR(p.newSellingPriceIdr)}`)),n(p.oldForeignCost)!==n(p.newForeignCost)?h('div',{className:'text-[8px] text-slate-400 mt-1'},`Modal ${formatForeign(p.currency,p.oldForeignCost)} → ${formatForeign(p.currency,p.newForeignCost)}`):null))):h('div',{className:'text-[9px] text-slate-400'},'Belum ada perubahan harga tercatat.')),
      h('div',{className:'grid grid-cols-2 gap-2'},h('button',{onClick:()=>openCatalogForm(c),className:'py-2.5 rounded-xl bg-slate-950 text-white text-[10px] font-black'},'Edit Produk'),h('button',{onClick:()=>toggleArchiveProduct(c),className:`py-2.5 rounded-xl text-[10px] font-black ${c.isArchived?'bg-emerald-50 text-emerald-700 border border-emerald-100':'bg-amber-50 text-amber-700 border border-amber-100'}`},c.isArchived?'Aktifkan Kembali':'Arsipkan Produk'))
    ));}

    if(modalType==='IMPORT')return h(ModalShell,{title:'Import Massal Pesanan',subtitle:'Tempel satu atau banyak blok DATA PELANGGAN. Nama produk dirapikan otomatis.',onClose:()=>setModalType(null)},h('div',{className:'p-4'},h('textarea',{rows:11,value:bulkWhatsAppText,onChange:e=>setBulkWhatsAppText(e.target.value),placeholder:'*DATA PELANGGAN*\nNama: Budi\nWA: 628...\n\n*DAFTAR PESANAN*\n- Dubai Chocolate | Qty: 2 | AED: 18.99 | Harga: 125000',className:'w-full rounded-xl border border-slate-200 p-3 text-[11px] font-mono outline-none focus:border-blue-500 resize-none'}),h('button',{onClick:handleBulkImport,className:'w-full mt-3 py-3 rounded-xl bg-emerald-600 text-white text-xs font-black'},'Baca & Preview Import')));

    if(modalType==='PURCHASE'&&purchaseTarget)return h(ModalShell,{title:`Beli ${purchaseTarget.name}`,subtitle:`Dibutuhkan ${purchaseTarget.required} ${purchaseTarget.unit} • sudah ${purchaseTarget.purchased} • sisa ${purchaseTarget.remaining}`,onClose:()=>setModalType(null),max:'max-w-md'},h('form',{onSubmit:savePurchase,className:'p-4 space-y-3'},h('div',{className:'grid grid-cols-2 gap-2'},h(Field,{label:'Qty Dibeli'},h('input',{type:'number',min:1,max:purchaseTarget.remaining,value:purchaseForm.quantity,onChange:e=>setPurchaseForm(p=>({...p,quantity:e.target.value})),className:inputCls})),h(Field,{label:'Toko'},h('input',{value:purchaseForm.store,onChange:e=>setPurchaseForm(p=>({...p,store:e.target.value})),className:inputCls}))),h('div',{className:'grid grid-cols-3 gap-2'},h(Field,{label:'Mata Uang'},h('select',{value:purchaseForm.currency,onChange:e=>setPurchaseForm(p=>({...p,currency:e.target.value,exchangeRate:n(settings.currencyRates[e.target.value],1)})),className:tinyInputCls},Object.keys(settings.currencyRates).map(k=>h('option',{key:k,value:k},k)))),h(Field,{label:'Harga Aktual / Unit'},h('input',{type:'number',step:'0.01',value:purchaseForm.unitForeignCost,onChange:e=>setPurchaseForm(p=>({...p,unitForeignCost:e.target.value})),className:tinyInputCls})),h(Field,{label:'Kurs'},h('input',{type:'number',value:purchaseForm.exchangeRate,onChange:e=>setPurchaseForm(p=>({...p,exchangeRate:e.target.value})),className:tinyInputCls}))),h('div',{className:'rounded-xl bg-slate-50 border border-slate-200 p-3 text-[10px]'},h('div',{className:'flex justify-between'},h('span',{className:'text-slate-400'},'Modal estimasi/unit'),h('b',null,formatForeign(purchaseTarget.currency,purchaseTarget.estimatedCost))),h('div',{className:'flex justify-between mt-1'},h('span',{className:'text-slate-400'},'Modal aktual pembelian'),h('b',null,formatIDR(n(purchaseForm.quantity)*n(purchaseForm.unitForeignCost)*n(purchaseForm.exchangeRate,1))))),h('button',{type:'submit',className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},'Simpan Pembelian'),h('div',{className:'border-t border-slate-100 pt-3'},h('div',{className:'text-[9px] font-black text-slate-400 uppercase tracking-wider mb-2'},'Jika Tidak Tersedia'),h('div',{className:'grid grid-cols-3 gap-1.5'},['Stok habis','Cari toko lain','Menunggu restock'].map(note=>h('button',{type:'button',key:note,onClick:()=>markShoppingIssue(purchaseTarget,note),className:'py-2 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-[8px] font-black'},note))))));

    if(modalType==='START_SESSION'){const stores=Array.from(new Set(shoppingProducts.map(p=>p.store))).filter(Boolean);return h(ModalShell,{title:'Mulai Sesi Belanja',subtitle:'Fokuskan Mode Belanja hanya ke satu toko.',onClose:()=>setModalType(null),max:'max-w-md'},h('form',{onSubmit:startSession,className:'p-4 space-y-3'},h(Field,{label:'Toko'},h('select',{value:sessionForm.store,onChange:e=>setSessionForm(p=>({...p,store:e.target.value})),className:inputCls},h('option',{value:''},'Pilih toko'),stores.map(s=>h('option',{key:s,value:s},s)))),h(Field,{label:'Catatan (opsional)'},h('input',{value:sessionForm.note,onChange:e=>setSessionForm(p=>({...p,note:e.target.value})),className:inputCls})),h('button',{type:'submit',className:'w-full py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},'Mulai Belanja')));}

    if(modalType==='SESSION_SUMMARY'&&lastSessionSummary)return h(ModalShell,{title:'Ringkasan Sesi Belanja',subtitle:lastSessionSummary.store,onClose:()=>setModalType(null),max:'max-w-md'},h('div',{className:'p-4'},h('div',{className:'grid grid-cols-3 gap-2'},[['Unit',lastSessionSummary.units],['Batch',lastSessionSummary.batches],['Modal',formatIDR(lastSessionSummary.cost)]].map(([a,b])=>h('div',{key:a,className:'rounded-xl bg-slate-50 border border-slate-100 p-3'},h('div',{className:'text-[8px] font-bold text-slate-400'},a),h('div',{className:'text-[11px] font-black mt-1'},b)))),h('button',{onClick:()=>setModalType(null),className:'w-full mt-3 py-3 rounded-xl bg-slate-950 text-white text-xs font-black'},'Selesai')));

    if(modalType==='PACKING'&&packingGroup) {
      const required=packingGroup.allItems.reduce((s,o)=>s+n(o.quantity,1),0);
      const packed=packingGroup.allItems.reduce((s,o)=>s+n(packingDraft[String(o.id)]),0);
      const packingRows=packingGroup.allItems.map(o=>{
        const max=effectivePurchased(o);
        const val=n(packingDraft[String(o.id)]);
        return h('div',{key:o.id,className:'rounded-xl border border-slate-100 px-3 py-2 flex items-center gap-2'},
          h('div',{className:'min-w-0 flex-1'},
            h('div',{className:'product-title text-[11px] font-black'},o.itemName),
            h('div',{className:'text-[8px] text-slate-400 mt-0.5'},`Dibeli ${max}/${n(o.quantity,1)} • target ${n(o.quantity,1)}`)
          ),
          h('div',{className:'flex items-center gap-1 shrink-0'},
            h('button',{onClick:()=>changePacked(o,-1),disabled:val<=0,className:'w-8 h-8 rounded-lg bg-slate-100 text-sm font-black disabled:opacity-30'},'−'),
            h('span',{className:'w-9 text-center text-[10px] font-black'},`${val}/${n(o.quantity,1)}`),
            h('button',{onClick:()=>changePacked(o,1),disabled:val>=max,className:'w-8 h-8 rounded-lg bg-purple-50 text-purple-700 text-sm font-black disabled:opacity-30'},'+')
          )
        );
      });
      return h(ModalShell,{
        title:`Packing ${packingGroup.customerName}`,
        subtitle:`${packed}/${required} unit masuk paket`,
        onClose:()=>setModalType(null)
      },
        h('div',{className:'p-4'},
          h('div',{className:'h-2 rounded-full bg-slate-100 overflow-hidden mb-3'},
            h('div',{className:'h-full bg-purple-600',style:{width:`${required?Math.round(packed/required*100):0}%`}})
          ),
          h('div',{className:'space-y-1.5'},...packingRows),
          h('button',{onClick:savePacking,className:'w-full mt-3 py-3 rounded-xl bg-purple-600 text-white text-xs font-black'},packed>=required?'Selesaikan Packing':'Simpan Progress Packing')
        )
      );
    }

    if(modalType==='WA'&&activeWAGroup)return h(ModalShell,{title:'Kirim Update WhatsApp',subtitle:`${activeWAGroup.customerName} • pilih maksimal 3 rekening`,onClose:()=>setModalType(null)},h('div',{className:'p-4 space-y-3'},
      h('div',{className:'grid grid-cols-3 gap-1.5'},[['auto','Auto'],['dp','Minta DP'],['settlement','Pelunasan'],['paid','Lunas'],['ship','Siap Kirim'],['resi','Resi']].map(([v,l])=>h('button',{key:v,onClick:()=>{setWaMode(v);setWaPreview(buildWAMessage(activeWAGroup,v,waBankIndexes));},className:`py-2 rounded-lg text-[8px] font-black border ${waMode===v?'bg-slate-950 text-white border-slate-950':'bg-white text-slate-500 border-slate-200'}`},l))),
      h('div',null,h('div',{className:'text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1.5'},'Rekening di Pesan'),h('div',{className:'flex flex-wrap gap-1.5'},settings.bankAccounts.map((a,i)=>a.bankName&&a.accountNumber?h('label',{key:i,className:`px-2 py-1.5 rounded-lg border text-[9px] font-bold flex items-center gap-1 ${waBankIndexes.includes(String(i))?'bg-blue-50 border-blue-200 text-blue-700':'border-slate-200 text-slate-500'}`},h('input',{type:'checkbox',checked:waBankIndexes.includes(String(i)),onChange:()=>toggleWABank(i),className:'accent-blue-600'}),a.bankName,a.isPrimary?' ★':''):null))),
      h('textarea',{rows:15,value:waPreview,onChange:e=>setWaPreview(e.target.value),className:'w-full rounded-xl border border-slate-200 p-3 text-[11px] leading-relaxed outline-none focus:border-blue-500 resize-none'}),
      h('button',{onClick:()=>openWhatsApp(activeWAGroup,waPreview),className:'w-full py-3 rounded-xl bg-emerald-600 text-white text-xs font-black flex items-center justify-center gap-2'},h(Icon,{name:'wa',size:17}),'Buka WhatsApp')
    ));

    if(modalType==='POST_BULK')return h(ModalShell,{title:'Perubahan Berhasil',subtitle:`Siapkan update WhatsApp untuk ${waQueue.length} pelanggan terdampak.`,onClose:()=>setModalType(null),max:'max-w-md'},h('div',{className:'p-4'},h('div',{className:'rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-[10px] font-bold text-emerald-700'},'Status sudah tersimpan. Anda bisa lanjut mengirim update tanpa mencari pelanggan satu-satu.'),h('div',{className:'grid grid-cols-2 gap-2 mt-3'},h('button',{onClick:()=>setModalType(null),className:'py-2.5 rounded-xl border border-slate-200 text-[10px] font-black'},'Nanti'),h('button',{onClick:()=>setModalType('WA_QUEUE'),className:'py-2.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black'},'Buka Antrian WA'))));

    if(modalType==='WA_QUEUE')return h(ModalShell,{title:'Antrian WhatsApp',subtitle:`${waQueue.filter(x=>x.sent).length}/${waQueue.length} sudah dibuka`,onClose:()=>setModalType(null)},h('div',{className:'p-4 space-y-1.5'},waQueue.map((g,i)=>h('div',{key:g.customerId,className:'rounded-xl border border-slate-100 px-3 py-2 flex items-center gap-2'},h('div',{className:`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${g.sent?'bg-emerald-50 text-emerald-600':'bg-slate-100 text-slate-500'}`},g.sent?h(Icon,{name:'check',size:14}):h('span',{className:'text-[9px] font-black'},i+1)),h('div',{className:'min-w-0 flex-1'},h('div',{className:'text-[11px] font-black'},g.customerName),h('div',{className:'text-[8px] text-slate-400'},`${g.totalUnits} unit • sisa ${formatIDR(g.totalUnpaid)}`)),h('button',{onClick:()=>sendQueueItem(i),className:`px-2.5 py-1.5 rounded-lg text-[9px] font-black ${g.sent?'bg-slate-100 text-slate-500':'bg-emerald-600 text-white'}`},g.sent?'Buka Lagi':'Buka WA')))));

    return null;
  };

  const mainContent = currentTab==='dashboard'?renderDashboard():currentTab==='orders'?renderOrders():currentTab==='shopping'?renderShopping():currentTab==='customers'?renderCustomers():currentTab==='catalog'?renderCatalog():currentTab==='summary'?renderSummary():renderDashboard();

  return h('div',{className:`min-h-[100dvh] ${currentTab==='summary'?'bg-slate-950':'bg-slate-50'}`},
    renderHeader(),
    currentTab==='summary'?mainContent:h('main',{className:`max-w-5xl mx-auto px-3.5 py-3 ${currentTab==='orders'&&selectedOrderIds.length?'pb-64':'safe-bottom'}`},mainContent),
    renderBulkToolbar(),
    renderBottomNav(),
    renderModal(),
    confirmDialog?h(ConfirmModal,{dialog:confirmDialog,onClose:()=>setConfirmDialog(null)}):null,
    h(Toast,{config:toast}),
    undoState?h('div',{className:'fixed z-[2100] left-3 right-3 md:left-auto md:right-4 md:w-[380px] rounded-xl bg-slate-950 text-white px-3 py-2.5 shadow-2xl flex items-center gap-2',style:{bottom:currentTab==='summary'?'16px':'calc(74px + env(safe-area-inset-bottom, 0px))'}},h('div',{className:'min-w-0 flex-1 text-[10px] font-bold truncate'},undoState.label),h('button',{onClick:doUndo,className:'px-2.5 py-1.5 rounded-lg bg-white text-slate-950 text-[9px] font-black'},'Batalkan')):null,
    globalLoading?h('div',{className:'fixed z-[2400] inset-0 bg-slate-950/10 pointer-events-auto flex items-center justify-center'},h('div',{className:'bg-white border border-slate-200 shadow-xl rounded-xl px-4 py-3 flex items-center gap-2'},h('div',{className:'w-4 h-4 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin'}),h('span',{className:'text-[10px] font-black text-slate-700'},'Menyimpan...'))):null,
    initialBlocking?h('div',{className:'fixed z-[4000] inset-0 bg-white flex flex-col items-center justify-center'},h('img',{src:'/jastipper-logo.png',className:'w-16 h-16 rounded-2xl object-cover shadow-lg'}),h('div',{className:'text-sm font-black mt-3'},'Jastipper Pro'),h('div',{className:'text-[10px] text-slate-400 mt-1'},'Menyiapkan data pertama kali...')):null
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
