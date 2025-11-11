// ==UserScript==
// @name         吾爱破解论坛AI自动回帖
// @namespace    http://tampermonkey.net/
// @version      1.2.2
// @description  使用AI在吾爱破解论坛自动回帖，根据帖子内容生成智能回复
// @author       逝去de枫
// @match        https://www.52pojie.cn/forum-10-*.html
// @match        https://www.52pojie.cn/thread-*-*-*.html
// @match        https://www.52pojie.cn/forum.php?mod=viewthread&tid=*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function() {
    'use strict';

    // ================================
    // 可配置参数区间（所有随机值都在这里设置）
    // ================================
    const CONFIG = {
        domain: 'https://www.52pojie.cn',
        username: '你的ID',

        // 回帖间隔时间区间（秒）
        minInterval: 120,  // 2分40秒
        maxInterval: 240,  // 4分钟

        // 每小时回帖次数区间
        minPostsPerHour: 14,
        maxPostsPerHour: 18,

        // 页面搜索区间
        minPageSearch: 5,
        maxPageSearch: 15,

        // 超时时间区间（毫秒）
        minTimeout: 25000,
        maxTimeout: 35000,

        // AI相关配置
        aiModel: "gemini-2.5-flash",
        aiMaxRetries: 3,
        minAiTimeout: 25000,
        maxAiTimeout: 35000,

        // 错误刷新延迟区间（毫秒）
        minErrorRefreshDelay: 45000,
        maxErrorRefreshDelay: 75000,

        // 回复检查区间
        minReplyChecks: 25,
        maxReplyChecks: 35
    };

    // 获取随机值的辅助函数
    const RandomUtils = {
        getInterval: () => Math.floor(Math.random() * (CONFIG.maxInterval - CONFIG.minInterval + 1)) + CONFIG.minInterval,
        getPostsPerHour: () => Math.floor(Math.random() * (CONFIG.maxPostsPerHour - CONFIG.minPostsPerHour + 1)) + CONFIG.minPostsPerHour,
        getPageSearch: () => Math.floor(Math.random() * (CONFIG.maxPageSearch - CONFIG.minPageSearch + 1)) + CONFIG.minPageSearch,
        getTimeout: () => Math.floor(Math.random() * (CONFIG.maxTimeout - CONFIG.minTimeout + 1)) + CONFIG.minTimeout,
        getAiTimeout: () => Math.floor(Math.random() * (CONFIG.maxAiTimeout - CONFIG.minAiTimeout + 1)) + CONFIG.minAiTimeout,
        getErrorRefreshDelay: () => Math.floor(Math.random() * (CONFIG.maxErrorRefreshDelay - CONFIG.minErrorRefreshDelay + 1)) + CONFIG.minErrorRefreshDelay,
        getReplyChecks: () => Math.floor(Math.random() * (CONFIG.maxReplyChecks - CONFIG.minReplyChecks + 1)) + CONFIG.minReplyChecks
    };

    const STORAGE_KEYS = {
        REPLIED_THREADS: 'replied_threads',
        REPLY_HISTORY: 'reply_history',
        LAST_REPLY_TIME: 'last_reply_time',
        CURRENT_HOUR_COUNT: 'current_hour_count',
        CURRENT_HOUR_LIMIT: 'current_hour_limit', // 新增：存储当前小时的回帖上限
        CURRENT_HOUR_START: 'current_hour_start',
        CURRENT_PAGE: 'current_page',
        SEARCH_START_PAGE: 'search_start_page',
        LAST_STATUS: 'last_status',
        AUTO_REPLY_ENABLED: 'auto_reply_enabled',
        AI_API_KEY: 'ai_api_key',
        CURRENT_INTERVAL: 'current_interval' // 新增：存储当前的间隔时间
    };

    class AutoReplyManager {
        constructor() {
            this.currentStatus = '初始化中...';
            this.nextReplyCountdown = 0;
            this.errorRefreshCountdown = 0;
            this.isAutoReplyEnabled = GM_getValue(STORAGE_KEYS.AUTO_REPLY_ENABLED, true);
            this.aiApiKey = GM_getValue(STORAGE_KEYS.AI_API_KEY, '你的key');
            this.init();
        }

        init() {
            this.checkDatabaseError();
            this.initStorage();
            this.createControlPanel();
            this.checkAndStartAutoReply();
            this.updatePanel();
            this.startStatusUpdateLoop();
        }

        // 管理员检测函数
        isAdminUser(authorElement) {
            const style = authorElement.getAttribute('style');
            return style && style.includes('color:');
        }

        // 修改：获取帖子标题和正文内容
        getPostContent() {
            let content = '';

            // 获取帖子标题
            const titleElement = document.querySelector('h1.ts span#thread_subject');
            if (titleElement) {
                const title = titleElement.textContent.trim();
                content += `标题：${title}\n\n`;
            }

            // 获取帖子正文内容
            const firstPost = document.querySelector('.plhin:first-child .t_f, .psth:first-child .t_f, [id^="postmessage_"]:first-child');
            if (firstPost) {
                const body = firstPost.textContent.trim();
                content += `正文：${body}`;
            }

            // 如果获取到了内容，限制总长度
            if (content) {
                return content.substring(0, 1500); // 稍微增加长度限制以容纳标题
            }

            return null;
        }

        // AI生成回复内容
        async generateAIReply(postContent) {
            if (!this.aiApiKey) {
                throw new Error('AI API Key未配置');
            }

            const prompt = `请根据以下帖子内容（包含标题和正文），生成一个5-30字之间的简短回复，要求像真人一样自然，不要使用固定模板：

${postContent}

请用中文回复：`;

            try {
                const response = await this.makeAIRequest(prompt);
                const reply = response.text.trim();

                if (reply.length < 10 || reply.length > 50) {
                    throw new Error(`AI回复长度不符合要求: ${reply.length}字`);
                }

                return reply;
            } catch (error) {
                console.error('AI生成回复失败:', error);
                throw new Error(`AI生成失败: ${error.message}`);
            }
        }

        makeAIRequest(prompt) {
            return new Promise((resolve, reject) => {
                const timeout = RandomUtils.getAiTimeout();
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.aiModel}:generateContent?key=${this.aiApiKey}`,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    data: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: prompt
                            }]
                        }]
                    }),
                    timeout: timeout,
                    onload: function(response) {
                        if (response.status === 200) {
                            try {
                                const data = JSON.parse(response.responseText);
                                if (data.candidates && data.candidates[0] && data.candidates[0].content) {
                                    resolve({
                                        text: data.candidates[0].content.parts[0].text
                                    });
                                } else {
                                    reject(new Error('AI响应格式错误'));
                                }
                            } catch (e) {
                                reject(new Error('解析AI响应失败'));
                            }
                        } else {
                            reject(new Error(`AI API错误: ${response.status}`));
                        }
                    },
                    onerror: function(error) {
                        reject(new Error(`网络错误: ${error}`));
                    },
                    ontimeout: function() {
                        reject(new Error('AI请求超时'));
                    }
                });
            });
        }

        // 简化的控制面板
        createControlPanel() {
            const panel = document.createElement('div');
            panel.id = 'auto-reply-panel';
            panel.style.cssText = `
                position: fixed; top: 100px; right: 20px; width: 420px; background: #f5f5f5;
                border: 2px solid #4CAF50; border-radius: 8px; padding: 15px; z-index: 10000;
                font-family: Arial, sans-serif; font-size: 12px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                max-height: 80vh; overflow-y: auto;
            `;

            // 获取当前配置值用于显示
            const currentHourLimit = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT, CONFIG.minPostsPerHour);
            const currentInterval = GM_getValue(STORAGE_KEYS.CURRENT_INTERVAL, CONFIG.minInterval);

            panel.innerHTML = `
                <div style="font-weight: bold; color: #4CAF50; margin-bottom: 10px; text-align: center; font-size: 14px;">
                    吾爱破解AI自动回帖 v1.2.2
                </div>

                <!-- 随机配置信息 -->
                <div style="background: #fff8e1; padding: 8px; border-radius: 4px; margin-bottom: 10px;">
                    <div style="font-weight: bold; color: #ff8f00; margin-bottom: 5px;">随机配置信息:</div>
                    <div style="margin-bottom: 3px;"><span>当前小时上限: </span><span id="current-hour-limit">${currentHourLimit}</span> 帖/小时</div>
                    <div style="margin-bottom: 3px;"><span>当前回帖间隔: </span><span id="current-interval">${currentInterval}</span> 秒</div>
                    <div style="margin-bottom: 3px;"><span>页面搜索范围: </span><span id="page-search-range">${CONFIG.minPageSearch}-${CONFIG.maxPageSearch}</span> 页</div>
                    <div style="font-size: 10px; color: #666;">每次重置时随机生成新值</div>
                </div>

                <!-- AI配置区域 -->
                <div style="background: #e3f2fd; padding: 8px; border-radius: 4px; margin-bottom: 10px;">
                    <div style="font-weight: bold; color: #1565C0; margin-bottom: 5px;">AI配置:</div>
                    <div style="margin-bottom: 5px;">
                        <span>API Key: </span>
                        <input type="password" id="ai-api-key" value="${this.aiApiKey}" style="width: 100%; padding: 2px; margin-top: 3px; font-size: 11px;" placeholder="输入Google AI API Key">
                    </div>
                    <button id="save-ai-key" style="width: 100%; padding: 4px; background: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; margin-top: 5px;">保存AI配置</button>
                </div>

                <div style="background: #e8f5e8; padding: 8px; border-radius: 4px; margin-bottom: 10px;">
                    <div style="margin-bottom: 5px;"><span>🕒 当前小时: </span><span id="current-hour-count">0</span> / <span id="current-hour-limit-display">${currentHourLimit}</span></div>
                    <div style="margin-bottom: 5px;"><span>⏰ 下次回复: </span><span id="next-reply-time">--</span></div>
                    <div style="margin-bottom: 5px;"><span>🔧 故障刷新: </span><span id="error-refresh-time">--</span></div>
                    <div style="margin-bottom: 5px;"><span>📖 当前页面: </span><span id="current-page">1</span></div>
                    <div style="margin-bottom: 5px;"><span>🕐 当前时间: </span><span id="current-time">--</span></div>
                    <div style="margin-bottom: 5px;"><span>🔄 下次重置: </span><span id="next-reset-time">--</span></div>
                </div>

                <div style="background: #fff3cd; padding: 8px; border-radius: 4px; margin-bottom: 10px;">
                    <div style="font-weight: bold; color: #856404; margin-bottom: 5px;">状态信息:</div>
                    <div id="auto-reply-status" style="min-height: 40px; color: #856404;">初始化中...</div>
                </div>

                <div style="background: #d1ecf1; padding: 8px; border-radius: 4px; margin-bottom: 10px;">
                    <div style="font-weight: bold; color: #0c5460; margin-bottom: 5px;">统计信息:</div>
                    <div style="margin-bottom: 3px;"><span>已回复帖子: </span><span id="replied-count">0</span></div>
                    <div style="margin-bottom: 3px;"><span>今日回复: </span><span id="today-count">0</span></div>
                    <div><span>最后回复: </span><span id="last-reply-time">--</span></div>
                </div>

                <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                    <button id="toggle-auto-reply" style="flex: 1; padding: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        ${this.isAutoReplyEnabled ? '⏸️ 暂停自动回帖' : '▶️ 开始自动回帖'}
                    </button>
                    <button id="reset-data" style="flex: 1; padding: 8px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer;">🔄 重置数据</button>
                </div>

                <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                    <button id="force-next-page" style="flex: 1; padding: 6px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">📖 强制下一页</button>
                    <button id="force-check" style="flex: 1; padding: 6px; background: #9C27B0; color: white; border: none; border-radius: 4px; cursor: pointer;">🔍 强制检查</button>
                </div>

                <div style="font-size: 10px; color: #666; text-align: center; border-top: 1px solid #ddd; padding-top: 5px;">
                    域名: ${CONFIG.domain}<br>
                    间隔: ${CONFIG.minInterval}-${CONFIG.maxInterval}秒 | 小时上限: ${CONFIG.minPostsPerHour}-${CONFIG.maxPostsPerHour}<br>
                    AI模型: ${CONFIG.aiModel}
                </div>
            `;

            document.body.appendChild(panel);

            document.getElementById('toggle-auto-reply').addEventListener('click', () => this.toggleAutoReply());
            document.getElementById('reset-data').addEventListener('click', () => this.resetData());
            document.getElementById('force-next-page').addEventListener('click', () => this.forceNextPage());
            document.getElementById('force-check').addEventListener('click', () => this.forceCheck());
            document.getElementById('save-ai-key').addEventListener('click', () => this.saveAIKey());

            this.makePanelDraggable(panel);
        }

        saveAIKey() {
            const newKey = document.getElementById('ai-api-key').value.trim();
            if (newKey) {
                this.aiApiKey = newKey;
                GM_setValue(STORAGE_KEYS.AI_API_KEY, newKey);
                this.updateStatus('AI API Key已更新');
            } else {
                alert('请输入有效的API Key');
            }
        }

        // 简化的执行回复逻辑
        async executeReply() {
            if (this.checkDatabaseError()) return;

            if (!this.isAutoReplyEnabled) {
                this.updateStatus('自动回帖已暂停，跳过回复');
                return;
            }

            // 检查是否已经回复过（防止重复提交）
            const tid = this.getTidFromUrl(window.location.href);
            const repliedThreads = GM_getValue(STORAGE_KEYS.REPLIED_THREADS);
            if (repliedThreads.includes(tid)) {
                this.updateStatus('检测到已回复过此帖，返回列表页');
                setTimeout(() => {
                    window.location.href = `${CONFIG.domain}/forum-10-1.html`;
                }, 2000);
                return;
            }

            this.updateStatus('在帖子页面，准备使用AI生成回复...');

            // 等待回复框加载
            try {
                await this.waitForElement('#fastpostmessage');
            } catch (error) {
                this.updateStatus('回复框加载超时，可能已回复成功');
                this.checkAndReturnToList();
                return;
            }

            // 获取帖子内容并生成AI回复
            try {
                // 修改：使用新的获取帖子内容方法
                const postContent = this.getPostContent();
                if (!postContent) {
                    throw new Error('无法获取帖子内容');
                }

                this.updateStatus('正在使用AI生成回复内容...');
                const aiReply = await this.generateAIReply(postContent);

                this.updateStatus(`AI生成回复: ${aiReply}`);

                // 填写回复内容
                const refreshCheckbox = document.getElementById('fastpostrefresh');
                if (refreshCheckbox && !refreshCheckbox.checked) refreshCheckbox.checked = true;

                const messageTextarea = document.getElementById('fastpostmessage');
                if (messageTextarea) {
                    messageTextarea.value = aiReply;

                    const submitButton = document.getElementById('fastpostsubmit');
                    if (submitButton) {
                        submitButton.click();
                        this.updateStatus('提交AI生成的回复中...');
                        this.recordReply(tid, aiReply);
                        // 简化的回复检查
                        this.setupSimpleReplyCheck(tid);
                    }
                }
            } catch (error) {
                this.updateStatus(`AI回复失败: ${error.message}，跳过此帖`);
                setTimeout(() => {
                    window.location.href = `${CONFIG.domain}/forum-10-1.html`;
                }, 2000);
            }
        }

        // 简化的回复检查
        setupSimpleReplyCheck(tid) {
            const maxChecks = RandomUtils.getReplyChecks(); // 使用随机检查次数
            let checkCount = 0;

            const checkInterval = setInterval(() => {
                checkCount++;

                // 检查是否已跳转到最后一页（回帖成功）
                if (window.location.href.includes('#lastpost') ||
                    window.location.href.includes('&page=') &&
                    this.checkCurrentPageForUserReply()) {

                    clearInterval(checkInterval);
                    this.updateStatus('回帖成功确认，返回列表页');
                    setTimeout(() => {
                        window.location.href = `${CONFIG.domain}/forum-10-1.html`;
                    }, 2000);
                    return;
                }

                // 超时检查
                if (checkCount >= maxChecks) {
                    clearInterval(checkInterval);
                    this.updateStatus('回帖超时，尝试返回列表页');
                    setTimeout(() => {
                        window.location.href = `${CONFIG.domain}/forum-10-1.html`;
                    }, 2000);
                }
            }, 1000);
        }

        // 检查当前页面是否有用户回复
        checkCurrentPageForUserReply() {
            const userElements = document.querySelectorAll('.authi a.xw1');
            for (let element of userElements) {
                if (element.textContent.trim() === CONFIG.username) {
                    return true;
                }
            }
            return false;
        }

        // 简化的检查并返回列表
        checkAndReturnToList() {
            const tid = this.getTidFromUrl(window.location.href);
            if (this.checkCurrentPageForUserReply()) {
                this.updateStatus('检测到回帖成功，返回列表页');
                setTimeout(() => {
                    window.location.href = `${CONFIG.domain}/forum-10-1.html`;
                }, 2000);
            } else {
                this.updateStatus('未检测到回帖，返回列表页');
                setTimeout(() => {
                    window.location.href = `${CONFIG.domain}/forum-10-1.html`;
                }, 2000);
            }
        }

        recordReply(tid, content) {
            const now = Date.now();
            const repliedThreads = GM_getValue(STORAGE_KEYS.REPLIED_THREADS);
            const replyHistory = GM_getValue(STORAGE_KEYS.REPLY_HISTORY);

            if (!repliedThreads.includes(tid)) {
                repliedThreads.push(tid);
                GM_setValue(STORAGE_KEYS.REPLIED_THREADS, repliedThreads);
            }

            replyHistory.push({ tid: tid, timestamp: now, content: content });
            GM_setValue(STORAGE_KEYS.REPLY_HISTORY, replyHistory);

            GM_setValue(STORAGE_KEYS.LAST_REPLY_TIME, now);
            const currentCount = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_COUNT) + 1;
            GM_setValue(STORAGE_KEYS.CURRENT_HOUR_COUNT, currentCount);

            // 设置下一次回复的随机间隔
            const nextInterval = RandomUtils.getInterval();
            GM_setValue(STORAGE_KEYS.CURRENT_INTERVAL, nextInterval);
        }

        getAvailablePosts() {
            const repliedThreads = GM_getValue(STORAGE_KEYS.REPLIED_THREADS);
            const posts = [];
            const postElements = document.querySelectorAll('tbody[id^="normalthread_"]');

            postElements.forEach(element => {
                const titleLink = element.querySelector('th a.s.xst');
                const authorLink = element.querySelector('td.by cite a');

                if (titleLink && authorLink) {
                    const href = titleLink.getAttribute('href');
                    const tid = this.getTidFromUrl(href);
                    const author = authorLink.textContent.trim();

                    // 排除管理员和已回复的帖子
                    if (!this.isAdminUser(authorLink) && !repliedThreads.includes(tid)) {
                        let fullUrl = href;
                        if (!href.startsWith('http')) {
                            fullUrl = CONFIG.domain + '/' + href;
                        }

                        posts.push({
                            title: titleLink.textContent.trim(),
                            href: href,
                            fullUrl: fullUrl,
                            tid: tid,
                            author: author
                        });
                    }
                }
            });
            return posts;
        }

        getTidFromUrl(url) {
            const match = url.match(/thread-(\d+)/);
            return match ? match[1] : null;
        }

        getCurrentPageNumber() {
            const urlMatch = window.location.href.match(/forum-10-(\d+)\.html/);
            return urlMatch ? parseInt(urlMatch[1]) : 1;
        }

        async goToNextPage() {
            const currentPage = this.getCurrentPageNumber();
            const nextPage = currentPage + 1;
            const searchStartPage = GM_getValue(STORAGE_KEYS.SEARCH_START_PAGE, 1);
            const maxPageSearch = RandomUtils.getPageSearch(); // 使用随机页面搜索范围

            if (nextPage > searchStartPage + maxPageSearch - 1) {
                this.updateStatus(`已搜索 ${maxPageSearch} 页，回到起始页`);
                window.location.href = `${CONFIG.domain}/forum-10-${searchStartPage}.html`;
                return;
            }

            this.updateStatus(`翻页到第 ${nextPage} 页...`);
            GM_setValue(STORAGE_KEYS.CURRENT_PAGE, nextPage);
            window.location.href = `${CONFIG.domain}/forum-10-${nextPage}.html`;
        }

        // 保留的核心功能（增加随机性）
        checkDatabaseError() {
            if (document.body.innerHTML.includes('Discuz! Database Error')) {
                const delay = RandomUtils.getErrorRefreshDelay();
                this.updateStatus(`检测到论坛数据库错误，${Math.round(delay/1000)}秒后自动刷新`);
                this.startErrorRefreshTimer(delay);
                return true;
            }
            return false;
        }

        startErrorRefreshTimer(delay) {
            this.errorRefreshCountdown = delay / 1000;
            const timer = setInterval(() => {
                this.errorRefreshCountdown--;
                if (this.errorRefreshCountdown <= 0) {
                    clearInterval(timer);
                    window.location.reload();
                }
            }, 1000);
        }

        initStorage() {
            if (!GM_getValue(STORAGE_KEYS.REPLIED_THREADS)) GM_setValue(STORAGE_KEYS.REPLIED_THREADS, []);
            if (!GM_getValue(STORAGE_KEYS.REPLY_HISTORY)) GM_setValue(STORAGE_KEYS.REPLY_HISTORY, []);
            if (!GM_getValue(STORAGE_KEYS.CURRENT_HOUR_COUNT)) GM_setValue(STORAGE_KEYS.CURRENT_HOUR_COUNT, 0);
            if (!GM_getValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT)) GM_setValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT, RandomUtils.getPostsPerHour());
            if (!GM_getValue(STORAGE_KEYS.CURRENT_HOUR_START)) GM_setValue(STORAGE_KEYS.CURRENT_HOUR_START, this.getCurrentHourTimestamp());
            if (!GM_getValue(STORAGE_KEYS.CURRENT_PAGE)) GM_setValue(STORAGE_KEYS.CURRENT_PAGE, 1);
            if (!GM_getValue(STORAGE_KEYS.SEARCH_START_PAGE)) GM_setValue(STORAGE_KEYS.SEARCH_START_PAGE, 1);
            if (!GM_getValue(STORAGE_KEYS.CURRENT_INTERVAL)) GM_setValue(STORAGE_KEYS.CURRENT_INTERVAL, RandomUtils.getInterval());
            this.checkHourReset();
        }

        getCurrentHourTimestamp() {
            const now = new Date();
            // 修复：使用更精确的小时时间戳，避免边界问题
            return Math.floor(now.getTime() / (60 * 60 * 1000));
        }

        getCurrentHourStartTime() {
            const now = new Date();
            const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
            return hourStart.getTime();
        }

        getNextHourStartTime() {
            const now = new Date();
            const nextHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
            return nextHourStart.getTime();
        }

        checkHourReset() {
            const currentHourTimestamp = this.getCurrentHourTimestamp();
            const storedHourTimestamp = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_START);

            // 修复：添加更严格的小时变化检测
            if (currentHourTimestamp !== storedHourTimestamp) {
                // 新的一小时，重置计数并生成新的随机值
                GM_setValue(STORAGE_KEYS.CURRENT_HOUR_COUNT, 0);
                GM_setValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT, RandomUtils.getPostsPerHour());
                GM_setValue(STORAGE_KEYS.CURRENT_INTERVAL, RandomUtils.getInterval());
                GM_setValue(STORAGE_KEYS.CURRENT_HOUR_START, currentHourTimestamp);
                
                // 修复：重置搜索起始页，避免无限翻页
                GM_setValue(STORAGE_KEYS.SEARCH_START_PAGE, 1);
                GM_setValue(STORAGE_KEYS.CURRENT_PAGE, 1);

                const newLimit = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT);
                const newInterval = GM_getValue(STORAGE_KEYS.CURRENT_INTERVAL);
                this.updateStatus(`新的一小时开始，重置计数 - 上限:${newLimit}帖/小时, 间隔:${newInterval}秒`);
                
                // 修复：强制刷新页面以重新开始搜索
                setTimeout(() => {
                    window.location.href = `${CONFIG.domain}/forum-10-1.html`;
                }, 2000);
            }
        }

        makePanelDraggable(panel) {
            let isDragging = false;
            let dragOffset = { x: 0, y: 0 };
            const titleBar = panel.querySelector('div:first-child');
            titleBar.style.cursor = 'move';

            titleBar.addEventListener('mousedown', (e) => {
                isDragging = true;
                dragOffset.x = e.clientX - panel.getBoundingClientRect().left;
                dragOffset.y = e.clientY - panel.getBoundingClientRect().top;
                panel.style.opacity = '0.8';
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                panel.style.left = (e.clientX - dragOffset.x) + 'px';
                panel.style.top = (e.clientY - dragOffset.y) + 'px';
                panel.style.right = 'auto';
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
                panel.style.opacity = '1';
            });
        }

        updateStatus(newStatus) {
            this.currentStatus = newStatus;
            GM_setValue(STORAGE_KEYS.LAST_STATUS, newStatus);
            const statusElement = document.getElementById('auto-reply-status');
            if (statusElement) {
                const timestamp = new Date().toLocaleTimeString();
                statusElement.innerHTML = `<div style="margin-bottom: 3px;">${newStatus}</div><div style="font-size: 10px; color: #666;">更新时间: ${timestamp}</div>`;
            }
        }

        updatePanel() {
            const currentCount = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_COUNT);
            const currentHourLimit = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT);
            const currentInterval = GM_getValue(STORAGE_KEYS.CURRENT_INTERVAL);
            const lastReplyTime = GM_getValue(STORAGE_KEYS.LAST_REPLY_TIME);
            const currentPage = GM_getValue(STORAGE_KEYS.CURRENT_PAGE);
            const repliedThreads = GM_getValue(STORAGE_KEYS.REPLIED_THREADS);

            // 更新显示值
            document.getElementById('current-hour-count').textContent = currentCount;
            document.getElementById('current-hour-limit').textContent = currentHourLimit;
            document.getElementById('current-hour-limit-display').textContent = currentHourLimit;
            document.getElementById('current-interval').textContent = currentInterval;
            document.getElementById('current-page').textContent = currentPage;
            document.getElementById('replied-count').textContent = repliedThreads.length;
            document.getElementById('today-count').textContent = this.getTodayReplyCount();

            const currentTime = new Date();
            document.getElementById('current-time').textContent = currentTime.toLocaleTimeString();

            if (lastReplyTime) {
                const lastTime = new Date(lastReplyTime);
                document.getElementById('last-reply-time').textContent = lastTime.toLocaleTimeString();
            }

            this.checkHourReset();
            this.calculateNextReplyCountdown();
            this.updateResetTimeDisplay();

            this.updateCountdownDisplay('next-reply-time', this.nextReplyCountdown);
            this.updateCountdownDisplay('error-refresh-time', this.errorRefreshCountdown);

            this.autoCheckReplyCondition();
        }

        updateResetTimeDisplay() {
            const nextResetTime = this.getNextHourStartTime();
            const now = Date.now();
            const timeUntilReset = Math.max(0, nextResetTime - now);

            const resetElement = document.getElementById('next-reset-time');
            if (resetElement) {
                if (timeUntilReset > 0) {
                    const minutes = Math.floor(timeUntilReset / (60 * 1000));
                    const seconds = Math.floor((timeUntilReset % (60 * 1000)) / 1000);
                    resetElement.textContent = `${minutes}分${seconds}秒`;
                    resetElement.style.color = timeUntilReset < 5 * 60 * 1000 ? '#ff0000' : '';
                } else {
                    resetElement.textContent = '即将重置';
                    resetElement.style.color = '#4CAF50';
                }
            }
        }

        autoCheckReplyCondition() {
            if (window.location.href.includes('forum-10-') && this.isAutoReplyEnabled) {
                if (this.canReplyNow()) {
                    if (this.currentStatus.includes('等待中') || this.currentStatus.includes('已达上限')) {
                        this.updateStatus('等待结束，开始寻找可回复帖子');
                        this.checkAndStartAutoReply();
                    }
                }
            }
        }

        calculateNextReplyCountdown() {
            const lastReplyTime = GM_getValue(STORAGE_KEYS.LAST_REPLY_TIME);
            const currentCount = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_COUNT);
            const currentHourLimit = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT);
            const currentInterval = GM_getValue(STORAGE_KEYS.CURRENT_INTERVAL);

            // 修复：先检查小时重置
            this.checkHourReset();

            if (currentCount >= currentHourLimit) {
                const nextResetTime = this.getNextHourStartTime();
                const now = Date.now();
                this.nextReplyCountdown = Math.max(0, Math.ceil((nextResetTime - now) / 1000));
                return;
            }

            if (lastReplyTime) {
                const nextReplyTime = lastReplyTime + currentInterval * 1000;
                const now = Date.now();
                this.nextReplyCountdown = Math.max(0, Math.ceil((nextReplyTime - now) / 1000));
            } else {
                this.nextReplyCountdown = 0;
            }
        }

        updateCountdownDisplay(elementId, countdown) {
            const element = document.getElementById(elementId);
            if (element) {
                if (countdown > 0) {
                    const minutes = Math.floor(countdown / 60);
                    const seconds = countdown % 60;
                    element.textContent = `${minutes}分${seconds}秒`;
                    if (elementId === 'next-reply-time' && countdown > 0) {
                        element.style.color = '#ff0000';
                    } else {
                        element.style.color = '';
                    }
                } else {
                    element.textContent = '可执行';
                    element.style.color = '#4CAF50';
                }
            }
        }

        getTodayReplyCount() {
            const replyHistory = GM_getValue(STORAGE_KEYS.REPLY_HISTORY);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return replyHistory.filter(reply => new Date(reply.timestamp) >= today).length;
        }

        startStatusUpdateLoop() {
            setInterval(() => this.updatePanel(), 1000);
        }

        toggleAutoReply() {
            this.isAutoReplyEnabled = !this.isAutoReplyEnabled;
            GM_setValue(STORAGE_KEYS.AUTO_REPLY_ENABLED, this.isAutoReplyEnabled);
            const button = document.getElementById('toggle-auto-reply');
            if (this.isAutoReplyEnabled) {
                button.textContent = '⏸️ 暂停自动回帖';
                button.style.background = '#4CAF50';
                this.updateStatus('自动回帖已启用');
                this.checkAndStartAutoReply();
            } else {
                button.textContent = '▶️ 开始自动回帖';
                button.style.background = '#f44336';
                this.updateStatus('自动回帖已暂停');
            }
        }

        resetData() {
            if (confirm('确定要重置所有数据吗？这将清除回帖记录和计数。')) {
                GM_setValue(STORAGE_KEYS.REPLIED_THREADS, []);
                GM_setValue(STORAGE_KEYS.REPLY_HISTORY, []);
                GM_setValue(STORAGE_KEYS.CURRENT_HOUR_COUNT, 0);
                GM_setValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT, RandomUtils.getPostsPerHour());
                GM_setValue(STORAGE_KEYS.CURRENT_INTERVAL, RandomUtils.getInterval());
                GM_setValue(STORAGE_KEYS.CURRENT_HOUR_START, this.getCurrentHourTimestamp());
                GM_setValue(STORAGE_KEYS.LAST_REPLY_TIME, null);
                GM_setValue(STORAGE_KEYS.CURRENT_PAGE, 1);
                GM_setValue(STORAGE_KEYS.SEARCH_START_PAGE, 1);
                this.updatePanel();
                this.updateStatus('数据已重置');
                alert('数据已重置');
            }
        }

        forceNextPage() { this.goToNextPage(); }
        forceCheck() { this.updateStatus('手动触发检查'); this.checkAndStartAutoReply(); }

        checkAndStartAutoReply() {
            if (this.checkDatabaseError()) return;

            if (window.location.href.includes('forum-10-') && this.isAutoReplyEnabled) {
                this.startAutoReply();
            } else if ((window.location.href.includes('thread-') || window.location.href.includes('mod=viewthread')) && this.isAutoReplyEnabled) {
                this.executeReply();
            }
        }

        async startAutoReply() {
            if (!this.isAutoReplyEnabled) return;

            // 修复：强制检查小时重置
            this.checkHourReset();

            if (!this.canReplyNow()) {
                const currentCount = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_COUNT);
                const currentHourLimit = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT);
                if (currentCount >= currentHourLimit) {
                    const nextResetTime = this.getNextHourStartTime();
                    const now = Date.now();
                    const minutesUntilReset = Math.ceil((nextResetTime - now) / (60 * 1000));
                    this.updateStatus(`小时回复数已达上限(${currentCount}/${currentHourLimit})，${minutesUntilReset}分钟后重置`);
                } else {
                    const currentInterval = GM_getValue(STORAGE_KEYS.CURRENT_INTERVAL);
                    const lastReplyTime = GM_getValue(STORAGE_KEYS.LAST_REPLY_TIME);
                    const timeSinceLastReply = Math.floor((Date.now() - lastReplyTime) / 1000);
                    const timeRemaining = currentInterval - timeSinceLastReply;
                    this.updateStatus(`距离上次回复时间不足${currentInterval}秒，还需等待${timeRemaining}秒`);
                }
                return;
            }

            this.updateStatus('开始自动回帖流程...');
            try {
                await this.findAndReplyToPost();
            } catch (error) {
                console.error('自动回帖出错:', error);
                this.updateStatus('出错: ' + error.message);
                
                // 修复：出错时也重置页面状态
                setTimeout(() => {
                    window.location.href = `${CONFIG.domain}/forum-10-1.html`;
                }, 3000);
            }
        }

        async findAndReplyToPost() {
            const posts = this.getAvailablePosts();
            if (posts.length > 0) {
                const randomPost = posts[Math.floor(Math.random() * posts.length)];
                this.updateStatus(`找到可回复帖子: ${randomPost.title}`);
                const currentPage = this.getCurrentPageNumber();
                GM_setValue(STORAGE_KEYS.CURRENT_PAGE, currentPage);

                window.location.href = randomPost.fullUrl;
            } else {
                this.updateStatus('当前页面没有可回复的帖子，尝试翻页...');
                await this.goToNextPage();
            }
        }

        canReplyNow() {
            // 修复：先检查小时重置
            this.checkHourReset();
            
            const currentCount = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_COUNT);
            const currentHourLimit = GM_getValue(STORAGE_KEYS.CURRENT_HOUR_LIMIT);
            const lastReplyTime = GM_getValue(STORAGE_KEYS.LAST_REPLY_TIME);
            const currentInterval = GM_getValue(STORAGE_KEYS.CURRENT_INTERVAL);

            if (currentCount >= currentHourLimit) {
                return false;
            }

            if (lastReplyTime && (Date.now() - lastReplyTime < currentInterval * 1000)) {
                return false;
            }

            return true;
        }

        waitForElement(selector, timeout = 10000) {
            return new Promise((resolve, reject) => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    return;
                }
                const observer = new MutationObserver((mutations, obs) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        obs.disconnect();
                        resolve(element);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`等待元素超时: ${selector}`));
                }, timeout);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const manager = new AutoReplyManager();
            if (window.location.href.includes('thread-') || window.location.href.includes('mod=viewthread')) {
                manager.executeReply();
            }
        });
    } else {
        const manager = new AutoReplyManager();
        if (window.location.href.includes('thread-') || window.location.href.includes('mod=viewthread')) {
            manager.executeReply();
        }
    }

})();
