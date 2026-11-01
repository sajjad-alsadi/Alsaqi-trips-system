'use strict';
// زر «إعادة المحاولة» في شاشة الرفض: تطبيق Apps Script يعمل داخل إطار (iframe) معزول،
// فاستدعاء location.reload() يعيد تحميل الإطار نفسه فتظهر صفحة بيضاء. المطلوب إعادة جلب الصلاحيات من الخادم.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, uiScript, extractFn } = require('./helpers/load');

test('لا يُستعمل location.reload() في أي مكان من الصفحة', () => {
    assert.doesNotMatch(read('html_js_css.html'), /location\.reload\s*\(/);
});

test('زر إعادة المحاولة في شاشة الرفض يستدعي retryAccess', () => {
    const html = read('html_js_css.html');
    const m = /id="deniedScreen"[\s\S]*?<\/div>\s*<\/div>/.exec(html);
    assert.ok(m, 'لم تُوجد شاشة الرفض');
    assert.match(m[0], /onclick="retryAccess\(\)"/);
});

test('retryAccess: تُخفي شاشة الرفض ثم تعيد تحميل البيانات من الخادم مرة واحدة', () => {
    const calls = [];
    const denied = { classList: { add: c => calls.push('add:' + c), remove: c => calls.push('remove:' + c) } };
    const ctx = { $: id => (id === 'deniedScreen' ? denied : null), loadDashboardData: () => calls.push('load') };
    const { retryAccess } = vm.runInNewContext(extractFn(uiScript(), 'retryAccess') + '\n;({retryAccess})', ctx);
    retryAccess();
    assert.deepEqual(calls, ['add:hidden', 'load']);
});
