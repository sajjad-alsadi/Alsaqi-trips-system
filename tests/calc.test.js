'use strict';
// اختبارات محرك الاحتساب (الخادم هو المرجع). الأرقام محسوبة يدوياً من SEED_* وراجعتها قبل تثبيتها.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('./helpers/load');

const S = loadServer(['calcTrip_', 'pickRates_', 'SEED_ALLOWANCE', 'SEED_TRANSPORT', 'SEED_ABROAD', 'RATE_TYPES_']);

function ratesTable(extra) {
    const T = S.RATE_TYPES_, rows = [];
    Object.keys(S.SEED_ALLOWANCE).forEach(k => rows.push({ type: T.allowance, item: k, amount: S.SEED_ALLOWANCE[k], from: '2026-01-01' }));
    Object.keys(S.SEED_TRANSPORT).forEach(k => rows.push({ type: T.transport, item: k, amount: S.SEED_TRANSPORT[k], from: '2026-01-01' }));
    Object.keys(S.SEED_ABROAD).forEach(k => rows.push({ type: T.abroad, item: k, amount: S.SEED_ABROAD[k], from: '2026-01-01' }));
    return rows.concat(extra || []);
}
const RATES = S.pickRates_(ratesTable(), '2026-10-01');
const base = { type: 'داخلي', origin: 'النجف', vehicle: 'شركة', hotelType: 'لا يوجد', stops: [], employees: [] };
// نتيجة المحرك تأتي من سياق vm آخر: تُحوَّل إلى كائنات عادية ليعمل deepEqual الصارم (يقارن النماذج الأولية)
const calc = inp => JSON.parse(JSON.stringify(S.calcTrip_(Object.assign({}, base, inp), RATES)));
const lines = r => r.employees.map(e => [e.name, e.allowance, e.transport, e.hotel, e.total]);

test('داخلي: محافظة واحدة 3 أيام بعجلة شركة: السائق بنداً بالمخصص نفسه وبلا نقل', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-29', stops: [{ gov: 'البصرة' }], driverName: 'سائق', employees: [{ name: 'أحمد' }] });
    assert.deepEqual(r.errors, []);
    assert.equal(r.days, 3);
    assert.deepEqual(lines(r), [['أحمد', 105000, 0, 0, 105000], ['سائق', 105000, 0, 0, 105000]]);
    assert.equal(r.totals.payable, 210000);
});

test('محافظتان بيوم واحد: مخصص المحافظة الأبعد فقط (البصرة)', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', stops: [{ gov: 'بابل' }, { gov: 'البصرة' }], driverName: 'س', employees: [{ name: 'أحمد' }] });
    assert.deepEqual(r.errors, []);
    assert.equal(r.totals.allowance, 70000);
});

test('محافظتان بأيام موزَّعة: مجموع (مخصص × أيام المكوث)', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-29', stops: [{ gov: 'بابل', days: 1 }, { gov: 'البصرة', days: 2 }], driverName: 'س', employees: [{ name: 'أحمد' }] });
    assert.deepEqual(r.errors, []);
    assert.equal(lines(r)[0][1], 20000 + 35000 * 2);
});

test('مجموع أيام المحافظات لا يساوي المدة: خطأ', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-29', stops: [{ gov: 'بابل', days: 1 }, { gov: 'البصرة', days: 1 }], driverName: 'س', employees: [{ name: 'أحمد' }] });
    assert.deepEqual(r.errors, ['مجموع أيام المحافظات (2) لا يساوي مدة الإيفاد (3).']);
});

test('أيام مكوث كسرية: خطأ', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-29', stops: [{ gov: 'بابل', days: 1.5 }, { gov: 'البصرة', days: 1.5 }], driverName: 'س', employees: [{ name: 'أحمد' }] });
    assert.deepEqual(r.errors, ['حدّد عدد أيام مكوث صحيح (يوم فأكثر) لكل محافظة.']);
});

test('عجلة شخصية وموفدان بلا مستلم: خطأ؛ ومع المستلم تُدفع الأجور له وحده', () => {
    const inp = { start: '2026-09-27', end: '2026-09-27', stops: [{ gov: 'بغداد' }], vehicle: 'شخصية', employees: [{ name: 'أ' }, { name: 'ب' }] };
    assert.deepEqual(calc(inp).errors, ['حدد الموظف المستلم لأجور النقل.']);
    const r = calc(Object.assign({ transportReceiver: 'ب' }, inp));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(lines(r), [['أ', 25000, 0, 0, 25000], ['ب', 25000, 90000, 0, 115000]]);
    assert.equal(r.totals.payable, 140000);
});

test('موفد واحد بعجلة شخصية: المستلم تلقائياً', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', stops: [{ gov: 'بغداد' }], vehicle: 'شخصية', employees: [{ name: 'أ' }] });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(lines(r), [['أ', 25000, 90000, 0, 115000]]);
});

test('الانطلاق من بغداد يستعمل جدول النجف مؤقتاً (قرار D6 معلّق)', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', origin: 'بغداد', stops: [{ gov: 'كركوك' }], vehicle: 'مستأجرة', employees: [{ name: 'أ' }] });
    assert.deepEqual(r.errors, []);
    assert.equal(r.totals.transport, 170000);
});

test('الانطلاق من جهة أخرى: المسافة مطلوبة ويُوسَم «يحتاج اعتماد النقل»', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', origin: 'أربيل', stops: [{ gov: 'بغداد' }], vehicle: 'شخصية', employees: [{ name: 'أ' }] });
    assert.deepEqual(r.errors, ['أدخل المسافة بالكيلومتر للانطلاق من أربيل.']);
    assert.equal(r.needsApproval, true);
});

test('مبيت غير متعاقد بمبلغ معتمد يُضاف للموفد المستلم', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-28', stops: [{ gov: 'بابل' }], vehicle: 'شخصية', hotelType: 'غير متعاقد', hotelAmount: '75000', employees: [{ name: 'أ' }] });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(lines(r), [['أ', 40000, 35000, 75000, 150000]]);
});

test('خارجي: المخصص بالدرجة × الأيام، والسلفة خارج إجمالي المستحقات', () => {
    const r = calc({ type: 'خارجي', country: 'تركيا', start: '2026-09-27', end: '2026-09-30', employees: [{ name: 'أ', grade: 'رئيس القسم', advance: '500000' }, { name: 'ب', grade: 'الموظف' }] });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(lines(r), [['أ', 300000, 0, 0, 300000], ['ب', 200000, 0, 0, 200000]]);
    assert.equal(r.totals.advance, 500000);
    assert.equal(r.totals.payable, 500000);
});

test('خارجي بلا درجة: خطأ', () => {
    const r = calc({ type: 'خارجي', country: 'تركيا', start: '2026-09-27', end: '2026-09-30', employees: [{ name: 'أ' }] });
    assert.deepEqual(r.errors, ['حدد الدرجة الوظيفية للموفد: أ']);
});

test('عودة قبل الذهاب: خطأ', () => {
    const r = calc({ start: '2026-09-29', end: '2026-09-27', stops: [{ gov: 'بابل' }], driverName: 'س', employees: [{ name: 'أ' }] });
    assert.deepEqual(r.errors, ['لا يجوز أن يسبق تاريخ العودة تاريخ الذهاب.']);
});

test('اسم مكرر بكتابة مختلفة قليلاً (همزة ومسافة): خطأ', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', stops: [{ gov: 'بابل' }], driverName: 'س', employees: [{ name: 'أحمد' }, { name: 'احمد ' }] });
    assert.deepEqual(r.errors, ['الاسم مكرر داخل الإيفاد: احمد']);
});

test('اسم السائق مطابق لاسم موفد: خطأ', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', stops: [{ gov: 'بابل' }], driverName: 'أحمد', employees: [{ name: 'أحمد' }] });
    assert.deepEqual(r.errors, ['اسم السائق يجب أن يكون مختلفاً عن أسماء الموفدين.']);
});

test('محافظة الانطلاق (النجف) بلا مخصص معتمد: خطأ', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', stops: [{ gov: 'النجف' }], driverName: 'س', employees: [{ name: 'أ' }] });
    assert.deepEqual(r.errors, ['لا يوجد مبلغ إيفاد معتمد للمحافظة: النجف']);
});

test('اسم بديل لمحافظة (الرمادي) يُوحَّد إلى الأنبار', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', stops: [{ gov: 'الرمادي' }], driverName: 'س', employees: [{ name: 'أ' }] });
    assert.deepEqual(r.errors, []);
    assert.equal(r.totals.allowance, 2 * S.SEED_ALLOWANCE['الأنبار']);
});

test('إيفاد السائق وحده: بند واحد بالمخصص', () => {
    const r = calc({ start: '2026-09-27', end: '2026-09-27', stops: [{ gov: 'بابل' }], driverName: 'س', driverOnly: true, employees: [] });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(lines(r), [['س', 20000, 0, 0, 20000]]);
});

test('الأسعار بتاريخ سريان: سعر مستقبلي لا يؤثر في إيفاد سابق له', () => {
    const future = { type: S.RATE_TYPES_.allowance, item: 'بابل', amount: 99999, from: '2027-01-01' };
    const before = S.pickRates_(ratesTable([future]), '2026-10-01');
    const after = S.pickRates_(ratesTable([future]), '2027-02-01');
    assert.equal(before.allowance['بابل'], 20000);
    assert.equal(after.allowance['بابل'], 99999);
});
