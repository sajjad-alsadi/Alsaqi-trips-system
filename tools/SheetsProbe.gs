// أداة تجارب سلوك Google Sheets الحقيقي (T1.3). للنسخة التجريبية فقط ثم تُحذف.
// تعمل على شيتات مؤقتة (_probe_*) تحذفها بنفسها، ولا تعدّل بيانات الإيفادات. تكتب التقرير في شيت «تجارب السلوك».
// تستعمل دوال النظام الفعلية (appendRow_ وupdateRow_ وsafeText_) لأن السؤال: ماذا يفعل Sheets بما يكتبه هذا الكود تحديداً.
// التشغيل: انظر docs/sheets-probe.md. المستخدم يجب أن يكون «مسؤولاً» في شيت المستخدمون.

const PROBE_TMP_ = '_probe_tmp', PROBE_TMP2_ = '_probe_text', PROBE_TMP3_ = '_probe_grow', PROBE_TMP4_ = '_probe_rows', PROBE_REPORT_ = 'تجارب السلوك';
const PROBE_HEAD_ = ['المفتاح', 'القيمة', 'ملاحظة', 'الرقم'];
const PROBE_TEXTS_ = ['001', '00123', '1/2', '2026-11-02', '12:30', '1e3', '١٢٣', '٠٠١', 'E-100', 'TRUE', '12345678901234567890'];

function probeCell_(sh, r, c) {
  const rg = sh.getRange(r, c), v = rg.getValue();
  const isDate = Object.prototype.toString.call(v) === '[object Date]';
  return {
    str: isDate ? 'Date(' + Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm") + ')' : String(v),
    type: isDate ? 'Date' : typeof v, formula: rg.getFormula(), display: rg.getDisplayValue(), raw: v
  };
}
function probeDesc_(c) { return 'قيمة=' + c.str + ' | نوع=' + c.type + (c.formula ? ' | صيغة=' + c.formula : '') + ' | معروض=' + c.display; }
function probeDrop_(ss, name) { const s = ss.getSheetByName(name); if (s) ss.deleteSheet(s); }

// E1: نص يبدأ برمز صيغة، عبر المسار نفسه الذي يكتبه التطبيق، ثم تحديث الصف مرة ثانية
function probeFormulas_(sh, report) {
  ['=1+1', '+1+1', '-1+1', '@SUM(1)', '=HYPERLINK("https://example.com","x")'].forEach(function (v) {
    const input = safeText_(v, 100);
    appendRow_(sh, { 'المفتاح': 'E1', 'القيمة': input, 'ملاحظة': '', 'الرقم': '' });
    const r = sh.getLastRow(), a = probeCell_(sh, r, 2);
    updateRow_(sh, r, { 'ملاحظة': 'تحديث' });
    const b = probeCell_(sh, r, 2);
    report.push(['E1', 'نص يبدأ برمز صيغة (safeText_ ثم appendRow_ ثم updateRow_)', v + '  ←  يُكتب: ' + input, probeDesc_(a), probeDesc_(b),
      a.formula ? 'خطر: صيغة منذ الإضافة' : (b.formula ? 'خطر: صار صيغة بعد التحديث (R2 صحيحة)' : 'سليم: يبقى نصاً')]);
  });
}
// E2/E3: نصوص تشبه أرقاماً أو تواريخ في عمود «الرقم»
function probeTexts_(sh, report, code, title) {
  PROBE_TEXTS_.forEach(function (v) {
    appendRow_(sh, { 'المفتاح': code, 'القيمة': '', 'ملاحظة': '', 'الرقم': v });
    const r = sh.getLastRow(), a = probeCell_(sh, r, 4);
    updateRow_(sh, r, { 'ملاحظة': 'تحديث' });
    const b = probeCell_(sh, r, 4);
    const verdict = a.str !== v ? 'تغيّر عند الإضافة' : (b.str !== v ? 'تغيّر عند التحديث' : (a.type !== 'string' ? 'القيمة نفسها لكن النوع ' + a.type : 'سليم'));
    report.push([code, title, v, probeDesc_(a), probeDesc_(b), verdict]);
  });
}
// E3b: تنسيق «نص عادي» لا يغطي الصف الجديد الذي يضيفه appendRow خارج حدود الشيت
function probeGrow_(ss, report) {
  probeDrop_(ss, PROBE_TMP3_);
  const sh = ss.insertSheet(PROBE_TMP3_);
  sh.appendRow(PROBE_HEAD_);
  sh.getRange(1, 4, sh.getMaxRows(), 1).setNumberFormat('@');
  if (sh.getMaxRows() > 3) sh.deleteRows(4, sh.getMaxRows() - 3);
  for (let i = 0; i < 3; i++) {
    sh.appendRow(['E3b', '', '', '00123']);
    const r = sh.getLastRow(), c = probeCell_(sh, r, 4);
    report.push(['E3b', 'نص عادي ثم appendRow حتى يتجاوز حدود الشيت (الصف ' + r + ' من ' + sh.getMaxRows() + ')', '00123',
      probeDesc_(c) + ' | تنسيق=' + sh.getRange(r, 4).getNumberFormat(), '', c.str === '00123' && c.type === 'string' ? 'سليم' : 'تغيّر: الصف الجديد خارج التنسيق']);
  }
  ss.deleteSheet(sh);
}
// E4: التواريخ كما يكتبها التطبيق ويقرؤها
function probeDates_(sh, report) {
  const tz = Session.getScriptTimeZone();
  [['نص كامل', '2026-11-02T10:30'], ['نص تاريخ فقط', '2026-11-02'], ['كائن Date', new Date(2026, 10, 2, 10, 30)]].forEach(function (p) {
    appendRow_(sh, { 'المفتاح': 'E4', 'القيمة': p[1], 'ملاحظة': '', 'الرقم': '' });
    const r = sh.getLastRow(), a = probeCell_(sh, r, 2);
    updateRow_(sh, r, { 'ملاحظة': 'تحديث' });
    const b = probeCell_(sh, r, 2), shown = localStr_(b.raw);
    const input = p[1] instanceof Date ? Utilities.formatDate(p[1], tz, "yyyy-MM-dd'T'HH:mm") : p[1];
    report.push(['E4', 'تاريخ: ' + p[0], String(input), probeDesc_(a), probeDesc_(b) + ' | localStr_=' + shown,
      shown === input ? 'سليم: localStr_ يعيد المُدخَل' : 'يختلف: ' + input + ' ← ' + shown]);
  });
}
// E6: موضع الإضافة وأرقام الصفوف في شيت جديد بتجميد صف الترويسة
function probeAppend_(ss, report) {
  probeDrop_(ss, PROBE_TMP4_);
  resetExecutionCache_();
  const sh = sheet_(PROBE_TMP4_, PROBE_HEAD_);
  sh.setFrozenRows(1);
  const lasts = [];
  for (let i = 0; i < 3; i++) { appendRow_(sh, { 'المفتاح': 'E6-' + i }); lasts.push(sh.getLastRow()); }
  const rows = readRows_(sh).rows.map(function (r) { return r.__row; });
  report.push(['E6', 'appendRow_ في شيت جديد (' + sh.getMaxRows() + ' صفاً)، ترويسة مجمَّدة', '3 إضافات', 'getLastRow=' + lasts.join(','), '__row=' + rows.join(','),
    lasts.join(',') === '2,3,4' && rows.join(',') === '2,3,4' ? 'سليم' : 'غير متوقع']);
  ss.deleteSheet(sh);
}

function probeIdentity() {
  requireRole_('admin', 'فحص الهوية');
  const ss = SpreadsheetApp.getActiveSpreadsheet(), owner = ss.getOwner();
  const active = Session.getActiveUser().getEmail(), eff = Session.getEffectiveUser().getEmail();
  let editors = '(تعذّر)';
  try { editors = ss.getEditors().length; } catch (e) { /* لا شيء */ }
  return {
    'getActiveUser': active, 'getEffectiveUser': eff, 'getOwner': owner ? owner.getEmail() : '(null)',
    'يطابق المالك': !!owner && String(owner.getEmail()).toLowerCase() === String(active).toLowerCase(),
    'عدد المحررين': editors, 'منطقة السكربت': Session.getScriptTimeZone(), 'منطقة الجدول': ss.getSpreadsheetTimeZone(), 'لغة الجدول': ss.getSpreadsheetLocale()
  };
}
function measureDashboard() {
  requireRole_('admin', 'قياس الأداء');
  const ss = SpreadsheetApp.getActiveSpreadsheet(), out = { runs: [], rows: {} };
  for (let i = 0; i < 3; i++) {
    resetExecutionCache_();
    const t0 = new Date().getTime(), d = getDashboardData(), ms = new Date().getTime() - t0;
    out.runs.push({ ms: ms, kb: Math.round(JSON.stringify(d).length / 1024) });
  }
  ['الإيفادات', 'الموفدون', 'التسويات', 'سجل التغييرات', 'المستخدمون', 'الأسعار', 'الموظفون', 'الأقسام'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    out.rows[n] = s ? Math.max(0, s.getLastRow() - 1) : 0;
  });
  return out;
}

// نقطة الدخول: شغّلها من المحرر بحساب مسؤول (ويفضَّل المالك)
function runSheetsProbe() {
  requireRole_('admin', 'تشغيل تجارب السلوك');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = [['الرمز', 'التجربة', 'المُدخَل', 'النتيجة بعد الإضافة', 'النتيجة بعد التحديث', 'الحكم']];
  [PROBE_TMP_, PROBE_TMP2_, PROBE_TMP3_, PROBE_TMP4_].forEach(function (n) { probeDrop_(ss, n); });
  resetExecutionCache_();
  function step(label, fn) { try { fn(); } catch (e) { report.push([label, 'توقفت التجربة بخطأ', '', String(e && e.message || e), '', 'خطأ']); } }
  try {
    const sh = sheet_(PROBE_TMP_, PROBE_HEAD_);
    step('E1', function () { probeFormulas_(sh, report); });
    step('E2', function () { probeTexts_(sh, report, 'E2', 'نص يشبه رقماً أو تاريخاً (تنسيق افتراضي)'); });
    step('E4', function () { probeDates_(sh, report); });
    step('E3', function () {
      const sh2 = sheet_(PROBE_TMP2_, PROBE_HEAD_);
      sh2.getRange(1, 4, sh2.getMaxRows(), 1).setNumberFormat('@');
      probeTexts_(sh2, report, 'E3', 'نفس النصوص بعد تنسيق عمود «الرقم» كنص عادي');
    });
    step('E3b', function () { probeGrow_(ss, report); });
    step('E6', function () { probeAppend_(ss, report); });
    step('E5', function () {
      const id = probeIdentity();
      Object.keys(id).forEach(function (k) { report.push(['E5', 'الهوية (من المحرر)', k, String(id[k]), '', '']); });
    });
    step('E7', function () {
      const m = measureDashboard();
      m.runs.forEach(function (x, i) { report.push(['E7', 'زمن getDashboardData (تنفيذ مستقل) ' + (i + 1), '', x.ms + ' ms', x.kb + ' KB', '']); });
      Object.keys(m.rows).forEach(function (k) { report.push(['E7', 'عدد صفوف «' + k + '»', '', String(m.rows[k]), '', '']); });
    });
  } finally {
    [PROBE_TMP_, PROBE_TMP2_, PROBE_TMP3_, PROBE_TMP4_].forEach(function (n) { probeDrop_(ss, n); });
    resetExecutionCache_();
  }
  probeDrop_(ss, PROBE_REPORT_);
  const rep = ss.insertSheet(PROBE_REPORT_);
  // عبر cellOut_ (كل نص يُحفظ نصاً): وإلا صار «=1+1» في عمود المُدخَل صيغة حيّة (#ERROR!) و«001» رقماً. وتنسيق العمود كنص لا يمنع ذلك (E3)
  rep.getRange(1, 1, report.length, report[0].length).setValues(report.map(rowOut_));
  return report;
}
