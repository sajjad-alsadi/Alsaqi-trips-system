'use strict';
// فصل المهام (D2 في docs/improvement-plan.md)، بلا استثناء، لكل نسخة من الإيفاد ولكل بند موفد:
//   المُدخِل (أو المعدِّل) ≠ مصادق المالية ≠ المدقق ≠ المُدخِل.
//   الصارف ≠ المُدخِل و≠ المدقق، ويجوز أن يكون مصادق المالية.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/fakeSheets');

const NAMES = ['financeEndorse', 'auditApprove', 'payEmployee', 'payAdvance', 'saveTripData', 'updateTrip', 'TRIP_HEADERS', 'EMP_HEADERS', 'USER_HEADERS', 'ST'];
const FIN = 'بانتظار مصادقة المالية', AUD = 'بانتظار مصادقة الرقابة', PAY = 'بانتظار الصرف';
const row = (headers, o) => headers.map(h => (o[h] === undefined ? '' : o[h]));

// المستخدمون: hr1 للإدخال؛ fin1/fin2 مالية؛ aud1/aud2 رقابة؛ multi بكل الأدوار؛ hrfin بدورين
const USERS = [
    ['hr1@x.iq', 'موارد بشرية', ''], ['fin1@x.iq', 'مالية', ''], ['fin2@x.iq', 'مالية', ''],
    ['aud1@x.iq', 'رقابة', ''], ['aud2@x.iq', 'رقابة', ''],
    ['multi@x.iq', 'موارد بشرية، مالية، رقابة', ''], ['finaud@x.iq', 'مالية، رقابة', '']
];

// يبني بيئة بإيفاد واحد T-1 وموفد واحد؛ trip/emp تعدّلان الحقول
function setup(email, trip, emp) {
    const e = makeEnv({ email }, NAMES);
    const S = e.S;
    e.addSheet('المستخدمون', [S.USER_HEADERS].concat(USERS));
    e.addSheet('الإيفادات', [S.TRIP_HEADERS, row(S.TRIP_HEADERS, Object.assign({
        'رقم الإيفاد': 'T-1', 'حالة الطلب': FIN, 'تاريخ العودة': '2020-01-01T00:00', 'المُدخِل': 'hr1@x.iq', 'مُدخِل النسخة الحالية': 'hr1@x.iq', 'الإصدار': 1
    }, trip))]);
    e.addSheet('الموفدون', [S.EMP_HEADERS, row(S.EMP_HEADERS, Object.assign({
        'رقم الإيفاد': 'T-1', 'اسم الموظف': 'أحمد', 'حالة الموفد': FIN, 'إجمالي المستحقات': 100000, 'المصروف': 0
    }, emp))]);
    e.addSheet('سجل التغييرات', [S.LOG_HEADERS || []]);
    return e;
}
const cell = (e, sheet, header) => {
    const rows = e.rows(sheet), h = rows[0];
    return rows[1][h.indexOf(header)];
};
const MSG = {
    finEnterer: /لا يجوز لمن أدخل الإيفاد أو عدّله أن يصادق عليه مالياً/,
    finAudit: /لا يجوز لمن صادق عليه رقابياً أن يصادق عليه مالياً/,
    audEnterer: /لا يجوز لمن أدخل الإيفاد أو عدّله أن يصادق عليه رقابياً/,
    audFin: /لا يجوز لمن صادق عليه مالياً أن يصادق عليه رقابياً/,
    payEnterer: /لا يجوز لمن أدخل الإيفاد أو عدّله أن يصرفه/,
    payAudit: /لا يجوز لمن صادق عليه رقابياً أن يصرفه/
};

// ——— مصادقة المالية ———
test('مصادقة المالية: المُدخِل نفسه (بدورين) يُرفض ولا يتغير شيء', () => {
    const e = setup('multi@x.iq', { 'المُدخِل': 'multi@x.iq', 'مُدخِل النسخة الحالية': 'multi@x.iq' });
    assert.throws(() => e.S.financeEndorse('T-1', 'أحمد', ''), MSG.finEnterer);
    assert.equal(cell(e, 'الموفدون', 'حالة الموفد'), FIN);
    assert.equal(cell(e, 'الموفدون', 'مصادقة المالية'), '');
});

test('مصادقة المالية: شخص آخر يصادق وتُسجَّل هويته', () => {
    const e = setup('fin1@x.iq');
    assert.equal(e.S.financeEndorse('T-1', 'أحمد', 'سليم').success, true);
    assert.equal(cell(e, 'الموفدون', 'مصادقة المالية'), 'fin1@x.iq');
    assert.equal(cell(e, 'الموفدون', 'حالة الموفد'), AUD);
});

test('مصادقة المالية: من صادق رقابياً على البند نفسه (قبل إعادته إلى المالية) يُرفض', () => {
    const e = setup('finaud@x.iq', {}, { 'المدقق': 'finaud@x.iq', 'حالة الموفد': 'معاد إلى المالية' });
    assert.throws(() => e.S.financeEndorse('T-1', 'أحمد', ''), MSG.finAudit);
});

test('المُدخِل المعتمد هو مُدخِل النسخة الحالية، فإن غاب فالمُدخِل الأصلي (إيفاد قديم)', () => {
    // عُدِّل الإيفاد بيد multi فصار هو مُدخِل النسخة الحالية، بينما المُدخِل الأصلي hr1
    const edited = setup('multi@x.iq', { 'مُدخِل النسخة الحالية': 'multi@x.iq' });
    assert.throws(() => edited.S.financeEndorse('T-1', 'أحمد', ''), MSG.finEnterer);
    // والمُدخِل الأصلي لم يعد مقيَّداً بهذه النسخة (hr1 لا يملك دور المالية هنا؛ نجرّب بمستخدم يملكه)
    const legacy = setup('multi@x.iq', { 'المُدخِل': 'multi@x.iq', 'مُدخِل النسخة الحالية': '' });
    assert.throws(() => legacy.S.financeEndorse('T-1', 'أحمد', ''), MSG.finEnterer);
});

test('المقارنة لا تتأثر بحالة الأحرف أو المسافات في البريد المخزَّن', () => {
    const e = setup('multi@x.iq', { 'مُدخِل النسخة الحالية': '  Multi@X.IQ ' });
    assert.throws(() => e.S.financeEndorse('T-1', 'أحمد', ''), MSG.finEnterer);
});

// ——— مصادقة الرقابة ———
const AUD_STATE = { 'حالة الموفد': AUD, 'مصادقة المالية': 'fin1@x.iq' };

test('مصادقة الرقابة: المُدخِل يُرفض', () => {
    const e = setup('multi@x.iq', { 'المُدخِل': 'multi@x.iq', 'مُدخِل النسخة الحالية': 'multi@x.iq' }, AUD_STATE);
    assert.throws(() => e.S.auditApprove('T-1', 'أحمد', ''), MSG.audEnterer);
});

test('مصادقة الرقابة: مصادق المالية يُرفض', () => {
    const e = setup('finaud@x.iq', {}, { 'حالة الموفد': AUD, 'مصادقة المالية': 'finaud@x.iq' });
    assert.throws(() => e.S.auditApprove('T-1', 'أحمد', ''), MSG.audFin);
    assert.equal(cell(e, 'الموفدون', 'حالة الموفد'), AUD);
});

test('مصادقة الرقابة: مدقق مستقل يصادق وتُسجَّل هويته', () => {
    const e = setup('aud1@x.iq', {}, AUD_STATE);
    assert.equal(e.S.auditApprove('T-1', 'أحمد', '').success, true);
    assert.equal(cell(e, 'الموفدون', 'المدقق'), 'aud1@x.iq');
    assert.equal(cell(e, 'الموفدون', 'حالة الموفد'), PAY);
});

// ——— الصرف ———
const PAY_STATE = { 'حالة الموفد': PAY, 'مصادقة المالية': 'fin1@x.iq', 'المدقق': 'aud1@x.iq' };

test('الصرف: المُدخِل يُرفض', () => {
    const e = setup('multi@x.iq', { 'المُدخِل': 'multi@x.iq', 'مُدخِل النسخة الحالية': 'multi@x.iq' }, PAY_STATE);
    assert.throws(() => e.S.payEmployee('T-1', 'أحمد', 'V-1', ''), MSG.payEnterer);
    assert.equal(cell(e, 'الموفدون', 'المصروف'), 0);
});

test('الصرف: المدقق يُرفض', () => {
    const e = setup('finaud@x.iq', {}, { 'حالة الموفد': PAY, 'مصادقة المالية': 'fin1@x.iq', 'المدقق': 'finaud@x.iq' });
    assert.throws(() => e.S.payEmployee('T-1', 'أحمد', 'V-1', ''), MSG.payAudit);
    assert.equal(cell(e, 'الموفدون', 'المصروف'), 0);
});

test('الصرف: يجوز أن يكون الصارف هو مصادق المالية (قرار المالك)', () => {
    const e = setup('fin1@x.iq', {}, PAY_STATE);
    const r = e.S.payEmployee('T-1', 'أحمد', 'V-1', '');
    assert.equal(r.success, true);
    assert.equal(cell(e, 'الموفدون', 'المصروف'), 100000);
    assert.equal(cell(e, 'الموفدون', 'الدافع'), 'fin1@x.iq');
});

test('الصرف: صارف مالية آخر غير المصادق يصرف أيضاً', () => {
    const e = setup('fin2@x.iq', {}, PAY_STATE);
    assert.equal(e.S.payEmployee('T-1', 'أحمد', 'V-1', '').success, true);
});

test('صرف السلفة: القواعد نفسها (المُدخِل والمدقق يُرفضان، ومصادق المالية يجوز)', () => {
    const adv = { 'حالة الموفد': PAY, 'مصادقة المالية': 'fin1@x.iq', 'المدقق': 'aud1@x.iq', 'السلفة': 500000, 'حالة السلفة': 'بانتظار الصرف', 'إجمالي المستحقات': 0 };
    const byEnterer = setup('multi@x.iq', { 'المُدخِل': 'multi@x.iq', 'مُدخِل النسخة الحالية': 'multi@x.iq' }, adv);
    assert.throws(() => byEnterer.S.payAdvance('T-1', 'أحمد', 'V-9'), MSG.payEnterer);
    const byAuditor = setup('finaud@x.iq', {}, Object.assign({}, adv, { 'المدقق': 'finaud@x.iq' }));
    assert.throws(() => byAuditor.S.payAdvance('T-1', 'أحمد', 'V-9'), MSG.payAudit);
    const byEndorser = setup('fin1@x.iq', {}, adv);
    assert.equal(byEndorser.S.payAdvance('T-1', 'أحمد', 'V-9').success, true);
    assert.equal(cell(byEndorser, 'الموفدون', 'حالة السلفة'), 'مصروفة');
});

// ——— تكامل: الحفظ والتعديل ودورة كاملة بالدوال الحقيقية ———
const FORM = {
    tripId: 'T-9', orderDate: '2020-02-20', purpose: 'تدقيق ميداني', type: 'داخلي', start: '2020-03-01', end: '2020-03-03',
    origin: 'النجف', stops: [{ gov: 'البصرة' }], vehicle: 'شركة', driverName: 'سائق', hotelType: 'لا يوجد',
    employees: [{ name: 'أحمد', dept: 'التدقيق', grade: 'الموظف' }]
};
function fresh(email) {
    const e = makeEnv({ email }, NAMES);
    e.addSheet('المستخدمون', [e.S.USER_HEADERS, ['hr1@x.iq', 'موارد بشرية', ''], ['hr2@x.iq', 'موارد بشرية', ''], ['fin1@x.iq', 'مالية', ''], ['finaud@x.iq', 'مالية، رقابة', '']]);
    return e;
}
const val = (e, sheet, header, i) => e.rows(sheet)[i || 1][e.rows(sheet)[0].indexOf(header)];
const as = (e, email) => { e.session.email = email; e.S.resetExecutionCache_ && e.S.resetExecutionCache_(); };

test('الحفظ يسجّل المُدخِل ومُدخِل النسخة؛ والتعديل يغيّر مُدخِل النسخة وحده', () => {
    const e = fresh('hr1@x.iq');
    assert.equal(e.S.saveTripData(FORM).success, true);
    assert.equal(val(e, 'الإيفادات', 'المُدخِل'), 'hr1@x.iq');
    assert.equal(val(e, 'الإيفادات', 'مُدخِل النسخة الحالية'), 'hr1@x.iq');
    // يُعاد الموفد إلى الموارد البشرية ثم يعدّل الإيفاد hr2
    e.rows('الموفدون')[1][e.rows('الموفدون')[0].indexOf('حالة الموفد')] = 'معاد إلى الموارد البشرية';
    as(e, 'hr2@x.iq');
    assert.equal(e.S.updateTrip('T-9', Object.assign({}, FORM, { end: '2020-03-04' }), 'تصحيح التاريخ').success, true);
    assert.equal(val(e, 'الإيفادات', 'المُدخِل'), 'hr1@x.iq');
    assert.equal(val(e, 'الإيفادات', 'مُدخِل النسخة الحالية'), 'hr2@x.iq');
    assert.equal(val(e, 'الإيفادات', 'الإصدار'), 2);
});

test('دورة كاملة: كل مرحلة بشخص مختلف، ويجوز أن يصرف مصادق المالية', () => {
    const e = fresh('hr1@x.iq');
    e.S.saveTripData(FORM);
    // المالية والرقابة اثنان؛ finaud يحمل الدورين لكنه لم يصادق مالياً
    as(e, 'fin1@x.iq');   assert.equal(e.S.financeEndorse('T-9', 'أحمد', '').success, true);
    as(e, 'finaud@x.iq'); assert.equal(e.S.auditApprove('T-9', 'أحمد', '').success, true);
    // الصرف: المدقق finaud (يملك دور المالية) يُرفض، أما مصادق المالية fin1 فيصرف
    assert.throws(() => e.S.payEmployee('T-9', 'أحمد', 'V-1', ''), /لا يجوز لمن صادق عليه رقابياً أن يصرفه/);
    as(e, 'fin1@x.iq');   assert.equal(e.S.payEmployee('T-9', 'أحمد', 'V-1', '').success, true);
    assert.equal(val(e, 'الموفدون', 'مصادقة المالية'), 'fin1@x.iq');
    assert.equal(val(e, 'الموفدون', 'المدقق'), 'finaud@x.iq');
    assert.equal(val(e, 'الموفدون', 'الدافع'), 'fin1@x.iq');
});

test('دورة كاملة: المدقق لا يدقّق ما صادق عليه مالياً بنفسه', () => {
    const e = fresh('hr1@x.iq');
    e.S.saveTripData(FORM);
    as(e, 'finaud@x.iq');
    assert.equal(e.S.financeEndorse('T-9', 'أحمد', '').success, true);
    assert.throws(() => e.S.auditApprove('T-9', 'أحمد', ''), /لا يجوز لمن صادق عليه مالياً أن يصادق عليه رقابياً/);
});
