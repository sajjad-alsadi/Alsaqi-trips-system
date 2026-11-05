'use strict';
// T2.8 (R4/D1): السكربت مشروع مستقل يملكه المالك ويفتح الملف بمعرّفه (خاصية السكربت SPREADSHEET_ID)،
// فلا يرى الشيفرة (ولا مفتاح T2.5 لاحقاً) من يملك صلاحية تحرير الملف وحده.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeEnv } = require('./helpers/fakeSheets');
const { read } = require('./helpers/load');

const NAMES = ['ss_', 'currentUser_', 'getDashboardData', 'setupFirstAdmin', 'resetExecutionCache_', 'USER_HEADERS'];
const HEAD = ['البريد', 'الدور', 'الاسم'];
const plain = x => JSON.parse(JSON.stringify(x));
const base = { email: 'adm@x.iq', owner: 'adm@x.iq', sheets: { 'المستخدمون': [HEAD, ['adm@x.iq', 'مسؤول', '']] } };
const env = o => makeEnv(Object.assign({}, base, o), NAMES);

test('مشروع مستقل + SPREADSHEET_ID: يفتح الملف بالمعرّف ولا يستعمل getActiveSpreadsheet', () => {
    const e = env({ standalone: true, props: { SPREADSHEET_ID: 'SS1' } });
    const u = plain(e.S.currentUser_());
    assert.equal(u.ok, true);
    assert.deepEqual(e.calls.ids, ['SS1']);
    assert.equal(e.calls.getActive, 0);
});

test('معرّف خاطئ أو بلا صلاحية: يفشل ولا يتراجع صامتاً إلى الملف المرتبط', () => {
    const e = env({ standalone: false, props: { SPREADSHEET_ID: 'WRONG' } });
    assert.throws(() => e.S.currentUser_(), /Requested entity was not found/);
    assert.equal(e.calls.getActive, 0);
});

test('مشروع مستقل بلا SPREADSHEET_ID: رسالة عربية واضحة تدلّ على الإعداد، لا خطأ تقني', () => {
    const e = env({ standalone: true });
    assert.throws(() => e.S.getDashboardData(), /SPREADSHEET_ID/);
    assert.throws(() => e.S.getDashboardData(), /docs\/deployment\.md|إعدادات المشروع/);
});

test('مشروع مرتبط بالملف وبلا SPREADSHEET_ID (النشر القائم): يعمل كما كان', () => {
    const e = env({ standalone: false });
    assert.equal(plain(e.S.currentUser_()).ok, true);
    assert.equal(e.calls.openById, 0);
});

test('الملف يُفتح مرة واحدة لكل تنفيذ، ويُعاد فتحه بعد resetExecutionCache_', () => {
    const e = env({ standalone: true, props: { SPREADSHEET_ID: 'SS1' } });
    e.S.currentUser_(); e.S.ss_(); e.S.ss_();
    assert.equal(e.calls.openById, 1);
    e.S.resetExecutionCache_(); e.S.ss_();
    assert.equal(e.calls.openById, 2);
});

test('setupFirstAdmin يعمل في مشروع مستقل (مالك الملف يُحدَّد من الملف المفتوح بالمعرّف)', () => {
    const e = env({ standalone: true, props: { SPREADSHEET_ID: 'SS1' }, sheets: { 'المستخدمون': [HEAD] } });
    assert.equal(plain(e.S.setupFirstAdmin()).success, true);
    assert.equal(e.rows('المستخدمون')[1][0], 'adm@x.iq');
});

test('setupFirstAdmin يرفض غير المالك في مشروع مستقل كذلك', () => {
    const e = env({ standalone: true, props: { SPREADSHEET_ID: 'SS1' }, email: 'x@x.iq', sheets: { 'المستخدمون': [HEAD] } });
    assert.throws(() => e.S.setupFirstAdmin(), /لمالك الملف فقط/);
});

test('حارس: لا يُستدعى getActiveSpreadsheet إلا داخل ss_() (في الخادم وفي أداة التجارب)', () => {
    ['src/google_apps_script.js', 'tools/SheetsProbe.gs'].forEach(f => {
        const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        const n = (src.match(/getActiveSpreadsheet\(/g) || []).length;
        assert.equal(n, f.startsWith('src') ? 1 : 0, f + ': مواضع getActiveSpreadsheet');
    });
    assert.match(read('google_apps_script.js'), /function ss_\(\)/);
});
