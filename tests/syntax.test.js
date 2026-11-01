'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, uiScript } = require('./helpers/load');

test('صياغة الخادم سليمة', () => assert.doesNotThrow(() => new vm.Script(read('google_apps_script.js'))));
test('صياغة جافاسكربت الواجهة سليمة', () => assert.doesNotThrow(() => new vm.Script(uiScript())));
