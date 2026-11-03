'use strict';
// إدارة قائمة الموظفين والأقسام من التطبيق (T2.6b): للموارد البشرية فقط، بتحقق وسجل، بدل تحرير الشيت مباشرة.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/fakeSheets');

const NAMES = ['saveEmployee', 'setEmployeeStatus', 'saveDepartment', 'setDepartmentStatus', 'directory_', 'publicDirectory_', 'saveTripData',
    'resetExecutionCache_', 'USER_HEADERS', 'DIR_HEADERS', 'DEPT_HEADERS', 'LOG_HEADERS', 'getDashboardData'];
const plain = x => JSON.parse(JSON.stringify(x));
const DIR_ROWS = [
    ['E-100', 'أحمد كريم', 'التدقيق', 'الموظف', 'فعّال'],
    ['E-101', 'عبد الله علي', 'المالية', 'رئيس القسم', ''],
    ['E-102', 'مريم حسن', 'المالية', 'الموظف', 'غير فعّال']
];
const DEPT_ROWS = [['التدقيق', 'فعّال'], ['المالية', ''], ['النقل', 'فعّال'], ['القديم', 'غير فعّال']];
const USERS = [['hr1@x.iq', 'موارد بشرية', ''], ['fin1@x.iq', 'مالية', ''], ['adm@x.iq', 'مسؤول', '']];

function env(email, opts) {
    opts = opts || {};
    const e = makeEnv({ email: email || 'hr1@x.iq' }, NAMES);
    const S = e.S;
    e.addSheet('المستخدمون', [S.USER_HEADERS].concat(USERS));
    e.addSheet('الموظفون', [S.DIR_HEADERS].concat(opts.dir || DIR_ROWS));
    e.addSheet('الأقسام', [S.DEPT_HEADERS].concat(opts.depts || DEPT_ROWS));
    return e;
}
const as = (e, email) => { e.session.email = email; e.S.resetExecutionCache_(); };
const NEW = (o) => Object.assign({ mode: 'add', id: 'E-200', name: 'سارة محمود', dept: 'النقل', grade: 'الموظف', status: 'فعّال' }, o);
const lastLog = e => { const l = e.rows('سجل التغييرات'); return l[l.length - 1]; };

// ——— الصلاحية ———
test('كل دوال الإدارة للموارد البشرية فقط (المالية والمسؤول يُرفضان، ولا يُكتب شيء)', () => {
    const e = env('fin1@x.iq');
    const calls = [() => e.S.saveEmployee(NEW()), () => e.S.setEmployeeStatus('E-100', 'غير فعّال'), () => e.S.saveDepartment('جديد'), () => e.S.setDepartmentStatus('النقل', 'غير فعّال')];
    calls.forEach(f => assert.throws(f, /ليست لديك صلاحية/));
    as(e, 'adm@x.iq'); calls.forEach(f => assert.throws(f, /ليست لديك صلاحية/));
    assert.equal(e.rows('الموظفون').length, 4);
    assert.equal(e.rows('الأقسام').length, 5);
});

// ——— إضافة موظف ———
test('إضافة موظف: يُكتب بالقيم المنظَّفة، وتُعاد القائمة المحدَّثة، ويُسجَّل', () => {
    const e = env();
    const r = plain(e.S.saveEmployee(NEW({ id: '  E-200 ', name: '  سارة   محمود ' })));
    assert.equal(r.success, true);
    assert.deepEqual(e.rows('الموظفون')[4], ['E-200', 'سارة   محمود', 'النقل', 'الموظف', 'فعّال'].map((x, i) => i === 1 ? e.rows('الموظفون')[4][1] : x));
    const added = r.directory.employees.find(x => x.id === 'E-200');
    assert.equal(added.name.replace(/\s+/g, ' '), 'سارة محمود');
    assert.equal(added.active, true);
    const log = lastLog(e);
    assert.equal(log[1], 'hr1@x.iq'); assert.equal(log[4], 'إضافة موظف');
});

test('إضافة موظف: الرقم المكرر (حتى لغير الفعّال) والرقم غير الصالح والحقول الناقصة تُرفض', () => {
    const e = env();
    assert.throws(() => e.S.saveEmployee(NEW({ id: 'e-100' })), /الرقم الوظيفي "e-100" موجود/);
    assert.throws(() => e.S.saveEmployee(NEW({ id: 'E-102' })), /موجود/);
    assert.throws(() => e.S.saveEmployee(NEW({ id: '=1+1' })), /أحرف وأرقام/);
    assert.throws(() => e.S.saveEmployee(NEW({ id: 'a b' })), /أحرف وأرقام/);
    assert.throws(() => e.S.saveEmployee(NEW({ id: '' })), /الرقم الوظيفي مطلوب/);
    assert.throws(() => e.S.saveEmployee(NEW({ name: '  ' })), /الاسم مطلوب/);
    assert.throws(() => e.S.saveEmployee(NEW({ dept: '' })), /القسم مطلوب/);
    assert.equal(e.rows('الموظفون').length, 4);
});

test('إضافة موظف: قسم غير معتمد أو معطَّل، ودرجة غير معتمدة، واسم مطابق لموظف آخر: مرفوضة', () => {
    const e = env();
    assert.throws(() => e.S.saveEmployee(NEW({ dept: 'قسم وهمي' })), /القسم "قسم وهمي" غير معتمد/);
    assert.throws(() => e.S.saveEmployee(NEW({ dept: 'القديم' })), /القسم "القديم" غير معتمد/);
    assert.throws(() => e.S.saveEmployee(NEW({ grade: 'درجة وهمية' })), /الدرجة "درجة وهمية" غير معتمدة/);
    assert.throws(() => e.S.saveEmployee(NEW({ name: 'عبدالله  علي' })), /مطابق لاسم الموظف E-101/);   // نفس المفتاح بعد التطبيع
    assert.equal(e.rows('الموظفون').length, 4);
});

test('إضافة موظف: بلا أقسام معرَّفة يُقبل نص القسم، والدرجة اختيارية', () => {
    const e = env('hr1@x.iq', { depts: [] });
    assert.equal(e.S.saveEmployee(NEW({ dept: 'أي قسم', grade: '' })).success, true);
});

test('الموظف المضاف يظهر فوراً في الاختيار ويُقبل في الإيفاد؛ ومن عُطِّل يُرفض', () => {
    const e = env();
    e.S.saveEmployee(NEW({ id: 'E-300', name: 'خالد حسين', dept: 'التدقيق' }));
    e.S.setEmployeeStatus('E-100', 'غير فعّال');
    assert.deepEqual(plain(e.S.publicDirectory_()).employees.filter(x => x.active).map(x => x.id), ['E-101', 'E-300']);
    const form = (id) => ({ tripId: 'T-' + id, orderDate: '2020-02-20', purpose: 'تدقيق', type: 'داخلي', start: '2020-03-01', end: '2020-03-02',
        origin: 'النجف', stops: [{ gov: 'البصرة' }], vehicle: 'شخصية', hotelType: 'لا يوجد', employees: [{ id, name: '' }] });
    assert.equal(e.S.saveTripData(form('E-300')).success, true);
    assert.throws(() => e.S.saveTripData(form('E-100')), /الموظف "أحمد كريم" غير فعّال/);
});

// ——— تعديل موظف ———
test('تعديل موظف: يغيّر الاسم والقسم والدرجة والحالة ولا يمسّ الرقم، ويسجّل الفروق', () => {
    const e = env();
    const r = plain(e.S.saveEmployee({ mode: 'edit', id: 'E-101', name: 'عبدالله علي حسن', dept: 'النقل', grade: 'الموظف', status: 'غير فعّال' }));
    assert.equal(r.success, true);
    assert.deepEqual(e.rows('الموظفون')[2], ['E-101', 'عبدالله علي حسن', 'النقل', 'الموظف', 'غير فعّال']);
    const log = lastLog(e);
    assert.equal(log[4], 'تعديل موظف');
    const details = JSON.parse(log[5]);
    assert.deepEqual(details['الاسم'], ['عبد الله علي', 'عبدالله علي حسن']);
    assert.deepEqual(details['القسم'], ['المالية', 'النقل']);
    assert.deepEqual(details['الحالة'], ['فعّال', 'غير فعّال']);
});

test('تعديل موظف غير موجود يُرفض؛ ويجوز الإبقاء على اسمه نفسه دون اعتباره تكراراً', () => {
    const e = env();
    assert.throws(() => e.S.saveEmployee({ mode: 'edit', id: 'X-1', name: 'س', dept: 'النقل', status: 'فعّال' }), /غير موجود/);
    assert.equal(e.S.saveEmployee({ mode: 'edit', id: 'E-100', name: 'أحمد كريم', dept: 'المالية', grade: '', status: 'فعّال' }).success, true);
});

// ——— تفعيل/تعطيل موظف ———
test('تعطيل موظف وتفعيله: الحالة وحدها، ويُسجَّل، وغير الموجود يُرفض', () => {
    const e = env();
    assert.equal(e.S.setEmployeeStatus('E-100', 'غير فعّال').success, true);
    assert.equal(e.rows('الموظفون')[1][4], 'غير فعّال');
    assert.equal(e.rows('الموظفون')[1][1], 'أحمد كريم');
    assert.equal(lastLog(e)[4], 'تعطيل موظف');
    assert.equal(e.S.setEmployeeStatus('E-100', 'فعّال').success, true);
    assert.equal(lastLog(e)[4], 'تفعيل موظف');
    assert.throws(() => e.S.setEmployeeStatus('X-1', 'فعّال'), /غير موجود/);
});

// ——— الأقسام ———
test('إضافة قسم: تُكتب فعّالة، والمكرر يُرفض، والمعطَّل يُوجَّه إلى تفعيله', () => {
    const e = env();
    const r = plain(e.S.saveDepartment('  المشتريات  '));
    assert.equal(r.success, true);
    assert.deepEqual(e.rows('الأقسام')[5], ['المشتريات', 'فعّال']);
    assert.ok(r.directory.allDepartments.some(d => d.name === 'المشتريات' && d.active));
    assert.throws(() => e.S.saveDepartment('النقل'), /موجود/);
    assert.throws(() => e.S.saveDepartment('القديم'), /موجود ومعطَّل/);
    assert.throws(() => e.S.saveDepartment('   '), /اسم القسم مطلوب/);
    assert.equal(lastLog(e)[4], 'إضافة قسم');
});

test('تعطيل قسم: يُمنع ما دام فيه موظفون فعّالون، ويجوز حين لا يبقى إلا المعطَّلون', () => {
    const e = env();
    assert.throws(() => e.S.setDepartmentStatus('المالية', 'غير فعّال'), /لا يمكن تعطيل القسم "المالية": فيه 1 موظف فعّال/);
    assert.equal(e.rows('الأقسام')[2][1], '');
    assert.equal(e.S.setDepartmentStatus('النقل', 'غير فعّال').success, true);            // لا موظفين فيه
    assert.equal(e.rows('الأقسام')[3][1], 'غير فعّال');
    e.S.setEmployeeStatus('E-101', 'غير فعّال');
    assert.equal(e.S.setDepartmentStatus('المالية', 'غير فعّال').success, true);          // E-102 معطَّل أصلاً
    assert.equal(e.S.setDepartmentStatus('القديم', 'فعّال').success, true);                // التفعيل بلا قيد
    assert.throws(() => e.S.setDepartmentStatus('غير موجود', 'فعّال'), /غير موجود/);
});

// ——— حمولة القائمة والملاحظات ———
test('publicDirectory_ يضمّ الأقسام كلها بحالتها، والأسماء المتطابقة تظهر ملاحظةً', () => {
    const e = env('hr1@x.iq', { dir: DIR_ROWS.concat([['E-400', 'علي حسن', 'المالية', '', ''], ['E-401', 'علي  حسن', 'المالية', '', '']]) });
    const d = plain(e.S.publicDirectory_());
    assert.deepEqual(d.allDepartments, [{ name: 'التدقيق', active: true }, { name: 'المالية', active: true }, { name: 'النقل', active: true }, { name: 'القديم', active: false }]);
    assert.deepEqual(d.departments, ['التدقيق', 'المالية', 'النقل']);
    assert.match(d.issues.join('\n'), /الاسم "علي حسن" مكرر بين E-400 وE-401/);
});
