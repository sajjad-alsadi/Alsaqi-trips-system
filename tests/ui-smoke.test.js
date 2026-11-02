'use strict';
// اختبار تفاعلي للواجهة في jsdom (اختياري: يُتخطّى إن لم يُثبَّت jsdom عبر npm install).
// يغطي ما لا تغطيه اختبارات الدوال النقية: ربط الأحداث ونطاق المتغيرات وسلوك الإكمال التلقائي في DOM حقيقي.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let jsdom = null;
try { jsdom = require('jsdom'); } catch (e) { /* غير مثبَّت */ }
const skip = jsdom ? false : 'jsdom غير مثبَّت (npm install)';
const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'html_js_css.html'), 'utf8');

const DIRECTORY = `STATE.directory = { employees: [
    { id: 'E-100', name: 'أحمد كريم', dept: 'التدقيق', grade: 'الموظف', active: true },
    { id: 'E-101', name: 'عبد الله علي', dept: 'المالية', grade: 'رئيس القسم', active: true },
    { id: 'E-102', name: 'مريم حسن', dept: 'الموارد البشرية', grade: 'الموظف', active: false },
    { id: 'D-200', name: 'سائق الشركة', dept: 'النقل', grade: '', active: true }],
    departments: [], issues: ['صف 9: القسم "س" غير موجود في شيت الأقسام.'] };`;

// صفحة جديدة بمحاكاة google.script.run (لا تستدعي شيئاً)، وقائمة موظفين محقونة
function page(t) {
    const errors = [];
    const vc = new jsdom.VirtualConsole();
    vc.on('jsdomError', e => errors.push((e.detail && (e.detail.stack || e.detail.message)) || e.message));
    const dom = new jsdom.JSDOM(HTML, {
        runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://example.test/',
        beforeParse(w) {
            const run = new Proxy({}, { get: (t, k) => (k === 'withSuccessHandler' || k === 'withFailureHandler') ? () => run : () => {} });
            w.google = { script: { run } };
            w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
            w.scrollTo = () => {};
        }
    });
    const w = dom.window;
    t.after(() => w.close());          // يوقف مؤقّتات الصفحة وإلا لا تنتهي العملية
    const P = {
        w, errors, ev: c => w.eval(c), $: id => w.document.getElementById(id),
        type(input, text) { input.focus(); input.value = text; input.dispatchEvent(new w.Event('input', { bubbles: true })); },
        pick(input, i) { input.parentNode.querySelectorAll('.dir-opt')[i || 0].dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true })); },
        pop: input => input.parentNode.querySelector('.dir-pop'),
        collect: () => JSON.parse(JSON.stringify(w.eval('collectFormInput()')))
    };
    P.ev(DIRECTORY);
    return P;
}

test('الصفحة تُحمَّل وتُهيَّأ بلا أخطاء', { skip }, t => assert.deepEqual(page(t).errors, []));

test('اختيار موظف من القائمة: يملأ القسم ويربط الرقم الوظيفي ويدخل في مدخلات النموذج', { skip }, t => {
    const P = page(t);
    const name = P.w.document.querySelector('.emp-name');
    P.type(name, 'عبدالله');                                   // بلا مسافة: يجد «عبد الله علي»
    const opts = P.pop(name).querySelectorAll('.dir-opt');
    assert.equal(opts.length, 1);
    assert.equal(name.getAttribute('role'), 'combobox');
    assert.equal(name.getAttribute('aria-expanded'), 'true');
    P.pick(name);
    assert.equal(name.value, 'عبد الله علي');
    assert.equal(name.dataset.empId, 'E-101');
    assert.equal(P.w.document.querySelector('.emp-dept').value, 'المالية');
    assert.equal(P.pop(name).classList.contains('hidden'), true);
    assert.equal(name.classList.contains('is-unlinked'), false);
    assert.deepEqual(P.collect().employees[0], { id: 'E-101', name: 'عبد الله علي', dept: 'المالية', grade: 'رئيس القسم', advance: '' });
});

test('تعديل الاسم بعد الاختيار يفك الربط ويفرّغ القسم وينبّه', { skip }, t => {
    const P = page(t);
    const name = P.w.document.querySelector('.emp-name');
    P.type(name, 'احمد'); P.pick(name);
    assert.equal(name.dataset.empId, 'E-100');
    P.type(name, 'احمد كريم س');
    assert.equal(name.dataset.empId, undefined);
    assert.equal(P.w.document.querySelector('.emp-dept').value, '');
    assert.equal(name.classList.contains('is-unlinked'), true);
    assert.equal(P.collect().employees[0].id, '');
});

test('غير الفعّال لا يظهر، ومن اختير في صف آخر أو كسائق لا يظهر', { skip }, t => {
    const P = page(t);
    const name = P.w.document.querySelector('.emp-name');
    P.type(name, 'مريم');
    assert.equal(P.pop(name).querySelectorAll('.dir-opt').length, 0);
    P.type(name, 'عبدالله'); P.pick(name);
    P.ev('addEmployee({})');
    const second = P.w.document.querySelectorAll('.emp-name')[1];
    P.type(second, 'عبدالله');
    assert.equal(P.pop(second).querySelectorAll('.dir-opt').length, 0);
});

test('لوحة المفاتيح: Enter يختار الخيار النشط، وEscape يغلق', { skip }, t => {
    const P = page(t);
    const name = P.w.document.querySelector('.emp-name');
    P.type(name, 'احمد');
    name.dispatchEvent(new P.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(name.dataset.empId, 'E-100');
    P.type(name, 'احمد ك');            // يفك الربط ويفتح القائمة
    name.dispatchEvent(new P.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(P.pop(name).classList.contains('hidden'), true);
});

test('إيفاد محفوظ: اسم قديم بلا رقم يظهر منبَّهاً، وبرقم موجود يُربط بالقائمة باسمها وقسمها', { skip }, t => {
    const P = page(t);
    P.ev('clearFormFields()');
    P.ev(`addEmployee({ name: 'عبد الله علي', dept: 'x', id: '' })`);
    const legacy = P.w.document.querySelector('.emp-name');
    assert.equal(legacy.classList.contains('is-unlinked'), true);
    assert.equal(legacy.dataset.empId, undefined);
    P.ev('clearFormFields()');
    P.ev(`addEmployee({ name: 'اسم قديم', id: 'E-100' })`);
    const saved = P.w.document.querySelector('.emp-name');
    assert.equal(saved.value, 'أحمد كريم');
    assert.equal(saved.dataset.empId, 'E-100');
    assert.equal(P.w.document.querySelector('.emp-dept').value, 'التدقيق');
});

test('السائق: يُختار من القائمة، ويُفرَّغ مع تفريغ النموذج دون أخطاء نطاق', { skip }, t => {
    const P = page(t);
    P.ev(`document.getElementById('vehicleType').value = 'شركة'; refreshReceivers();`);
    const driver = P.$('driverName');
    P.type(driver, 'سائق'); P.pick(driver);
    assert.equal(driver.dataset.empId, 'D-200');
    assert.equal(P.collect().driverId, 'D-200');
    P.ev('clearFormFields()');                                  // يكشف DRIVER_PICKER خارج النطاق
    assert.equal(driver.dataset.empId, undefined);
    assert.equal(driver.value, '');
    P.ev(`DRIVER_PICKER.set('D-200', 'اسم قديم')`);           // كما يفعل populateForm عند تعديل إيفاد محفوظ
    assert.equal(driver.dataset.empId, 'D-200');
    assert.equal(driver.value, 'سائق الشركة');
});

test('ملاحظات قائمة الموظفين تظهر تحت قسم الموفدين', { skip }, t => {
    const P = page(t);
    P.ev('renderDirectoryIssues()');
    assert.equal(P.$('dirIssues').classList.contains('hidden'), false);
    assert.match(P.$('dirIssues').textContent, /ملاحظات على قائمة الموظفين \(1\)/);
});
