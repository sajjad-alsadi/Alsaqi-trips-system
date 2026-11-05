'use strict';
// T2.4 (O1): الصفحة لا تُحمَّل داخل إطار موقع آخر (clickjacking على أزرار المصادقة والصرف).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, read } = require('./helpers/load');

function load() {
    const calls = { mode: undefined, template: undefined };
    const out = {
        setTitle() { return out; },
        setXFrameOptionsMode(m) { calls.mode = m; return out; },
        addMetaTag() { return out; }
    };
    const HtmlService = {
        XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
        createTemplateFromFile(n) { calls.template = n; return { evaluate: () => out }; }
    };
    const S = loadServer(['doGet'], { HtmlService });
    return { S, calls };
}

test('doGet: وضع الإطار DEFAULT (لا يسمح بالتضمين في موقع آخر)', () => {
    const { S, calls } = load();
    S.doGet();
    assert.equal(calls.template, 'Index');
    assert.equal(calls.mode, 'DEFAULT');
});

test('الشيفرة لا تذكر ALLOWALL في أي موضع', () => {
    assert.ok(!/ALLOWALL/.test(read('google_apps_script.js')));
});
