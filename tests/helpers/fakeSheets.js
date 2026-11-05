'use strict';
// محاكاة صغيرة في الذاكرة لـ SpreadsheetApp وSession وLockService بالقدر الذي تستعمله الشيفرة.
// لا تحاكي سلوك Sheets الحقيقي في تحويل الأنواع أو الصيغ (هذا يُجرَّب على نسخة حقيقية: T1.3).
const { loadServer } = require('./load');

// يقلّد ما رُصد في Sheets الفعلي (تجربة T1.3، لغة en_US) عند الكتابة بـ appendRow/setValues:
//   البادئة ' علامة نص تُستهلك (فلا تظهر عند القراءة)، «=…» صيغة حيّة، «001» رقم، «1e3» رقم، «TRUE» منطقي،
//   و«1/2» و«2026-11-02» و«12:30» تواريخ/أوقات (تُقلَّد هنا برقم: يكفي لكشف تغيّر النوع).
// الأرقام العربية الهندية والنصوص الأخرى تبقى نصاً. لا يقلّد تنسيق الأعمدة (لم يُجدِ مع appendRow).
// التاريخ يُنشأ بمُنشئ Date من سياق vm الخاص بالخادم (وإلا فشل instanceof Date في الشيفرة)، بتوقيت UTC ليتطابق مع Utilities.formatDate المحاكى
let DateCtor = Date;
const mkDate = (y, mo, d, h, mi) => new DateCtor(Date.UTC(y, mo, d, h, mi));
function sheetsParse(v) {
    if (typeof v !== 'string') return v;
    if (v.charAt(0) === "'") return v.slice(1);
    if (v.charAt(0) === '=') return '#FORMULA(' + v + ')';
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v) && v.length <= 15) return Number(v);
    if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(v);
    if (m) return mkDate(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    m = /^(\d{1,2})\/(\d{1,2})$/.exec(v);                       // لغة en_US: شهر/يوم في السنة الحالية
    if (m) return mkDate(new Date().getUTCFullYear(), +m[1] - 1, +m[2], 0, 0);
    m = /^(\d{1,2}):(\d{2})$/.exec(v);                           // وقت فقط: على أساس 30/12/1899 كما في Sheets
    if (m) return mkDate(1899, 11, 30, +m[1], +m[2]);
    return v;
}

class FakeSheet {
    constructor(name) { this.name = name; this.rows = []; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
    getRange(r, c, nr, nc) {
        const sh = this; nr = nr || 1; nc = nc || 1;
        return {
            getValues() {
                const out = [];
                for (let i = 0; i < nr; i++) {
                    const row = sh.rows[r - 1 + i] || [], o = [];
                    for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
                    out.push(o);
                }
                return out;
            },
            setValues(v) { v.forEach((vr, i) => { const idx = r - 1 + i; sh.rows[idx] = sh.rows[idx] || []; vr.forEach((x, j) => { sh.rows[idx][c - 1 + j] = sheetsParse(x); }); }); },
            // أقل ما تحتاجه tools/SheetsProbe.gs (المحاكي لا يحاكي تحويل Sheets للأنواع ولا الصيغ)
            getValue() { return (sh.rows[r - 1] || [])[c - 1] === undefined ? '' : sh.rows[r - 1][c - 1]; },
            getFormula() { const v = this.getValue(); return typeof v === 'string' && v.indexOf('#FORMULA(') === 0 ? v.slice(9, -1) : ''; },
            getDisplayValue() { return String(this.getValue()); },
            setNumberFormat(f) { sh._fmt = sh._fmt || {}; sh._fmt[c] = f; return this; },
            getNumberFormat() { return (sh._fmt && sh._fmt[c]) || 'General'; }
        };
    }
    getDataRange() {
        const w = this.getLastColumn();
        return { getValues: () => this.rows.map(r => Array.from({ length: w }, (_, j) => r[j] === undefined ? '' : r[j])) };
    }
    appendRow(arr) { this.rows.push(arr.map(sheetsParse)); }
    clearContents() { this.rows = []; }
    getMaxRows() { return Math.max(this._max || 1000, this.rows.length); }
    setFrozenRows() {}
    deleteRows(start, n) { this.rows.splice(start - 1, n); this._max = Math.max(this.rows.length, (this._max || 1000) - n); }
}

// opts: { email: بريد المستخدم الحالي، owner: بريد مالك الملف (null = غير متاح)، sheets: { اسم: [[صف]...] },
//         props: خصائص السكربت (مثل SPREADSHEET_ID)، standalone: true = مشروع مستقل (getActiveSpreadsheet تعيد null)،
//         spreadsheetId: معرّف الملف الذي يفتحه openById (الافتراضي 'SS1') }
function makeEnv(opts, names, extraSource) {
    opts = opts || {};
    const session = { email: opts.email === undefined ? '' : opts.email };
    const sheets = {};
    Object.keys(opts.sheets || {}).forEach(n => { const s = new FakeSheet(n); s.rows = opts.sheets[n].map(r => r.slice()); sheets[n] = s; });
    const owner = opts.owner === undefined ? null : opts.owner;
    const ss = {
        getSheetByName: n => sheets[n] || null,
        insertSheet: n => (sheets[n] = new FakeSheet(n)),
        getOwner: () => owner === null ? null : { getEmail: () => owner },
        deleteSheet: s => { delete sheets[s.name]; },
        getEditors: () => [],
        getSpreadsheetTimeZone: () => 'Asia/Baghdad',
        getSpreadsheetLocale: () => 'ar_IQ'
    };
    const props = opts.props || {}, calls = { openById: 0, getActive: 0, ids: [] };
    const realId = opts.spreadsheetId || 'SS1';
    const S = loadServer(names.concat(['Date']), {
        SpreadsheetApp: {
            getActiveSpreadsheet: () => { calls.getActive++; return opts.standalone ? null : ss; },
            openById: id => {
                calls.openById++; calls.ids.push(id);
                if (id !== realId) throw new Error('Exception: Requested entity was not found.');
                return ss;
            }
        },
        PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props[k] === undefined ? null : props[k]) }) },
        Session: { getActiveUser: () => ({ getEmail: () => session.email }), getEffectiveUser: () => ({ getEmail: () => session.email }), getScriptTimeZone: () => 'Asia/Baghdad' },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        // الشيفرة لا تستعمل غير الصيغة yyyy-MM-dd'T'HH:mm؛ يُكتفى بـ UTC في المحاكاة
        Utilities: { formatDate: d => d.toISOString().slice(0, 16) }
    }, extraSource);
    DateCtor = S.Date;
    return {
        S, session, sheets, calls,
        rows: n => (sheets[n] ? sheets[n].rows : null),
        // يضيف شيتاً بعد التحميل (حين تلزم ترويسات الخادم لبناء الصفوف)
        addSheet: (n, rows) => { const s = new FakeSheet(n); s.rows = rows.map(r => r.slice()); sheets[n] = s; return s; }
    };
}

module.exports = { makeEnv, FakeSheet };
