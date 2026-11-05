'use strict';
// يحمّل الشيفرة من src/ كما هي (دون تعديلها) لاختبارها خارج Apps Script والمتصفح.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = name => fs.readFileSync(path.join(SRC, name), 'utf8');

// الخادم: يُشغَّل الملف كاملاً داخل vm بخدمات Google فارغة (لا تُستدعى عند التحميل)،
// ثم يُعاد كائن بالأسماء المطلوبة فقط. `globals` تستبدل خدمات Google بمحاكيات (انظر fakeSheets.js).
function loadServer(names, globals, extraSource) {
    const ctx = vm.createContext(Object.assign({
        console,
        SpreadsheetApp: {}, LockService: {}, Session: {}, HtmlService: {},
        Utilities: {}, CacheService: {}, PropertiesService: {}, ContentService: {}
    }, globals));
    return vm.runInContext(read('google_apps_script.js') + '\n' + (extraSource || '') + '\n;({' + names.join(',') + '})', ctx);
}

// الواجهة: كتلة الجافاسكربت الرئيسية (آخر وسم script في الملف).
function uiScript() {
    const html = read('html_js_css.html');
    const open = html.lastIndexOf('<script');
    const start = html.indexOf('>', open) + 1;
    return html.slice(start, html.lastIndexOf('</script>'));
}

// دالة من الواجهة بأسطرها كاملة: من سطر function name( حتى أول سطر يساوي } تماماً (أو سطر واحد متوازن).
function extractFn(src, name) {
    const lines = src.split('\n');
    const i = lines.findIndex(l => new RegExp('^\\s*function ' + name + '\\(').test(l));
    if (i < 0) throw new Error('الدالة غير موجودة: ' + name);
    const count = (s, ch) => s.split(ch).length - 1;
    if (count(lines[i], '{') > 0 && count(lines[i], '{') === count(lines[i], '}')) return lines[i];
    let j = i + 1;
    while (j < lines.length && lines[j] !== '}') j++;
    return lines.slice(i, j + 1).join('\n');
}

// ثابت/متغير عام مكتوب بصيغة const|var name = ...; (قد يمتد على عدة أسطر)
function extractConst(src, name) {
    const m = new RegExp('^(?:const|var) ' + name + ' = [\\s\\S]*?;[ \\t]*$', 'm').exec(src);
    if (!m) throw new Error('الثابت غير موجود: ' + name);
    return m[0];
}

// فهرس العناصر العامة (دوال وثوابت في بداية السطر) في كتلة الواجهة.
function indexTopLevel(src) {
    const lines = src.split('\n');
    const items = [];
    for (let i = 0; i < lines.length; i++) {
        let m = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\(/.exec(lines[i]);
        if (m) {
            let j = i;
            const c = (s, ch) => s.split(ch).length - 1;
            if (!(c(lines[i], '{') > 0 && c(lines[i], '{') === c(lines[i], '}'))) { j = i + 1; while (j < lines.length && lines[j] !== '}') j++; }
            items.push({ name: m[1], order: i, text: lines.slice(i, j + 1).join('\n') });
            i = j;
            continue;
        }
        m = /^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/.exec(lines[i]);
        if (m) {
            let j = i;
            while (j < lines.length && !/;\s*(\/\/.*)?$/.test(lines[j])) j++;
            items.push({ name: m[1], order: i, text: lines.slice(i, j + 1).join('\n') });
            i = j;
        }
    }
    return items;
}

// يبني الدوال المطلوبة من الواجهة مع كل ما تعتمد عليه من دوال وثوابت عامة (إغلاق التبعيات)،
// ويشغّلها داخل vm بلا DOM، ثم يعيد الدوال المطلوبة.
function loadUi(entry, extraGlobals) {
    const items = indexTopLevel(uiScript());
    const byName = new Map(items.map(it => [it.name, it]));
    const picked = new Map();
    const visit = name => {
        if (picked.has(name) || !byName.has(name)) return;
        const it = byName.get(name);
        picked.set(name, it);
        (it.text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []).forEach(visit);
    };
    entry.forEach(n => { if (!byName.has(n)) throw new Error('غير موجود في الواجهة: ' + n); visit(n); });
    const code = Array.from(picked.values()).sort((a, b) => a.order - b.order).map(it => it.text).join('\n');
    return vm.runInNewContext(code + '\n;({' + entry.join(',') + '})', Object.assign({ console }, extraGlobals));
}

module.exports = { loadServer, loadUi, uiScript, extractFn, extractConst, indexTopLevel, read };
