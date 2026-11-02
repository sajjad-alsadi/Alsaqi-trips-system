'use strict';
// محاكاة صغيرة في الذاكرة لـ SpreadsheetApp وSession وLockService بالقدر الذي تستعمله الشيفرة.
// لا تحاكي سلوك Sheets الحقيقي في تحويل الأنواع أو الصيغ (هذا يُجرَّب على نسخة حقيقية: T1.3).
const { loadServer } = require('./load');

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
            setValues(v) { v.forEach((vr, i) => { const idx = r - 1 + i; sh.rows[idx] = sh.rows[idx] || []; vr.forEach((x, j) => { sh.rows[idx][c - 1 + j] = x; }); }); }
        };
    }
    getDataRange() {
        const w = this.getLastColumn();
        return { getValues: () => this.rows.map(r => Array.from({ length: w }, (_, j) => r[j] === undefined ? '' : r[j])) };
    }
    appendRow(arr) { this.rows.push(arr.slice()); }
    clearContents() { this.rows = []; }
}

// opts: { email: بريد المستخدم الحالي، owner: بريد مالك الملف (null = غير متاح)، sheets: { اسم: [[صف]...] } }
function makeEnv(opts, names) {
    opts = opts || {};
    const session = { email: opts.email === undefined ? '' : opts.email };
    const sheets = {};
    Object.keys(opts.sheets || {}).forEach(n => { const s = new FakeSheet(n); s.rows = opts.sheets[n].map(r => r.slice()); sheets[n] = s; });
    const owner = opts.owner === undefined ? null : opts.owner;
    const ss = {
        getSheetByName: n => sheets[n] || null,
        insertSheet: n => (sheets[n] = new FakeSheet(n)),
        getOwner: () => owner === null ? null : { getEmail: () => owner }
    };
    const S = loadServer(names, {
        SpreadsheetApp: { getActiveSpreadsheet: () => ss },
        Session: { getActiveUser: () => ({ getEmail: () => session.email }), getScriptTimeZone: () => 'Asia/Baghdad' },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        // الشيفرة لا تستعمل غير الصيغة yyyy-MM-dd'T'HH:mm؛ يُكتفى بـ UTC في المحاكاة
        Utilities: { formatDate: d => d.toISOString().slice(0, 16) }
    });
    return {
        S, session, sheets,
        rows: n => (sheets[n] ? sheets[n].rows : null),
        // يضيف شيتاً بعد التحميل (حين تلزم ترويسات الخادم لبناء الصفوف)
        addSheet: (n, rows) => { const s = new FakeSheet(n); s.rows = rows.map(r => r.slice()); sheets[n] = s; return s; }
    };
}

module.exports = { makeEnv, FakeSheet };
