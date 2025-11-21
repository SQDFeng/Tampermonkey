// ==UserScript==
// @name         夸克网盘Cookie提取器
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  提取夸克网盘的Cookie
// @author       Cookie Extractor
// @match        https://pan.quark.cn/*
// @grant        GM_setClipboard
// @grant        GM_notification
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        .cookie-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff;
            border: 2px solid #1890ff;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: system-ui, sans-serif;
            max-width: 500px;
            min-width: 350px;
            cursor: move;
        }
        .cookie-panel h3 {
            margin: 0 0 10px 0;
            color: #1890ff;
            font-size: 16px;
            border-bottom: 1px solid #eee;
            padding-bottom: 8px;
            cursor: move;
        }
        .cookie-content {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 10px;
            margin: 10px 0;
            max-height: 200px;
            overflow-y: auto;
            word-break: break-all;
            font-size: 12px;
            line-height: 1.4;
            user-select: text;
        }
        .cookie-buttons {
            display: flex;
            gap: 8px;
        }
        .cookie-btn {
            flex: 1;
            padding: 8px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .copy-btn { background: #1890ff; color: white; }
        .copy-btn:hover { background: #096dd9; }
        .close-btn { background: #f5f5f5; color: #666; }
        .close-btn:hover { background: #e8e8e8; }
        .cookie-status {
            font-size: 12px;
            margin-top: 8px;
            text-align: center;
        }
        .monitoring-status {
            font-size: 11px;
            margin-bottom: 8px;
        }
    `;
    document.head.appendChild(style);

    let extractedCookies = null;

    function createCookiePanel() {
        const panel = document.createElement('div');
        panel.className = 'cookie-panel';
        panel.innerHTML = `
            <h3>夸克网盘Cookie提取器</h3>
            <div class="monitoring-status" id="monitoringStatus">监控中...</div>
            <div class="cookie-content" id="cookieContent">等待Cookie...</div>
            <div class="cookie-buttons">
                <button class="cookie-btn copy-btn" id="copyCookie">复制</button>
                <button class="cookie-btn close-btn" id="closePanel">关闭</button>
            </div>
            <div class="cookie-status" id="cookieStatus">等待包含Cookie的请求</div>
        `;
        document.body.appendChild(panel);

        makeDraggable(panel);

        panel.querySelector('#copyCookie').addEventListener('click', copyCookie);
        panel.querySelector('#closePanel').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        startMonitoring();
    }

    function makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = element.querySelector('h3');

        header.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = "auto";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    function startMonitoring() {
        let lastCookie = document.cookie;

        const checkInterval = setInterval(() => {
            const currentCookie = document.cookie;
            if (currentCookie !== lastCookie) {
                lastCookie = currentCookie;
                checkForCookies();
            }
            checkForCookies();
        }, 500);
    }

    function checkForCookies() {
        const cookies = document.cookie;
        const quarkCookies = ['QC005', 'QC006', 'QUTH', 'token', 'sid'];
        const hasQuarkCookies = quarkCookies.some(cookie => cookies.includes(cookie));

        if (hasQuarkCookies && cookies.length > 10) {
            extractedCookies = cookies;
            updatePanel(cookies, `已找到Cookie (${cookies.split(';').length}个)`);
        }
    }

    function updatePanel(cookies, status) {
        const contentElement = document.getElementById('cookieContent');
        const statusElement = document.getElementById('cookieStatus');
        const monitoringElement = document.getElementById('monitoringStatus');

        if (contentElement && statusElement && monitoringElement) {
            contentElement.textContent = cookies;
            statusElement.textContent = status;
            statusElement.style.color = '#52c41a';
            monitoringElement.textContent = 'Cookie已获取';
            monitoringElement.style.color = '#52c41a';
        }
    }

    function copyCookie() {
        if (extractedCookies) {
            GM_setClipboard(extractedCookies, 'text')
                .then(() => {
                    const statusElement = document.getElementById('cookieStatus');
                    statusElement.textContent = '已复制到剪贴板';
                    statusElement.style.color = '#52c41a';

                    GM_notification({
                        text: 'Cookie已复制',
                        title: '夸克网盘',
                        timeout: 2000
                    });
                })
                .catch(err => {
                    const statusElement = document.getElementById('cookieStatus');
                    statusElement.textContent = '复制失败';
                    statusElement.style.color = '#ff4d4f';
                });
        }
    }

    function init() {
        setTimeout(() => {
            if (!document.querySelector('.cookie-panel')) {
                createCookiePanel();
            }
        }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    let currentUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== currentUrl) {
            currentUrl = window.location.href;
            if (!document.querySelector('.cookie-panel')) {
                setTimeout(createCookiePanel, 1000);
            }
        }
    }, 1000);

    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'C') {
            e.preventDefault();
            const panel = document.querySelector('.cookie-panel');
            if (panel) {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            } else {
                createCookiePanel();
            }
        }
    });
})();
