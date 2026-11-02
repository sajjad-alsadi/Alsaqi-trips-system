'use strict';
// قائمة الموظفين والأقسام (T2.6، قرار D4): الهوية بالرقم الوظيفي لا بالاسم، والأسماء من القائمة لا من الكتابة الحرة.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/fakeSheets');

const NAMES = ['directory_', 'applyDirectory_', 'dirEntryForName_', 'empIdentity_', 'looseKey_', 'saveTripData', 'updateTrip',
    'linkEmployeesToDirectory', 'getDashboardData', 'resetExecutionCache_', 'TRIP_HEADERS', 'EMP_HEADERS', 'USER_HEADERS', 'DIR_HEADERS', 'DEPT_HEADERS', 'ADJ_HEADERS'];
const plain = x => JSON.parse(JSON.stringify(x));
const row = (headers, o) => headers.map(h => (o[h] === undefined ? '' : o[h]));

const DIR_ROWS = [
    ['E-100', 'أحمد', 'التدقيق', 'الموظف', 'فعّال'],
    ['E-101', 'عبدالله علي', 'المالية', 'رئيس القسم', ''],
    ['E-102', 'مريم حسن', 'الموارد البشرية', 'الموظف', 'غير فعّال'],
    ['D-200', 'سائق الشركة', 'النقل', 'الموظف', '']
];
const DEPT_ROWS = [['التدقيق', 'فعّال'], ['المالية', ''], ['الموارد البشرية', ''], ['النقل', '']];
const USERS = [['hr1@x.iq', 'موارد بشرية', ''], ['adm@x.iq', 'مسؤول', ''], ['fin1@x.iq', 'مالية', '']];

function env(email, opts) {
    opts = opts || {};
    const e = makeEnv({ email: email || 'hr1@x.iq' }, NAMES);
    const S = e.S;
    e.addSheet('المستخدمون', [S.USER_HEADERS].concat(USERS));
    e.addSheet('الموظفون', [S.DIR_HEADERS].concat(opts.dir || DIR_ROWS));
    e.addSheet('الأقسام', [S.DEPT_HEADERS].concat(opts.depts || DEPT_ROWS));
    return e;
}
const as = (e, email) => { e.session.email = email; };
const val = (e, sheet, header, i) => e.rows(sheet)[i || 1][e.rows(sheet)[0].indexOf(header)];
const FORM = (o) => Object.assign({
    tripId: 'T-1', orderDate: '2020-02-20', purpose: 'تدقيق', type: 'داخلي', start: '2020-03-01', end: '2020-03-03',
    origin: 'النجف', stops: [{ gov: 'البصرة' }], vehicle: 'شخصية', hotelType: 'لا يوجد',
    employees: [{ id: 'E-100', name: 'أحمد', dept: '', grade: '' }]
}, o);

// ——— قراءة القائمة ———
test('directory_: يقرأ الموظفين والأقسام ويطبّع حالة التفعيل', () => {
    const d = plain(env().S.directory_());
    assert.equal(d.employees.length, 4);
    assert.deepEqual(d.employees.map(x => x.active), [true, true, false, true]);
    assert.deepEqual(d.departments, ['التدقيق', 'المالية', 'الموارد البشرية', 'النقل']);
    assert.deepEqual(d.issues, []);
});

test('directory_: الملاحظات (تكرار الرقم، بلا رقم أو اسم، قسم أو درجة غير معتمدة) دون إسقاط الصالح', () => {
    const e = env('hr1@x.iq', { dir: DIR_ROWS.concat([
        ['E-100', 'مكرر', 'التدقيق', 'الموظف', ''],
        ['', 'بلا رقم', 'التدقيق', 'الموظف', ''],
        ['E-300', '', 'التدقيق', 'الموظف', ''],
        ['E-301', 'قسم مجهول', 'قسم غير موجود', 'الموظف', ''],
        ['E-302', 'درجة مجهولة', 'التدقيق', 'درجة وهمية', '']
    ]) });
    const d = plain(e.S.directory_());
    assert.deepEqual(d.employees.map(x => x.id), ['E-100', 'E-101', 'E-102', 'D-200', 'E-301', 'E-302']);
    assert.equal(d.issues.length, 5);
    assert.match(d.issues.join('\n'), /E-100 مكرر/);
    assert.match(d.issues.join('\n'), /بلا رقم وظيفي/);
    assert.match(d.issues.join('\n'), /بلا اسم/);
    assert.match(d.issues.join('\n'), /القسم "قسم غير موجود"/);
    assert.match(d.issues.join('\n'), /الدرجة "درجة وهمية"/);
});

// ——— الهوية ———
test('«عبد الله علي» و«عبدالله علي» هوية واحدة (E-101) رغم اختلاف كتابة الاسم', () => {
    const S = env().S, dir = S.directory_();
    assert.equal(S.dirEntryForName_('عبد الله علي', dir).id, 'E-101');
    assert.equal(S.dirEntryForName_('عبدالله علي', dir).id, 'E-101');
    assert.equal(S.empIdentity_({ 'اسم الموظف': 'عبد الله علي' }, dir), S.empIdentity_({ 'اسم الموظف': 'عبدالله علي' }, dir));
});

test('الهوية: الرقم المخزَّن يغلب على الاسم؛ والاسم غير المطابَق أو الملتبس يبقى بمفتاح الاسم', () => {
    const e = env('hr1@x.iq', { dir: DIR_ROWS.concat([['E-400', 'علي حسن', '', '', ''], ['E-401', 'علي  حسن', '', '', '']]) });
    const S = e.S, dir = S.directory_();
    assert.equal(S.empIdentity_({ 'الرقم الوظيفي': 'e-100', 'اسم الموظف': 'اسم آخر' }, dir), 'id:e-100');
    assert.match(S.empIdentity_({ 'اسم الموظف': 'علي حسن' }, dir), /^n:/);           // اسمان متطابقان في القائمة: ملتبس
    assert.match(S.empIdentity_({ 'اسم الموظف': 'شخص غير موجود' }, dir), /^n:/);
});

// ——— تطبيق القائمة على مدخلات الإيفاد ———
const inputOf = (o) => Object.assign({ employees: [], driverName: '', driverId: '' }, o);

test('applyDirectory_: قائمة فارغة ← خطأ واحد واضح', () => {
    const e = env('hr1@x.iq', { dir: [] });
    const r = plain(e.S.applyDirectory_(inputOf({ employees: [{ id: 'E-100', name: 'أحمد' }] })));
    assert.deepEqual(r.errors, ['قائمة الموظفين فارغة. تضيفها الموارد البشرية في شيت "الموظفون" (الرقم الوظيفي، الاسم، القسم، الدرجة).']);
});

test('applyDirectory_: اسم مكتوب بلا اختيار، ورقم غير موجود، وموظف غير فعّال: أخطاء محددة', () => {
    const S = env().S;
    const r = plain(S.applyDirectory_(inputOf({ employees: [{ name: 'أحمد' }, { id: 'X-9', name: 'س' }, { id: 'E-102', name: 'مريم' }] })));
    assert.deepEqual(r.errors, [
        'اختر الموظف "أحمد" من قائمة الموظفين (لا يُقبل اسم مكتوب يدوياً).',
        'الرقم الوظيفي "X-9" غير موجود في قائمة الموظفين.',
        'الموظف "مريم حسن" غير فعّال في قائمة الموظفين.'
    ]);
});

test('applyDirectory_: الاسم والقسم والدرجة تُؤخذ من القائمة لا من المُرسَل، وصف فارغ يُتجاهل', () => {
    const S = env().S;
    const inp = inputOf({ employees: [{ id: 'E-101', name: 'كتابة خاطئة', dept: 'قسم مزيّف', grade: 'الموظف' }, { id: '', name: '', dept: '', grade: '' }] });
    const r = plain(S.applyDirectory_(inp));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(plain(inp.employees[0]), { id: 'E-101', name: 'عبدالله علي', dept: 'المالية', grade: 'رئيس القسم' });
    assert.deepEqual(Object.values(plain(r.ids)), ['E-101']);
});

test('applyDirectory_: السائق يُختار من القائمة أيضاً (بلا رقم: خطأ)', () => {
    const S = env().S;
    const bad = plain(S.applyDirectory_(inputOf({ driverName: 'سائق الشركة' })));
    assert.deepEqual(bad.errors, ['السائق: اختر السائق "سائق الشركة" من قائمة الموظفين (لا يُقبل اسم مكتوب يدوياً).']);
    const inp = inputOf({ driverName: 'اسم مختلف', driverId: 'D-200' });
    assert.deepEqual(plain(S.applyDirectory_(inp)).errors, []);
    assert.equal(inp.driverName, 'سائق الشركة');
});

// ——— الحفظ ———
test('saveTripData: يخزّن الرقم الوظيفي للموفد والسائق، ويتجاهل القسم والدرجة المُرسَلة', () => {
    const e = env();
    const r = e.S.saveTripData(FORM({ vehicle: 'شركة', driverName: 'سائق الشركة', driverId: 'D-200',
        employees: [{ id: 'E-101', name: 'xx', dept: 'قسم مزيّف', grade: '' }] }));
    assert.equal(r.success, true);
    const names = e.rows('الموفدون').slice(1).map(x => x[e.rows('الموفدون')[0].indexOf('اسم الموظف')]);
    const ids = e.rows('الموفدون').slice(1).map(x => x[e.rows('الموفدون')[0].indexOf('الرقم الوظيفي')]);
    assert.deepEqual(names, ['عبدالله علي', 'سائق الشركة']);
    assert.deepEqual(ids, ['E-101', 'D-200']);
    assert.equal(val(e, 'الموفدون', 'القسم'), 'المالية');
});

test('saveTripData: موفد بلا اختيار من القائمة يُرفض ولا يُكتب شيء', () => {
    const e = env();
    assert.throws(() => e.S.saveTripData(FORM({ employees: [{ name: 'أحمد' }] })), /اختر الموظف "أحمد" من قائمة الموظفين/);
    assert.equal(e.rows('الإيفادات') === null || e.rows('الإيفادات').length <= 1, true);
});

// ——— التداخل بالهوية ———
function legacyTrip(e, tripId, name, start, end) {
    const S = e.S;
    const trips = e.rows('الإيفادات') || e.addSheet('الإيفادات', [S.TRIP_HEADERS]).rows;
    trips.push(row(S.TRIP_HEADERS, { 'رقم الإيفاد': tripId, 'حالة الطلب': 'بانتظار مصادقة المالية', 'تاريخ الذهاب': start, 'تاريخ العودة': end, 'المُدخِل': 'hr1@x.iq' }));
    const emps = e.rows('الموفدون') || e.addSheet('الموفدون', [S.EMP_HEADERS]).rows;
    emps.push(row(S.EMP_HEADERS, { 'رقم الإيفاد': tripId, 'اسم الموظف': name, 'حالة الموفد': 'بانتظار مصادقة المالية', 'إجمالي المستحقات': 100000, 'المصروف': 0 }));
}

test('التداخل: إيفاد قديم بلا رقم وظيفي وباسم مكتوب «عبد الله علي» يُكشف لإيفاد جديد للموظف E-101', () => {
    const e = env();
    legacyTrip(e, 'OLD-1', 'عبد الله علي', '2020-03-02T00:00', '2020-03-04T00:00');
    assert.throws(() => e.S.saveTripData(FORM({ employees: [{ id: 'E-101', name: 'عبدالله علي' }] })), /لديه إيفاد متداخل زمنياً \(OLD-1\)/);
});

test('التداخل: الموظف نفسه برقمه في إيفادين متداخلين يُكشف حتى لو اختلف الاسم المخزَّن', () => {
    const e = env();
    assert.equal(e.S.saveTripData(FORM({ tripId: 'N-1' })).success, true);
    // إيفاد جديد لـ E-100 يتداخل مع N-1
    assert.throws(() => e.S.saveTripData(FORM({ tripId: 'N-2', start: '2020-03-02', end: '2020-03-05' })), /لديه إيفاد متداخل زمنياً \(N-1\)/);
    // موظف آخر لا يتأثر
    assert.equal(e.S.saveTripData(FORM({ tripId: 'N-3', start: '2020-03-02', end: '2020-03-05', employees: [{ id: 'E-101', name: '' }] })).success, true);
});

// ——— التعديل بعد الإعادة ———
test('updateTrip: صف قديم باسم «عبد الله علي» يُحدَّث ولا يُحذف ويُضاف رقمه، بلا تسوية استرداد مصطنعة', () => {
    const e = env();
    e.S.saveTripData(FORM({ tripId: 'U-1', employees: [{ id: 'E-101', name: '' }] }));
    const h = e.rows('الموفدون')[0], r = e.rows('الموفدون')[1];
    // نحاكي بيانات قديمة: اسم مكتوب بمسافة، بلا رقم، مع صرف جزئي، وموفد معاد إلى الموارد البشرية
    r[h.indexOf('اسم الموظف')] = 'عبد الله علي'; r[h.indexOf('الرقم الوظيفي')] = '';
    r[h.indexOf('المصروف')] = 10000; r[h.indexOf('حالة الموفد')] = 'معاد إلى الموارد البشرية';
    const before = e.rows('الموفدون').length;
    assert.equal(e.S.updateTrip('U-1', FORM({ tripId: 'U-1', end: '2020-03-04', employees: [{ id: 'E-101', name: '' }] }), 'تصحيح').success, true);
    assert.equal(e.rows('الموفدون').length, before);                       // لم يُحذف ويُضف من جديد
    assert.equal(val(e, 'الموفدون', 'الرقم الوظيفي'), 'E-101');
    assert.equal(val(e, 'الموفدون', 'اسم الموظف'), 'عبدالله علي');          // اسم القائمة
    assert.equal(val(e, 'الموفدون', 'المصروف'), 10000);                     // المصروف محفوظ
    const adj = e.rows('التسويات');
    assert.equal(adj === null || adj.length <= 1, true);                    // لا تسويات
});

test('updateTrip: موظف صار غير فعّال ويبقى في الإيفاد القائم لا يعطّل تعديله؛ ولا يُضاف غير الفعّال لإيفاد جديد', () => {
    const e = env();
    e.S.saveTripData(FORM({ tripId: 'K-1' }));
    // E-100 صار غير فعّال بعد إصدار الإيفاد
    e.rows('الموظفون')[1][4] = 'غير فعّال'; e.S.resetExecutionCache_();
    e.rows('الموفدون')[1][e.rows('الموفدون')[0].indexOf('حالة الموفد')] = 'معاد إلى الموارد البشرية';
    assert.equal(e.S.updateTrip('K-1', FORM({ tripId: 'K-1', end: '2020-03-04' }), 'تصحيح').success, true);
    assert.throws(() => e.S.saveTripData(FORM({ tripId: 'K-2', start: '2021-01-01', end: '2021-01-02' })), /الموظف "أحمد" غير فعّال في قائمة الموظفين/);
});

// ——— الترحيل ———
test('linkEmployeesToDirectory: تامة وتقريبية تُربط، والملتبس وغير الموجود يُسجَّلان ولا يُغيَّران؛ ومسؤول فقط', () => {
    const e = env('adm@x.iq', { dir: DIR_ROWS.concat([['E-400', 'علي حسن', '', '', ''], ['E-401', 'علي حسن', '', '', '']]) });
    const S = e.S;
    ['أحمد', 'عبد الله علي', 'علي حسن', 'شخص مجهول', 'أحمد'].forEach((n, i) => legacyTrip(e, 'L-' + i, n, '2019-01-0' + (i + 1) + 'T00:00', '2019-01-0' + (i + 1) + 'T00:00'));
    // صف مربوط مسبقاً
    e.rows('الموفدون')[5][e.rows('الموفدون')[0].indexOf('الرقم الوظيفي')] = 'E-100';
    as(e, 'fin1@x.iq');
    assert.throws(() => S.linkEmployeesToDirectory(), /ليست لديك صلاحية/);
    as(e, 'adm@x.iq');
    const r = plain(S.linkEmployeesToDirectory());
    assert.equal(r.success, true);
    assert.deepEqual(r.counts, { exact: 1, approx: 1, ambiguous: 1, none: 1, already: 1 });
    const h = e.rows('الموفدون')[0];
    const ids = e.rows('الموفدون').slice(1).map(x => x[h.indexOf('الرقم الوظيفي')]);
    assert.deepEqual(ids, ['E-100', 'E-101', '', '', 'E-100']);
    const rep = e.rows('مراجعة الربط');
    assert.equal(rep[0][0], 'رقم الإيفاد');
    assert.deepEqual(rep.slice(1).map(x => x[2]), ['مطابقة تقريبية', 'ملتبس', 'غير موجود في القائمة']);
    // إعادة التشغيل: لا جديد
    const again = plain(S.linkEmployeesToDirectory());
    assert.deepEqual(again.counts, { exact: 0, approx: 0, ambiguous: 1, none: 1, already: 3 });
});

// ——— حمولة اللوحة ———
test('getDashboardData: القائمة للموارد البشرية فقط', () => {
    const e = env('hr1@x.iq');
    const d = plain(e.S.getDashboardData());
    assert.equal(d.directory.employees.length, 4);
    assert.deepEqual(d.directory.departments.length, 4);
    as(e, 'fin1@x.iq'); e.S.resetExecutionCache_ && e.S.resetExecutionCache_();
    assert.equal(plain(e.S.getDashboardData()).directory, undefined);
});
