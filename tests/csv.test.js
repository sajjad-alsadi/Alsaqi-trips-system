'use strict';
// تصدير CSV للتدقيق (C3 في docs/improvement-plan.md): المصادقة والمخالفة تُسجَّل في صفوف الموفدين.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi, loadServer } = require('./helpers/load');
const { buildAuditCSV, csvCell } = loadUi(['buildAuditCSV', 'csvCell']);
const { normId_ } = loadServer(['normId_']);

// محلّل CSV بسيط: فواصل، نصوص مقتبسة، "" داخل النص، سطر BOM وCRLF
function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\r') { /* تجاهل */ }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
}
const byHeader = csv => { const [h, ...r] = parseCsv(csv); return r.map(cells => Object.fromEntries(h.map((k, i) => [k, cells[i]]))); };

const trip = (over) => Object.assign({
    'رقم الإيفاد': '101', 'نوع الإيفاد': 'داخلي', 'غرض الإيفاد': 'تدقيق', 'تاريخ الذهاب': '2026-09-27', 'تاريخ العودة': '2026-09-29',
    'عدد الأيام': 3, 'جهة الانطلاق': 'النجف', 'الوجهات': 'البصرة', 'نوع العجلة': 'شركة', 'إجمالي النقل': 0, 'أجور المبيت': 0,
    'حالة الطلب': 'تم الصرف', 'الإصدار': 2
}, over);
const emp = (name, over) => Object.assign({ 'رقم الإيفاد': '101', 'اسم الموظف': name, 'إجمالي المستحقات': 105000, 'المصروف': 105000, 'رقم قيد الصرف': 'V-1' }, over);
const run = (t, emps) => byHeader(buildAuditCSV([t], new Map([[normId_(t['رقم الإيفاد']), emps]])))[0];

test('إيفاد جديد: المصادقة والمدقق والتاريخ تُجمع من الموفدين (قيمة واحدة إن تطابقت)', () => {
    const approvals = { 'مصادقة المالية': 'fin@x.iq', 'تاريخ مصادقة المالية': '2026-09-30T09:00:00', 'المدقق': 'aud@x.iq', 'تاريخ التدقيق': '2026-10-01T10:30:00' };
    const r = run(trip(), [emp('أحمد', approvals), emp('سائق', approvals)]);
    assert.equal(r['مصادقة المالية'], 'fin@x.iq');
    assert.equal(r['مصادقة الرقابة'], 'aud@x.iq');
    assert.equal(r['تاريخ مصادقة الرقابة'], '01/10/2026 10:30');
    assert.equal(r['نوع المخالفة'], '');
    assert.equal(r['سبب الإعادة'], '');
});

test('موفدان بمدققين مختلفين: تُعرض القيم المتميّزة مفصولة بـ |', () => {
    const r = run(trip(), [emp('أ', { 'المدقق': 'a1@x.iq' }), emp('ب', { 'المدقق': 'a2@x.iq' }), emp('ج', { 'المدقق': 'a1@x.iq' })]);
    assert.equal(r['مصادقة الرقابة'], 'a1@x.iq | a2@x.iq');
});

test('موفد معاد: نوع المخالفة وسببها من صفه', () => {
    const r = run(trip({ 'حالة الطلب': 'معاد إلى المالية' }), [emp('أ', { 'نوع المخالفة': 'خطأ في الاحتساب', 'سبب الإعادة': 'المبلغ لا يطابق الأيام' }), emp('ب')]);
    assert.equal(r['نوع المخالفة'], 'خطأ في الاحتساب');
    assert.equal(r['سبب الإعادة'], 'المبلغ لا يطابق الأيام');
});

test('إيفاد قديم بقيم على صف الإيفاد فقط: تبقى كما كانت', () => {
    const r = run(trip({ 'مصادقة المالية': 'old@x.iq', 'المدقق': 'oldaud@x.iq', 'تاريخ التدقيق': '2025-01-05T08:00:00', 'نوع المخالفة': 'قديم', 'سبب الإعادة': 'سبب قديم' }), [emp('أ')]);
    assert.equal(r['مصادقة المالية'], 'old@x.iq');
    assert.equal(r['مصادقة الرقابة'], 'oldaud@x.iq');
    assert.equal(r['تاريخ مصادقة الرقابة'], '05/01/2025 08:00');
    assert.equal(r['نوع المخالفة'], 'قديم');
    assert.equal(r['سبب الإعادة'], 'سبب قديم');
});

test('بقية الأعمدة لم تتغير: الموفدون والمبالغ وقيود الصرف', () => {
    const r = run(trip(), [emp('أحمد'), emp('سائق', { 'رقم قيد الصرف': 'V-2' })]);
    assert.equal(r['رقم الإيفاد'], '101');
    assert.equal(r['الموفدون'], 'أحمد | سائق');
    assert.equal(r['إجمالي المستحقات'], '210000');
    assert.equal(r['المصروف'], '210000');
    assert.equal(r['قيود الصرف'], 'V-1 | V-2');
    assert.equal(r['الإصدار'], '2');
});

test('حماية حقن الصيغ في Excel: خلية تبدأ بـ = أو + أو - أو @ تُسبق بفاصلة عليا', () => {
    ['=1+1', '+SUM(A1)', '-2', '@x'].forEach(v => assert.equal(csvCell(v), '"\'' + v + '"'));
    assert.equal(csvCell('نص "مقتبس"'), '"نص ""مقتبس"""');
});
