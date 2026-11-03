'use strict';
// صفحة الواجهة في jsdom (اختياري): يحاكي google.script.run بمسجِّل نداءات تُجاب يدوياً من الاختبار.
const fs = require('node:fs');
const path = require('node:path');

let jsdom = null;
try { jsdom = require('jsdom'); } catch (e) { /* غير مثبَّت */ }
const skip = jsdom ? false : 'jsdom غير مثبَّت (npm install)';
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'html_js_css.html'), 'utf8');

const DIRECTORY = {
    employees: [
        { id: 'E-100', name: 'أحمد كريم', dept: 'التدقيق', grade: 'الموظف', active: true },
        { id: 'E-101', name: 'عبد الله علي', dept: 'المالية', grade: 'رئيس القسم', active: true },
        { id: 'E-102', name: 'مريم حسن', dept: 'الموارد البشرية', grade: 'الموظف', active: false },
        { id: 'D-200', name: 'سائق الشركة', dept: 'النقل', grade: '', active: true }],
    departments: ['التدقيق', 'المالية', 'النقل'],
    allDepartments: [{ name: 'التدقيق', active: true }, { name: 'المالية', active: true }, { name: 'النقل', active: true }, { name: 'القديم', active: false }],
    issues: ['صف 9: القسم "س" غير موجود في شيت الأقسام.']
};

// صفحة جديدة؛ t سياق الاختبار (تُغلق النافذة بعده: يوقف مؤقّتات الصفحة وإلا لا تنتهي العملية)
function page(t, opts) {
    opts = opts || {};
    const errors = [], calls = [];
    const vc = new jsdom.VirtualConsole();
    vc.on('jsdomError', e => errors.push((e.detail && (e.detail.stack || e.detail.message)) || e.message));
    const dom = new jsdom.JSDOM(HTML, {
        runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://example.test/',
        beforeParse(w) {
            let ok, fail;
            const run = new Proxy({}, { get: (_, k) => {
                if (k === 'withSuccessHandler') return f => { ok = f; return run; };
                if (k === 'withFailureHandler') return f => { fail = f; return run; };
                return (...args) => { calls.push({ fn: String(k), args, ok, fail }); ok = fail = undefined; };
            } });
            w.google = { script: { run } };
            w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
            w.scrollTo = () => {};
        }
    });
    const w = dom.window;
    t.after(() => w.close());
    const P = {
        w, errors, calls, ev: c => w.eval(c), $: id => w.document.getElementById(id),
        type(input, text) { input.focus(); input.value = text; input.dispatchEvent(new w.Event('input', { bubbles: true })); },
        pick(input, i) { input.parentNode.querySelectorAll('.dir-opt')[i || 0].dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true })); },
        pop: input => input.parentNode.querySelector('.dir-pop'),
        collect: () => JSON.parse(JSON.stringify(w.eval('collectFormInput()'))),
        click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })),
        last: fn => calls.filter(c => c.fn === fn).pop(),
        button: (root, text) => Array.from(root.querySelectorAll('button')).find(b => b.textContent.trim() === text)
    };
    P.ev('STATE.directory = ' + JSON.stringify(opts.directory === undefined ? DIRECTORY : opts.directory) + '; renderDirectoryIssues();');
    return P;
}

module.exports = { page, skip, DIRECTORY };
