'use strict';
// نص الاحتساب المشترك مكتوب في الملفين؛ يجب أن يتطابقا حرفاً بحرف (بعد حذف التعليقات والمسافات).
// عند أي فشل هنا: عدّل الملفين معاً (انظر docs/maintenance.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, uiScript, extractFn, extractConst } = require('./helpers/load');

const norm = s => s.replace(/\/\/[^\n]*/g, '').replace(/^(const|var|let) /, '').replace(/\s+/g, '');
const server = read('google_apps_script.js'), ui = uiScript();

['canonGov_', 'nameKey_', 'normId_', 'parseLocal_', 'dayNum_', 'minutesOf_', 'calcDays_', 'pickRates_', 'pickReceiver_', 'calcTrip_']
    .forEach(n => test('دالة مشتركة متطابقة: ' + n, () => assert.equal(norm(extractFn(ui, n)), norm(extractFn(server, n)))));

['HOME_GOV_', 'GOVERNORATES_', 'GRADES_', 'GOV_ALIASES_', 'RATE_TYPES_']
    .forEach(n => test('ثابت مشترك متطابق: ' + n, () => assert.equal(norm(extractConst(ui, n)), norm(extractConst(server, n)))));
