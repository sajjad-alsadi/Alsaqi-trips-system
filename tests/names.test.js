'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('./helpers/load');
const S = loadServer(['nameKey_', 'normId_']);

test('توحيد الأسماء: الهمزات والتاء المربوطة والياء والمسافات والأرقام الهندية', () => {
    [['أحمد', 'احمد'], ['علي', 'على'], ['فاطمة', 'فاطمه'], ['محمد علي', 'محمد  علي'], ['٣٤٥ أ', '345 أ']]
        .forEach(([a, b]) => assert.equal(S.nameKey_(a), S.nameKey_(b), a + ' | ' + b));
});

test('توحيد رقم الإيفاد: أرقام هندية، ومسافات، وحالة الأحرف', () => {
    [['١٢٣/٢٠٢٦', '123/2026'], ['ABC-1', 'abc-1'], ['  12 ', '12']]
        .forEach(([a, b]) => assert.equal(S.normId_(a), S.normId_(b), a + ' | ' + b));
});

// «عبد الله» و«عبدالله» مفتاحان مختلفان في nameKey_ عمداً (لا يُدمجان بالاسم)؛
// الهوية الفعلية بالرقم الوظيفي من قائمة الموظفين: انظر tests/directory.test.js (T2.6).
test('nameKey_ لا يدمج «عبد الله» و«عبدالله» (الهوية بالرقم الوظيفي لا بالاسم)', () => {
    assert.notEqual(S.nameKey_('عبد الله'), S.nameKey_('عبدالله'));
});
