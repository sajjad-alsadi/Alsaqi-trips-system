// ==========================================
// ملف Backend - Google Apps Script
// نظام الساقي لإدارة الإيفادات
// ==========================================

// رقم إصدار الخادم: تعرضه الواجهة للتنبيه إذا كانت النسخة المنشورة قديمة
const APP_VERSION = '2026-10-31-no-setup-mode';

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('نظام الساقي لإدارة الإيفادات')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ------------------------------------------------------------------
// ثوابت: الشيتات والحالات والأعمدة
// ------------------------------------------------------------------
const SHEETS = { trips: 'الإيفادات', emps: 'الموفدون', adj: 'التسويات', log: 'سجل التغييرات', users: 'المستخدمون', rates: 'الأسعار' };

// دورة الإيفاد: موارد بشرية ← مصادقة المالية ← مصادقة الرقابة ← الصرف بقيد ← تم الصرف
const ST = {
  FIN: 'بانتظار مصادقة المالية', AUD: 'بانتظار مصادقة الرقابة', PAY: 'بانتظار الصرف', DONE: 'تم الصرف',
  RET_HR: 'معاد إلى الموارد البشرية', RET_FIN: 'معاد إلى المالية',
  ADMIN: 'محال إلى المسؤول',   // الرقابة وجدت مخالفة: كل بنود الإيفاد مجمَّدة حتى يبتّ المسؤول
  DEL: 'محذوف'                 // حذف منطقي بقرار المسؤول: يبقى في الشيت ولا يظهر في النظام
};
const VIOLATION_TYPES = ['مبلغ غير صحيح', 'مخالفة لأحد الضوابط', 'مستند ناقص', 'تداخل إيفادات', 'بيانات غير مطابقة للكتاب الرسمي', 'أخرى'];

const TRIP_HEADERS = ['رقم الإيفاد', 'تاريخ الذهاب', 'تاريخ العودة', 'جهة الانطلاق', 'الوجهات', 'نوع العجلة', 'إجمالي النقل', 'أجور المبيت', 'حالة الطلب', 'تاريخ الإدخال',
  'تاريخ التدقيق', 'المدقق', 'ملاحظات التدقيق',
  'نوع الإيفاد', 'الدولة', 'غرض الإيفاد', 'تاريخ الأمر', 'عدد الأيام', 'عدد الليالي', 'مسار المحافظات', 'نوع المبيت', 'إيفاد ثانٍ', 'المُدخِل', 'الإصدار',
  'مصادقة المالية', 'تاريخ مصادقة المالية', 'ملاحظات المالية',
  'نوع المخالفة', 'سبب الإعادة', 'أُعيد بواسطة', 'تاريخ الإعادة', 'يحتاج اعتماد النقل', 'المدخلات', 'أساس الاحتساب',
  'نوع مخالفة الإحالة', 'سبب الإحالة', 'أُحيل بواسطة', 'تاريخ الإحالة', 'سبب الحذف', 'حُذف بواسطة', 'تاريخ الحذف'];
const EMP_HEADERS = ['رقم الإيفاد', 'اسم الموظف', 'الصفة', 'مخصصات الإيفاد', 'أجور النقل', 'إجمالي المستحقات', 'حالة الدفع', 'تاريخ الصرف',
  'أجور المبيت', 'القسم', 'الدرجة', 'السلفة', 'حالة السلفة', 'قيد صرف السلفة', 'المصروف', 'رقم قيد الصرف', 'الدافع',
  'حالة الموفد', 'مصادقة المالية', 'تاريخ مصادقة المالية', 'ملاحظات المالية', 'المدقق', 'تاريخ التدقيق', 'ملاحظات التدقيق',
  'نوع المخالفة', 'سبب الإعادة', 'أُعيد بواسطة', 'تاريخ الإعادة', 'الحالة قبل الإحالة'];
const ADJ_HEADERS = ['المعرف', 'رقم الإيفاد', 'اسم الموظف', 'النوع', 'المبلغ', 'السبب', 'المصدر', 'الحالة', 'تاريخ الإنشاء', 'أنشأها', 'تاريخ الإغلاق', 'أغلقها', 'المرجع'];
const LOG_HEADERS = ['الوقت', 'المستخدم', 'الدور', 'رقم الإيفاد', 'الإجراء', 'التفاصيل'];
const USER_HEADERS = ['البريد', 'الدور', 'الاسم'];
const RATE_HEADERS = ['النوع', 'البند', 'المبلغ', 'سارٍ من'];

// الأسعار الأولية حسب الوثائق المعتمدة (تُنشأ مرة واحدة ثم تُعدَّل من شيت "الأسعار" بتاريخ سريان)
const SEED_ALLOWANCE = { 'بابل': 20000, 'كربلاء': 20000, 'بغداد': 25000, 'صلاح الدين': 30000, 'ذي قار': 30000, 'الديوانية': 15000, 'البصرة': 35000, 'ميسان': 30000, 'المثنى': 30000, 'ديالى': 30000, 'كركوك': 35000, 'نينوى': 35000, 'واسط': 30000, 'الأنبار': 30000, 'أربيل': 40000, 'السليمانية': 40000, 'حلبجة': 40000, 'دهوك': 45000 };
const SEED_TRANSPORT = { 'بغداد': 90000, 'البصرة': 210000, 'نينوى': 220000, 'أربيل': 270000, 'السليمانية': 250000, 'دهوك': 300000, 'كركوك': 170000, 'الأنبار': 150000, 'صلاح الدين': 150000, 'ديالى': 120000, 'بابل': 35000, 'كربلاء': 40000, 'واسط': 100000, 'الديوانية': 40000, 'المثنى': 75000, 'ذي قار': 125000, 'ميسان': 140000, 'حلبجة': 250000 };
const SEED_ABROAD = { 'المدير المفوض': 100000, 'معاون المدير المفوض': 90000, 'رئيس القسم': 75000, 'معاون رئيس القسم': 70000, 'مسؤول الشعبة': 60000, 'مسؤول الوحدة': 55000, 'الموظف': 50000 };
const SEED_DATE = '2026-01-01';

// ------------------------------------------------------------------
// أدوات الجداول
// ------------------------------------------------------------------
// تحويل قيم الخلايا إلى أنواع يقبلها google.script.run (كائنات Date لا تُنقل إلى الواجهة)
function toTransferable(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
  }
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return isFinite(value) ? value : '';
  if (typeof value === 'object' || typeof value === 'function') return String(value);
  return value;
}

// ذاكرة التنفيذ الواحد. كل نداء من الواجهة تنفيذ مستقل، فما يُحفظ هنا يسقط بنهايته (لا خطر قِدَم بين المستخدمين).
// تُوفّر استدعاءات خدمة Sheets المتكررة (فحص الأعمدة وقراءة المستخدم)، وهي أبطأ ما في النظام.
let SHEET_MEMO_ = {}, HEAD_MEMO_ = [], ROWS_MEMO_ = [], USER_MEMO_ = null;
function resetExecutionCache_() { SHEET_MEMO_ = {}; HEAD_MEMO_ = []; ROWS_MEMO_ = []; USER_MEMO_ = null; }
// صفوف إيفاد واحد المقروءة مؤخراً: تُستعمل ثانيةً داخل التنفيذ نفسه، وتُحدَّث في مكانها عند الكتابة فلا تصير قديمة
function dropRows_(sh) { ROWS_MEMO_ = ROWS_MEMO_.filter(function (m) { return m.sh !== sh; }); }
function setHeaders_(sh, headers) {
  for (let i = 0; i < HEAD_MEMO_.length; i++) if (HEAD_MEMO_[i][0] === sh) { HEAD_MEMO_[i][1] = headers; return; }
  HEAD_MEMO_.push([sh, headers]);
}
function headersOf_(sh) {
  for (let i = 0; i < HEAD_MEMO_.length; i++) if (HEAD_MEMO_[i][0] === sh) return HEAD_MEMO_[i][1];
  const last = sh.getLastColumn();
  const h = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0] : [];
  setHeaders_(sh, h);
  return h;
}

function withLock_(fn) {
  resetExecutionCache_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// يعيد الشيت، وينشئه أو يُكمل أعمدته الناقصة (قراءة واحدة للترويسة وكتابة واحدة)
function sheet_(name, headers) {
  if (SHEET_MEMO_[name]) return SHEET_MEMO_[name];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    setHeaders_(sh, headers.slice());
    return (SHEET_MEMO_[name] = sh);
  }
  const last = sh.getLastColumn();
  let cur = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0] : [];
  const missing = headers.filter(function (h) { return cur.indexOf(h) === -1; });
  if (missing.length) { sh.getRange(1, cur.length + 1, 1, missing.length).setValues([missing]); cur = cur.concat(missing); }
  setHeaders_(sh, cur);
  return (SHEET_MEMO_[name] = sh);
}

// قراءة جدول كامل كمصفوفة كائنات (مع رقم الصف __row)
function readRows_(sh) {
  const values = sh.getDataRange().getValues();
  const headers = values.length ? values[0] : [];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const o = { __row: i + 1 };
    headers.forEach(function (h, c) { if (h !== '') o[h] = values[i][c]; });
    rows.push(o);
  }
  return { headers: headers, rows: rows };
}

// قراءة موجَّهة: صفوف إيفاد واحد فقط (عمود الرقم أولاً ثم الصفوف المطابقة)، بدل قراءة الشيت كله عند كل إجراء.
// تُعيد الشكل نفسه الذي تعيده readRows_، فتحلّ محلها دون تغيير باقي المنطق.
function readTripRows_(sh, tripId) {
  const key = normId_(tripId);
  for (let m = 0; m < ROWS_MEMO_.length; m++) if (ROWS_MEMO_[m].sh === sh && ROWS_MEMO_[m].key === key) return ROWS_MEMO_[m].table;
  const table = readTripRowsUncached_(sh, key);
  ROWS_MEMO_.push({ sh: sh, key: key, table: table });
  return table;
}
function readTripRowsUncached_(sh, key) {
  const headers = headersOf_(sh), col = headers.indexOf('رقم الإيفاد'), lastRow = sh.getLastRow();
  if (col === -1 || lastRow < 2) return { headers: headers, rows: [] };
  const ids = sh.getRange(2, col + 1, lastRow - 1, 1).getValues(), hit = [];
  for (let i = 0; i < ids.length; i++) if (normId_(ids[i][0]) === key) hit.push(i + 2);
  const rows = [];
  for (let a = 0; a < hit.length;) {
    let b = a;
    while (b + 1 < hit.length && hit[b + 1] === hit[b] + 1) b++;   // الصفوف المتجاورة تُقرأ بنداء واحد
    const block = sh.getRange(hit[a], 1, hit[b] - hit[a] + 1, headers.length).getValues();
    for (let k = 0; k < block.length; k++) {
      const o = { __row: hit[a] + k };
      headers.forEach(function (h, c) { if (h !== '') o[h] = block[k][c]; });
      rows.push(o);
    }
    a = b + 1;
  }
  return { headers: headers, rows: rows };
}

// الحالة الجديدة للإيفاد بعد أي كتابة (الإيفاد وموفدوه وتسوياته): تُطبّقها الواجهة محلياً بدل تحميل كل البيانات من جديد
function tripPatch_(tripId, withAdjustments) {
  const t = findTrip_(readTripRows_(sheet_(SHEETS.trips, TRIP_HEADERS), tripId), tripId);
  const status = t ? normStatus_(t['حالة الطلب']) : '';
  if (!t || status === ST.DEL) return { tripId: tripId, trip: null, employees: [], adjustments: [] };
  const trip = outRows_([t])[0];
  trip['حالة الطلب'] = status;
  HEAVY_TRIP_COLS_.forEach(function (c) { delete trip[c]; });
  const emps = outRows_(readTripRows_(sheet_(SHEETS.emps, EMP_HEADERS), tripId).rows);
  emps.forEach(function (e) { e['المصروف'] = paidOf_(e); e['حالة الموفد'] = empStage_(status, e); });
  const out = { tripId: tripId, trip: trip, employees: emps };
  if (withAdjustments) out.adjustments = outRows_(readTripRows_(sheet_(SHEETS.adj, ADJ_HEADERS), tripId).rows);   // غيابها يعني: لم تتغير تسويات هذا الإيفاد
  return out;
}

function outRows_(rows) {
  return rows.map(function (r) {
    const o = {};
    Object.keys(r).forEach(function (k) { if (k !== '__row') o[k] = toTransferable(r[k]); });
    return o;
  });
}

// كتابة حقول محددة في صف موجود
function updateRow_(sh, rowNumber, obj) {
  const headers = headersOf_(sh);
  const cur = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) { if (Object.prototype.hasOwnProperty.call(obj, h)) cur[i] = obj[h]; });
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([cur]);
  ROWS_MEMO_.forEach(function (m) {   // يُحدَّث الصف المخزَّن في مكانه ليطابق الشيت
    if (m.sh === sh) m.table.rows.forEach(function (r) { if (r.__row === rowNumber) Object.keys(obj).forEach(function (k) { r[k] = obj[k]; }); });
  });
}

function appendRow_(sh, obj) {
  dropRows_(sh);
  const headers = headersOf_(sh);
  sh.appendRow(headers.map(function (h) { return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''; }));
}

// نص حر من المستخدم: قص الطول ومنع تفسيره كصيغة في الشيت
function safeText_(text, max) {
  const s = String(text === undefined || text === null ? '' : text).trim().slice(0, max || 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function nowLocalStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
}
function localStr_(v) {   // خلية تاريخ/نص إلى نص محلي موحّد
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm") : String(v === undefined || v === null ? '' : v);
}

// ------------------------------------------------------------------
// المستخدمون والصلاحيات (بالبريد الإلكتروني)
// ------------------------------------------------------------------
const ROLE_MAP = { 'موارد بشرية': 'hr', 'الموارد البشرية': 'hr', 'الإدارة والموارد البشرية': 'hr', 'hr': 'hr',
  'مالية': 'finance', 'المالية': 'finance', 'الشؤون المالية': 'finance', 'finance': 'finance',
  'رقابة': 'audit', 'الرقابة': 'audit', 'الرقابة والتدقيق': 'audit', 'تدقيق': 'audit', 'audit': 'audit',
  'مسؤول': 'admin', 'مسؤول النظام': 'admin', 'admin': 'admin' };

// لا وصول لأحد ما لم يكن بريده معرَّفاً في شيت "المستخدمون". شيت فارغ = رفض الجميع؛ وأول مسؤول يُعرَّف بـ setupFirstAdmin (لمالك الملف)
function currentUser_() {
  if (!USER_MEMO_) USER_MEMO_ = loadCurrentUser_();
  return USER_MEMO_;
}
function loadCurrentUser_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const users = definedUsers_();
  if (!users.length) return { ok: false, email: email, hint: 'لم يُعرَّف أي مستخدم في شيت "المستخدمون". يعرّف مالك الملف أول مسؤول بتشغيل الدالة setupFirstAdmin من محرر Apps Script.' };
  if (!email) return { ok: false, email: '', hint: 'تعذر تحديد هوية المستخدم. اجعل النشر بصلاحية "User accessing the web app".' };
  const roles = [];
  users.forEach(function (u) {
    if (String(u['البريد']).trim().toLowerCase() !== email) return;
    String(u['الدور']).split(/[،,]/).forEach(function (r) { const code = ROLE_MAP[r.trim()]; if (code && roles.indexOf(code) === -1) roles.push(code); });
  });
  if (!roles.length) return { ok: false, email: email, hint: 'هذا البريد غير مُعرَّف في شيت "المستخدمون".' };
  return { ok: true, email: email, roles: roles };
}
// المستخدمون المعرَّفون في الشيت (صفوف ذات بريد)
function definedUsers_() {
  return readRows_(sheet_(SHEETS.users, USER_HEADERS)).rows.filter(function (r) { return String(r['البريد']).trim() !== ''; });
}

function requireRole_(role, label) {
  const u = currentUser_();
  if (!u.ok) throw new Error('غير مصرّح: ' + (u.hint || ''));
  if (u.roles.indexOf(role) === -1) throw new Error('ليست لديك صلاحية ' + label + '.');
  return u;
}
function roleLabel_(u) {
  return u.roles.join('،');
}

// تعريف أول مسؤول: تُشغَّل يدوياً من محرر Apps Script (تشغيل ← setupFirstAdmin) مرة واحدة حين يكون شيت "المستخدمون" فارغاً.
// الدوال العامة قابلة للاستدعاء من أي مستخدم يفتح الصفحة، فالحماية في الدالة نفسها: لا تعمل إلا لمالك الملف، ولا تعمل إن وُجد أي مستخدم معرَّف.
// يُعرَّف مسؤولاً فقط (أقل صلاحية)؛ بقية المستخدمين وأدوارهم تُضاف في الشيت.
function setupFirstAdmin() {
  return withLock_(function () {
    const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!email) throw new Error('تعذر تحديد بريدك. شغّل الدالة من محرر Apps Script بحسابك.');
    const owner = SpreadsheetApp.getActiveSpreadsheet().getOwner();
    const ownerEmail = owner ? String(owner.getEmail() || '').trim().toLowerCase() : '';
    if (!ownerEmail || ownerEmail !== email) throw new Error('هذه التهيئة لمالك الملف فقط.');
    if (definedUsers_().length) throw new Error('شيت المستخدمين غير فارغ؛ أضف المستخدمين فيه مباشرة.');
    appendRow_(sheet_(SHEETS.users, USER_HEADERS), { 'البريد': email, 'الدور': 'مسؤول', 'الاسم': 'مالك الملف' });
    appendLog_({ email: email, roles: ['admin'] }, '', 'تهيئة أول مسؤول', 'عُرِّف مالك الملف مسؤولاً للنظام');
    return { success: true, message: 'عُرِّف ' + email + ' مسؤولاً للنظام. أضف بقية المستخدمين وأدوارهم في شيت "المستخدمون".' };
  });
}

// ------------------------------------------------------------------
// الأسعار
// ------------------------------------------------------------------
function ratesSheet_() {
  if (SHEET_MEMO_[SHEETS.rates]) return SHEET_MEMO_[SHEETS.rates];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEETS.rates)) {
    const sh = sheet_(SHEETS.rates, RATE_HEADERS);
    const rows = [];
    Object.keys(SEED_ALLOWANCE).forEach(function (k) { rows.push([RATE_TYPES_.allowance, k, SEED_ALLOWANCE[k], SEED_DATE]); });
    Object.keys(SEED_TRANSPORT).forEach(function (k) { rows.push([RATE_TYPES_.transport, k, SEED_TRANSPORT[k], SEED_DATE]); });
    Object.keys(SEED_ABROAD).forEach(function (k) { rows.push([RATE_TYPES_.abroad, k, SEED_ABROAD[k], SEED_DATE]); });
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
    return sh;
  }
  return sheet_(SHEETS.rates, RATE_HEADERS);
}
function rateRows_() {
  return readRows_(ratesSheet_()).rows.map(function (r) {
    return { type: String(r['النوع']).trim(), item: String(r['البند']).trim(), amount: Number(r['المبلغ']), from: localStr_(r['سارٍ من']).slice(0, 10) };
  });
}

// ------------------------------------------------------------------
// حالات قديمة (قبل دورة المصادقة) تُقرأ بمعناها الجديد دون تعديل بيانات المستخدم
// ------------------------------------------------------------------
function normStatus_(s) {
  const v = String(s || '');
  if (v === 'بانتظار المالية') return ST.FIN;
  if (v === 'مكتمل مالياً - بانتظار الرقابة' || v === 'تم التدقيق') return ST.DONE;
  return v;
}
function paidOf_(e) {
  const p = e['المصروف'];
  if (p !== '' && p !== undefined && p !== null) return Number(p) || 0;
  return e['حالة الدفع'] === 'تم الدفع' ? (Number(e['إجمالي المستحقات']) || 0) : 0;
}
function remainingOf_(e) { return Math.max(0, (Number(e['إجمالي المستحقات']) || 0) - paidOf_(e)); }

// حالة بند الموفد: القيمة المخزَّنة له، أو حالة الإيفاد (توافقاً مع بيانات قديمة قبل إضافة حالة لكل موفد)
function empStage_(tripStatus, e) {
  const s = String(e['حالة الموفد'] || '').trim();
  return s || tripStatus;
}

function appendLog_(u, tripId, action, details) {
  appendRow_(sheet_(SHEETS.log, LOG_HEADERS), {
    'الوقت': new Date(), 'المستخدم': u.email || 'غير معروف', 'الدور': roleLabel_(u), 'رقم الإيفاد': tripId, 'الإجراء': action,
    'التفاصيل': typeof details === 'string' ? details : JSON.stringify(details)
  });
}

// ------------------------------------------------------------------
// القراءة
// ------------------------------------------------------------------
// عمودان ثقيلان لا حاجة لإرسالهما مع كل تحديث: المدخلات (تُجلب عند التعديل فقط عبر getTripInputs) وأساس الاحتساب (لا تعرضه الواجهة)
const HEAVY_TRIP_COLS_ = ['المدخلات', 'أساس الاحتساب'];
// أسماء الأعمدة مرة واحدة بدل تكرارها في كل صف: أصغر حمولة بكثير، والواجهة تُعيد بناء الكائنات كما كانت تماماً
function pack_(objs) {
  const cols = objs.length ? Object.keys(objs[0]) : [];
  return { cols: cols, rows: objs.map(function (o) { return cols.map(function (c) { return o[c]; }); }) };
}

function getDashboardData() {
  resetExecutionCache_();
  const u = currentUser_();
  if (!u.ok) return { unauthorized: true, email: u.email, hint: u.hint, version: APP_VERSION };
  // قراءة الأسعار لا تحتاج قفلاً (كان يصطف كل المستخدمين خلف أي كاتب)؛ القفل فقط عند إنشاء الشيت لأول مرة لئلا يُزرع مرتين
  const rates = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.rates) ? rateRows_() : withLock_(rateRows_);
  const trips = outRows_(readRows_(sheet_(SHEETS.trips, TRIP_HEADERS)).rows);
  trips.forEach(function (t) { t['حالة الطلب'] = normStatus_(t['حالة الطلب']); HEAVY_TRIP_COLS_.forEach(function (c) { delete t[c]; }); });
  const live_ = {};   // الإيفادات المحذوفة منطقياً (قرار المسؤول) تبقى في الشيت ولا تُرسَل للواجهة
  trips.forEach(function (t) { if (t['حالة الطلب'] !== ST.DEL) live_[normId_(t['رقم الإيفاد'])] = true; });
  const employees = outRows_(readRows_(sheet_(SHEETS.emps, EMP_HEADERS)).rows).filter(function (e) { return live_[normId_(e['رقم الإيفاد'])]; });
  const statusById_ = {};
  trips.forEach(function (t) { statusById_[normId_(t['رقم الإيفاد'])] = t['حالة الطلب']; });
  employees.forEach(function (e) {
    e['المصروف'] = paidOf_(e);
    e['حالة الموفد'] = empStage_(statusById_[normId_(e['رقم الإيفاد'])] || '', e);
  });
  const adjustments = outRows_(readRows_(sheet_(SHEETS.adj, ADJ_HEADERS)).rows);
  // سجل التغييرات لا يُرسَل هنا (قد يبلغ آلاف السطور)؛ يُجلب فقط عند فتح تفاصيل إيفاد معيّن عبر getTripLog
  const users = readRows_(sheet_(SHEETS.users, USER_HEADERS)).rows
    .filter(function (r) { return String(r['البريد']).trim() !== ''; })
    .map(function (r) { return { email: String(r['البريد']).trim().toLowerCase(), name: String(r['الاسم'] || '').trim() }; });
  return { trips: pack_(trips.filter(function (t) { return t['حالة الطلب'] !== ST.DEL; })), employees: pack_(employees), adjustments: adjustments, rates: rates, users: users,
           session: { email: u.email, roles: u.roles }, violationTypes: VIOLATION_TYPES, version: APP_VERSION };
}

// سجل التغييرات الخاص بإيفاد واحد فقط (يُجلب عند الطلب من لوحة التفاصيل، لا مع كل تحميل)
// مدخلات الإيفاد المحفوظة: تُجلب عند بدء التعديل فقط (كانت تُرسل مع كل تحديث لكل الإيفادات)
function getTripInputs(tripId) {
  resetExecutionCache_();
  requireRole_('hr', 'تعديل الإيفادات (الموارد البشرية)');
  const L = loadTrip_(tripId);
  return { inputs: String(L.trip['المدخلات'] || '') };
}

function getTripLog(tripId) {
  resetExecutionCache_();
  const u = currentUser_();
  if (!u.ok) throw new Error('غير مصرّح: ' + (u.hint || ''));
  const key = normId_(tripId);
  return outRows_(readRows_(sheet_(SHEETS.log, LOG_HEADERS)).rows.filter(function (r) { return normId_(r['رقم الإيفاد']) === key; }));
}

// دالة لجلب تكرار رقم الإيفاد (بعد توحيد الأرقام الهندية والمسافات)
function checkDuplicateID(tripId) {
  resetExecutionCache_();
  const u = currentUser_();
  if (!u.ok) throw new Error('غير مصرّح: ' + (u.hint || ''));
  const k = normId_(tripId);
  return readRows_(sheet_(SHEETS.trips, TRIP_HEADERS)).rows.some(function (r) { return normId_(r['رقم الإيفاد']) === k; });
}

// ------------------------------------------------------------------
// تجهيز إيفاد: تنظيف المدخلات، الاحتساب من الخادم، الفحوص
// ------------------------------------------------------------------
function cleanInput_(f) {
  const stops = (f.stops || []).map(function (s) { return { gov: canonGov_(s.gov), days: s.days }; });
  return {
    tripId: safeText_(f.tripId, 60), orderDate: safeText_(f.orderDate, 10), purpose: safeText_(f.purpose, 500),
    type: f.type === 'خارجي' ? 'خارجي' : 'داخلي', country: safeText_(f.country, 80),
    start: String(f.start || ''), end: String(f.end || ''), origin: canonGov_(f.origin || HOME_GOV_),
    stops: stops, vehicle: ['شركة', 'شخصية', 'مستأجرة'].indexOf(f.vehicle) !== -1 ? f.vehicle : 'شركة',
    transportReceiver: safeText_(f.transportReceiver, 100), driverName: safeText_(f.driverName, 100), driverNoAllowance: f.driverNoAllowance === true, driverOnly: f.driverOnly === true,
    distanceKm: f.distanceKm === undefined ? '' : f.distanceKm, kmRate: f.kmRate === undefined ? '' : f.kmRate,
    hotelType: ['لا يوجد', 'متعاقد', 'غير متعاقد'].indexOf(f.hotelType) !== -1 ? f.hotelType : 'لا يوجد',
    hotelAmount: f.hotelAmount === undefined ? '' : f.hotelAmount, hotelReceiver: safeText_(f.hotelReceiver, 100),
    employees: (f.employees || []).map(function (e) {
      return { name: safeText_(e.name, 100), dept: safeText_(e.dept, 100), grade: safeText_(e.grade, 40), advance: e.advance === undefined ? '' : e.advance };
    })
  };
}

// فحص التداخل الزمني لنفس الموفد (الضابط 9: الإيفاد الثاني في اليوم نفسه بعد العودة للنجف يُحتسب إيفاداً مستقلاً)
function checkOverlaps_(calc, inp, excludeId) {
  const trips = readRows_(sheet_(SHEETS.trips, TRIP_HEADERS)).rows;
  const emps = readRows_(sheet_(SHEETS.emps, EMP_HEADERS)).rows;
  const a0 = parseLocal_(inp.start), a1 = parseLocal_(inp.end);
  const mine = {};
  calc.employees.forEach(function (e) { mine[nameKey_(e.name)] = e.name; });
  let second = false;
  const skip = normId_(excludeId || '');
  trips.forEach(function (t) {
    if (skip && normId_(t['رقم الإيفاد']) === skip) return;
    if (normStatus_(t['حالة الطلب']) === ST.DEL) return;
    const b0 = parseLocal_(localStr_(t['تاريخ الذهاب'])), b1 = parseLocal_(localStr_(t['تاريخ العودة']));
    if (!b0 || !b1) return;
    const names = emps.filter(function (e) { return normId_(e['رقم الإيفاد']) === normId_(t['رقم الإيفاد']); })
      .map(function (e) { return nameKey_(e['اسم الموظف']); }).filter(function (k) { return mine[k]; });
    if (!names.length) return;
    if (minutesOf_(a0) < minutesOf_(b1) && minutesOf_(b0) < minutesOf_(a1)) {
      throw new Error('الموفد "' + mine[names[0]] + '" لديه إيفاد متداخل زمنياً (' + t['رقم الإيفاد'] + '). عدّل التواريخ أو أعد الإيفاد المتداخل.');
    }
    if (minutesOf_(b1) <= minutesOf_(a0) && dayNum_(b1) === dayNum_(a0) && canonGov_(inp.origin) === HOME_GOV_) second = true;
  });
  return second;
}

function prepareTrip_(rawInput, excludeId) {
  const inp = cleanInput_(rawInput);
  if (!inp.tripId) throw new Error('رقم الإيفاد مطلوب.');
  if (!inp.purpose) throw new Error('غرض الإيفاد مطلوب (الضابط 2).');
  const calc = calcTrip_(inp, pickRates_(rateRows_(), inp.start));
  if (calc.errors.length) throw new Error(calc.errors.join('\n'));
  const second = checkOverlaps_(calc, inp, excludeId);
  return { inp: inp, calc: calc, second: second };
}

function tripFields_(p, u) {
  const inp = p.inp, calc = p.calc;
  const route = inp.type === 'خارجي' ? (inp.country || '') : calc.stops.map(function (s) { return s.gov + (calc.stops.length > 1 ? ' (' + s.days + ')' : ''); }).join('، ');
  return {
    'رقم الإيفاد': inp.tripId, 'تاريخ الذهاب': inp.start, 'تاريخ العودة': inp.end, 'جهة الانطلاق': inp.type === 'خارجي' ? HOME_GOV_ : inp.origin,
    'الوجهات': inp.type === 'خارجي' ? inp.country : calc.stops.map(function (s) { return s.gov; }).join('، '),
    'نوع العجلة': inp.type === 'خارجي' ? '' : inp.vehicle, 'إجمالي النقل': calc.totals.transport, 'أجور المبيت': calc.totals.hotel,
    'نوع الإيفاد': inp.type, 'الدولة': inp.country, 'غرض الإيفاد': inp.purpose, 'تاريخ الأمر': inp.orderDate,
    'عدد الأيام': calc.days, 'عدد الليالي': calc.nights, 'مسار المحافظات': route, 'نوع المبيت': inp.type === 'خارجي' ? '' : inp.hotelType,
    'إيفاد ثانٍ': p.second ? 'نعم' : '', 'يحتاج اعتماد النقل': calc.needsApproval ? 'نعم' : '',
    'المدخلات': JSON.stringify(inp), 'أساس الاحتساب': JSON.stringify(calc.basis)
  };
}

function empFields_(tripId, e) {
  return {
    'رقم الإيفاد': tripId, 'اسم الموظف': e.name, 'الصفة': e.role || '', 'مخصصات الإيفاد': e.allowance, 'أجور النقل': e.transport, 'إجمالي المستحقات': e.total,
    'أجور المبيت': e.hotel, 'القسم': e.dept, 'الدرجة': e.grade, 'السلفة': e.advance
  };
}

function findTrip_(tripsTable, tripId) {
  const k = normId_(tripId);
  return tripsTable.rows.filter(function (r) { return normId_(r['رقم الإيفاد']) === k; })[0] || null;
}
function tripEmps_(empRows, tripId) {
  const k = normId_(tripId);
  return empRows.filter(function (e) { return normId_(e['رقم الإيفاد']) === k; });
}

// ------------------------------------------------------------------
// الموارد البشرية: إنشاء إيفاد وتعديله بعد الإعادة
// ------------------------------------------------------------------
function saveTripData(formData) {
  return withLock_(function () {
    const u = requireRole_('hr', 'إصدار الإيفادات (الموارد البشرية)');
    const tripsSh = sheet_(SHEETS.trips, TRIP_HEADERS), empSh = sheet_(SHEETS.emps, EMP_HEADERS);
    if (findTrip_(readRows_(tripsSh), safeText_(formData.tripId, 60))) throw new Error('رقم الإيفاد مسجل مسبقاً: ' + safeText_(formData.tripId, 60));
    const p = prepareTrip_(formData, '');
    const f = tripFields_(p, u);
    f['حالة الطلب'] = ST.FIN; f['تاريخ الإدخال'] = new Date(); f['المُدخِل'] = u.email; f['الإصدار'] = 1;
    appendRow_(tripsSh, f);
    p.calc.employees.forEach(function (e) {
      const row = empFields_(p.inp.tripId, e);
      row['حالة الدفع'] = 'لم يتم الدفع'; row['المصروف'] = 0; row['حالة السلفة'] = e.advance > 0 ? 'بانتظار الصرف' : '';
      row['حالة الموفد'] = ST.FIN;
      appendRow_(empSh, row);
    });
    appendLog_(u, p.inp.tripId, 'إصدار إيفاد', { total: p.calc.totals.payable, advance: p.calc.totals.advance, employees: p.calc.employees.length });
    return { success: true, message: 'تم حفظ الإيفاد وإرساله لمصادقة المالية.', tripId: p.inp.tripId, total: p.calc.totals.payable , patch: tripPatch_(p.inp.tripId, true) };
  });
}

function summary_(tripRow, empRows) {
  return { destinations: tripRow['الوجهات'], start: localStr_(tripRow['تاريخ الذهاب']), end: localStr_(tripRow['تاريخ العودة']), vehicle: tripRow['نوع العجلة'],
           transport: tripRow['إجمالي النقل'], hotel: tripRow['أجور المبيت'],
           employees: empRows.map(function (e) { return e['اسم الموظف'] + ': ' + e['إجمالي المستحقات']; }) };
}

function updateTrip(tripId, formData, reason) {
  return withLock_(function () {
    const u = requireRole_('hr', 'تعديل الإيفادات (الموارد البشرية)');
    const why = safeText_(reason, 500);
    if (!why) throw new Error('سبب التعديل مطلوب.');
    const tripsSh = sheet_(SHEETS.trips, TRIP_HEADERS), empSh = sheet_(SHEETS.emps, EMP_HEADERS), adjSh = sheet_(SHEETS.adj, ADJ_HEADERS);
    const tripsT = readRows_(tripsSh), trip = findTrip_(tripsT, tripId);
    if (!trip) throw new Error('لم يُعثر على الإيفاد: ' + tripId);
    const tripStatusNow = normStatus_(trip['حالة الطلب']);
    const empsT = readRows_(empSh);
    const oldEmps = tripEmps_(empsT.rows, tripId);
    if (!oldEmps.some(function (o) { return empStage_(tripStatusNow, o) === ST.RET_HR; }))
      throw new Error('لا يمكن تعديل الإيفاد إلا بعد إعادة أحد موفديه على الأقل إلى الموارد البشرية.');
    const before = summary_(trip, oldEmps);

    formData.tripId = trip['رقم الإيفاد'];            // رقم الإيفاد ثابت عند التعديل
    const p = prepareTrip_(formData, tripId);
    const newByKey = {};
    p.calc.employees.forEach(function (e) { newByKey[nameKey_(e.name)] = e; });

    // السلف المصروفة لا تُعدَّل ولا يُحذف صاحبها: تُسوّى أولاً
    oldEmps.forEach(function (o) {
      const st = String(o['حالة السلفة']);
      if (st === 'مصروفة' || st === 'مُسوّاة') {
        const n = newByKey[nameKey_(o['اسم الموظف'])];
        if (!n || n.advance !== (Number(o['السلفة']) || 0)) throw new Error('لا يمكن تغيير أو حذف سلفة مصروفة للموفد "' + o['اسم الموظف'] + '".');
      }
    });

    // تحديث الموفدين: يُحافَظ على المصروف فعلاً، والزائد يُسجَّل تسوية استرداد ولا يُكتب فوقه.
    // كل موفد (حتى من لم يُعَد تحديداً) يبدأ دورة مصادقة جديدة، لأن بيانات الإيفاد المشتركة (التواريخ والوجهة) تغيّرت.
    const oldByKey = {};
    oldEmps.forEach(function (o) { oldByKey[nameKey_(o['اسم الموظف'])] = o; });
    const toDelete = [];
    oldEmps.forEach(function (o) {
      const k = nameKey_(o['اسم الموظف']), n = newByKey[k], paid = paidOf_(o);
      if (!n) {
        if (paid > 0) addAdjustment_(adjSh, u, tripId, o['اسم الموظف'], 'استرداد', paid, 'حذف الموفد من الإيفاد بعد صرف مستحقاته', 'تعديل');
        toDelete.push(o.__row);
      }
    });
    toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { empSh.deleteRow(r); });
      dropRows_(empSh);
    // إعادة القراءة بعد الحذف لتصحيح أرقام الصفوف
    const rowsNow = tripEmps_(readTripRows_(empSh, tripId).rows, tripId);
    const nowByKey = {};
    rowsNow.forEach(function (o) { nowByKey[nameKey_(o['اسم الموظف'])] = o; });
    p.calc.employees.forEach(function (e) {
      const k = nameKey_(e.name), o = nowByKey[k];
      const resetFields = { 'حالة الموفد': ST.FIN, 'مصادقة المالية': '', 'تاريخ مصادقة المالية': '', 'ملاحظات المالية': '',
                             'المدقق': '', 'تاريخ التدقيق': '', 'ملاحظات التدقيق': '', 'نوع المخالفة': '', 'سبب الإعادة': '', 'أُعيد بواسطة': '', 'تاريخ الإعادة': '' };
      if (o) {
        const paid = paidOf_(o), fields = Object.assign(empFields_(tripId, e), resetFields);
        const advPaid = String(o['حالة السلفة']) === 'مصروفة' || String(o['حالة السلفة']) === 'مُسوّاة';
        if (advPaid) { delete fields['السلفة']; }
        else fields['حالة السلفة'] = e.advance > 0 ? 'بانتظار الصرف' : '';
        fields['حالة الدفع'] = paid > 0 && paid >= e.total ? 'تم الدفع' : 'لم يتم الدفع';
        if (paid > e.total) addAdjustment_(adjSh, u, tripId, e.name, 'استرداد', paid - e.total, 'نقص المستحق بعد التعديل عمّا صُرف فعلاً', 'تعديل');
        updateRow_(empSh, o.__row, fields);
      } else {
        const row = Object.assign(empFields_(tripId, e), resetFields);
        row['حالة الدفع'] = 'لم يتم الدفع'; row['المصروف'] = 0; row['حالة السلفة'] = e.advance > 0 ? 'بانتظار الصرف' : '';
        appendRow_(empSh, row);
      }
    });

    const f = tripFields_(p, u);
    f['حالة الطلب'] = ST.FIN; f['الإصدار'] = (Number(trip['الإصدار']) || 1) + 1;
    updateRow_(tripsSh, trip.__row, f);
    const after = summary_(Object.assign({}, trip, f), tripEmps_(readTripRows_(empSh, tripId).rows, tripId));
    appendLog_(u, tripId, 'تعديل بعد الإعادة', { reason: why, before: before, after: after });
    return { success: true, message: 'تم تعديل الإيفاد وإعادة إرسال موفديه لمصادقة المالية.', tripId: tripId , patch: tripPatch_(tripId, true) };
  });
}

function addAdjustment_(adjSh, u, tripId, empName, type, amount, reason, source) {
  const rows = readRows_(adjSh).rows;
  let max = 0;
  rows.forEach(function (r) { const n = parseInt(String(r['المعرف']).replace(/\D/g, ''), 10); if (n > max) max = n; });
  const id = 'ADJ-' + (max + 1);
  appendRow_(adjSh, { 'المعرف': id, 'رقم الإيفاد': tripId, 'اسم الموظف': empName, 'النوع': type, 'المبلغ': Math.round(amount), 'السبب': reason,
                      'المصدر': source, 'الحالة': 'مفتوحة', 'تاريخ الإنشاء': new Date(), 'أنشأها': u.email });
  return id;
}

// ------------------------------------------------------------------
// المصادقات والإعادة — على مستوى كل موفد على حدة (وليس الإيفاد كله دفعة واحدة)،
// لأن إيفاداً واحداً قد يضم أكثر من موفد بمستندات ومواعيد مختلفة.
// ------------------------------------------------------------------
function loadTrip_(tripId) {
  const tripsSh = sheet_(SHEETS.trips, TRIP_HEADERS);
  const t = findTrip_(readTripRows_(tripsSh, tripId), tripId);
  if (!t) throw new Error('لم يُعثر على الإيفاد: ' + tripId);
  return { sh: tripsSh, trip: t, status: normStatus_(t['حالة الطلب']) };
}

// بند موفد واحد ضمن إيفاد؛ يعيد أيضاً حالته المُستنتَجة (empStage_)
function loadEmp_(empSh, tripId, empName, tripStatus) {
  const key = nameKey_(empName);
  const e = tripEmps_(readTripRows_(empSh, tripId).rows, tripId).filter(function (r) { return nameKey_(r['اسم الموظف']) === key; })[0];
  if (!e) throw new Error('لم يُعثر على الموفد: ' + empName);
  return { row: e, stage: empStage_(tripStatus, e) };
}

// إعادة حساب حالة الإيفاد المعروضة (تجميع لحالات موفديه): تُستدعى بعد كل إجراء على أي موفد فيه
function syncTripStatus_(tripId) {
  const tripsSh = sheet_(SHEETS.trips, TRIP_HEADERS);
  const t = findTrip_(readTripRows_(tripsSh, tripId), tripId);
  if (!t) return;
  const tripStatus = normStatus_(t['حالة الطلب']);
  const emps = tripEmps_(readTripRows_(sheet_(SHEETS.emps, EMP_HEADERS), tripId).rows, tripId);
  if (!emps.length) return;
  const stages = emps.map(function (e) { return empStage_(tripStatus, e); });
  let display;
  if (stages.indexOf(ST.DEL) !== -1) display = ST.DEL;
  else if (stages.indexOf(ST.ADMIN) !== -1) display = ST.ADMIN;
  else if (stages.indexOf(ST.RET_HR) !== -1) display = ST.RET_HR;
  else if (stages.indexOf(ST.RET_FIN) !== -1) display = ST.RET_FIN;
  else if (stages.every(function (s) { return s === ST.DONE; })) display = ST.DONE;
  else if (stages.indexOf(ST.FIN) !== -1) display = ST.FIN;
  else if (stages.indexOf(ST.AUD) !== -1) display = ST.AUD;
  else display = ST.PAY;
  if (display !== t['حالة الطلب']) updateRow_(tripsSh, t.__row, { 'حالة الطلب': display });
}

// يحوّل بند الموفد إلى "تم الصرف" حين تُصرف مستحقاته كاملة ولا سلفة مفتوحة له
function completeEmpIfSettled_(empSh, tripId, empName) {
  const key = nameKey_(empName);
  const e = tripEmps_(readTripRows_(empSh, tripId).rows, tripId).filter(function (r) { return nameKey_(r['اسم الموظف']) === key; })[0];
  if (!e) return;
  const advOpen = (Number(e['السلفة']) || 0) > 0 && String(e['حالة السلفة']) === 'بانتظار الصرف';
  if (remainingOf_(e) <= 0 && !advOpen) updateRow_(empSh, e.__row, { 'حالة الموفد': ST.DONE });
}

function financeEndorse(tripId, empName, notes) {
  return withLock_(function () {
    const u = requireRole_('finance', 'مصادقة المالية');
    const L = loadTrip_(tripId);
    const empSh = sheet_(SHEETS.emps, EMP_HEADERS);
    const E = loadEmp_(empSh, tripId, empName, L.status);
    if (E.stage !== ST.FIN && E.stage !== ST.RET_FIN) throw new Error('لا يمكن مصادقة المالية لموفد حالته: ' + E.stage);
    updateRow_(empSh, E.row.__row, { 'حالة الموفد': ST.AUD, 'مصادقة المالية': u.email, 'تاريخ مصادقة المالية': new Date(), 'ملاحظات المالية': safeText_(notes) });
    syncTripStatus_(tripId);
    appendLog_(u, tripId, 'مصادقة المالية', { employee: E.row['اسم الموظف'], notes: safeText_(notes) });
    return { success: true, message: 'صودق على مستحقات ' + E.row['اسم الموظف'] + ' من المالية، وأُرسلت لمصادقة الرقابة.' , patch: tripPatch_(tripId) };
  });
}

// لا يُصرف أي مبلغ لموفد قبل مصادقة الرقابة على بنده
function auditApprove(tripId, empName, notes) {
  return withLock_(function () {
    const u = requireRole_('audit', 'مصادقة الرقابة');
    const L = loadTrip_(tripId);
    const empSh = sheet_(SHEETS.emps, EMP_HEADERS);
    const E = loadEmp_(empSh, tripId, empName, L.status);
    if (E.stage !== ST.AUD) throw new Error('لا يمكن مصادقة الرقابة لموفد حالته: ' + E.stage);
    updateRow_(empSh, E.row.__row, { 'حالة الموفد': ST.PAY, 'تاريخ التدقيق': new Date(), 'المدقق': u.email, 'ملاحظات التدقيق': safeText_(notes) });
    completeEmpIfSettled_(empSh, tripId, E.row['اسم الموظف']);   // لا شيء يُصرف إن كان مصروفاً كاملاً أصلاً (مثلاً بعد تعديل لم يغيّر مبلغه)
    syncTripStatus_(tripId);
    appendLog_(u, tripId, 'مصادقة الرقابة', { employee: E.row['اسم الموظف'], notes: safeText_(notes) });
    return { success: true, message: 'صودق على مستحقات ' + E.row['اسم الموظف'] + ' من الرقابة، وأصبحت جاهزة للصرف.' , patch: tripPatch_(tripId) };
  });
}

// target: 'hr' | 'finance'. الرقابة تعيد بند موفد من مرحلة المصادقة أو الصرف أو بعد الصرف؛ والمالية تعيد إلى الموارد البشرية فقط
function returnTrip(tripId, empName, target, violationType, description) {
  return withLock_(function () {
    const u = currentUser_();
    if (!u.ok) throw new Error('غير مصرّح: ' + (u.hint || ''));
    const isAudit = u.roles.indexOf('audit') !== -1, isFin = u.roles.indexOf('finance') !== -1;
    const L = loadTrip_(tripId);
    const empSh = sheet_(SHEETS.emps, EMP_HEADERS);
    const E = loadEmp_(empSh, tripId, empName, L.status);
    const desc = safeText_(description);
    if (VIOLATION_TYPES.indexOf(violationType) === -1) throw new Error('حدد نوع المخالفة.');
    if (!desc) throw new Error('وصف المخالفة مطلوب.');
    if (target !== 'hr' && target !== 'finance') throw new Error('جهة الإعادة غير صحيحة.');
    let allowed = false;
    if (isAudit && [ST.AUD, ST.PAY, ST.DONE].indexOf(E.stage) !== -1) allowed = true;
    if (isFin && target === 'hr' && [ST.FIN, ST.RET_FIN].indexOf(E.stage) !== -1) allowed = true;
    if (!allowed) throw new Error('لا تملك صلاحية إعادة موفد حالته: ' + E.stage + ' إلى هذه الجهة.');
    updateRow_(empSh, E.row.__row, { 'حالة الموفد': target === 'hr' ? ST.RET_HR : ST.RET_FIN, 'نوع المخالفة': violationType, 'سبب الإعادة': desc, 'أُعيد بواسطة': u.email, 'تاريخ الإعادة': new Date() });
    syncTripStatus_(tripId);
    appendLog_(u, tripId, 'إعادة إلى ' + (target === 'hr' ? 'الموارد البشرية' : 'المالية'), { employee: E.row['اسم الموظف'], violation: violationType, description: desc, from: E.stage });
    return { success: true, message: 'أُعيد بند الموفد ' + E.row['اسم الموظف'] + ' إلى ' + (target === 'hr' ? 'الموارد البشرية' : 'المالية') + '.' , patch: tripPatch_(tripId, true) };
  });
}

// ------------------------------------------------------------------
// الإحالة إلى المسؤول: مخالفة تُكتشف قبل الصرف
// الرقابة تُحيل الإيفاد كله فتتجمّد بنوده (لا مصادقة ولا صرف ولا تعديل)، ثم يبتّ المسؤول: حذف منطقي أو إعادة إلى مساره
// ------------------------------------------------------------------
// من صُرف له شيء (مخصصات أو سلفة) لا يجوز حذف إيفاده ولا إحالته: ما صُرف لا يُمحى بل يُسوّى
function paidNames_(tripStatus, emps) {
  return emps.filter(function (e) {
    const adv = String(e['حالة السلفة']);
    return empStage_(tripStatus, e) === ST.DONE || paidOf_(e) > 0 || adv === 'مصروفة' || adv === 'مُسوّاة';
  }).map(function (e) { return e['اسم الموظف']; });
}

function referToAdmin(tripId, violationType, description) {
  return withLock_(function () {
    const u = requireRole_('audit', 'إحالة الإيفاد إلى المسؤول');
    const desc = safeText_(description, 500);
    if (VIOLATION_TYPES.indexOf(violationType) === -1) throw new Error('حدد نوع المخالفة.');
    if (!desc) throw new Error('سبب الإحالة مطلوب.');
    const L = loadTrip_(tripId);
    if (L.status === ST.DEL) throw new Error('الإيفاد محذوف.');
    if (L.status === ST.ADMIN) throw new Error('الإيفاد محال إلى المسؤول مسبقاً.');
    const empSh = sheet_(SHEETS.emps, EMP_HEADERS);
    const emps = tripEmps_(readTripRows_(empSh, tripId).rows, tripId);
    if (!emps.length) throw new Error('لا يوجد موفدون في هذا الإيفاد.');
    const paid = paidNames_(L.status, emps);
    if (paid.length) throw new Error('لا تجوز إحالة إيفاد صُرف جزء منه (' + paid.join('، ') + '). استخدم الإعادة والتسوية.');
    emps.forEach(function (e) { updateRow_(empSh, e.__row, { 'الحالة قبل الإحالة': empStage_(L.status, e), 'حالة الموفد': ST.ADMIN }); });
    updateRow_(L.sh, L.trip.__row, { 'حالة الطلب': ST.ADMIN, 'نوع مخالفة الإحالة': violationType, 'سبب الإحالة': desc, 'أُحيل بواسطة': u.email, 'تاريخ الإحالة': new Date() });
    appendLog_(u, tripId, 'إحالة إلى المسؤول', { violation: violationType, description: desc });
    return { success: true, message: 'أُحيل الإيفاد ' + tripId + ' إلى المسؤول، وتجمّدت بنوده حتى يبتّ فيه.' , patch: tripPatch_(tripId) };
  });
}

// تمهيد مشترك لقراري المسؤول: دور المسؤول، إيفاد محال فعلاً، سبب مكتوب، ولا يبتّ فيه من أحاله
function adminCase_(tripId, note, label) {
  const u = requireRole_('admin', label);
  const why = safeText_(note, 500);
  if (!why) throw new Error('سبب القرار مطلوب.');
  const L = loadTrip_(tripId);
  if (L.status !== ST.ADMIN) throw new Error('الإيفاد ليس محالاً إلى المسؤول. حالته: ' + L.status);
  const referrer = String(L.trip['أُحيل بواسطة'] || '').trim().toLowerCase();
  if (referrer && referrer === u.email) throw new Error('لا يبتّ في الإحالة من أحالها؛ يلزم مسؤول آخر.');
  const empSh = sheet_(SHEETS.emps, EMP_HEADERS);
  return { u: u, why: why, L: L, empSh: empSh, emps: tripEmps_(readTripRows_(empSh, tripId).rows, tripId) };
}

// إعادة الإيفاد إلى مساره: كل موفد يعود إلى مرحلته قبل الإحالة تماماً (لا يُتجاوَز أي اعتماد)
function releaseReferral(tripId, note) {
  return withLock_(function () {
    const c = adminCase_(tripId, note, 'إعادة الإيفاد إلى مساره (المسؤول)');
    const was = String(c.L.trip['نوع مخالفة الإحالة'] || '') + ' — ' + String(c.L.trip['سبب الإحالة'] || '');
    c.emps.forEach(function (e) {
      const prev = String(e['الحالة قبل الإحالة'] || '').trim();
      updateRow_(c.empSh, e.__row, { 'حالة الموفد': prev || ST.FIN, 'الحالة قبل الإحالة': '' });   // بلا سجل سابق: يبدأ من أول مصادقة
    });
    updateRow_(c.L.sh, c.L.trip.__row, { 'نوع مخالفة الإحالة': '', 'سبب الإحالة': '', 'أُحيل بواسطة': '', 'تاريخ الإحالة': '' });
    syncTripStatus_(tripId);
    appendLog_(c.u, tripId, 'إعادة الإيفاد إلى مساره (قرار المسؤول)', { reason: c.why, description: 'كانت الإحالة بسبب: ' + was });
    return { success: true, message: 'أُعيد الإيفاد ' + tripId + ' إلى مساره، وعاد كل موفد إلى مرحلته السابقة.' , patch: tripPatch_(tripId) };
  });
}

// حذف منطقي: يبقى الإيفاد في الشيت بحالة "محذوف" مع من حذفه ومتى ولماذا، ولا يظهر في النظام ولا يُعاد استخدام رقمه
function deleteTrip(tripId, note) {
  return withLock_(function () {
    const c = adminCase_(tripId, note, 'حذف الإيفاد (المسؤول)');
    const paid = paidNames_(c.L.status, c.emps);
    if (paid.length) throw new Error('لا يُحذف إيفاد صُرف جزء منه (' + paid.join('، ') + ').');
    const snapshot = summary_(c.L.trip, c.emps);
    const was = String(c.L.trip['نوع مخالفة الإحالة'] || '') + ' — ' + String(c.L.trip['سبب الإحالة'] || '');
    c.emps.forEach(function (e) { updateRow_(c.empSh, e.__row, { 'حالة الموفد': ST.DEL }); });
    updateRow_(c.L.sh, c.L.trip.__row, { 'حالة الطلب': ST.DEL, 'سبب الحذف': c.why, 'حُذف بواسطة': c.u.email, 'تاريخ الحذف': new Date() });
    appendLog_(c.u, tripId, 'حذف إيفاد (قرار المسؤول)', { reason: c.why, description: 'أُحيل بسبب: ' + was, snapshot: snapshot });
    return { success: true, message: 'حُذف الإيفاد ' + tripId + ' (حذف منطقي: يبقى مسجلاً في الشيت وسجل التغييرات).' , patch: tripPatch_(tripId) };
  });
}

// ------------------------------------------------------------------
// الصرف بقيد: مخصصات وسلف وتسويات
// ------------------------------------------------------------------
function voucher_(v, label) {
  const s = safeText_(v, 60);
  if (!s) throw new Error(label + ' مطلوب.');
  return s;
}

function payEmployee(tripId, empName, voucherNo, earlyApproval) {
  return withLock_(function () {
    const u = requireRole_('finance', 'الصرف (الشؤون المالية)');
    const L = loadTrip_(tripId);
    const empSh = sheet_(SHEETS.emps, EMP_HEADERS);
    const E = loadEmp_(empSh, tripId, empName, L.status);
    if (E.stage !== ST.PAY) throw new Error('لا يُصرف قبل مصادقة الرقابة لهذا الموفد. حالته الحالية: ' + E.stage);
    const e = E.row;
    const v = voucher_(voucherNo, 'رقم قيد الصرف');
    const remaining = remainingOf_(e);
    if (remaining <= 0) throw new Error('لا مستحقات متبقية للصرف لهذا الموفد.');
    // الضابط المالي 3: تُصرف بعد الرجوع؛ والصرف المبكر يتطلب موافقة إدارة الشركة
    const endP = parseLocal_(localStr_(L.trip['تاريخ العودة'])), nowP = parseLocal_(nowLocalStr_());
    let early = '';
    if (endP && nowP && minutesOf_(endP) > minutesOf_(nowP)) {
      early = safeText_(earlyApproval, 100);
      if (!early) throw new Error('لا تُصرف المخصصات قبل الرجوع من الإيفاد. أدخل رقم موافقة إدارة الشركة على الصرف المبكر.');
    }
    const prev = String(e['رقم قيد الصرف'] || '');
    updateRow_(empSh, e.__row, { 'المصروف': paidOf_(e) + remaining, 'حالة الدفع': 'تم الدفع', 'تاريخ الصرف': new Date(), 'رقم قيد الصرف': prev ? prev + '، ' + v : v, 'الدافع': u.email });
    completeEmpIfSettled_(empSh, tripId, e['اسم الموظف']);
    syncTripStatus_(tripId);
    appendLog_(u, tripId, 'صرف مستحقات', { employee: e['اسم الموظف'], amount: remaining, voucher: v, earlyApproval: early });
    return { success: true, message: 'سُجِّل صرف ' + remaining + ' د.ع للموفد ' + e['اسم الموظف'] + ' بقيد ' + v + '.', amount: remaining , patch: tripPatch_(tripId, true) };
  });
}

function payAdvance(tripId, empName, voucherNo) {
  return withLock_(function () {
    const u = requireRole_('finance', 'الصرف (الشؤون المالية)');
    const L = loadTrip_(tripId);
    const empSh = sheet_(SHEETS.emps, EMP_HEADERS);
    const E = loadEmp_(empSh, tripId, empName, L.status);
    if (E.stage !== ST.PAY) throw new Error('لا تُصرف السلفة قبل مصادقة الرقابة لهذا الموفد. حالته الحالية: ' + E.stage);
    const e = E.row;
    const v = voucher_(voucherNo, 'رقم قيد الصرف');
    if (!((Number(e['السلفة']) || 0) > 0) || String(e['حالة السلفة']) !== 'بانتظار الصرف') throw new Error('لا توجد سلفة بانتظار الصرف لهذا الموفد.');
    updateRow_(empSh, e.__row, { 'حالة السلفة': 'مصروفة', 'قيد صرف السلفة': v });
    completeEmpIfSettled_(empSh, tripId, e['اسم الموظف']);
    syncTripStatus_(tripId);
    appendLog_(u, tripId, 'صرف سلفة', { employee: e['اسم الموظف'], amount: Number(e['السلفة']), voucher: v });
    return { success: true, message: 'سُجِّل صرف السلفة للموفد ' + e['اسم الموظف'] + ' بقيد ' + v + '.' , patch: tripPatch_(tripId, true) };
  });
}

// تسوية السلفة بالفواتير الأصولية: الفرق استرداد (بوصل قبض) أو مستحق إضافي
function settleAdvance(tripId, empName, invoicesTotal, receiptNo) {
  return withLock_(function () {
    const u = requireRole_('finance', 'تسوية السلف (الشؤون المالية)');
    const L = loadTrip_(tripId);
    const inv = Number(invoicesTotal);
    if (!isFinite(inv) || inv < 0) throw new Error('أدخل إجمالي الفواتير المقدَّمة.');
    const empSh = sheet_(SHEETS.emps, EMP_HEADERS), adjSh = sheet_(SHEETS.adj, ADJ_HEADERS);
    const key = nameKey_(empName);
    const e = tripEmps_(readTripRows_(empSh, tripId).rows, tripId).filter(function (r) { return nameKey_(r['اسم الموظف']) === key; })[0];
    if (!e || String(e['حالة السلفة']) !== 'مصروفة') throw new Error('لا توجد سلفة مصروفة بانتظار التسوية لهذا الموفد.');
    const adv = Number(e['السلفة']) || 0, diff = adv - Math.round(inv);
    let id = '';
    if (diff !== 0) {
      id = addAdjustment_(adjSh, u, tripId, e['اسم الموظف'], diff > 0 ? 'استرداد' : 'مستحق إضافي', Math.abs(diff),
        'تسوية السلفة: السلفة ' + adv + ' والفواتير ' + Math.round(inv), 'سلفة');
      const ref = safeText_(receiptNo, 60);
      if (ref && diff > 0) closeAdjustmentRow_(adjSh, id, u, ref);
    }
    updateRow_(empSh, e.__row, { 'حالة السلفة': 'مُسوّاة' });
    appendLog_(u, tripId, 'تسوية سلفة', { employee: e['اسم الموظف'], advance: adv, invoices: Math.round(inv), diff: diff, adjustment: id });
    return { success: true, message: diff === 0 ? 'سُوِّيت السلفة كاملة بالفواتير.' : 'سُوِّيت السلفة، وسُجِّلت تسوية ' + (diff > 0 ? 'استرداد' : 'مستحق إضافي') + ' بمبلغ ' + Math.abs(diff) + ' د.ع.' , patch: tripPatch_(tripId, true) };
  });
}

function closeAdjustmentRow_(adjSh, id, u, ref) {
  const a = readRows_(adjSh).rows.filter(function (r) { return r['المعرف'] === id; })[0];
  updateRow_(adjSh, a.__row, { 'الحالة': 'مغلقة', 'تاريخ الإغلاق': new Date(), 'أغلقها': u.email, 'المرجع': ref });
  return a;
}

// إغلاق تسوية: وصل قبض للاسترداد، أو قيد صرف للمستحق الإضافي
function settleAdjustment(adjId, ref) {
  return withLock_(function () {
    const u = requireRole_('finance', 'إغلاق التسويات (الشؤون المالية)');
    const adjSh = sheet_(SHEETS.adj, ADJ_HEADERS);
    const a = readRows_(adjSh).rows.filter(function (r) { return r['المعرف'] === adjId; })[0];
    if (!a) throw new Error('لم يُعثر على التسوية: ' + adjId);
    if (a['الحالة'] !== 'مفتوحة') throw new Error('هذه التسوية مغلقة مسبقاً.');
    const r = voucher_(ref, a['النوع'] === 'استرداد' ? 'رقم وصل القبض' : 'رقم قيد الصرف');
    closeAdjustmentRow_(adjSh, adjId, u, r);
    if (a['النوع'] === 'استرداد' && a['المصدر'] === 'تعديل') {   // بعد الاسترداد يعود المصروف الفعلي إلى المستحق
      const empSh = sheet_(SHEETS.emps, EMP_HEADERS), key = nameKey_(a['اسم الموظف']);
      const e = tripEmps_(readTripRows_(empSh, a['رقم الإيفاد']).rows, a['رقم الإيفاد']).filter(function (x) { return nameKey_(x['اسم الموظف']) === key; })[0];
      if (e) updateRow_(empSh, e.__row, { 'المصروف': Math.max(0, paidOf_(e) - (Number(a['المبلغ']) || 0)) });
    }
    appendLog_(u, a['رقم الإيفاد'], 'إغلاق تسوية ' + adjId, { type: a['النوع'], amount: a['المبلغ'], reference: r });
    return { success: true, message: 'أُغلقت التسوية ' + adjId + ' بالمرجع ' + r + '.' , patch: tripPatch_(a['رقم الإيفاد'], true) };
  });
}

// ==========================================
// الحساب المشترك (يُولَّد آلياً؛ مطابق لما في الواجهة)
// ==========================================
// ============================================================================
// الحساب المشترك: يُنسخ آلياً إلى الخادم (Code.gs) والواجهة، فيكون مصدر الحقيقة واحداً
// ============================================================================
var HOME_GOV_ = 'النجف';
var GOVERNORATES_ = ['النجف', 'أربيل', 'الأنبار', 'بابل', 'بغداد', 'البصرة', 'حلبجة', 'دهوك', 'الديوانية', 'ديالى', 'ذي قار', 'السليمانية', 'صلاح الدين', 'كركوك', 'كربلاء', 'المثنى', 'ميسان', 'نينوى', 'واسط'];
var GRADES_ = ['المدير المفوض', 'معاون المدير المفوض', 'رئيس القسم', 'معاون رئيس القسم', 'مسؤول الشعبة', 'مسؤول الوحدة', 'الموظف'];
var GOV_ALIASES_ = { 'رمادي': 'الأنبار', 'الرمادي': 'الأنبار', 'موصل': 'نينوى', 'الموصل': 'نينوى', 'سماوة': 'المثنى', 'السماوة': 'المثنى', 'الكوت': 'واسط', 'ديوانية': 'الديوانية', 'القادسية': 'الديوانية', 'سليمانية': 'السليمانية', 'السماوه': 'المثنى' };
var RATE_TYPES_ = { allowance: 'مخصص داخلي', transport: 'نقل من النجف', abroad: 'مخصص خارجي' };

function canonGov_(name) {
    var n = String(name === undefined || name === null ? '' : name).trim();
    return GOV_ALIASES_[n] || n;
}

// مفتاح مقارنة الأسماء: يوحّد الهمزات والياء والتاء المربوطة والمسافات والأرقام
function nameKey_(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
        .replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
        .replace(/\s+/g, ' ').trim().toLowerCase();
}

// نصوص مقارنة معرّف الإيفاد (أرقام هندية/لاتينية ومسافات)
function normId_(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
        .replace(/\s+/g, '').toLowerCase();
}

// التواريخ: نص محلي بصيغة YYYY-MM-DD أو YYYY-MM-DDTHH:mm (جزء الوقت اختياري، ويُهمَل عمداً:
// النظام لا يعتمد وقت الإيفاد، فتُحسب الأيام بالتاريخ فقط ويُصفَّر الوقت دائماً)
function parseLocal_(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s === undefined || s === null ? '' : s));
    return m ? { y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0 } : null;
}
function dayNum_(p) { return Math.round(Date.UTC(p.y, p.mo - 1, p.d) / 86400000); }
function minutesOf_(p) { return dayNum_(p) * 1440 + p.h * 60 + p.mi; }

// عدد أيام الإيفاد: عدّ شامل للتاريخين (تاريخ الذهاب وتاريخ العودة يُحسبان كل يوم منهما)، أي الفرق التقويمي + 1.
// مثال: الذهاب 27/9 والعودة 29/9 = 3 أيام (27 و28 و29). النظام لا يعتمد وقت الإيفاد (بطلب المستخدم).
function calcDays_(startStr, endStr) {
    var a = parseLocal_(startStr), b = parseLocal_(endStr);
    if (!a || !b || minutesOf_(b) < minutesOf_(a)) return null;
    var diff = dayNum_(b) - dayNum_(a);
    return { days: diff + 1, nights: diff };
}

// اختيار الأسعار السارية بتاريخ الإيفاد: آخر سعر سارٍ قبله، وإلا أقدم سعر متاح
function pickRates_(rows, dateStr) {
    var day = String(dateStr || '').slice(0, 10);
    var keyOf = {}; keyOf[RATE_TYPES_.allowance] = 'allowance'; keyOf[RATE_TYPES_.transport] = 'transport'; keyOf[RATE_TYPES_.abroad] = 'abroad';
    var best = {}, out = { allowance: {}, transport: {}, abroad: {} };
    (rows || []).forEach(function (r) {
        var k = keyOf[r.type];
        if (!k) return;
        var item = k === 'abroad' ? String(r.item).trim() : canonGov_(r.item);
        var amount = Number(r.amount);
        if (!isFinite(amount) || amount < 0) return;
        var from = String(r.from || '').slice(0, 10) || '0000-00-00';
        var id = k + '|' + item, cur = best[id];
        var better = !cur ||
            (from <= day && (cur.from > day || from > cur.from)) ||
            (from > day && cur.from > day && from < cur.from);
        if (better) best[id] = { from: from, amount: amount, k: k, item: item };
    });
    Object.keys(best).forEach(function (id) { out[best[id].k][best[id].item] = best[id].amount; });
    return out;
}

function pickReceiver_(emps, wanted) {
    if (emps.length === 1) return emps[0].name;
    var k = nameKey_(wanted);
    for (var i = 0; i < emps.length; i++) if (nameKey_(emps[i].name) === k && k) return emps[i].name;
    return '';
}

// الاحتساب الكامل للإيفاد. المدخلات:
// { type:'داخلي'|'خارجي', start, end, origin, stops:[{gov,days}], vehicle, transportReceiver, distanceKm, kmRate,
//   hotelType, hotelAmount, hotelReceiver, driverName (لعجلة الشركة), driverNoAllowance (عدم صرف مخصصات السائق), driverOnly (إيفاد للسائق وحده بلا موفدين), country, employees:[{name,dept,grade,advance}] }
function calcTrip_(inp, rates) {
    var errors = [];
    var res = { errors: errors, days: 0, nights: 0, stops: [], farthest: '', transportPrice: 0, needsApproval: false,
                transportPayee: '', hotelPayee: '', employees: [], totals: { allowance: 0, transport: 0, hotel: 0, advance: 0, payable: 0 }, basis: {} };
    var dd = calcDays_(inp.start, inp.end);
    if (!dd) errors.push(!parseLocal_(inp.start) || !parseLocal_(inp.end) ? 'أدخل تاريخ الذهاب وتاريخ العودة.' : 'لا يجوز أن يسبق تاريخ العودة تاريخ الذهاب.');
    else { res.days = dd.days; res.nights = dd.nights; }

    var emps = (inp.employees || []).filter(function (e) { return String(e.name === undefined || e.name === null ? '' : e.name).trim() !== ''; })
        .map(function (e) { return { name: String(e.name).trim(), dept: String(e.dept || '').trim(), grade: String(e.grade || '').trim(), advance: e.advance, allowance: 0, transport: 0, hotel: 0, total: 0, role: '' }; });
    // إيفاد للسائق وحده (توصيل مستلزمات أو بريد...): داخلي بعجلة الشركة وبلا موفدين
    var driverOnly = inp.driverOnly === true && inp.type !== 'خارجي' && (inp.vehicle || 'شركة') === 'شركة';
    if (driverOnly) { if (emps.length) errors.push('إيفاد السائق وحده لا يتضمن موفدين: احذف الموفدين أو ألغِ الخيار.'); }
    else if (!emps.length) errors.push('أدخل اسم موفد واحد على الأقل.');
    var seen = {};
    emps.forEach(function (e) {
        var k = nameKey_(e.name);
        if (seen[k]) errors.push('الاسم مكرر داخل الإيفاد: ' + e.name);
        seen[k] = 1;
    });
    var abroad = inp.type === 'خارجي';
    var days = res.days;

    if (!abroad) {
        var stops = (inp.stops || []).map(function (s) { return { gov: canonGov_(s.gov), days: s.days }; });
        if (!stops.length) errors.push('اختر محافظة واحدة على الأقل.');
        var far = null;
        stops.forEach(function (s) {
            if (!(rates.allowance[s.gov] > 0)) errors.push('لا يوجد مبلغ إيفاد معتمد للمحافظة: ' + s.gov);
            var t = rates.transport[s.gov] || 0, a = rates.allowance[s.gov] || 0;
            if (!far || t > far.t || (t === far.t && a > far.a)) far = { gov: s.gov, t: t, a: a };
        });
        res.farthest = far ? far.gov : '';
        var allowance = 0;
        if (stops.length === 1 && dd) {
            stops[0].days = days;
            allowance = (rates.allowance[stops[0].gov] || 0) * days;
        } else if (stops.length > 1 && dd) {
            if (days === 1) {           // الضابط 12: المحافظة الأبعد لمخصص اليوم
                stops.forEach(function (s) { s.days = s.gov === far.gov ? 1 : 0; });
                allowance = rates.allowance[far.gov] || 0;
            } else {                    // الضابط 13: مخصص كل محافظة بحسب مدة المكوث الفعلية
                var sum = 0, okDays = true;
                stops.forEach(function (s) {
                    var n = Number(s.days);
                    if (!isFinite(n) || n < 1 || Math.floor(n) !== n) okDays = false;
                    else { s.days = n; sum += n; allowance += (rates.allowance[s.gov] || 0) * n; }
                });
                if (!okDays) errors.push('حدّد عدد أيام مكوث صحيح (يوم فأكثر) لكل محافظة.');
                else if (sum !== days) errors.push('مجموع أيام المحافظات (' + sum + ') لا يساوي مدة الإيفاد (' + days + ').');
            }
        }
        res.stops = stops;
        emps.forEach(function (e) { e.allowance = allowance; e.role = ''; });

        var vehicle = inp.vehicle || 'شركة', transport = 0;
        if (vehicle === 'شركة') {
            // عجلة الشركة تحتاج سائقاً، ويُصرف له إيفاد بنفس مخصص الوجهة والمدة (بلا نقل ولا مبيت تلقائياً) إلا إذا اختير عدم صرف مخصصاته
            var driverName = String(inp.driverName || '').trim();
            if (!driverName) errors.push('أدخل اسم السائق عند اختيار عجلة الشركة.');
            else if (seen[nameKey_(driverName)]) errors.push('اسم السائق يجب أن يكون مختلفاً عن أسماء الموفدين.');
            else {
                emps.push({ name: driverName, dept: 'سائق', role: 'سائق', grade: '', advance: 0, allowance: inp.driverNoAllowance ? 0 : allowance, transport: 0, hotel: 0, total: 0 });
                seen[nameKey_(driverName)] = 1;
            }
        }
        if (vehicle !== 'شركة' && far) {
            var originGov = canonGov_(inp.origin || HOME_GOV_);
            if (originGov === HOME_GOV_ || originGov === 'بغداد') {
                // النجف: الجدول المعتمد. بغداد: نفس جدول النجف مؤقتاً إلى أن تُعتمد أسعارها الخاصة.
                transport = rates.transport[far.gov] || 0;
                res.transportPrice = transport;
                if (!(transport > 0)) errors.push('لا يوجد سعر نقل معتمد للمحافظة: ' + far.gov);
            } else {
                // أي جهة انطلاق أخرى: مسافة بالكيلومتر × سعر الكيلومتر، والسعر تقدير يدوي من الموارد البشرية (افتراضه 100 د.ع)
                var km = Number(inp.distanceKm), rate = Number(inp.kmRate);
                if (inp.distanceKm === '' || inp.distanceKm === undefined || inp.distanceKm === null || !isFinite(km) || km < 0) errors.push('أدخل المسافة بالكيلومتر للانطلاق من ' + inp.origin + '.');
                else if (inp.kmRate === '' || inp.kmRate === undefined || inp.kmRate === null || !isFinite(rate) || rate < 0) errors.push('أدخل سعر الكيلومتر.');
                else transport = Math.round(km * rate);
                res.transportPrice = transport;
                res.needsApproval = true;
            }
        }
        if (transport > 0) {
            var recv = pickReceiver_(emps, inp.transportReceiver);
            if (!recv) errors.push('حدد الموظف المستلم لأجور النقل.');
            emps.forEach(function (e) { if (e.name === recv) e.transport = transport; });
            res.transportPayee = recv;
        }
        if (inp.hotelType === 'غير متعاقد') {
            var h = Number(inp.hotelAmount);
            if (inp.hotelAmount === '' || inp.hotelAmount === undefined || inp.hotelAmount === null || !isFinite(h) || h < 0) errors.push('أدخل مبلغ المبيت المعتمد للفندق غير المتعاقد.');
            else if (h > 0) {
                var hr = pickReceiver_(emps, inp.hotelReceiver);
                if (!hr) errors.push('حدد الموظف المستلم لأجور المبيت.');
                emps.forEach(function (e) { if (e.name === hr) e.hotel = Math.round(h); });
                res.hotelPayee = hr;
            }
        }
    } else {
        if (!String(inp.country || '').trim()) errors.push('أدخل الدولة الموفد إليها.');
        emps.forEach(function (e) {
            if (GRADES_.indexOf(e.grade) === -1) errors.push('حدد الدرجة الوظيفية للموفد: ' + e.name);
            else if (!(rates.abroad[e.grade] > 0)) errors.push('لا يوجد مبلغ إيفاد خارجي معتمد للدرجة: ' + e.grade);
            else e.allowance = rates.abroad[e.grade] * days;
            var adv = e.advance;
            if (adv === '' || adv === undefined || adv === null) e.advance = 0;
            else {
                var a = Number(adv);
                if (!isFinite(a) || a < 0) { errors.push('مبلغ السلفة غير صالح للموفد: ' + e.name); e.advance = 0; }
                else e.advance = Math.round(a);
            }
        });
    }

    emps.forEach(function (e) {
        e.allowance = Math.round(e.allowance); e.transport = Math.round(e.transport); e.hotel = Math.round(e.hotel);
        if (!abroad) e.advance = 0;
        e.total = e.allowance + e.transport + e.hotel;
        res.totals.allowance += e.allowance; res.totals.transport += e.transport; res.totals.hotel += e.hotel;
        res.totals.advance += e.advance; res.totals.payable += e.total;
    });
    if (driverOnly && emps.length && res.totals.payable <= 0) errors.push('إيفاد السائق وحده يحتاج مخصصات أو مبلغ مبيت؛ ألغِ خيار عدم صرف مخصصات السائق.');
    res.employees = emps;
    res.basis = { days: days, nights: res.nights, type: abroad ? 'خارجي' : 'داخلي', origin: inp.origin || HOME_GOV_, stops: res.stops, farthest: res.farthest,
                  transportPrice: res.transportPrice, vehicle: inp.vehicle || 'شركة', hotelType: inp.hotelType || '', abroadRates: abroad ? rates.abroad : undefined };
    return res;
}
