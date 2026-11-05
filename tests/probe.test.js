'use strict';
// اختبار دخان لسكربت tools/SheetsProbe.gs على المحاكي: يتأكد أنه يعمل دون أخطاء ويكتب التقرير ويحذف شيتاته المؤقتة.
// (نتائج المحاكي لا تعني شيئاً عن سلوك Sheets الحقيقي؛ الغرض خلوّ السكربت من الأخطاء قبل تشغيله على الملف الفعلي.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeEnv } = require('./helpers/fakeSheets');

const PROBE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'SheetsProbe.gs'), 'utf8');
const NAMES = ['runSheetsProbe', 'probeIdentity', 'measureDashboard', 'USER_HEADERS'];
const plain = x => JSON.parse(JSON.stringify(x));
function env(email, owner) {
    const e = makeEnv({ email, owner }, NAMES, PROBE);
    e.addSheet('المستخدمون', [e.S.USER_HEADERS, ['adm@x.iq', 'مسؤول', ''], ['hr1@x.iq', 'موارد بشرية', '']]);
    return e;
}

test('runSheetsProbe: تُنتج تقريراً بكل التجارب وتحذف الشيتات المؤقتة', () => {
    const e = env('adm@x.iq', 'adm@x.iq');
    const report = plain(e.S.runSheetsProbe());
    const codes = Array.from(new Set(report.slice(1).map(r => r[0])));
    assert.deepEqual(codes.filter(c => c !== 'E5' && c !== 'E7'), ['E1', 'E2', 'E4', 'E3', 'E3b', 'E6']);
    assert.ok(codes.includes('E5') && codes.includes('E7'));
    assert.equal(report.filter(r => r[0] === 'E1').length, 5);
    assert.equal(report.filter(r => r[0] === 'E2').length, 11);
    assert.equal(report.filter(r => r[0] === 'E3').length, 11);
    assert.equal(report.filter(r => r[0] === 'E3b').length, 3);
    assert.equal(report.filter(r => r[5] === 'خطأ').length, 0);                         // لا تجربة توقفت
    ['_probe_tmp', '_probe_text', '_probe_grow', '_probe_rows'].forEach(n => assert.equal(e.rows(n), null));
    assert.equal(e.rows('تجارب السلوك').length, report.length);
});

test('الصلاحية: غير المسؤول يُرفض في كل دوال الأداة', () => {
    const e = env('hr1@x.iq', 'adm@x.iq');
    ['runSheetsProbe', 'probeIdentity', 'measureDashboard'].forEach(f => assert.throws(() => e.S[f](), /ليست لديك صلاحية/));
    assert.equal(e.rows('تجارب السلوك'), null);
});

test('probeIdentity: يعيد مفاتيح الهوية ويقارن بمالك الملف', () => {
    const same = plain(env('adm@x.iq', 'ADM@x.iq').S.probeIdentity());
    assert.equal(same['يطابق المالك'], true);
    assert.equal(same['getActiveUser'], 'adm@x.iq');
    const other = plain(env('adm@x.iq', 'owner@x.iq').S.probeIdentity());
    assert.equal(other['يطابق المالك'], false);
    assert.equal(plain(env('adm@x.iq', null).S.probeIdentity())['getOwner'], '(null)');
});

test('measureDashboard: ثلاثة قياسات وعدد صفوف الشيتات', () => {
    const m = plain(env('adm@x.iq', 'adm@x.iq').S.measureDashboard());
    assert.equal(m.runs.length, 3);
    assert.ok(m.runs.every(r => typeof r.ms === 'number' && r.kb > 0));
    assert.equal(m.rows['المستخدمون'], 2);
});
