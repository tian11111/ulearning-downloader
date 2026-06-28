// ==UserScript==
// @name         优学院资源批量下载
// @namespace    https://github.com/Neco
// @version      3.9.0
// @description  批量下载优学院课程资源
// @author       Neco
// @match        *://*.ulearning.cn/*
// @match        *://ua.ulearning.cn/*
// @match        *://docs.ulearning.cn/*
// @match        *://lms.dgut.edu.cn/*
// @match        *://*.dgut.edu.cn/*
// @match        *://ua.dgut.edu.cn/*
// @match        *://uobs.dgut.edu.cn/*
// @grant        GM_download
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    let interceptedResources = [];
    let currentFilter = 'all';
    let panelVisible = false;
    let logVisible = false;
    let downloadDelay = 500;
    const logs = [];

    function addLog(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const icons = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌', debug: '🔍' };
        logs.push({ time, msg, type, icon: icons[type] || 'ℹ️' });
        if (logs.length > 200) logs.shift();
        if (logVisible) renderLogs();
    }

    function renderLogs() {
        const logBody = document.getElementById('ulearn-log-body');
        if (!logBody) return;
        logBody.innerHTML = logs.map(l => `
            <div style="padding: 3px 6px; margin-bottom: 1px; border-radius: 3px; font-size: 11px; background: ${l.type === 'success' ? 'rgba(74,222,128,0.1)' : l.type === 'error' ? 'rgba(243,139,168,0.1)' : 'rgba(255,255,255,0.05)'};">
                <span style="color: #6c7086;">${l.time}</span> ${l.icon} ${l.msg}
            </div>
        `).join('');
        logBody.scrollTop = logBody.scrollHeight;
    }

    // 拦截网络请求
    function setupInterceptor() {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._url = url;
            return origOpen.apply(this, [method, url, ...args]);
        };

        XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
                processResponse(this._url, this.responseText);
            });
            return origSend.apply(this, args);
        };

        const origFetch = window.fetch;
        window.fetch = function(input, init) {
            const url = typeof input === 'string' ? input : input.url;
            return origFetch.apply(this, arguments).then(response => {
                const cloned = response.clone();
                cloned.text().then(text => processResponse(url, text));
                return response;
            });
        };

        addLog('拦截器已启动', 'success');
    }

    function processResponse(url, body) {
        if (!url || !body) return;
        try {
            const data = JSON.parse(body);
            const before = interceptedResources.length;
            extractResources(data);
            if (interceptedResources.length > before) {
                addLog(`从请求中提取了 ${interceptedResources.length - before} 个资源`, 'success');
            }
        } catch (e) {}
    }

    function getFileType(name) {
        if (!name) return 'other';
        const ext = name.split('.').pop().toLowerCase();
        if (['pdf'].includes(ext)) return 'pdf';
        if (['doc', 'docx'].includes(ext)) return 'word';
        if (['ppt', 'pptx'].includes(ext)) return 'ppt';
        if (['xls', 'xlsx'].includes(ext)) return 'excel';
        if (['zip', 'rar', '7z'].includes(ext)) return 'zip';
        if (['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv'].includes(ext)) return 'video';
        if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio';
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) return 'image';
        if (['txt', 'md', 'csv', 'json', 'xml'].includes(ext)) return 'text';
        return 'other';
    }

    function getTypeIcon(type) {
        return { pdf: '📄', word: '📝', ppt: '📊', excel: '📈', zip: '📦', video: '🎬', audio: '🎵', image: '🖼️', text: '📃', other: '📎' }[type] || '📎';
    }

    function getTypeName(type) {
        return { pdf: 'PDF', word: 'Word', ppt: 'PPT', excel: 'Excel', zip: '压缩包', video: '视频', audio: '音频', image: '图片', text: '文本', other: '其他' }[type] || '其他';
    }

    function extractResources(data) {
        if (!data || typeof data !== 'object') return;

        if (Array.isArray(data)) {
            data.forEach(item => extractResources(item));
            return;
        }

        if (data.list && Array.isArray(data.list)) {
            data.list.forEach(item => {
                if (item.location && typeof item.location === 'string') {
                    addResource(item.title || '', item.location);
                }
            });
            return;
        }

        if (data.title && data.location && typeof data.location === 'string') {
            addResource(data.title, data.location);
            return;
        }

        Object.values(data).forEach(val => {
            if (val && typeof val === 'object') extractResources(val);
        });
    }

    function addResource(title, location) {
        let url = location;
        if (!url.startsWith('http')) {
            if (url.startsWith('resources/')) {
                url = window.location.origin + '/uobs/view/' + url;
            } else {
                url = window.location.origin + (url.startsWith('/') ? '' : '/') + url;
            }
        }

        const pureName = title.split('/').pop() || url.split('/').pop().split('?')[0] || '未知文件';
        const type = getFileType(pureName);

        if (!interceptedResources.find(r => r.url === url)) {
            interceptedResources.push({ name: title || pureName, pureName, url, type });
            if (panelVisible) updateUI();
        }
    }

    // 扫描页面上的所有链接
    function scanPageLinks() {
        addLog('扫描页面链接...', 'info');
        const links = document.querySelectorAll('a[href]');
        let found = 0;

        links.forEach(link => {
            const href = link.href || '';
            const text = link.textContent.trim();

            if (href.includes('/uobs/view/resources/') ||
                href.includes('/resources/') ||
                href.endsWith('.pdf') ||
                href.endsWith('.pptx') ||
                href.endsWith('.docx') ||
                href.endsWith('.xlsx')) {
                if (text && href) {
                    addResource(text, href);
                    found++;
                }
            }
        });

        addLog(`从页面找到 ${found} 个资源链接`, found > 0 ? 'success' : 'info');
        return found;
    }

    // 监听DOM变化
    function setupDOMObserver() {
        const observer = new MutationObserver(() => {
            // 每次DOM变化时扫描链接
            scanPageLinks();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    let downloading = false;

    function downloadFile(resource) {
        return new Promise((resolve) => {
            const fileName = resource.pureName || resource.name;

            // 用 GM_xmlhttpRequest 获取文件为 Blob，绕过跨域限制
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: resource.url,
                    responseType: 'blob',
                    onload: function(response) {
                        try {
                            const blob = response.response;
                            const blobUrl = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = blobUrl;
                            a.download = fileName;
                            a.style.display = 'none';
                            document.body.appendChild(a);
                            a.click();
                            setTimeout(() => {
                                document.body.removeChild(a);
                                URL.revokeObjectURL(blobUrl);
                            }, 1000);
                            addLog(`✅ 下载成功: ${fileName}`, 'success');
                        } catch (e) {
                            addLog(`❌ 下载失败: ${fileName} - ${e.message}`, 'error');
                        }
                        resolve();
                    },
                    onerror: function(err) {
                        addLog(`❌ 下载失败: ${fileName}`, 'error');
                        // 降级：尝试直接打开
                        try {
                            window.open(resource.url + '&attname=' + encodeURIComponent(fileName), '_blank');
                        } catch (e) {}
                        resolve();
                    },
                    ontimeout: function() {
                        addLog(`❌ 下载超时: ${fileName}`, 'error');
                        resolve();
                    }
                });
            } else {
                // 降级方案：直接用 a 标签
                const a = document.createElement('a');
                a.href = resource.url;
                a.download = fileName;
                a.target = '_blank';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => document.body.removeChild(a), 1000);
                resolve();
            }
        });
    }

    async function downloadMultiple(resources) {
        if (downloading) {
            showToast('正在下载中，请等待...');
            return;
        }
        downloading = true;
        showToast(`开始下载 ${resources.length} 个文件`);

        for (let i = 0; i < resources.length; i++) {
            const r = resources[i];
            addLog(`⬇️ [${i + 1}/${resources.length}] ${r.pureName || r.name}`, 'info');
            await downloadFile(r);
            // 每个文件间隔 1.5 秒，避免浏览器拦截
            if (i < resources.length - 1) {
                await new Promise(resolve => setTimeout(resolve, downloadDelay));
            }
        }

        downloading = false;
        showToast(`下载完成 ${resources.length} 个文件`);
        addLog(`✅ 全部下载完成`, 'success');
    }

    function createPanel() {
        const floatBtn = document.createElement('div');
        floatBtn.id = 'ulearn-float';
        floatBtn.innerHTML = '📥';
        floatBtn.style.cssText = 'position: fixed; top: 20px; right: 20px; width: 48px; height: 48px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; cursor: pointer; z-index: 999999; box-shadow: 0 4px 16px rgba(0,0,0,0.3);';

        const badge = document.createElement('div');
        badge.id = 'ulearn-badge';
        badge.style.cssText = 'position: absolute; top: -6px; right: -6px; background: #f38ba8; color: #1e1e2e; font-size: 10px; font-weight: 700; min-width: 18px; height: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; padding: 0 4px;';
        badge.textContent = '0';
        floatBtn.appendChild(badge);

        const panel = document.createElement('div');
        panel.id = 'ulearn-panel';
        panel.style.cssText = 'position: fixed; top: 80px; right: 20px; width: 380px; max-height: 80vh; background: #1e1e2e; border: 1px solid #45475a; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); z-index: 999998; font-family: -apple-system, sans-serif; color: #cdd6f4; overflow: hidden; display: none; flex-direction: column;';

        panel.innerHTML = `
            <div id="ulearn-header" style="padding: 12px 16px; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; justify-content: space-between; align-items: center; cursor: move;">
                <span style="font-weight: 600;">📥 优学院下载器</span>
                <div style="display: flex; gap: 6px;">
                    <button id="ulearn-log-btn" style="background: rgba(255,255,255,0.2); border: none; color: #fff; padding: 4px 10px; border-radius: 12px; cursor: pointer; font-size: 12px;">📋</button>
                    <button id="ulearn-close" style="background: rgba(255,255,255,0.2); border: none; color: #fff; width: 24px; height: 24px; border-radius: 50%; cursor: pointer;">×</button>
                </div>
            </div>
            <div style="padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: calc(80vh - 50px);">
                <div style="text-align: center;">已捕获 <strong id="ulearn-total" style="font-size: 20px; color: #89b4fa;">0</strong> 个资源</div>

                <button id="ulearn-scan" style="padding: 10px; background: #a6e3a1; color: #1e1e2e; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    🔍 扫描页面资源
                </button>

                <div style="background: #313244; border-radius: 8px; padding: 10px; font-size: 12px; color: #a6adc8;">
                    💡 请手动点击页面上的文件夹展开内容，脚本会自动捕获资源链接
                </div>

                <div id="ulearn-filters" style="display: flex; flex-wrap: wrap; gap: 6px;">
                    <button class="ulearn-filter active" data-type="all">全部</button>
                    <button class="ulearn-filter" data-type="pdf">📄 PDF</button>
                    <button class="ulearn-filter" data-type="word">📝 Word</button>
                    <button class="ulearn-filter" data-type="ppt">📊 PPT</button>
                    <button class="ulearn-filter" data-type="excel">📈 Excel</button>
                    <button class="ulearn-filter" data-type="image">🖼️ 图片</button>
                    <button class="ulearn-filter" data-type="video">🎬 视频</button>
                    <button class="ulearn-filter" data-type="zip">📦 压缩包</button>
                </div>

                <div id="ulearn-list" style="max-height: 300px; overflow-y: auto; background: #181825; border-radius: 8px; padding: 8px;">
                    <div style="text-align: center; padding: 20px; color: #6c7086;">暂无资源，点击扫描按钮...</div>
                </div>

                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button id="ulearn-dl-all" class="ulearn-btn primary" disabled>下载全部</button>
                    <button id="ulearn-dl-sel" class="ulearn-btn primary" disabled>下载选中</button>
                    <button id="ulearn-copy" class="ulearn-btn secondary">复制链接</button>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a6adc8;">
                    <span>下载间隔：</span>
                    <select id="ulearn-delay" style="background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;">
                        <option value="0">无间隔</option>
                        <option value="500" selected>0.5秒</option>
                        <option value="1000">1秒</option>
                        <option value="1500">1.5秒</option>
                        <option value="2000">2秒</option>
                        <option value="3000">3秒</option>
                    </select>
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                        <input type="checkbox" id="ulearn-sel-all" checked> 全选
                    </label>
                </div>

                <div id="ulearn-log-panel" style="display: none; max-height: 150px; overflow-y: auto; background: #181825; border-radius: 8px; padding: 6px;">
                    <div id="ulearn-log-body"></div>
                </div>
            </div>
        `;

        document.body.appendChild(floatBtn);
        document.body.appendChild(panel);

        const style = document.createElement('style');
        style.textContent = `
            .ulearn-filter { padding: 4px 10px; background: #313244; border: 1px solid #45475a; border-radius: 16px; color: #cdd6f4; font-size: 12px; cursor: pointer; }
            .ulearn-filter.active { background: #89b4fa; color: #1e1e2e; border-color: #89b4fa; }
            .ulearn-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin-bottom: 3px; background: #1e1e2e; border-radius: 6px; font-size: 12px; cursor: pointer; }
            .ulearn-item:hover { background: #313244; }
            .ulearn-btn { padding: 8px 14px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; flex: 1; }
            .ulearn-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .ulearn-btn.primary { background: #89b4fa; color: #1e1e2e; }
            .ulearn-btn.secondary { background: #45475a; color: #cdd6f4; }
            .ulearn-toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: #313244; color: #cdd6f4; padding: 10px 20px; border-radius: 8px; z-index: 9999999; }
        `;
        document.head.appendChild(style);

        return { floatBtn, panel };
    }

    function filteredResources() {
        return currentFilter === 'all' ? interceptedResources : interceptedResources.filter(r => r.type === currentFilter);
    }

    function updateUI() {
        document.getElementById('ulearn-total').textContent = filteredResources().length;
        document.getElementById('ulearn-badge').textContent = interceptedResources.length;
        document.getElementById('ulearn-dl-all').disabled = interceptedResources.length === 0;
        updateList();
    }

    function updateList() {
        const list = document.getElementById('ulearn-list');
        const resources = filteredResources();

        if (resources.length === 0) {
            list.innerHTML = '<div style="text-align: center; padding: 20px; color: #6c7086;">暂无资源</div>';
            return;
        }

        list.innerHTML = resources.map((r, i) => {
            const idx = interceptedResources.indexOf(r);
            return `<div class="ulearn-item">
                <input type="checkbox" class="ulearn-cb" data-idx="${idx}" checked>
                <span>${getTypeIcon(r.type)}</span>
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r.name}">${r.name}</span>
                <span style="font-size:10px; padding:2px 6px; background:#313244; border-radius:4px; color:#a6adc8;">${getTypeName(r.type)}</span>
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
        const count = document.querySelectorAll('.ulearn-cb:checked').length;
        const btn = document.getElementById('ulearn-dl-sel');
        btn.disabled = count === 0;
        btn.textContent = count > 0 ? `下载选中 (${count})` : '下载选中';
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.className = 'ulearn-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    function init() {
        setupInterceptor();
        setupDOMObserver();
        const { floatBtn, panel } = createPanel();

        // 按钮拖拽 + 点击切换
        let btnDrag = false, btnMoved = false, btnSx, btnSy, btnOrigLeft, btnOrigTop;
        floatBtn.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            btnDrag = true;
            btnMoved = false;
            btnSx = e.clientX;
            btnSy = e.clientY;
            const rect = floatBtn.getBoundingClientRect();
            btnOrigLeft = rect.left;
            btnOrigTop = rect.top;
            // 切换到 left/top 定位
            floatBtn.style.right = 'auto';
            floatBtn.style.left = btnOrigLeft + 'px';
            floatBtn.style.top = btnOrigTop + 'px';
        });
        document.addEventListener('mousemove', e => {
            if (!btnDrag) return;
            const dx = e.clientX - btnSx;
            const dy = e.clientY - btnSy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) btnMoved = true;
            if (btnMoved) {
                floatBtn.style.left = (btnOrigLeft + dx) + 'px';
                floatBtn.style.top = (btnOrigTop + dy) + 'px';
            }
        });
        document.addEventListener('mouseup', e => {
            if (!btnDrag) return;
            btnDrag = false;
            if (!btnMoved) {
                // 点击行为
                panelVisible = !panelVisible;
                panel.style.display = panelVisible ? 'flex' : 'none';
                if (panelVisible) {
                    updateUI();
                    scanPageLinks();
                }
            }
        });

        document.getElementById('ulearn-close').addEventListener('click', () => {
            panel.style.display = 'none';
            panelVisible = false;
        });

        document.getElementById('ulearn-log-btn').addEventListener('click', () => {
            logVisible = !logVisible;
            document.getElementById('ulearn-log-panel').style.display = logVisible ? 'block' : 'none';
            if (logVisible) renderLogs();
        });

        document.getElementById('ulearn-scan').addEventListener('click', () => {
            scanPageLinks();
            updateUI();
        });

        document.getElementById('ulearn-filters').addEventListener('click', e => {
            if (!e.target.classList.contains('ulearn-filter')) return;
            document.querySelectorAll('.ulearn-filter').forEach(f => f.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.type;
            updateUI();
        });

        document.getElementById('ulearn-sel-all').addEventListener('change', e => {
            document.querySelectorAll('.ulearn-cb').forEach(cb => cb.checked = e.target.checked);
            updateSelBtn();
        });

        document.getElementById('ulearn-delay').addEventListener('change', e => {
            downloadDelay = parseInt(e.target.value);
        });

        document.getElementById('ulearn-dl-all').addEventListener('click', () => {
            const r = filteredResources();
            if (r.length) downloadMultiple(r);
        });

        document.getElementById('ulearn-dl-sel').addEventListener('click', () => {
            const checked = document.querySelectorAll('.ulearn-cb:checked');
            if (!checked.length) return;
            downloadMultiple(Array.from(checked).map(cb => interceptedResources[parseInt(cb.dataset.idx)]));
        });

        document.getElementById('ulearn-copy').addEventListener('click', () => {
            const checked = document.querySelectorAll('.ulearn-cb:checked');
            if (!checked.length) return showToast('请先选择要复制的资源');
            const resources = Array.from(checked).map(cb => interceptedResources[parseInt(cb.dataset.idx)]);
            navigator.clipboard.writeText(resources.map(x => x.url).join('\n'));
            showToast(`已复制 ${resources.length} 个链接`);
        });

        // 拖拽
        let isDragging = false, ox, oy;
        document.getElementById('ulearn-header').addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            ox = e.clientX - panel.offsetLeft;
            oy = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            panel.style.left = (e.clientX - ox) + 'px';
            panel.style.top = (e.clientY - oy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => isDragging = false);

        // 初始扫描
        setTimeout(scanPageLinks, 1000);
    }

    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
