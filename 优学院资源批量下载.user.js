// ==UserScript==
// @name         优学院资源批量下载
// @namespace    https://github.com/Neco
// @version      4.3.0
// @description  批量下载优学院课程资源（修复单元页文件地址捕获、资源页自动翻页、噪声与卡死）
// @author       Neco
// @match        *://*.ulearning.cn/*
// @match        *://ua.ulearning.cn/*
// @match        *://docs.ulearning.cn/*
// @match        *://lms.dgut.edu.cn/ulearning/*
// @match        *://uobs.dgut.edu.cn/*
// @grant        GM_download
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    /* ------------------------------------------------------------------ *
     * 全局状态
     * ------------------------------------------------------------------ */
    const STATE = {
        resources: [],          // { name, pureName, url, type }
        seen: new Set(),        // 归一化 URL 去重表
        filter: 'all',
        panelVisible: false,
        logVisible: false,
        delay: 500,
        downloading: false,
        suppressObserver: 0,    // >0 表示自身 UI 正在写 DOM，忽略观察器回调
        scanScheduled: false,
        domScanTimer: null,
        uiBuilt: false,
        replaying: false,
        filling: false,
        pendingName: ''
    };

    const logs = [];
    const MAX_LOGS = 200;

    /** 单次 DOM 扫描最多处理的节点数，防止超大页面卡死 */
    const MAX_DOM_CANDIDATES = 4000;
    /** DOM 变更后的合并扫描延迟 */
    const DOM_SCAN_DEBOUNCE = 1200;
    /** 单次响应体最大解析体积（字符），超出直接跳过，避免 JSON.parse 卡死 */
    const MAX_PARSE_SIZE = 4 * 1024 * 1024;

    /* ------------------------------------------------------------------ *
     * 文件类型
     * ------------------------------------------------------------------ */
    const EXT_MAP = {
        pdf: 'pdf',
        doc: 'word', docx: 'word', dot: 'word', dotx: 'word', wps: 'word', rtf: 'word',
        ppt: 'ppt', pptx: 'ppt', pps: 'ppt', ppsx: 'ppt', pot: 'ppt',
        xls: 'excel', xlsx: 'excel', xlsm: 'excel', csv: 'excel', et: 'excel',
        zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip',
        mp4: 'video', avi: 'video', mov: 'video', mkv: 'video', flv: 'video',
        wmv: 'video', m3u8: 'video', ts: 'video',
        mp3: 'audio', wav: 'audio', aac: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio',
        jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image',
        svg: 'image', webp: 'image', ico: 'image', tif: 'image', tiff: 'image',
        txt: 'text', md: 'text', json: 'text', xml: 'text', html: 'text', htm: 'text',
        swf: 'other', scorm: 'other'
    };

    const TYPE_ICON = {
        pdf: '📄', word: '📝', ppt: '📊', excel: '📈', zip: '📦',
        video: '🎬', audio: '🎵', image: '🖼️', text: '📃', other: '📎'
    };

    const TYPE_NAME = {
        pdf: 'PDF', word: 'Word', ppt: 'PPT', excel: 'Excel', zip: '压缩包',
        video: '视频', audio: '音频', image: '图片', text: '文本', other: '其他'
    };

    /** 允许收录的扩展名（用于过滤接口里的噪声 URL） */
    const ALLOWED_EXTS = Object.keys(EXT_MAP);

    function extOf(str) {
        if (!str || typeof str !== 'string') return '';
        const clean = str.split('#')[0].split('?')[0];
        const seg = clean.split('/').pop() || '';
        const idx = seg.lastIndexOf('.');
        if (idx < 0 || idx === seg.length - 1) return '';
        const ext = seg.slice(idx + 1).toLowerCase();
        return /^[a-z0-9]{1,6}$/.test(ext) ? ext : '';
    }

    function getFileType(name, url) {
        let ext = extOf(name);
        if (!ext) ext = extOf(url || '');
        return EXT_MAP[ext] || 'other';
    }

    /** 从名称或 URL 补齐扩展名 */
    function ensureExt(name, url) {
        let n = (name || '').trim();
        if (!n) n = decodeSafe((url || '').split('?')[0].split('/').pop() || '未知文件');
        if (!extOf(n)) {
            const ext = extOf(url || '');
            if (ext) n = n + '.' + ext;
        }
        return n;
    }

    function decodeSafe(s) {
        try { return decodeURIComponent(s); } catch (e) { return s; }
    }

    /** 清理文件名中的非法字符 */
    function sanitizeName(name) {
        const n = String(name || '未知文件')
            .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        return n.slice(0, 150) || '未知文件';
    }

    /* ------------------------------------------------------------------ *
     * 日志
     * ------------------------------------------------------------------ */
    function addLog(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const icons = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌', debug: '🔍' };
        logs.push({ time, msg, type, icon: icons[type] || 'ℹ️' });
        if (logs.length > MAX_LOGS) logs.shift();
        if (STATE.logVisible) scheduleRenderLogs();
    }

    let logRenderTimer = null;
    function scheduleRenderLogs() {
        if (logRenderTimer) return;
        logRenderTimer = setTimeout(() => {
            logRenderTimer = null;
            renderLogs();
        }, 300);
    }

    function renderLogs() {
        const body = document.getElementById('ulearn-log-body');
        if (!body) return;
        withObserverPaused(() => {
            body.innerHTML = logs.map(l => `
                <div style="padding:3px 6px;margin-bottom:1px;border-radius:3px;font-size:11px;background:${
                    l.type === 'success' ? 'rgba(74,222,128,0.1)'
                        : l.type === 'error' ? 'rgba(243,139,168,0.1)'
                            : 'rgba(255,255,255,0.05)'}">
                    <span style="color:#6c7086;">${esc(l.time)}</span> ${l.icon} ${esc(l.msg)}
                </div>`).join('');
            body.scrollTop = body.scrollHeight;
        });
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /* ------------------------------------------------------------------ *
     * 观察器抑制：自身 UI 写 DOM 时不触发扫描（修复卡死自激循环）
     * ------------------------------------------------------------------ */
    function withObserverPaused(fn) {
        STATE.suppressObserver++;
        try {
            return fn();
        } finally {
            // 延迟释放，确保 MutationObserver 回调拿到的是已抑制状态
            setTimeout(() => { STATE.suppressObserver = Math.max(0, STATE.suppressObserver - 1); }, 0);
        }
    }

    function isOwnNode(node) {
        if (!node) return false;
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return false;
        return !!(el.closest && el.closest('#ulearn-panel, #ulearn-float, #ulearn-style'));
    }

    /* ------------------------------------------------------------------ *
     * URL 归一化与收录
     * ------------------------------------------------------------------ */
    const RESOURCE_HINT = /\/uobs\/|robots\/view|resource|attach|file|courseware|material|content|upload|media|static\/upload/i;

    /**
     * 站点自身静态资源（图标/背景/头像/字体）。这些不是课程文件，
     * v4.0 把它们全当成"图片资源"，导致面板里全是 hm.gif / AI.svg 这类噪声。
     */
    const STATIC_PATH_BLOCK = /\/static\/|\/favicon\.ico|\/umooc\/head\/|\/img\/icon\/|\/common\/img\//i;
    const STATIC_EXT_BLOCK = /\.(svg|ico|gif|woff2?|ttf|eot|otf|map|css|js|mjs)(\?|#|$)/i;
    /** 明确是 UI 图标的文件名（不含扩展名比较） */
    const STATIC_NAME_BLOCK = new RegExp(
        '^(hm|v|two|three|one|cn-2\\.0|tips_[a-z_]*|ai|kejian|ziyuan|gonggao|gerenzuoye|xiaozuzuoye|'
        + 'ceyan|taolun|ketang|zhibo|txhy|kaoshi|zuoye|gongshi|shijuan|logo|icon|avatar|banner|bg|background)$',
        'i'
    );

    function baseName(u) {
        if (!u) return '';
        const seg = String(u).split('#')[0].split('?')[0].split('/').pop() || '';
        const i = seg.lastIndexOf('.');
        return i > 0 ? seg.slice(0, i) : seg;
    }

    /** 是否是站点自身的静态 UI 资源（应排除） */
    function isStaticAsset(url) {
        if (!url) return true;
        if (STATIC_PATH_BLOCK.test(url)) return true;
        if (STATIC_EXT_BLOCK.test(url)) return true;
        if (STATIC_NAME_BLOCK.test(baseName(url))) return true;
        return false;
    }

    function toAbsolute(url) {
        if (!url || typeof url !== 'string') return '';
        let u = url.trim();
        if (!u) return '';
        if (/^(data|blob|javascript|mailto|tel):/i.test(u)) return '';
        if (u.startsWith('//')) u = location.protocol + u;
        if (/^https?:\/\//i.test(u)) return u;
        if (u.startsWith('resources/')) u = location.origin + '/uobs/view/' + u;
        else u = location.origin + (u.startsWith('/') ? '' : '/') + u;
        return u;
    }

    function normalizeUrl(u) {
        try {
            const url = new URL(u, location.href);
            // 去掉只用于命名下载文件的 attname 参数，避免同一文件重复
            url.searchParams.delete('attname');
            url.searchParams.delete('filename');
            url.hash = '';
            return url.origin + url.pathname + (url.search || '');
        } catch (e) {
            return u;
        }
    }

    /** 判断某个 URL 是否像一个可下载资源 */
    function looksLikeResource(url, titleHint) {
        if (!url) return false;
        // 站点静态 UI 资源一律排除（修复"只能识别到一堆照片"）
        if (isStaticAsset(url)) return false;
        if (/\.(html?|php|aspx?|jsp)(\?|#|$)/i.test(url) && !/\/uobs\//i.test(url)) return false;
        const ext = extOf(url);
        if (ext && ALLOWED_EXTS.indexOf(ext) >= 0) return true;
        if (extOf(titleHint) && ALLOWED_EXTS.indexOf(extOf(titleHint)) >= 0) return true;
        if (/\/uobs\/view\/resources\//i.test(url)) return true;
        if (/\/uobs\//i.test(url) && !/\.(js|css|ico)(\?|#|$)/i.test(url)) return true;
        return false;
    }

    function addResource(title, rawUrl, sourceLabel) {
        const url = toAbsolute(rawUrl);
        if (!url) return false;
        if (!looksLikeResource(url, title)) return false;
        // 排除页面自身、静态脚本样式
        if (/\.(js|css|woff2?|ttf|map)(\?|#|$)/i.test(url)) return false;
        if (url.indexOf(location.origin) === 0 && /index\.html/i.test(url)) return false;

        // performance 来源的纯图片多为页面装饰，不接受（避免噪声）
        if (sourceLabel === 'perf') {
            const t = getFileType(title, url);
            if (t === 'image') return false;
        }
        if (isStaticAsset(url)) return false;

        const key = normalizeUrl(url);
        if (STATE.seen.has(key)) return false;
        STATE.seen.add(key);

        const name = sanitizeName(ensureExt(title, url));
        const pureName = sanitizeName(name.split('/').pop() || name);

        STATE.resources.push({
            name,
            pureName,
            url,
            type: getFileType(pureName, url),
            source: sourceLabel || ''
        });
        return true;
    }

    /* ------------------------------------------------------------------ *
     * 深度解析：从任意接口 JSON 结构中提取资源
     * ------------------------------------------------------------------ */
    const URL_KEYS = [
        'location', 'url', 'href', 'src', 'fileUrl', 'fileURL', 'fileurl', 'filePath', 'filepath',
        'resourceUrl', 'resourcePath', 'downloadUrl', 'downloadPath', 'attUrl',
        'attachmentUrl', 'attachmentPath', 'ossUrl', 'ossPath', 'objectKey',
        'storagePath', 'serverPath', 'previewUrl', 'playUrl', 'mediaUrl', 'cdnUrl', 'path',
        'file', 'realPath', 'relativePath', 'viewUrl', 'contentUrl'
    ];

    const TITLE_KEYS = [
        'title', 'name', 'fileName', 'filename', 'resourceName', 'originalName', 'origName',
        'attName', 'displayName', 'resourceTitle', 'coursewareName', 'label', 'fullName',
        'nodeName', 'resName', 'contentName'
    ];

    function pickKey(obj, keys) {
        for (let i = 0; i < keys.length; i++) {
            const v = obj[keys[i]];
            if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return '';
    }

    function deepExtract(data, depth, stats, inheritedTitle) {
        if (depth > 12 || data == null || typeof data !== 'object') return;
        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                deepExtract(data[i], depth + 1, stats, inheritedTitle);
            }
            return;
        }

        // 本层的标题（优学院单元页常见：父级有 name/title，子级 resource 里才有 location）
        const ownTitle = pickKey(data, TITLE_KEYS);
        const titleForChildren = ownTitle || inheritedTitle || '';

        // 当前对象自身是否是一个资源
        const urlVal = pickKey(data, URL_KEYS);
        if (urlVal) {
            // 关键：自身没标题时，用父级标题继承，避免文件名变成 aaa.pdf
            if (addResource(ownTitle || inheritedTitle, urlVal, 'json')) stats.added++;
        }

        for (const k in data) {
            if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
            const v = data[k];
            if (v && typeof v === 'object') deepExtract(v, depth + 1, stats, titleForChildren);
        }
    }

    /* ------------------------------------------------------------------ *
     * 网络拦截（修复：只解析 JSON，限制体积，忽略二进制/HTML）
     * ------------------------------------------------------------------ */
    let interceptInstalled = false;
    let ORIG_FETCH = null;

    function setupInterceptor() {
        if (interceptInstalled) return;
        interceptInstalled = true;

        // ---- XHR ----
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url) {
            try { this.__ulearn_url = url; } catch (e) { }
            return origOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            const xhr = this;
            try {
                xhr.addEventListener('load', function () {
                    try {
                        // 只处理文本/JSON 响应，blob/arraybuffer 一律跳过
                        const rt = xhr.responseType;
                        if (rt && rt !== 'text' && rt !== 'json') return;
                        const ct = (xhr.getResponseHeader && xhr.getResponseHeader('content-type')) || '';
                        if (ct && !/json|text\/plain|text\/html/i.test(ct)) return;
                        const text = rt === 'json' ? JSON.stringify(xhr.response) : xhr.responseText;
                        processResponse(xhr.__ulearn_url, text);
                    } catch (e) { /* 静默 */ }
                });
            } catch (e) { }
            return origSend.apply(this, arguments);
        };

        // ---- fetch ----
        const origFetch = window.fetch;
        ORIG_FETCH = origFetch;
        if (origFetch) {
            window.fetch = function (input) {
                const p = origFetch.apply(this, arguments);
                try {
                    const url = typeof input === 'string' ? input : (input && input.url);
                    p.then(resp => {
                        try {
                            const ct = (resp.headers && resp.headers.get('content-type')) || '';
                            // 只克隆 JSON 响应，避免下载二进制时爆内存
                            if (!/json|text\/plain/i.test(ct)) return;
                            const len = resp.headers.get('content-length');
                            if (len && parseInt(len, 10) > MAX_PARSE_SIZE) return;
                            resp.clone().text().then(t => processResponse(url, t)).catch(() => { });
                        } catch (e) { }
                    }).catch(() => { });
                } catch (e) { }
                return p;
            };
        }

        // ---- window.open ----
        // 某些环境点「查看」会新开标签页而非内嵌预览，这里兜住。
        try {
            const origOpen = window.open;
            if (origOpen) {
                window.open = function (url) {
                    const win = origOpen.apply(this, arguments);
                    try { inspectOpenedUrl(url); } catch (e) { }
                    // 新窗口可能稍后才跳转，轮询几次 location
                    let n = 0;
                    const timer = setInterval(() => {
                        n++;
                        try {
                            inspectOpenedUrl(win && win.location && win.location.href);
                        } catch (e) { /* 跨域时读不到，忽略 */ }
                        if (n >= 12) clearInterval(timer);
                    }, 500);
                    return win;
                };
            }
        } catch (e) { }

        addLog('拦截器已启动', 'success');
    }

    /** 从任意 URL（含 furl 参数）里抽真实文件地址并收录 */
    function inspectOpenedUrl(u) {
        if (!u || typeof u !== 'string') return 0;
        const real = decodeFurl(u) || (/uobs\.dgut\.edu\.cn\/view\/resources\//i.test(u) ? u : '');
        if (!real) return 0;
        if (addResource(STATE.pendingName || '', real, 'frame')) {
            refreshUI();
            return 1;
        }
        return 0;
    }

    function processResponse(url, body) {
        if (!url || typeof body !== 'string' || !body) return;
        // 体积与首字符快速过滤
        if (body.length > MAX_PARSE_SIZE) return;
        const head = body.slice(0, 1);
        if (head !== '{' && head !== '[') return;
        // 与资源无关的请求直接跳过（减少解析开销）
        if (!RESOURCE_HINT.test(url) && !/\.(pdf|docx?|pptx?|xlsx?|zip|mp4|mp3)$/i.test(url)) {
            // 仍然尝试一次：单元页接口路径千变万化，但只针对体积较小的响应
            if (body.length > 300 * 1024) return;
        }

        let data;
        try {
            data = JSON.parse(body);
        } catch (e) {
            return;
        }

        const stats = { added: 0 };
        try {
            deepExtract(data, 0, stats);
        } catch (e) { }

        if (stats.added > 0) {
            addLog(`接口新增 ${stats.added} 个资源（共 ${STATE.resources.length}）`, 'success');
            refreshUI();
        }
    }

    /* ------------------------------------------------------------------ *
     * 已加载资源探测：performance entries（补录脚本安装前的请求）
     * ------------------------------------------------------------------ */
    function scanPerformanceEntries() {
        if (!window.performance || !performance.getEntriesByType) return 0;
        let added = 0;
        let entries = [];
        try { entries = performance.getEntriesByType('resource') || []; } catch (e) { return 0; }
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (!e || !e.name) continue;
            if (addResource('', e.name, 'perf')) added++;
        }
        return added;
    }

    function setupPerformanceObserver() {
        if (typeof PerformanceObserver === 'undefined') return;
        try {
            const po = new PerformanceObserver(list => {
                let added = 0;
                list.getEntries().forEach(e => {
                    if (e && e.name && addResource('', e.name, 'perf')) added++;
                });
                if (added > 0) refreshUI();
            });
            po.observe({ entryTypes: ['resource'] });
        } catch (e) { }
    }

    /* ------------------------------------------------------------------ *
     * DOM 扫描（修复：兼容 div/li 卡片式资源项，不依赖 <a href>）
     * ------------------------------------------------------------------ */
    function elementUrls(el) {
        const out = [];
        // 属性中的 URL
        if (el.attributes && el.attributes.length) {
            for (let i = 0; i < el.attributes.length; i++) {
                const a = el.attributes[i];
                const v = a.value || '';
                if (!v) continue;
                if (/^https?:\/\//i.test(v) || /^\/?(resources|uobs)\//i.test(v) || /^(\.\/)?[\w\-./]+\.(pdf|docx?|pptx?|xlsx?|zip|rar|7z|mp4|mp3)(\?|$)/i.test(v)) {
                    out.push(v);
                }
            }
        }
        return out;
    }

    function labelOf(el) {
        const t = visibleText(el);
        return t.length > 120 ? t.slice(0, 120) : t;
    }

    function scanDom() {
        const body = document.body;
        if (!body) return 0;

        let added = 0;
        let scanned = 0;

        // 1) 带 href / data-* 的节点
        const sel = 'a[href], [data-url], [data-href], [data-location], [data-file], [data-src], [data-attname], [data-resource], [data-path]';
        let nodes;
        try { nodes = body.querySelectorAll(sel); } catch (e) { nodes = []; }

        const limit = Math.min(nodes.length, MAX_DOM_CANDIDATES);
        for (let i = 0; i < limit; i++) {
            const el = nodes[i];
            if (isOwnNode(el)) continue;
            scanned++;
            const urls = elementUrls(el);
            if (!urls.length) continue;
            const label = labelOf(el);
            for (let j = 0; j < urls.length; j++) {
                if (addResource(label, urls[j], 'dom-attr')) added++;
            }
        }

        // 2) 文本里出现文件名、但外层是 div/li 卡片的资源（单元页常见形态）
        const textCandidates = body.querySelectorAll('li, tr, .item, .list-item, .resource, .file, .material, [class*="resource"], [class*="file"], [class*="item"]');
        const limit2 = Math.min(textCandidates.length, MAX_DOM_CANDIDATES);
        const extRe = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar|7z|mp4|mp3|txt)\b/i;
        for (let i = 0; i < limit2; i++) {
            const el = textCandidates[i];
            if (isOwnNode(el)) continue;
            const label = labelOf(el);
            if (!label || label.length > 120 || !extRe.test(label)) continue;
            // 在自身或祖先里找 URL 线索
            let target = el;
            let urls = elementUrls(target);
            let depth = 0;
            while (!urls.length && target && target.parentElement && depth < 3) {
                target = target.parentElement;
                urls = elementUrls(target);
                depth++;
            }
            if (!urls.length) continue;
            // 只取标签里出现的那个文件名，避免把整块文案当名字
            const m = label.match(new RegExp('[^\\s|/\\\\]*\\.(' + ALLOWED_EXTS.join('|') + ')\\b', 'i'));
            const name = m ? m[0] : label;
            for (let j = 0; j < urls.length; j++) {
                if (addResource(name, urls[j], 'dom-text')) added++;
            }
        }

        return added;
    }

    /* ------------------------------------------------------------------ *
     * DOM 观察（修复：合并节流 + 忽略自身 UI + 仅扫描新增节点所在区域）
     * ------------------------------------------------------------------ */
    function scheduleDomScan(reason) {
        if (STATE.scanScheduled) return;
        STATE.scanScheduled = true;
        if (STATE.domScanTimer) clearTimeout(STATE.domScanTimer);
        STATE.domScanTimer = setTimeout(() => {
            STATE.scanScheduled = false;
            STATE.domScanTimer = null;
            let added = 0;
            try { added = scanDom(); } catch (e) { }
            if (added > 0) {
                addLog(`页面扫描新增 ${added} 个资源（共 ${STATE.resources.length}）`, 'success');
                refreshUI();
            }
        }, DOM_SCAN_DEBOUNCE);
    }

    function setupDOMObserver() {
        const observer = new MutationObserver(records => {
            // 自身 UI 造成的变更直接忽略，避免 扫描→渲染→再扫描 的自激死循环
            if (STATE.suppressObserver > 0) return;
            let meaningful = false;
            for (let i = 0; i < records.length; i++) {
                const r = records[i];
                if (r.type === 'attributes') {
                    const tag = r.target && r.target.tagName;
                    if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') meaningful = true;
                    continue;
                }
                if (r.type !== 'childList') continue;
                const nodes = r.addedNodes;
                for (let j = 0; j < nodes.length; j++) {
                    const n = nodes[j];
                    if (n.nodeType !== 1) continue;
                    if (isOwnNode(n)) continue;
                    meaningful = true;
                    break;
                }
                if (meaningful) break;
            }
            if (meaningful) scheduleDomScan('mutation');
        });

        // 同时监听 src/data 属性：单元页点「查看」后前端才把真实地址写进 iframe.src
        observer.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['src', 'data', 'href']
        });
    }

    // SPA 路由变化（单元页是 hash 路由）时重新扫描
    function setupRouteWatcher() {
        let lastHash = location.hash;
        setInterval(() => {
            if (location.hash !== lastHash) {
                const prev = lastHash;
                lastHash = location.hash;
                // 不清空已捕获资源：单元页/资源页/翻页之间应累积。
                // 这样"单元里的文件"和"资源页的文件"能一起下载。
                addLog('页面已切换，正在补充捕获…', 'info');
                setTimeout(() => {
                    scanPerformanceEntries();
                    scanDom();
                    refreshUI();
                    if (STATE.resources.length > 0) {
                        addLog(`当前累计 ${STATE.resources.length} 个资源`, 'success');
                    }
                }, 1500);
            }
        }, 1500);
    }

    /* ------------------------------------------------------------------ *
     * 下载
     * ------------------------------------------------------------------ */
    function downloadFile(resource) {
        return new Promise(resolve => {
            const fileName = resource.pureName || resource.name || '未知文件';
            const finish = () => resolve();

            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: resource.url,
                    responseType: 'blob',
                    timeout: 120000,
                    onload(response) {
                        try {
                            if (response.status >= 400) throw new Error('HTTP ' + response.status);
                            const blob = response.response;
                            if (!blob || !blob.size) throw new Error('空文件');
                            const blobUrl = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = blobUrl;
                            a.download = fileName;
                            a.style.display = 'none';
                            document.body.appendChild(a);
                            a.click();
                            setTimeout(() => {
                                a.remove();
                                URL.revokeObjectURL(blobUrl);
                            }, 1000);
                            addLog(`下载成功: ${fileName}`, 'success');
                        } catch (e) {
                            addLog(`下载失败: ${fileName} — ${e.message}`, 'error');
                        }
                        finish();
                    },
                    onerror() {
                        addLog(`下载失败: ${fileName}（尝试直接打开）`, 'warn');
                        try {
                            const sep = resource.url.indexOf('?') >= 0 ? '&' : '?';
                            window.open(resource.url + sep + 'attname=' + encodeURIComponent(fileName), '_blank');
                        } catch (e) { }
                        finish();
                    },
                    ontimeout() {
                        addLog(`下载超时: ${fileName}`, 'error');
                        finish();
                    }
                });
            } else {
                const a = document.createElement('a');
                a.href = resource.url;
                a.download = fileName;
                a.target = '_blank';
                a.rel = 'noopener';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => a.remove(), 1000);
                finish();
            }
        });
    }

    async function downloadMultiple(list) {
        if (STATE.downloading) return showToast('正在下载中，请稍候…');
        if (!list.length) return showToast('没有可下载的资源');

        STATE.downloading = true;
        refreshUI();
        showToast(`开始下载 ${list.length} 个文件`);

        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            addLog(`[${i + 1}/${list.length}] ${r.pureName || r.name}`, 'info');
            await downloadFile(r);
            if (i < list.length - 1 && STATE.delay > 0) {
                await new Promise(res => setTimeout(res, STATE.delay));
            }
        }

        STATE.downloading = false;
        refreshUI();
        showToast(`已提交 ${list.length} 个下载任务`);
        addLog('全部任务处理完成', 'success');
    }

    /* ------------------------------------------------------------------ *
     * UI
     * ------------------------------------------------------------------ */
    function filteredResources() {
        return STATE.filter === 'all'
            ? STATE.resources
            : STATE.resources.filter(r => r.type === STATE.filter);
    }

    function createPanel() {
        const floatBtn = document.createElement('div');
        floatBtn.id = 'ulearn-float';
        floatBtn.textContent = '📥';
        floatBtn.style.cssText = 'position:fixed;top:20px;right:20px;width:48px;height:48px;'
            + 'background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;display:flex;'
            + 'align-items:center;justify-content:center;font-size:22px;cursor:pointer;z-index:2147483647;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,.3);user-select:none;';

        const badge = document.createElement('div');
        badge.id = 'ulearn-badge';
        badge.style.cssText = 'position:absolute;top:-6px;right:-6px;background:#f38ba8;color:#1e1e2e;'
            + 'font-size:10px;font-weight:700;min-width:18px;height:18px;border-radius:9px;display:flex;'
            + 'align-items:center;justify-content:center;padding:0 4px;';
        badge.textContent = '0';
        floatBtn.appendChild(badge);

        const panel = document.createElement('div');
        panel.id = 'ulearn-panel';
        panel.style.cssText = 'position:fixed;top:80px;right:20px;width:380px;max-height:80vh;'
            + 'background:#1e1e2e;border:1px solid #45475a;border-radius:12px;'
            + 'box-shadow:0 10px 40px rgba(0,0,0,.4);z-index:2147483646;font-family:-apple-system,sans-serif;'
            + 'color:#cdd6f4;overflow:hidden;display:none;flex-direction:column;';

        panel.innerHTML = `
            <div id="ulearn-header" style="padding:12px 16px;background:linear-gradient(135deg,#667eea,#764ba2);
                display:flex;justify-content:space-between;align-items:center;cursor:move;">
                <span style="font-weight:600;">📥 优学院下载器 v4.3.0</span>
                <div style="display:flex;gap:6px;">
                    <button id="ulearn-log-btn" title="日志" style="background:rgba(255,255,255,.2);border:none;
                        color:#fff;padding:4px 10px;border-radius:12px;cursor:pointer;font-size:12px;">📋</button>
                    <button id="ulearn-close" title="关闭" style="background:rgba(255,255,255,.2);border:none;
                        color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;">×</button>
                </div>
            </div>
            <div style="padding:12px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;max-height:calc(80vh - 50px);">
                <div style="text-align:center;">已捕获
                    <strong id="ulearn-total" style="font-size:20px;color:#89b4fa;">0</strong> 个资源
                </div>
                <button id="ulearn-scan" style="padding:10px;background:#a6e3a1;color:#1e1e2e;border:none;
                    border-radius:8px;cursor:pointer;font-weight:600;">🔍 重新扫描当前页面</button>
                <button id="ulearn-fill" style="padding:8px;background:#fab387;color:#1e1e2e;border:none;
                    border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">⬇️ 自动补全单元文件（逐个打开读取地址）</button>
                <button id="ulearn-import" style="padding:8px;background:#313244;color:#cdd6f4;
                    border:1px solid #45475a;border-radius:8px;cursor:pointer;font-size:12px;">📋 粘贴接口 JSON 解析（高级）</button>
                <div id="ulearn-import-box" style="display:none;flex-direction:column;gap:6px;">
                    <textarea id="ulearn-import-text" placeholder="把接口返回的 JSON 粘贴到这里…"
                        style="width:100%;box-sizing:border-box;height:90px;background:#181825;color:#cdd6f4;
                        border:1px solid #45475a;border-radius:6px;padding:6px;font-size:12px;resize:vertical;"></textarea>
                    <div style="display:flex;gap:6px;">
                        <button id="ulearn-import-run" class="ulearn-btn primary" style="padding:6px 12px;">解析</button>
                        <button id="ulearn-import-cancel" class="ulearn-btn secondary" style="padding:6px 12px;">收起</button>
                    </div>
                </div>
                <div style="background:#313244;border-radius:8px;padding:10px;font-size:12px;color:#a6adc8;line-height:1.5;">
                    💡 单元页：点「自动补全单元文件」——脚本会先自动展开所有章节，再逐个打开文件读取真实地址。<br>
                    资源页：点「重新扫描」即自动翻页取全，无需手动翻页。
                </div>
                <div id="ulearn-filters" style="display:flex;flex-wrap:wrap;gap:6px;">
                    <button class="ulearn-filter active" data-type="all">全部</button>
                    <button class="ulearn-filter" data-type="pdf">📄 PDF</button>
                    <button class="ulearn-filter" data-type="word">📝 Word</button>
                    <button class="ulearn-filter" data-type="ppt">📊 PPT</button>
                    <button class="ulearn-filter" data-type="excel">📈 Excel</button>
                    <button class="ulearn-filter" data-type="image">🖼️ 图片</button>
                    <button class="ulearn-filter" data-type="video">🎬 视频</button>
                    <button class="ulearn-filter" data-type="audio">🎵 音频</button>
                    <button class="ulearn-filter" data-type="zip">📦 压缩包</button>
                </div>
                <div id="ulearn-list" style="max-height:300px;overflow-y:auto;background:#181825;
                    border-radius:8px;padding:8px;">
                    <div style="text-align:center;padding:20px;color:#6c7086;">暂无资源</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="ulearn-dl-all" class="ulearn-btn primary" disabled>下载全部</button>
                    <button id="ulearn-dl-sel" class="ulearn-btn primary" disabled>下载选中</button>
                    <button id="ulearn-copy" class="ulearn-btn secondary">复制链接</button>
                    <button id="ulearn-clear" class="ulearn-btn secondary" style="flex:0 0 auto;padding:8px 12px;">清空</button>
                </div>
                <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#a6adc8;">
                    <span>下载间隔：</span>
                    <select id="ulearn-delay" style="background:#313244;color:#cdd6f4;border:1px solid #45475a;
                        border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;">
                        <option value="0">无间隔</option>
                        <option value="500" selected>0.5 秒</option>
                        <option value="1000">1 秒</option>
                        <option value="1500">1.5 秒</option>
                        <option value="2000">2 秒</option>
                        <option value="3000">3 秒</option>
                    </select>
                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                        <input type="checkbox" id="ulearn-sel-all" checked> 全选
                    </label>
                </div>
                <div id="ulearn-log-panel" style="display:none;max-height:150px;overflow-y:auto;
                    background:#181825;border-radius:8px;padding:6px;">
                    <div id="ulearn-log-body"></div>
                </div>
            </div>`;

        const style = document.createElement('style');
        style.id = 'ulearn-style';
        style.textContent = `
            .ulearn-filter{padding:4px 10px;background:#313244;border:1px solid #45475a;border-radius:16px;
                color:#cdd6f4;font-size:12px;cursor:pointer;}
            .ulearn-filter.active{background:#89b4fa;color:#1e1e2e;border-color:#89b4fa;}
            .ulearn-item{display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:3px;
                background:#1e1e2e;border-radius:6px;font-size:12px;cursor:pointer;}
            .ulearn-item:hover{background:#313244;}
            .ulearn-btn{padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-size:13px;flex:1;}
            .ulearn-btn:disabled{opacity:.5;cursor:not-allowed;}
            .ulearn-btn.primary{background:#89b4fa;color:#1e1e2e;}
            .ulearn-btn.secondary{background:#45475a;color:#cdd6f4;}
            .ulearn-toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#313244;
                color:#cdd6f4;padding:10px 20px;border-radius:8px;z-index:2147483647;font-size:13px;}`;
        document.head.appendChild(style);

        document.body.appendChild(floatBtn);
        document.body.appendChild(panel);
        return { floatBtn, panel };
    }

    function refreshUI() {
        const total = document.getElementById('ulearn-total');
        if (!total) return;
        withObserverPaused(() => {
            total.textContent = filteredResources().length;
            const badge = document.getElementById('ulearn-badge');
            if (badge) badge.textContent = STATE.resources.length;
            const dlAll = document.getElementById('ulearn-dl-all');
            if (dlAll) {
                dlAll.disabled = filteredResources().length === 0 || STATE.downloading;
                dlAll.textContent = STATE.downloading ? '下载中…' : `下载全部 (${filteredResources().length})`;
            }
            renderList();
        });
    }

    function renderList() {
        const list = document.getElementById('ulearn-list');
        if (!list) return;
        const items = filteredResources();

        if (!items.length) {
            list.innerHTML = '<div style="text-align:center;padding:20px;color:#6c7086;">暂无资源，'
                + '请展开页面内容后点「重新扫描」</div>';
            updateSelBtn();
            return;
        }

        list.innerHTML = items.map(r => {
            const idx = STATE.resources.indexOf(r);
            return `<div class="ulearn-item">
                <input type="checkbox" class="ulearn-cb" data-idx="${idx}" checked>
                <span>${TYPE_ICON[r.type] || '📎'}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.name)}">${esc(r.name)}</span>
                <span style="font-size:10px;padding:2px 6px;background:#313244;border-radius:4px;color:#a6adc8;">${TYPE_NAME[r.type] || '其他'}</span>
            </div>`;
        }).join('');

        list.querySelectorAll('.ulearn-cb').forEach(cb => cb.addEventListener('change', updateSelBtn));
        list.querySelectorAll('.ulearn-item').forEach(item => {
            item.addEventListener('click', e => {
                if (e.target.tagName === 'INPUT') return;
                const cb = item.querySelector('.ulearn-cb');
                cb.checked = !cb.checked;
                updateSelBtn();
            });
        });
        updateSelBtn();
    }

    function updateSelBtn() {
        const btn = document.getElementById('ulearn-dl-sel');
        if (!btn) return;
        const count = document.querySelectorAll('.ulearn-cb:checked').length;
        btn.disabled = count === 0 || STATE.downloading;
        btn.textContent = count > 0 ? `下载选中 (${count})` : '下载选中';
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.className = 'ulearn-toast';
        toast.textContent = msg;
        withObserverPaused(() => document.body.appendChild(toast));
        setTimeout(() => toast.remove(), 2000);
    }

    function getSelected() {
        return Array.from(document.querySelectorAll('.ulearn-cb:checked'))
            .map(cb => STATE.resources[parseInt(cb.dataset.idx, 10)])
            .filter(Boolean);
    }

    /* ------------------------------------------------------------------ *
     * 初始化
     * ------------------------------------------------------------------ */
    function init() {
        const loc = location.href;
        if (!/ulearning/i.test(loc) && !/uobs\.dgut\.edu\.cn/i.test(loc)) {
            return;
        }

        // 阶段一（document-start）：先装拦截器，抢在页面发请求之前
        setupInterceptor();

        // 阶段二：等 DOM 可用后再建 UI / 观察器
        if (document.body) {
            buildUI();
        } else {
            document.addEventListener('DOMContentLoaded', buildUI, { once: true });
        }
    }

    function buildUI() {
        if (STATE.uiBuilt) return;
        STATE.uiBuilt = true;

        setupPerformanceObserver();
        const { floatBtn, panel } = createPanel();

        // 浮动按钮：拖拽 + 点击
        let dragging = false, moved = false, sx = 0, sy = 0, ol = 0, ot = 0;
        floatBtn.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            dragging = true;
            moved = false;
            sx = e.clientX;
            sy = e.clientY;
            const rect = floatBtn.getBoundingClientRect();
            ol = rect.left;
            ot = rect.top;
            floatBtn.style.right = 'auto';
            floatBtn.style.left = ol + 'px';
            floatBtn.style.top = ot + 'px';
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            const dx = e.clientX - sx;
            const dy = e.clientY - sy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            if (moved) {
                floatBtn.style.left = (ol + dx) + 'px';
                floatBtn.style.top = (ot + dy) + 'px';
            }
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            if (!moved) {
                STATE.panelVisible = !STATE.panelVisible;
                panel.style.display = STATE.panelVisible ? 'flex' : 'none';
                if (STATE.panelVisible) {
                    refreshUI();
                    fullScan();
                }
            }
        });

        document.getElementById('ulearn-close').addEventListener('click', () => {
            panel.style.display = 'none';
            STATE.panelVisible = false;
        });

        document.getElementById('ulearn-log-btn').addEventListener('click', () => {
            STATE.logVisible = !STATE.logVisible;
            document.getElementById('ulearn-log-panel').style.display = STATE.logVisible ? 'block' : 'none';
            if (STATE.logVisible) renderLogs();
        });

        document.getElementById('ulearn-fill').addEventListener('click', () => {
            autoFillUnitFiles();
        });

        document.getElementById('ulearn-scan').addEventListener('click', () => {
            fullScan();
            showToast(`扫描中…已捕获 ${STATE.resources.length} 个`);
        });

        // 内嵌输入框（替代原生 prompt，避免阻塞页面）
        document.getElementById('ulearn-import').addEventListener('click', () => {
            const box = document.getElementById('ulearn-import-box');
            box.style.display = (box.style.display === 'flex') ? 'none' : 'flex';
        });

        document.getElementById('ulearn-import-cancel').addEventListener('click', () => {
            document.getElementById('ulearn-import-box').style.display = 'none';
        });

        document.getElementById('ulearn-import-run').addEventListener('click', () => {
            const ta = document.getElementById('ulearn-import-text');
            const text = (ta && ta.value || '').trim();
            if (!text) return showToast('请先粘贴 JSON 内容');

            let parsed = 0;
            // 优先按 JSON 解析
            try {
                const data = JSON.parse(text);
                const before = STATE.resources.length;
                processResponse('manual://json', JSON.stringify(data));
                parsed = STATE.resources.length - before;
            } catch (e) {
                // 退化为文本抓取：找 "文件名" ... "地址" 的配对
                const re = /"([^"]*\.(?:pdf|docx?|pptx?|xlsx?|zip|rar|7z|mp4|mp3|txt))"[^{}]{0,200}?"((?:https?:)?\/\/[^"]+|\/?[\w\-./]+\.(?:pdf|docx?|pptx?|xlsx?|zip|rar|7z|mp4|mp3|txt)[^"]*)"/gi;
                let m;
                while ((m = re.exec(text))) {
                    if (addResource(m[1], m[2], 'manual')) parsed++;
                }
            }
            refreshUI();
            if (parsed > 0) {
                ta.value = '';
                document.getElementById('ulearn-import-box').style.display = 'none';
                showToast(`解析到 ${parsed} 个资源`);
                addLog(`手动解析新增 ${parsed} 个资源`, 'success');
            } else {
                showToast('未解析到资源，请确认 JSON 内容');
            }
        });

        document.getElementById('ulearn-filters').addEventListener('click', e => {
            if (!e.target.classList.contains('ulearn-filter')) return;
            document.querySelectorAll('.ulearn-filter').forEach(f => f.classList.remove('active'));
            e.target.classList.add('active');
            STATE.filter = e.target.dataset.type;
            refreshUI();
        });

        document.getElementById('ulearn-sel-all').addEventListener('change', e => {
            document.querySelectorAll('.ulearn-cb').forEach(cb => { cb.checked = e.target.checked; });
            updateSelBtn();
        });

        document.getElementById('ulearn-delay').addEventListener('change', e => {
            STATE.delay = parseInt(e.target.value, 10) || 0;
        });

        document.getElementById('ulearn-dl-all').addEventListener('click', () => {
            downloadMultiple(filteredResources().slice());
        });

        document.getElementById('ulearn-dl-sel').addEventListener('click', () => {
            const list = getSelected();
            if (list.length) downloadMultiple(list);
        });

        document.getElementById('ulearn-clear').addEventListener('click', () => {
            STATE.resources.length = 0;
            STATE.seen.clear();
            logs.length = 0;
            addLog('列表已清空', 'info');
            refreshUI();
            showToast('已清空，可重新扫描');
        });

        document.getElementById('ulearn-copy').addEventListener('click', () => {
            const list = getSelected();
            if (!list.length) return showToast('请先选择要复制的资源');
            const text = list.map(x => x.url).join(String.fromCharCode(10));
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(
                    () => showToast(`已复制 ${list.length} 个链接`),
                    () => showToast('复制失败，请手动选择')
                );
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                showToast(`已复制 ${list.length} 个链接`);
            }
        });

        // 面板拖拽
        let pdragging = false, ox = 0, oy = 0;
        document.getElementById('ulearn-header').addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            pdragging = true;
            ox = e.clientX - panel.offsetLeft;
            oy = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (!pdragging) return;
            panel.style.left = (e.clientX - ox) + 'px';
            panel.style.top = (e.clientY - oy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { pdragging = false; });

        setupDOMObserver();
        setupRouteWatcher();

        // 首次扫描：等 SPA 渲染完成
        setTimeout(() => { fullScan(); }, 1500);
    }

    /* ------------------------------------------------------------------ *
     * 接口回放：单元页的文件地址不在 DOM 里，只在接口响应里。
     * 若脚本注入晚于页面首屏请求，拦截器就抓不到。
     * 这里从 performance 里找出页面已发出的 XHR/fetch 接口，按只读 GET 重放，
     * 再解析 JSON 提取资源 —— 不依赖注入时机。
     * ------------------------------------------------------------------ */
    const REPLAY_MAX = 30;
    /** 只回放只读列表类接口，避免触发写操作 */
    const REPLAY_READONLY_BLOCK = new RegExp(
        'delete|remove|update|save|submit|upload|create|edit|publish|logout|login|pay|vote|'
        + 'mark|progress|record|heartbeat|visit|sign|click|/add\\b|/del\\b',
        'i'
    );
    const REPLAY_SCORE_HINT = /resource|file|material|attach|activity|unit|list|content|courseware|chapter|node|tree/i;

    function replayCandidates() {
        if (!window.performance || !performance.getEntriesByType) return [];
        let entries = [];
        try { entries = performance.getEntriesByType('resource') || []; } catch (e) { return []; }

        const seen = new Set();
        const list = [];
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const it = e.initiatorType;
            if (it !== 'xmlhttprequest' && it !== 'fetch') continue;
            const name = e.name;
            if (!name || name.indexOf(location.origin) !== 0) continue;
            if (isStaticAsset(name)) continue;
            if (REPLAY_READONLY_BLOCK.test(name)) continue;
            const key = normalizeUrl(name);
            if (seen.has(key)) continue;
            seen.add(key);
            list.push(name);
        }
        // 更像"资源列表"的接口优先
        list.sort((a, b) => (REPLAY_SCORE_HINT.test(b) ? 1 : 0) - (REPLAY_SCORE_HINT.test(a) ? 1 : 0));
        return list.slice(0, REPLAY_MAX);
    }

    /**
     * 自动翻页：以"新增数量归零"为收敛条件，兼容各种分页参数名。
     * 若接口不认分页参数，第二次就返回同样数据 → 去重后新增为 0 → 立即停止。
     */
    async function paginateAndCollect(baseUrl, firstData) {
        const total = deepNumberByKey(firstData, TOTAL_KEYS, 0);
        const pageParam = detectPageParam(baseUrl) || 'page';
        const f = ORIG_FETCH || window.fetch;
        let added = 0;

        // 起始页码
        let startPage = 1;
        try {
            const u = new URL(baseUrl, location.href);
            const cur = Number(u.searchParams.get(pageParam));
            if (isFinite(cur) && cur > 0) startPage = cur;
        } catch (e) { }

        const maxPages = 40;
        let page = startPage + 1;

        while (page <= startPage + maxPages) {
            const next = withPageParam(baseUrl, pageParam, page);
            if (!next) break;
            let text = '';
            try {
                const resp = await f.call(window, next, {
                    method: 'GET',
                    credentials: 'include',
                    headers: { 'Accept': 'application/json, text/plain, */*' }
                });
                if (!resp || !resp.ok) break;
                const ct = (resp.headers && resp.headers.get('content-type')) || '';
                if (!/json|text\/plain/i.test(ct)) break;
                text = await resp.text();
                if (!text || text.length > MAX_PARSE_SIZE) break;
            } catch (e) { break; }

            let data;
            try { data = JSON.parse(text); } catch (e) { break; }

            const before = STATE.resources.length;
            deepExtract(data, 0, { added: 0 });
            const gained = STATE.resources.length - before;
            added += gained;

            // 收敛：没有新增就停（参数名不匹配时第二页即停止）
            if (gained === 0) break;
            // 已知总条数时，够了就停
            if (total > 0 && STATE.resources.length >= total) break;

            page++;
        }

        if (added > 0) {
            addLog(`自动翻页新增 ${added} 个（累计 ${STATE.resources.length}）`, 'success');
            refreshUI();
        }
        return added;
    }

    async function replayApiRequests() {
        if (STATE.replaying) return 0;
        const urls = replayCandidates();
        if (!urls.length) return 0;

        STATE.replaying = true;
        const f = ORIG_FETCH || window.fetch;
        let added = 0;
        let tried = 0;

        try {
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                try {
                    const resp = await f.call(window, url, {
                        method: 'GET',
                        credentials: 'include',
                        headers: { 'Accept': 'application/json, text/plain, */*' }
                    });
                    if (!resp || !resp.ok) continue;
                    const ct = (resp.headers && resp.headers.get('content-type')) || '';
                    if (!/json|text\/plain/i.test(ct)) continue;
                    const cl = resp.headers.get('content-length');
                    if (cl && parseInt(cl, 10) > MAX_PARSE_SIZE) continue;
                    const text = await resp.text();
                    if (!text || text.length > MAX_PARSE_SIZE) continue;
                    tried++;
                    let data;
                    try { data = JSON.parse(text); } catch (e) { continue; }
                    const before = STATE.resources.length;
                    const stats = { added: 0 };
                    deepExtract(data, 0, stats);
                    const gained = STATE.resources.length - before;
                    added += gained;

                    // 有收获的列表接口 → 自动翻页取全（解决需手动翻页）
                    if (gained > 0) {
                        const pageAdded = await paginateAndCollect(url, data);
                        added += pageAdded;
                    }
                } catch (e) { /* 单个接口失败不影响整体 */ }
            }
        } finally {
            STATE.replaying = false;
        }

        if (added > 0) {
            addLog(`接口回放成功，新增 ${added} 个资源`, 'success');
            refreshUI();
        }
        return added;
    }

    /* ------------------------------------------------------------------ *
     * 预览地址捕获（v4.2 新增，解决单元页抓不到文件）
     *
     * 单元页接口只返回文件名 + 资源 id，真实地址是前端点击「查看」时才拼出来的：
     *   https://docs.ulearning.cn/?time=1&ssl=1&furl=
     *       https%3A%2F%2Fuobs.dgut.edu.cn%2Fview%2Fresources%2Fweb%2F{id}.pdf
     * 注意真实域名是 uobs.dgut.edu.cn（不是 lms.dgut.edu.cn）。
     * 所以这里从 iframe / embed / a 的 src 里解出 furl。
     * ------------------------------------------------------------------ */
    const FILE_TEXT_RE = /\.(pdf|docx?|pptx?|xlsx?|zip|rar|7z|mp4|mp3|m4a|txt|csv)(\b|$)/i;

    function decodeFurl(u) {
        if (!u) return '';
        try {
            const url = new URL(u, location.href);
            const furl = url.searchParams.get('furl');
            if (furl) return decodeURIComponent(furl);
        } catch (e) { }
        return '';
    }

    /** 健壮取可见文本：innerText 可能不可用（如某些沙箱/渲染环境），用 textContent 兜底 */
    function visibleText(el) {
        if (!el) return '';
        let t = '';
        try { t = el.innerText; } catch (e) { t = ''; }
        if (!t) { try { t = el.textContent; } catch (e) { t = ''; } }
        return String(t || '').replace(/\s+/g, ' ').trim();
    }

    /** 在元素附近找文件名（预览弹层里标题与 iframe 同属一个容器） */
    function nameNearElement(el) {
        let node = el;
        for (let up = 0; up < 8 && node; up++) {
            try {
                const cands = node.querySelectorAll(
                    'h1,h2,h3,h4,h5,.title,[class*="title"],[class*="name"],[class*="Title"],[class*="Name"]');
                for (let i = 0; i < cands.length; i++) {
                    const t = visibleText(cands[i]);
                    if (t && t.length <= 120 && FILE_TEXT_RE.test(t)) return t;
                }
                const txt = visibleText(node);
                if (txt && txt.length <= 200) {
                    const m = txt.match(new RegExp('[^\\n]{0,80}' + FILE_TEXT_RE.source, 'i'));
                    if (m) return m[0].trim();
                }
            } catch (e) { }
            node = node.parentElement;
        }
        return '';
    }

    /** 扫描页面中已出现的预览地址 */
    function captureFromFrameSources(forcedName) {
        if (!document.body) return 0;
        let added = 0;
        let nodes = [];
        try {
            nodes = document.body.querySelectorAll('iframe[src], embed[src], object[data], a[href], video[src], source[src]');
        } catch (e) { return 0; }

        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const raw = el.getAttribute('src') || el.getAttribute('data') || el.getAttribute('href') || '';
            if (!raw) continue;
            const real = decodeFurl(raw)
                || (/uobs\.dgut\.edu\.cn\/view\/resources\//i.test(raw) ? raw : '');
            if (!real) continue;
            const name = forcedName || nameNearElement(el);
            if (addResource(name, real, 'frame')) added++;
        }
        if (added > 0) refreshUI();
        return added;
    }

    /**
     * 自动补全单元文件：逐个点「查看」→ 抓 iframe 的 furl → 关掉预览。
     * 提示：该操作等同于你自己点开文件，会在学习记录里标记为「已查看」。
     */
    function collectViewButtons() {
        if (!document.body) return [];
        const out = [];
        let btns = [];
        try { btns = document.body.querySelectorAll('button'); } catch (e) { return out; }

        for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            if (isOwnNode(b)) continue;
            const t = (b.textContent || '').trim();
            if (t !== '查看') continue;
            // 向上找包含文件名的卡片
            let card = b;
            let name = '';
            for (let up = 0; up < 8 && card; up++) {
                const txt = visibleText(card);
                if (FILE_TEXT_RE.test(txt)) {
                    name = nameNearElement(card);
                    if (!name) {
                        // 兜底：从卡片整段文本里截出"xxx.pdf"这一段
                        const m = txt.match(new RegExp('[^\\s|/\\\\]{0,80}' + FILE_TEXT_RE.source, 'i'));
                        name = m ? m[0].trim() : '';
                    }
                    if (name) break;
                }
                card = card.parentElement;
            }
            if (!name) continue;
            out.push({ btn: b, name: name });
        }
        return out;
    }

    function hasResourceByName(name) {
        const target = sanitizeName(name).toLowerCase();
        return STATE.resources.some(r => (r.pureName || '').toLowerCase() === target);
    }

    function closePreview() {
        let btns = [];
        try { btns = document.querySelectorAll('button'); } catch (e) { return; }
        for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            if (isOwnNode(b)) continue;
            if ((b.textContent || '').trim() === '关闭') {
                try { b.click(); } catch (e) { }
                return;
            }
        }
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    /** 找文本恰好等于目标文案的最深层元素（用于点「展开全部单元」） */
    function findTextElement(text) {
        if (!document.body) return null;
        let nodes = [];
        try {
            nodes = document.body.querySelectorAll('div,span,a,button,li,label,p,i,em,strong');
        } catch (e) { return null; }
        let best = null, bestKids = Infinity;
        const limit = Math.min(nodes.length, 6000);
        for (let i = 0; i < limit; i++) {
            const el = nodes[i];
            if (isOwnNode(el)) continue;
            if (visibleText(el) !== text) continue;
            let k = 0;
            try { k = el.querySelectorAll('*').length; } catch (e) { k = 9999; }
            if (k < bestKids) { bestKids = k; best = el; }
        }
        return best;
    }

    /** 该区域内是否已有「查看」按钮 */
    function hasViewButton(el) {
        let btns = [];
        try { btns = el.querySelectorAll('button'); } catch (e) { return false; }
        for (let i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').trim() === '查看') return true;
        }
        return false;
    }

    /**
     * 点开仍折叠的单元：显示「N个活动」但区域内没有「查看」按钮。
     * 只点最深的那一层，避免父子同时点导致又收起来。
     */
    /** 点「展开全部单元」的开关本体（现场实测：点文字标签无效，需点 switch） */
    function clickExpandAllSwitch() {
        const label = findTextElement('展开全部单元') || findTextElement('展开所有单元');
        if (!label) return false;

        let scope = label.parentElement;
        for (let up = 0; up < 3 && scope; up++) {
            let cands = [];
            try {
                cands = scope.querySelectorAll(
                    '[class*="switch"], [class*="Switch"], input[type="checkbox"]');
            } catch (e) { cands = []; }
            for (let i = 0; i < cands.length; i++) {
                if (isOwnNode(cands[i])) continue;
                try { cands[i].click(); return true; } catch (e) { }
            }
            scope = scope.parentElement;
        }
        try { label.click(); return true; } catch (e) { }
        try { if (label.parentElement) { label.parentElement.click(); return true; } } catch (e) { }
        return false;
    }

    /** 当前页面上「查看」按钮总数（用于验证展开是否真的生效，不受重渲染影响） */
    function globalViewCount() {
        if (!document.body) return 0;
        let n = 0;
        let btns = [];
        try { btns = document.body.querySelectorAll('button'); } catch (e) { return 0; }
        for (let i = 0; i < btns.length; i++) {
            if (isOwnNode(btns[i])) continue;
            if ((btns[i].textContent || '').trim() === '查看') n++;
        }
        return n;
    }

    /**
     * 该标题块所属单元是否已展开。
     * 注意：不能一路向上遍历到整页容器——页面里其他已展开单元也有「查看」按钮，
     * 会把所有折叠章节误判为已展开，导致一个都点不开。
     * 因此只在「仅包含一个单元」的作用域内判断。
     */
    function isUnitExpanded(el) {
        if (!el) return false;

        // 1) 自身子树里有「查看」→ 已展开
        if (hasViewButton(el)) return true;

        // 2) 向上找第一个「只含一个单元」的容器
        let p = el.parentElement;
        for (let i = 0; i < 3 && p; i++) {
            const hits = (String(p.textContent || '').match(/个活动/g) || []).length;
            if (hits <= 1) return hasViewButton(p);
            p = p.parentElement; // 已跨到多单元范围，停止判断
        }
        return false;
    }

    /** 扫描当前所有仍折叠的单元标题块（每次调用都基于最新 DOM） */
    function collapsedCandidates() {
        if (!document.body) return [];
        let nodes = [];
        try { nodes = document.body.querySelectorAll('div,section,li'); } catch (e) { return []; }

        const cands = [];
        const limit = Math.min(nodes.length, 4000);
        for (let i = 0; i < limit; i++) {
            const el = nodes[i];
            if (isOwnNode(el)) continue;
            const t = visibleText(el);
            if (!t || t.length > 80) continue;
            if (!/个活动/.test(t)) continue;
            if (/^\d+个活动$/.test(t)) continue;
            if (isUnitExpanded(el)) continue;
            cands.push({ el: el, title: t });
        }
        // 只留最深一层
        return cands.filter(c => !cands.some(o => o !== c && c.el.contains(o.el)));
    }

    /**
     * 逐个点开仍折叠的单元。
     * 关键：点击后页面可能整体重渲染，元素引用会失效，
     * 因此用「全局查看按钮数是否增加」来判断是否成功，而不依赖元素本身。
     */
    /**
     * 逐个点开仍折叠的单元。
     * 站点点击后会整体重渲染，元素引用会失效，因此：
     *  1) 每轮都重新扫描最新 DOM；
     *  2) 用「每个标题只尝试一次」避免把刚展开的又点回去（来回震荡）；
     *  3) 用全局「查看」按钮数是否增加来判定是否真的展开成功。
     */
    async function clickCollapsedUnits() {
        let opened = 0;
        const tried = {};

        for (let guard = 0; guard < 80; guard++) {
            const cands = collapsedCandidates();
            const next = cands.filter(c => !tried[c.title])[0];
            if (!next) break;

            tried[next.title] = 1;
            const before = globalViewCount();
            let ok = false;

            // 依次尝试 3 种点击目标（每次都基于当前最新元素）
            const targets = [];
            const el = next.el;
            targets.push(el);
            try { if (el.firstElementChild) targets.push(el.firstElementChild); } catch (e) { }
            try {
                const par = el.parentElement;
                if (par && par.firstElementChild && par.firstElementChild !== el) {
                    targets.push(par.firstElementChild);
                }
            } catch (e) { }

            for (let t = 0; t < targets.length; t++) {
                try { targets[t].click(); } catch (e) { continue; }
                await sleep(650);
                if (globalViewCount() > before) { ok = true; break; }
            }

            if (ok) opened++;
        }
        return opened;
    }

    /** 展开全部单元：先尝试开关，再逐个点开折叠章节 */
    async function expandAllUnitsDeep() {
        if (clickExpandAllSwitch()) await sleep(1300);

        let lastCount = -1;
        for (let round = 0; round < 15; round++) {
            const n = globalViewCount();
            const opened = await clickCollapsedUnits();
            if (!opened && n === lastCount) break;
            lastCount = globalViewCount();
            if (!opened) break;
            await sleep(600);
        }
        return globalViewCount();
    }

    async function autoFillUnitFiles() {
        if (STATE.filling) return showToast('正在补全中…');
        STATE.filling = true;

        let got = 0, tried = 0;
        const processed = {};

        try {
            showToast('正在展开全部单元…');
            addLog('正在展开全部单元…', 'info');
            const visible = await expandAllUnitsDeep();
            addLog(`展开后可见 ${visible} 个「查看」按钮`, 'info');

            for (let pass = 0; pass < 12; pass++) {
                const cards = collectViewButtons();
                const todo = cards.filter(c => !hasResourceByName(c.name) && !processed[c.name]);

                if (!todo.length) {
                    const opened = await clickCollapsedUnits();
                    if (!opened) break;
                    await sleep(800);
                    continue;
                }

                addLog(`第 ${pass + 1} 轮：待处理 ${todo.length} 个`, 'info');

                for (let i = 0; i < todo.length; i++) {
                    const c = todo[i];
                    processed[c.name] = 1;
                    if (hasResourceByName(c.name)) continue;
                    if (tried >= 400) break;
                    tried++;

                    STATE.pendingName = c.name;
                    try { c.btn.click(); } catch (e) { continue; }
                    await sleep(900);

                    let n = captureFromFrameSources(c.name);
                    if (n === 0 && hasResourceByName(c.name)) n = 1;
                    if (n > 0) {
                        got += n;
                        addLog(`已获取 ${c.name}`, 'success');
                        showToast(`已获取 ${got} 个文件…`);
                    }
                    closePreview();
                    await sleep(300);
                }

                const opened = await clickCollapsedUnits();
                if (opened) await sleep(700);
            }
        } finally {
            STATE.filling = false;
            refreshUI();
        }

        showToast(got > 0 ? `补全完成，新增 ${got} 个文件` : '未获取到新文件');
        addLog(`补全结束：新增 ${got} 个（累计 ${STATE.resources.length}）`, got > 0 ? 'success' : 'warn');
    }

    /* ------------------------------------------------------------------ *
     * 分页自动展开（解决资源页需手动翻页）
     * ------------------------------------------------------------------ */
    const PAGE_KEYS = ['page', 'pageno', 'pagenum', 'pageindex', 'current', 'currentpage', 'pn'];
    const TOTAL_KEYS = ['total', 'totalcount', 'totalnum', 'recordstotal', 'count',
        'rowcount', 'totalelements', 'allcount', 'totalpage'];

    function deepNumberByKey(data, keys, depth) {
        if (!data || typeof data !== 'object' || depth > 8) return 0;
        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                const r = deepNumberByKey(data[i], keys, depth + 1);
                if (r) return r;
            }
            return 0;
        }
        for (const k in data) {
            const lk = String(k).toLowerCase();
            if (keys.indexOf(lk) >= 0) {
                const v = Number(data[k]);
                if (isFinite(v) && v > 0) return v;
            }
            const v = data[k];
            if (v && typeof v === 'object') {
                const r = deepNumberByKey(v, keys, depth + 1);
                if (r) return r;
            }
        }
        return 0;
    }

    function detectPageParam(rawUrl) {
        try {
            const u = new URL(rawUrl, location.href);
            const names = [];
            u.searchParams.forEach((v, k) => names.push(k));
            for (let i = 0; i < names.length; i++) {
                if (PAGE_KEYS.indexOf(names[i].toLowerCase()) >= 0) return names[i];
            }
        } catch (e) { }
        return '';
    }

    function withPageParam(rawUrl, name, value) {
        try {
            const u = new URL(rawUrl, location.href);
            u.searchParams.set(name, String(value));
            return u.href;
        } catch (e) { return ''; }
    }

    /** 三路合并扫描 */
    function fullScan() {
        let added = 0;
        added += scanPerformanceEntries();
        try { added += scanDom(); } catch (e) { }
        if (added > 0) addLog(`扫描新增 ${added} 个资源（共 ${STATE.resources.length}）`, 'success');
        refreshUI();

        // 同步扫描拿不到地址的文件（单元页 PDF），靠回放接口补齐
        replayApiRequests();
        return added;
    }

    // 立刻执行 init（document-start 下 readyState 仍是 loading，
    // 若在此等待 DOMContentLoaded，拦截器就又装晚了 —— 这正是 v4.0 抓不到单元页文件的根因）。
    // init 内部已自行处理 body 尚未存在的建 UI 时机。
    try {
        init();
    } catch (e) {
        // 极端情况下（如 document-start 时 location 异常）延迟再试一次
        try { document.addEventListener('DOMContentLoaded', init, { once: true }); } catch (e2) { }
    }
})();
