'use strict';
// الإكمال التلقائي لاختيار الموظف (T2.6): المطابقة النقية، وربط النموذج بالرقم الوظيفي.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi, read, uiScript, extractFn } = require('./helpers/load');

const { matchDirectory } = loadUi(['matchDirectory']);
const emp = (id, name, dept, grade, active) => ({ id, name, dept: dept || '', grade: grade || '', active: active !== false });
const DIR = { employees: [
    emp('E-100', 'أحمد كريم', 'التدقيق', 'الموظف'),
    emp('E-101', 'عبد الله علي', 'المالية', 'رئيس القسم'),
    emp('E-102', 'مريم حسن', 'الموارد البشرية', 'الموظف', false),
    emp('E-103', 'علي عبدالله', 'التدقيق'),
    emp('E-104', 'إسراء محمود', 'المالية')
] };
// المصفوفات تأتي من سياق vm آخر: تُنسخ إلى مصفوفات عادية ليعمل deepEqual الصارم
const ids = r => Array.from(r).map(x => x.id);
const none = new Set();

test('«عبدالله» (بلا مسافة) يجد «عبد الله علي»، و«عبد الله» يجد «علي عبدالله»', () => {
    assert.deepEqual(ids(matchDirectory(DIR, 'عبدالله', none)), ['E-101', 'E-103']);
    assert.deepEqual(ids(matchDirectory(DIR, 'عبد الله', none)), ['E-101', 'E-103']);
});

test('الأقرب أولاً: ما يبدأ اسمه بالنص قبل ما يحتويه', () => {
    assert.deepEqual(ids(matchDirectory(DIR, 'علي', none)), ['E-103', 'E-101']);   // «علي عبدالله» يبدأ به؛ «عبد الله علي» يحويه
});

test('الهمزات والياء والتاء المربوطة لا تمنع المطابقة', () => {
    assert.deepEqual(ids(matchDirectory(DIR, 'احمد', none)), ['E-100']);
    assert.deepEqual(ids(matchDirectory(DIR, 'اسراء', none)), ['E-104']);
});

test('بحث بالرقم الوظيفي وبالقسم', () => {
    assert.deepEqual(ids(matchDirectory(DIR, 'e-101', none)), ['E-101']);
    assert.deepEqual(ids(matchDirectory(DIR, 'التدقيق', none)), ['E-100', 'E-103']);
});

test('كلمتان من اسمين مختلفين: كل كلمة يجب أن تطابق الموظف نفسه', () => {
    assert.deepEqual(ids(matchDirectory(DIR, 'احمد كريم', none)), ['E-100']);
    assert.deepEqual(ids(matchDirectory(DIR, 'احمد حسن', none)), []);
});

test('غير الفعّال لا يظهر، ومن اختير في صف آخر لا يظهر', () => {
    assert.deepEqual(ids(matchDirectory(DIR, 'مريم', none)), []);
    assert.deepEqual(ids(matchDirectory(DIR, 'التدقيق', new Set(['e-100']))), ['E-103']);
});

test('نص فارغ أو قائمة غائبة: لا نتائج؛ والحد الأقصى يُحترم', () => {
    assert.deepEqual(ids(matchDirectory(DIR, '   ', none)), []);
    assert.deepEqual(ids(matchDirectory(null, 'احمد', none)), []);
    assert.equal(matchDirectory(DIR, 'ا', none, 2).length, 2);
});

test('الربط في النموذج: الرقم الوظيفي يُجمع للموفدين والسائق، والسائق داخل غلاف الإكمال، وتحميل القائمة', () => {
    const html = read('html_js_css.html'), ui = uiScript();
    assert.match(extractFn(ui, 'collectFormInput'), /id: r\.querySelector\('\.emp-name'\)\.dataset\.empId/);
    assert.match(extractFn(ui, 'collectFormInput'), /driverId:/);
    assert.match(extractFn(ui, 'addEmployee'), /attachDirectoryPicker\(name,/);
    assert.match(extractFn(ui, 'populateForm'), /DRIVER_PICKER\.set\(inp\.driverId, inp\.driverName\)/);
    assert.match(extractFn(ui, 'clearFormFields'), /DRIVER_PICKER\.set\(''/);
    assert.match(html, /<div class="dir-wrap">\s*<input type="text" id="driverName"/);
    assert.match(extractFn(ui, 'loadDashboardData'), /STATE\.directory = data\.directory \|\| null/);
});
