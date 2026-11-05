'use strict';
// حماية النصوص عند الكتابة في الشيت (T1.3/T1.4). رُصد في Sheets الفعلي (ملف تجريبي، لغة en_US):
//   «001» ← 1، «00123» ← 123، «1/2» ← تاريخ، «1e3» ← 1000، «TRUE» ← منطقي، «=1+1» ← صيغة حيّة عند إعادة الكتابة،
//   وتنسيق العمود كنص لا يمنع ذلك مع appendRow. الحل: البادئة ' على كل نص يُكتب (علامة نص يستهلكها Sheets).
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/fakeSheets');

const NAMES = ['appendRow_', 'updateRow_', 'readRows_', 'sheet_', 'safeText_', 'saveTripData', 'financeEndorse', 'saveEmployee', 'setEmployeeStatus',
    'linkEmployeesToDirectory', 'resetExecutionCache_', 'USER_HEADERS', 'DIR_HEADERS', 'DEPT_HEADERS', 'EMP_HEADERS'];
const plain = x => JSON.parse(JSON.stringify(x));

function env(email) {
    const e = makeEnv({ email: email || 'hr1@x.iq' }, NAMES);
    const S = e.S;
    e.addSheet('المستخدمون', [S.USER_HEADERS, ['hr1@x.iq', 'موارد بشرية', ''], ['fin1@x.iq', 'مالية', ''], ['adm@x.iq', 'مسؤول', '']]);
    e.addSheet('الموظفون', [S.DIR_HEADERS, ['E-100', 'أحمد', 'التدقيق', 'الموظف', 'فعّال'], ['0123', 'علي', 'التدقيق', '', '']]);
    e.addSheet('الأقسام', [S.DEPT_HEADERS, ['التدقيق', 'فعّال'], ['النقل', 'فعّال']]);
    return e;
}
const cell = (sh, r, c) => { const g = sh.getRange(r, c); return { v: g.getValue(), f: g.getFormula() }; };

const TEXTS = ['001', '00123', '1/2', '2026-11-02', '2026-11-02T10:30', '12:30', '1e3', 'TRUE', 'false', '=1+1', '+1+1', '-1+1', '@SUM(1)',
    '=HYPERLINK("https://example.com","x")', "'مقتبس", 'عبد الله', 'E-100', '١٢٣', '٠٠١', '12345678901234567890'];

test('كل نص يبقى نصاً كما هو بعد الإضافة وبعد تحديث الصف (مرتين)', () => {
    const e = env(), S = e.S;
    const sh = S.sheet_('_t', ['المفتاح', 'القيمة', 'الرقم']);
    TEXTS.forEach(v => {
        S.appendRow_(sh, { 'المفتاح': 'k', 'القيمة': 'أ', 'الرقم': v });
        const r = sh.getLastRow();
        const check = when => { const c = cell(sh, r, 3); assert.equal(typeof c.v, 'string', when + ': ' + v + ' نوع ' + typeof c.v); assert.equal(c.v, v, when + ': ' + v); assert.equal(c.f, '', when + ': صيغة في ' + v); };
        check('بعد الإضافة');
        S.updateRow_(sh, r, { 'القيمة': 'ب' }); check('بعد التحديث');
        S.updateRow_(sh, r, { 'القيمة': 'ج' }); check('بعد التحديث الثاني');
    });
});

test('الأرقام والمنطقي والتواريخ الفعلية والفارغ لا تُمسّ', () => {
    const e = env(), S = e.S;
    const sh = S.sheet_('_t2', ['أ', 'ب', 'ج', 'د', 'هـ']);
    const d = new (S.Date)(Date.UTC(2026, 10, 2, 10, 30));
    S.appendRow_(sh, { 'أ': 500000, 'ب': 0, 'ج': true, 'د': d, 'هـ': '' });
    const r = sh.getLastRow();
    [1, 2, 3, 4, 5].forEach(c => assert.equal(cell(sh, r, c).f, ''));
    assert.deepEqual([cell(sh, r, 1).v, cell(sh, r, 2).v, cell(sh, r, 3).v, cell(sh, r, 5).v], [500000, 0, true, '']);
    assert.equal(cell(sh, r, 4).v, d);
    S.updateRow_(sh, r, { 'أ': 600000 });
    assert.deepEqual([cell(sh, r, 1).v, cell(sh, r, 3).v, cell(sh, r, 5).v], [600000, true, '']);
    assert.equal(cell(sh, r, 4).v, d);
});

test('safeText_ تنظّف الطول والمسافات فقط (الحماية في الكتابة لا هنا)', () => {
    const S = env().S;
    assert.equal(S.safeText_('  =1+1  ', 100), '=1+1');
    assert.equal(S.safeText_('abcdef', 3), 'abc');
    assert.equal(S.safeText_(undefined, 10), '');
});

test('رقم إيفاد «001» أو «5/2026» يُحفظ كما كُتب ويُعثر عليه لاحقاً', () => {
    ['001', '5/2026', '1e3', 'TRUE'].forEach(tripId => {
        const e = env(); const S = e.S;
        assert.equal(S.saveTripData({ tripId, orderDate: '2020-02-20', purpose: 'تدقيق', type: 'داخلي', start: '2020-03-01', end: '2020-03-02',
            origin: 'النجف', stops: [{ gov: 'البصرة' }], vehicle: 'شخصية', hotelType: 'لا يوجد', employees: [{ id: 'E-100', name: '' }] }).success, true);
        const h = e.rows('الإيفادات')[0];
        assert.equal(e.rows('الإيفادات')[1][h.indexOf('رقم الإيفاد')], tripId);
        assert.equal(e.rows('الموفدون')[1][e.rows('الموفدون')[0].indexOf('رقم الإيفاد')], tripId);
        e.session.email = 'fin1@x.iq'; S.resetExecutionCache_();
        assert.equal(S.financeEndorse(tripId, 'أحمد', '').success, true, 'لم يُعثر على الإيفاد ' + tripId);
    });
});

test('غرض إيفاد يبدأ بـ = يُحفظ نصاً ولا يصير صيغة', () => {
    const e = env(), S = e.S, evil = '=HYPERLINK("https://x.example","انقر")';
    S.saveTripData({ tripId: 'T-1', orderDate: '2020-02-20', purpose: evil, type: 'داخلي', start: '2020-03-01', end: '2020-03-02',
        origin: 'النجف', stops: [{ gov: 'البصرة' }], vehicle: 'شخصية', hotelType: 'لا يوجد', employees: [{ id: 'E-100', name: '' }] });
    const sh = e.sheets['الإيفادات'], c = e.rows('الإيفادات')[0].indexOf('غرض الإيفاد') + 1;
    assert.deepEqual(cell(sh, 2, c), { v: evil, f: '' });
});

test('رقم وظيفي بأصفار بادئة («0123»): يُضاف ويُعدَّل ويُعطَّل ويُرفض تكراره', () => {
    const e = env(), S = e.S;
    assert.throws(() => S.saveEmployee({ mode: 'add', id: '0123', name: 'آخر', dept: 'النقل', status: 'فعّال' }), /موجود في القائمة/);   // الموجود أصلاً بأصفاره
    assert.equal(S.saveEmployee({ mode: 'add', id: '0456', name: 'سارة', dept: 'النقل', grade: '', status: 'فعّال' }).success, true);
    assert.equal(e.rows('الموظفون')[3][0], '0456');
    assert.equal(S.setEmployeeStatus('0456', 'غير فعّال').success, true);
    assert.equal(S.saveEmployee({ mode: 'edit', id: '0456', name: 'سارة', dept: 'النقل', grade: '', status: 'فعّال' }).success, true);
    assert.throws(() => S.saveEmployee({ mode: 'add', id: '0456', name: 'ثالث', dept: 'النقل', status: 'فعّال' }), /موجود في القائمة/);
});

test('تقرير الربط: الرقم الوظيفي المقترح بأصفار بادئة يبقى نصاً', () => {
    const e = env('adm@x.iq'), S = e.S;
    const emps = e.addSheet('الموفدون', [S.EMP_HEADERS]);
    emps.rows.push(S.EMP_HEADERS.map(h => ({ 'رقم الإيفاد': 'T-9', 'اسم الموظف': 'ع لي' }[h] || '')));        // يطابق «علي» تقريباً (تجاهل المسافات)
    assert.equal(S.linkEmployeesToDirectory().success, true);
    const rep = e.rows('مراجعة الربط');
    assert.equal(typeof rep[1][3], 'string');
    assert.equal(rep[1][3], '0123');
});

test('بذور الأسعار: النص (ومنه تاريخ السريان) يبقى نصاً لا تاريخاً ولا رقماً', () => {
    const e = env(), S = e.S;
    S.saveTripData({ tripId: 'P-1', orderDate: '2020-02-20', purpose: 'تدقيق', type: 'داخلي', start: '2020-03-01', end: '2020-03-02',
        origin: 'النجف', stops: [{ gov: 'البصرة' }], vehicle: 'شخصية', hotelType: 'لا يوجد', employees: [{ id: 'E-100', name: '' }] });
    const rows = e.rows('الأسعار'), h = rows[0];
    assert.ok(rows.length > 10);
    rows.slice(1).forEach(r => {
        assert.equal(typeof r[h.indexOf('سارٍ من')], 'string');
        assert.equal(typeof r[h.indexOf('المبلغ')], 'number');            // المبالغ أرقام لا نصوص
    });
});

test('تواريخ الإيفاد تُحفظ نصاً كاملاً (…T00:00) كما كانت تصل الواجهة حين يحوّلها Sheets إلى Date', () => {
    const e = env(), S = e.S;
    S.saveTripData({ tripId: 'D-1', orderDate: '2020-02-20', purpose: 'تدقيق', type: 'داخلي', start: '2020-03-01', end: '2020-03-02T08:30',
        origin: 'النجف', stops: [{ gov: 'البصرة' }], vehicle: 'شخصية', hotelType: 'لا يوجد', employees: [{ id: 'E-100', name: '' }] });
    const h = e.rows('الإيفادات')[0], r = e.rows('الإيفادات')[1];
    assert.equal(r[h.indexOf('تاريخ الذهاب')], '2020-03-01T00:00');
    assert.equal(r[h.indexOf('تاريخ العودة')], '2020-03-02T08:30');
    assert.equal(r[h.indexOf('تاريخ الأمر')], '2020-02-20T00:00');
});
