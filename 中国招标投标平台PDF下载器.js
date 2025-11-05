// ==UserScript==
// @name         中国招标投标平台PDF下载器
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  使用多种策略确保PDF完整下载
// @author       You
// @match        *://*.cebpubservice.com/*
// @match        *://ctbpsp.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_setClipboard
// @connect      ctbpsp.com
// @connect      cebpubservice.com
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // 添加自定义CSS样式
    GM_addStyle(`
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        .pdf-download-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            color: white !important;
            border: none !important;
            padding: 10px 20px !important;
            border-radius: 5px !important;
            cursor: pointer !important;
            font-size: 14px !important;
            font-weight: bold !important;
            margin-left: 10px !important;
            transition: all 0.3s ease !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
        }
        .pdf-download-btn:hover {
            transform: translateY(-2px) !important;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3) !important;
        }
        .pdf-download-btn:active {
            transform: translateY(1px) !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
        }
        .pdf-download-btn:disabled {
            opacity: 0.6 !important;
            cursor: not-allowed !important;
        }
        .pdf-progress-overlay {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: rgba(0,0,0,0.8) !important;
            z-index: 99999 !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            align-items: center !important;
            color: white !important;
            font-family: Arial, sans-serif !important;
        }
        .pdf-progress-content {
            background: #333 !important;
            padding: 30px !important;
            border-radius: 10px !important;
            text-align: center !important;
            max-width: 500px !important;
            width: 90% !important;
        }
        .pdf-progress-bar {
            width: 100% !important;
            height: 20px !important;
            background: #555 !important;
            border-radius: 10px !important;
            margin: 20px 0 !important;
            overflow: hidden !important;
        }
        .pdf-progress-fill {
            height: 100% !important;
            background: linear-gradient(90deg, #4CAF50, #8BC34A) !important;
            transition: width 0.3s ease !important;
            width: 0% !important;
        }
    `);

    // 主函数
    function init() {
        // 等待页面完全加载
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', addDownloadButton);
        } else {
            setTimeout(addDownloadButton, 2000);
        }

        // 监听动态内容加载
        const observer = new MutationObserver(function(mutations) {
            const downloadContainer = document.querySelector('.download');
            const existingBtn = document.querySelector('.pdf-download-btn');

            if (downloadContainer && !existingBtn) {
                setTimeout(addDownloadButton, 1000);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function addDownloadButton() {
        const downloadContainer = document.querySelector('.download');
        if (!downloadContainer) return;

        if (downloadContainer.querySelector('.pdf-download-btn')) return;

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'pdf-download-btn';
        downloadBtn.innerHTML = '📥 高质量下载PDF';

        downloadBtn.addEventListener('click', function() {
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '⏳ 准备中...';
            startPDFDownload();
        });

        downloadContainer.appendChild(downloadBtn);
    }

    async function startPDFDownload() {
        try {
            // 显示进度覆盖层
            const progressOverlay = createProgressOverlay();

            // 获取PDF iframe
            const pdfIframe = await waitForElement('iframe.pdf-viewer', 10000);
            if (!pdfIframe) throw new Error('未找到PDF查看器');

            // 等待iframe加载
            await waitForIFrameLoad(pdfIframe);

            // 获取iframe文档
            const iframeDoc = pdfIframe.contentDocument || pdfIframe.contentWindow.document;

            // 获取PDF查看器和页面
            const pdfViewer = iframeDoc.querySelector('.pdfViewer');
            if (!pdfViewer) throw new Error('未找到PDF查看器容器');

            const pages = pdfViewer.querySelectorAll('.page');
            if (pages.length === 0) throw new Error('未找到PDF页面');

            updateProgress(progressOverlay, `找到 ${pages.length} 页，开始预加载...`, 10);

            // 策略1: 预加载所有页面
            await preloadAllPages(pdfViewer, pages, progressOverlay);

            // 策略2: 逐页捕获
            const PDF = new jspdf.jsPDF('p', 'mm', 'a4');
            const capturedPages = [];

            for (let i = 0; i < pages.length; i++) {
                const success = await capturePageWithRetry(PDF, pages, i, progressOverlay);
                capturedPages.push(success);

                const progress = 10 + Math.floor((i / pages.length) * 80);
                updateProgress(progressOverlay, `已处理 ${i + 1}/${pages.length} 页`, progress);
            }

            // 统计结果
            const successCount = capturedPages.filter(Boolean).length;

            // 保存PDF
            const titleElement = document.querySelector('.title_name');
            const fileName = titleElement ?
                `${titleElement.textContent.trim().substring(0, 50)}.pdf` :
                '招标文件.pdf';

            PDF.save(fileName);

            updateProgress(progressOverlay,
                `完成！成功捕获 ${successCount}/${pages.length} 页`, 100);

            // 显示完成通知
            GM_notification({
                text: `PDF下载完成！成功捕获 ${successCount}/${pages.length} 页`,
                title: 'PDF下载完成',
                timeout: 5000
            });

            // 恢复按钮状态
            setTimeout(() => {
                const downloadBtn = document.querySelector('.pdf-download-btn');
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.innerHTML = '📥 高质量下载PDF';
                }
                progressOverlay.remove();
            }, 3000);

        } catch (error) {
            console.error('PDF下载失败:', error);
            showErrorMessage('PDF下载失败: ' + error.message);

            // 恢复按钮状态
            const downloadBtn = document.querySelector('.pdf-download-btn');
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = '📥 高质量下载PDF';
            }
        }
    }

    // 预加载所有页面
    async function preloadAllPages(pdfViewer, pages, progressOverlay) {
        updateProgress(progressOverlay, '预加载所有页面...', 20);

        // 先滚动到每一页触发加载
        for (let i = 0; i < pages.length; i++) {
            await scrollToPage(pdfViewer, i);
            await wait(800); // 每页等待时间

            const progress = 20 + Math.floor((i / pages.length) * 20);
            updateProgress(progressOverlay, `预加载第 ${i + 1}/${pages.length} 页`, progress);
        }

        // 额外等待时间让所有页面完全加载
        updateProgress(progressOverlay, '等待页面完全渲染...', 40);
        await wait(3000);

        // 检查并重试未加载的页面
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
            const unloadedPages = [];

            for (let i = 0; i < pages.length; i++) {
                if (!isPageLoaded(pages[i])) {
                    unloadedPages.push(i);
                }
            }

            if (unloadedPages.length === 0) break;

            updateProgress(progressOverlay,
                `重试加载 ${unloadedPages.length} 个未完成页面 (${retryCount + 1}/${maxRetries})`,
                40 + (retryCount * 10));

            for (const pageIndex of unloadedPages) {
                await scrollToPage(pdfViewer, pageIndex);
                await wait(1000);
            }

            await wait(2000);
            retryCount++;
        }
    }

    // 带重试的页面捕获
    async function capturePageWithRetry(PDF, pages, pageIndex, progressOverlay) {
        const maxRetries = 3;

        for (let retry = 0; retry < maxRetries; retry++) {
            try {
                await scrollToPage(pages[0].parentNode, pageIndex);
                await waitForPageLoad(pages[pageIndex], 5000);

                // 额外等待确保稳定
                await wait(500 + (retry * 300));

                const canvas = await html2canvas(pages[pageIndex], {
                    useCORS: true,
                    allowTaint: false,
                    scale: 2,
                    logging: false,
                    backgroundColor: '#FFFFFF',
                    removeContainer: true,
                    onclone: function(clonedDoc, element) {
                        // 强制设置所有canvas为可见并已渲染状态
                        const canvases = element.querySelectorAll('canvas');
                        canvases.forEach(canvas => {
                            canvas.style.visibility = 'visible';
                            canvas.style.display = 'block';
                        });
                    }
                });

                // 验证canvas内容
                if (!isCanvasValid(canvas)) {
                    if (retry === maxRetries - 1) {
                        console.warn(`第 ${pageIndex + 1} 页捕获失败，添加空白页`);
                        addBlankPageToPDF(PDF, pageIndex);
                        return false;
                    }
                    continue;
                }

                // 添加到PDF
                addPageToPDF(PDF, canvas, pageIndex);
                return true;

            } catch (error) {
                console.error(`第 ${pageIndex + 1} 页捕获失败 (尝试 ${retry + 1}/${maxRetries}):`, error);

                if (retry === maxRetries - 1) {
                    addBlankPageToPDF(PDF, pageIndex);
                    return false;
                }

                await wait(1000 * (retry + 1));
            }
        }

        return false;
    }

    // 工具函数
    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`等待元素超时: ${selector}`));
            }, timeout);
        });
    }

    function waitForIFrameLoad(iframe) {
        return new Promise((resolve, reject) => {
            if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                resolve();
            } else {
                iframe.addEventListener('load', resolve);
                iframe.addEventListener('error', reject);
                setTimeout(() => reject(new Error('iframe加载超时')), 15000);
            }
        });
    }

    function scrollToPage(container, pageIndex) {
        const pages = container.querySelectorAll('.page');
        if (pages[pageIndex]) {
            pages[pageIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'center'
            });
        }
        return wait(500);
    }

    function waitForPageLoad(pageElement, timeout = 5000) {
        return new Promise((resolve) => {
            if (isPageLoaded(pageElement)) {
                resolve();
                return;
            }

            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                if (isPageLoaded(pageElement)) {
                    clearInterval(checkInterval);
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    resolve(); // 超时也继续
                }
            }, 200);
        });
    }

    function isPageLoaded(pageElement) {
        const canvas = pageElement.querySelector('canvas');
        if (!canvas) return false;

        // 检查canvas尺寸
        if (canvas.width < 100 || canvas.height < 100) return false;

        // 检查canvas内容
        return isCanvasValid(canvas);
    }

    function isCanvasValid(canvas) {
        try {
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // 统计非白色像素
            let nonWhitePixels = 0;
            const sampleSize = 1000; // 采样数量
            const step = Math.floor(data.length / 4 / sampleSize);

            for (let i = 0; i < data.length; i += 4 * step) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                // 如果不是白色或接近白色
                if (r < 250 || g < 250 || b < 250) {
                    nonWhitePixels++;
                }
            }

            // 如果有至少1%的像素不是白色，认为canvas有效
            const threshold = sampleSize * 0.01;
            return nonWhitePixels > threshold;
        } catch (error) {
            return false;
        }
    }

    function addPageToPDF(PDF, canvas, pageIndex) {
        const imgWidth = 210; // A4宽度 mm
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        const imgData = canvas.toDataURL('image/jpeg', 0.95); // 更高质量

        if (pageIndex > 0) {
            PDF.addPage();
        }

        PDF.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
    }

    function addBlankPageToPDF(PDF, pageIndex) {
        if (pageIndex > 0) {
            PDF.addPage();
        }
        // 添加空白页 - 不添加任何内容
    }

    function createProgressOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'pdf-progress-overlay';
        overlay.innerHTML = `
            <div class="pdf-progress-content">
                <h2>正在生成PDF</h2>
                <div class="pdf-progress-bar">
                    <div class="pdf-progress-fill" id="pdf-progress-fill"></div>
                </div>
                <p id="pdf-progress-text">初始化中...</p>
                <p style="font-size: 12px; opacity: 0.7; margin-top: 10px;">
                    请勿关闭页面，这可能需要几分钟时间...
                </p>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function updateProgress(overlay, text, percentage) {
        const progressFill = overlay.querySelector('#pdf-progress-fill');
        const progressText = overlay.querySelector('#pdf-progress-text');

        if (progressFill) progressFill.style.width = percentage + '%';
        if (progressText) progressText.textContent = text;
    }

    function showErrorMessage(message) {
        GM_notification({
            text: message,
            title: 'PDF下载错误',
            timeout: 5000,
            image: 'https://img.icons8.com/color/48/000000/error--v1.png'
        });

        // 同时显示在页面上
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 15px 20px;
            border-radius: 5px;
            z-index: 10000;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
            max-width: 300px;
        `;
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);

        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (errorDiv.parentNode) errorDiv.remove();
                }, 300);
            }
        }, 5000);
    }

    // 启动脚本
    init();
})();
