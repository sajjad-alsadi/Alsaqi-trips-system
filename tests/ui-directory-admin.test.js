'use strict';
// تبويب «قائمة الموظفين» (T2.6b) في jsdom: العرض والبحث والمرشحات وحوارات الإضافة والتعديل والتعطيل، وردود الخادم.
const test = require('node:test');
const assert = require('node:assert/strict');
const { page, skip, DIRECTORY } = require('./helpers/uiPage');

const HR = "STATE.session = { email: 'hr1@x.iq', roles: ['hr'] }; applySession();";
function hrPage(t, opts) { const P = page(t, opts); P.ev(HR); return P; }
const rows = P => Array.from(P.$('dirTableBody').querySelectorAll('tr'));
const cells = tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
const open = P => P.$('confirmModal') && P.w.document.querySelector('#confirmModal').offsetParent !== undefined;
const dialogTitle = P => P.$('confirmTitle').textContent;
const fillAndConfirm = (P, values) => { Object.keys(values).forEach(k => { P.$('cf_' + k).value = values[k]; }); P.click(P.$('confirmOk')); };
const withNew = (extra) => JSON.parse(JSON.stringify(Object.assign({}, DIRECTORY, { employees: DIRECTORY.employees.concat([extra]) })));

test('التبويب يظهر في التنقل للموارد البشرية فقط', { skip }, t => {
    const P = page(t);
    P.ev("STATE.session = { email: 'f@x.iq', roles: ['finance'] }; applySession();");
    assert.equal(P.$('nav-directory-tab').classList.contains('hidden'), true);
    P.ev(HR);
    assert.equal(P.$('nav-directory-tab').classList.contains('hidden'), false);
    assert.deepEqual(P.errors, []);
});

test('العرض: الأعداد والصفوف والحالات وملاحظات القائمة وجدول الأقسام بعدد الفعّالين', { skip }, t => {
    const P = hrPage(t);
    P.ev("goTab('directory-tab')");
    assert.equal(P.$('dirActiveCount').textContent, '3');
    assert.equal(P.$('dirInactiveCount').textContent, '1');
    assert.equal(rows(P).length, 4);
    assert.deepEqual(cells(rows(P).find(r => cells(r)[0] === 'E-102')).slice(0, 5), ['E-102', 'مريم حسن', 'الموارد البشرية', 'الموظف', 'غير فعّال']);
    assert.match(P.$('dirTabIssues').textContent, /ملاحظات على القائمة \(1\)/);
    const depts = Array.from(P.$('dirDeptBody').querySelectorAll('tr')).map(cells).map(c => c.slice(0, 3));
    assert.deepEqual(depts, [['التدقيق', '1', 'فعّال'], ['المالية', '1', 'فعّال'], ['النقل', '1', 'فعّال'], ['القديم', '0', 'غير فعّال']]);
    assert.deepEqual(P.errors, []);
});

test('البحث بتطبيع الأسماء وتصفية الحالة والقسم (ويشمل غير الفعّال)', { skip }, t => {
    const P = hrPage(t); P.ev("goTab('directory-tab')");
    P.type(P.$('dirSearch'), 'عبدالله');
    assert.deepEqual(rows(P).map(r => cells(r)[0]), ['E-101']);
    P.type(P.$('dirSearch'), 'مريم');
    assert.deepEqual(rows(P).map(r => cells(r)[0]), ['E-102']);           // غير الفعّال يظهر هنا خلافاً لاختيار الموفدين
    P.type(P.$('dirSearch'), '');
    P.click(P.button(P.$('dirStatusSeg'), 'غير فعّال'));
    assert.deepEqual(rows(P).map(r => cells(r)[0]), ['E-102']);
    P.click(P.button(P.$('dirStatusSeg'), 'فعّال'));
    assert.equal(rows(P).length, 3);
    P.$('dirDeptFilter').value = 'المالية'; P.$('dirDeptFilter').dispatchEvent(new P.w.Event('change', { bubbles: true }));
    assert.deepEqual(rows(P).map(r => cells(r)[0]), ['E-101']);
    P.type(P.$('dirSearch'), 'لا أحد بهذا الاسم');
    assert.match(P.$('dirTableBody').textContent, /لا نتائج مطابقة/);
});

test('إضافة موظف: الحوار يرسل saveEmployee بالقيم، ونجاحه يحدّث الجدول ويغلق الحوار', { skip }, t => {
    const P = hrPage(t); P.ev("goTab('directory-tab')");
    P.click(P.$('dirAddBtn'));
    assert.equal(dialogTitle(P), 'إضافة موظف');
    assert.equal(P.$('cf_id').readOnly, false);
    fillAndConfirm(P, { id: 'E-300', name: 'سارة محمود', dept: 'النقل', grade: 'الموظف', status: 'فعّال' });
    const c = P.last('saveEmployee');
    assert.deepEqual(JSON.parse(JSON.stringify(c.args)), [{ mode: 'add', id: 'E-300', name: 'سارة محمود', dept: 'النقل', grade: 'الموظف', status: 'فعّال' }]);
    const loads = () => P.calls.filter(x => x.fn === 'getDashboardData').length, before = loads();
    c.ok({ success: true, message: 'أُضيف', directory: withNew({ id: 'E-300', name: 'سارة محمود', dept: 'النقل', grade: 'الموظف', active: true }) });
    assert.equal(rows(P).length, 5);
    assert.equal(P.$('dirActiveCount').textContent, '4');
    assert.equal(P.$('scrim').classList.contains('is-open'), false);            // أُغلق الحوار
    assert.equal(loads(), before);                                                // بلا إعادة تحميل كاملة بعد النجاح
});

test('خطأ الخادم (رقم مكرر مثلاً) يظهر داخل الحوار ويبقى مفتوحاً لتصحيحه', { skip }, t => {
    const P = hrPage(t); P.ev("goTab('directory-tab')");
    P.click(P.$('dirAddBtn'));
    fillAndConfirm(P, { id: 'E-100', name: 'س', dept: 'النقل', grade: '', status: 'فعّال' });
    P.last('saveEmployee').fail(new Error('الرقم الوظيفي "E-100" موجود في القائمة.'));
    assert.match(P.$('confirmError').textContent, /موجود في القائمة/);
    assert.equal(P.$('scrim').classList.contains('is-open'), true);
    assert.equal(P.$('cf_id').value, 'E-100');                                   // ما كُتب باقٍ
});

test('حقول مطلوبة فارغة لا تُرسَل إلى الخادم', { skip }, t => {
    const P = hrPage(t); P.ev("goTab('directory-tab')");
    P.click(P.$('dirAddBtn'));
    fillAndConfirm(P, { id: '', name: '' });
    assert.equal(P.last('saveEmployee'), undefined);
    assert.equal(P.$('scrim').classList.contains('is-open'), true);
});

test('تعديل موظف: الرقم الوظيفي للقراءة فقط، ويُرسَل mode=edit بالقيم الجديدة', { skip }, t => {
    const P = hrPage(t); P.ev("goTab('directory-tab')");
    const tr = rows(P).find(r => cells(r)[0] === 'E-101');
    P.click(P.button(tr, 'تعديل'));
    assert.equal(dialogTitle(P), 'تعديل بيانات موظف');
    assert.equal(P.$('cf_id').value, 'E-101');
    assert.equal(P.$('cf_id').readOnly, true);
    assert.equal(P.$('cf_name').value, 'عبد الله علي');
    assert.equal(P.$('cf_dept').value, 'المالية');
    fillAndConfirm(P, { name: 'عبد الله علي حسن' });
    assert.deepEqual(JSON.parse(JSON.stringify(P.last('saveEmployee').args)), [{ mode: 'edit', id: 'E-101', name: 'عبد الله علي حسن', dept: 'المالية', grade: 'رئيس القسم', status: 'فعّال' }]);
});

test('تعطيل موظف وتفعيله: حوار تأكيد ثم setEmployeeStatus', { skip }, t => {
    const P = hrPage(t); P.ev("goTab('directory-tab')");
    P.click(P.button(rows(P).find(r => cells(r)[0] === 'E-100'), 'تعطيل'));
    assert.equal(dialogTitle(P), 'تعطيل موظف');
    P.click(P.$('confirmOk'));
    assert.deepEqual(JSON.parse(JSON.stringify(P.last('setEmployeeStatus').args)), ['E-100', 'غير فعّال']);
    P.last('setEmployeeStatus').ok({ success: true, message: 'ok', directory: JSON.parse(JSON.stringify(Object.assign({}, DIRECTORY, { employees: DIRECTORY.employees.map(e => e.id === 'E-100' ? Object.assign({}, e, { active: false }) : e) }))) });
    assert.equal(P.$('dirActiveCount').textContent, '2');
    P.click(P.button(rows(P).find(r => cells(r)[0] === 'E-102'), 'تفعيل'));
    assert.equal(dialogTitle(P), 'تفعيل موظف');
});

test('الأقسام: إضافة قسم، وتعطيل قسم فيه موظفون يُنبَّه إليه ويرفضه الخادم داخل الحوار', { skip }, t => {
    const P = hrPage(t); P.ev("goTab('directory-tab')");
    P.click(P.$('dirDeptAddBtn'));
    assert.equal(dialogTitle(P), 'إضافة قسم');
    fillAndConfirm(P, { name: 'المشتريات' });
    assert.deepEqual(JSON.parse(JSON.stringify(P.last('saveDepartment').args)), ['المشتريات']);
    P.last('saveDepartment').ok({ success: true, message: 'ok', directory: JSON.parse(JSON.stringify(Object.assign({}, DIRECTORY, { allDepartments: DIRECTORY.allDepartments.concat([{ name: 'المشتريات', active: true }]) }))) });
    assert.equal(P.$('dirDeptBody').querySelectorAll('tr').length, 5);
    const finance = Array.from(P.$('dirDeptBody').querySelectorAll('tr')).find(r => cells(r)[0] === 'المالية');
    P.click(P.button(finance, 'تعطيل'));
    assert.match(P.$('confirmMessage').textContent, /فيه موظفون فعّالون/);
    P.click(P.$('confirmOk'));
    assert.deepEqual(JSON.parse(JSON.stringify(P.last('setDepartmentStatus').args)), ['المالية', 'غير فعّال']);
    P.last('setDepartmentStatus').fail(new Error('لا يمكن تعطيل القسم "المالية": فيه 1 موظف فعّال.'));
    assert.match(P.$('confirmError').textContent, /لا يمكن تعطيل القسم/);
});

test('لغير الموارد البشرية (بلا قائمة): رسالة صلاحية لا انهيار', { skip }, t => {
    const P = page(t, { directory: null });
    P.ev("STATE.session = { email: 'f@x.iq', roles: ['finance'] }; applySession(); renderDirectoryTab();");
    assert.match(P.$('dirTableBody').textContent, /متاحة للموارد البشرية فقط/);
    assert.deepEqual(P.errors, []);
});

test('خادم أقدم لا يرسل allDepartments: التبويب لا ينكسر وحقل القسم نصي', { skip }, t => {
    const P = hrPage(t, { directory: { employees: DIRECTORY.employees, departments: [], issues: [] } });
    P.ev("goTab('directory-tab')");
    assert.equal(rows(P).length, 4);
    P.click(P.$('dirAddBtn'));
    assert.equal(P.$('cf_dept').tagName, 'INPUT');
    assert.deepEqual(P.errors, []);
});
