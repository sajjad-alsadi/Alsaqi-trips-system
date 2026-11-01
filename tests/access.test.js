'use strict';
// الوصول والأدوار (C1 في docs/improvement-plan.md): لا وضع إعداد؛ شيت المستخدمين الفارغ يرفض الجميع،
// وأول مسؤول يُعرَّف بدالة setupFirstAdmin لمالك الملف وحده.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/fakeSheets');
const { read, uiScript } = require('./helpers/load');

const NAMES = ['currentUser_', 'requireRole_', 'setupFirstAdmin', 'getDashboardData', 'resetExecutionCache_', 'roleLabel_'];
const HEAD = ['البريد', 'الدور', 'الاسم'];
const env = (opts) => makeEnv(opts, NAMES);
const plain = x => JSON.parse(JSON.stringify(x));   // نتائج vm إلى كائنات عادية

test('شيت المستخدمين فارغ: لا وصول لأحد (لا وضع إعداد)', () => {
    const e = env({ email: 'a@x.iq', sheets: { 'المستخدمون': [HEAD] } });
    const u = plain(e.S.currentUser_());
    assert.equal(u.ok, false);
    assert.equal(u.roles, undefined);
    assert.match(u.hint, /setupFirstAdmin/);
    const d = plain(e.S.getDashboardData());
    assert.equal(d.unauthorized, true);
    assert.equal(d.trips, undefined);
});

test('شيت المستخدمين غير موجود أصلاً: لا وصول، ويُنشأ بترويسته فقط', () => {
    const e = env({ email: 'a@x.iq' });
    assert.equal(plain(e.S.currentUser_()).ok, false);
    assert.deepEqual(plain(e.rows('المستخدمون')), [HEAD]);
});

test('شيت فارغ وبلا بريد للمستخدم: لا وصول', () => {
    const e = env({ email: '', sheets: { 'المستخدمون': [HEAD] } });
    assert.equal(plain(e.S.currentUser_()).ok, false);
});

test('مستخدم معرَّف بأدوار متعددة بفاصلة عربية: الأدوار تُقرأ، والبريد غير حساس لحالة الأحرف', () => {
    const e = env({ email: 'Aud@X.iq', sheets: { 'المستخدمون': [HEAD, ['aud@x.iq', 'مالية، الرقابة', 'س']] } });
    const u = plain(e.S.currentUser_());
    assert.equal(u.ok, true);
    assert.deepEqual(u.roles, ['finance', 'audit']);
    assert.equal(u.setup, undefined);
});

test('بريد غير معرَّف بينما المستخدمون معرَّفون: لا وصول', () => {
    const e = env({ email: 'z@x.iq', sheets: { 'المستخدمون': [HEAD, ['a@x.iq', 'مالية', '']] } });
    const u = plain(e.S.currentUser_());
    assert.equal(u.ok, false);
    assert.match(u.hint, /غير مُعرَّف/);
});

test('تعذر تحديد هوية المستخدم بينما المستخدمون معرَّفون: لا وصول', () => {
    const e = env({ email: '', sheets: { 'المستخدمون': [HEAD, ['a@x.iq', 'مالية', '']] } });
    const u = plain(e.S.currentUser_());
    assert.equal(u.ok, false);
    assert.match(u.hint, /تعذر تحديد هوية/);
});

test('requireRole_: يرفض بشيت فارغ، ويرفض دوراً غير ممنوح، ويقبل الممنوح', () => {
    const empty = env({ email: 'a@x.iq', sheets: { 'المستخدمون': [HEAD] } });
    assert.throws(() => empty.S.requireRole_('hr', 'x'), /غير مصرّح/);
    const e = env({ email: 'a@x.iq', sheets: { 'المستخدمون': [HEAD, ['a@x.iq', 'موارد بشرية', '']] } });
    assert.throws(() => e.S.requireRole_('finance', 'المصادقة'), /ليست لديك صلاحية المصادقة/);
    assert.equal(e.S.requireRole_('hr', 'x').email, 'a@x.iq');
});

test('setupFirstAdmin: المالك والشيت فارغ ← يُضاف مسؤولاً فقط ويُسجَّل في السجل', () => {
    const e = env({ email: 'Owner@X.iq', owner: 'owner@x.iq', sheets: { 'المستخدمون': [HEAD] } });
    const r = plain(e.S.setupFirstAdmin());
    assert.equal(r.success, true);
    assert.deepEqual(plain(e.rows('المستخدمون')).slice(1).map(x => x.slice(0, 2)), [['owner@x.iq', 'مسؤول']]);
    e.S.resetExecutionCache_();
    const u = plain(e.S.currentUser_());
    assert.deepEqual(u.roles, ['admin']);
    const log = plain(e.rows('سجل التغييرات'));
    assert.equal(log.length, 2);
    assert.equal(log[1][1], 'owner@x.iq');
    assert.equal(log[1][4], 'تهيئة أول مسؤول');
});

test('setupFirstAdmin: لا تعمل مرتين (الشيت لم يعد فارغاً)', () => {
    const e = env({ email: 'owner@x.iq', owner: 'owner@x.iq', sheets: { 'المستخدمون': [HEAD] } });
    e.S.setupFirstAdmin();
    assert.throws(() => e.S.setupFirstAdmin(), /غير فارغ/);
    assert.equal(e.rows('المستخدمون').length, 2);
});

test('setupFirstAdmin: غير المالك يُرفض ولا يُضاف شيء (الدالة العامة لا تصلح بوابة لمنح الصلاحية)', () => {
    const e = env({ email: 'intruder@x.iq', owner: 'owner@x.iq', sheets: { 'المستخدمون': [HEAD] } });
    assert.throws(() => e.S.setupFirstAdmin(), /لمالك الملف فقط/);
    assert.equal(e.rows('المستخدمون').length, 1);
});

test('setupFirstAdmin: مالك الملف غير متاح (ملف في مساحة مشتركة) أو لا بريد للمنفِّذ ← يُرفض', () => {
    const noOwner = env({ email: 'a@x.iq', owner: null, sheets: { 'المستخدمون': [HEAD] } });
    assert.throws(() => noOwner.S.setupFirstAdmin(), /لمالك الملف فقط/);
    const noEmail = env({ email: '', owner: 'owner@x.iq', sheets: { 'المستخدمون': [HEAD] } });
    assert.throws(() => noEmail.S.setupFirstAdmin(), /تعذر تحديد بريدك/);
    assert.equal(noOwner.rows('المستخدمون').length, 1);
    assert.equal(noEmail.rows('المستخدمون').length, 1);
});

test('لا بقايا لوضع الإعداد في الشيفرة (الخادم والواجهة)', () => {
    const server = read('google_apps_script.js'), ui = uiScript(), html = read('html_js_css.html');
    assert.doesNotMatch(server, /\.setup\b|\bsetup:/);
    assert.doesNotMatch(ui, /\.setup\b|\bsetup\b\s*=/);
    assert.doesNotMatch(html, /setupBanner|setup-banner/);
});
