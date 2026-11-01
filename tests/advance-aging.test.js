'use strict';
// تقادم السلف (D3): مهلة التسوية 10 أيام بعد تاريخ العودة؛ ما تجاوزها يُنبَّه به الموارد البشرية للمتابعة.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi, read, uiScript, extractFn } = require('./helpers/load');

const U = loadUi(['advanceAging', 'overdueAdvances', 'parseLocal_', 'normId_', 'ADVANCE_SETTLE_DAYS']);
const at = s => U.parseLocal_(s);
const plain = x => JSON.parse(JSON.stringify(x));
const trip = (id, end) => ({ 'رقم الإيفاد': id, 'تاريخ العودة': end });
const emp = (name, o) => Object.assign({ 'اسم الموظف': name, 'السلفة': 500000, 'حالة السلفة': 'مصروفة' }, o);

test('المهلة المعتمدة 10 أيام', () => assert.equal(U.ADVANCE_SETTLE_DAYS, 10));

test('سلفة غير مصروفة أو مُسوّاة أو صفر: لا تقادم', () => {
    const t = trip('T-1', '2026-11-01T00:00'), now = at('2026-12-31T10:00');
    assert.equal(U.advanceAging(t, emp('أ', { 'حالة السلفة': 'بانتظار الصرف' }), now), null);
    assert.equal(U.advanceAging(t, emp('أ', { 'حالة السلفة': 'مُسوّاة' }), now), null);
    assert.equal(U.advanceAging(t, emp('أ', { 'السلفة': 0 }), now), null);
    assert.equal(U.advanceAging(t, emp('أ', { 'السلفة': '', 'حالة السلفة': '' }), now), null);
});

test('الحدّ: العاشر من العودة ليس متأخراً، والحادي عشر متأخر بيوم', () => {
    const t = trip('T-1', '2026-11-01T00:00');
    assert.deepEqual(plain(U.advanceAging(t, emp('أ'), at('2026-11-11T09:00'))), { days: 10, overdueBy: 0, overdue: false });
    assert.deepEqual(plain(U.advanceAging(t, emp('أ'), at('2026-11-12T09:00'))), { days: 11, overdueBy: 1, overdue: true });
    assert.equal(U.advanceAging(t, emp('أ'), at('2026-11-21T09:00')).overdueBy, 10);   // 20 يوماً منذ العودة − مهلة 10
});

test('قبل العودة وفي يومها: غير متأخرة', () => {
    const t = trip('T-1', '2026-11-01T00:00');
    assert.equal(U.advanceAging(t, emp('أ'), at('2026-10-30T09:00')).overdue, false);
    assert.equal(U.advanceAging(t, emp('أ'), at('2026-10-30T09:00')).days, -2);
    assert.equal(U.advanceAging(t, emp('أ'), at('2026-11-01T23:59')).days, 0);
});

test('الحساب بالتاريخ دون الوقت، ويعبر حدود الأشهر والسنة الكبيسة', () => {
    assert.equal(U.advanceAging(trip('T', '2028-02-25T00:00'), emp('أ'), at('2028-03-07T00:01')).days, 11);   // 29 شباط 2028 موجود
    assert.equal(U.advanceAging(trip('T', '2026-12-28T00:00'), emp('أ'), at('2027-01-08T00:00')).days, 11);
    assert.equal(U.advanceAging(trip('T', '2026-11-01T23:59'), emp('أ'), at('2026-11-12T00:01')).days, 11);
});

test('تاريخ عودة مفقود أو غير صالح: لا تقادم', () => {
    assert.equal(U.advanceAging(trip('T', ''), emp('أ'), at('2026-12-01T00:00')), null);
    assert.equal(U.advanceAging(trip('T', 'غير تاريخ'), emp('أ'), at('2026-12-01T00:00')), null);
});

test('overdueAdvances: المتأخرة فقط، مرتبة من الأشد تأخراً، بمبالغها وأسماء أصحابها', () => {
    // الإدخال بترتيب غير مرتّب عمداً (الأحدث أولاً) ليُكشف أي حذف للفرز
    const trips = [trip('B-2', '2026-10-20T00:00'), trip('A-1', '2026-10-01T00:00'), trip('C-3', '2026-11-05T00:00')];
    const emps = [
        [emp('أحدث', { 'السلفة': 300000 })],
        [emp('قديمة'), emp('مُسوّاة', { 'حالة السلفة': 'مُسوّاة' })],
        [emp('ضمن المهلة')]
    ];
    const byTrip = new Map(trips.map((t, i) => [U.normId_(t['رقم الإيفاد']), emps[i]]));
    const r = U.overdueAdvances(trips, byTrip, at('2026-11-12T08:00')).map(x => [x.trip['رقم الإيفاد'], x.emp['اسم الموظف'], x.amount, x.days, x.overdueBy]);
    assert.deepEqual(plain(r), [['A-1', 'قديمة', 500000, 42, 32], ['B-2', 'أحدث', 300000, 23, 13]]);
});

test('الربط في الواجهة: تنبيه للموارد البشرية، ومرشح في قائمتها، وشارة، ووسم في القوائم والصرف', () => {
    const html = read('html_js_css.html'), ui = uiScript();
    assert.match(extractFn(ui, 'renderAlerts'), /can\('hr'\)[\s\S]*overdueAdvances\(/);
    assert.match(extractFn(ui, 'listMatches'), /adv-overdue/);
    assert.match(html, /data-status="adv-overdue"/);
    assert.match(extractFn(ui, 'updateBadges'), /overdueAdvances\(/);
    assert.match(extractFn(ui, 'tripRowEl'), /advanceAging\(/);
});
