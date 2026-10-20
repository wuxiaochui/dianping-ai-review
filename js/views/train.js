/* =====================================================================
   大众点评 AI 评价生成器 · 训练视图 (train)
   契约：App.registerView('train', { mount, unmount, refresh })
   - mount(container): 渲染到 <section class="view" data-view="train">
   - unmount(): 清理监听 / 取消未完成动画与定时器
   - refresh(): 数据变化时重渲（如训练历史列表）
   设计：Apple 风格 —— 摘要卡片弹簧入场、加载态脉冲、
        横向滚动 chips、留白克制、所有按钮 .pressable 即时反馈。
   ===================================================================== */
(function (global) {
  'use strict';

  /* ===================================================================
     一、模块状态
     =================================================================== */

  var state = {
    container: null,            // 当前挂载的 section.view 元素
    listeners: [],              // 待清理的事件监听器 [el, type, fn, opts]
    timers: [],                 // 待清理的 setTimeout id
    rafId: null,                // 入场动画 rAF id
    unsubStore: null,           // Store 变化取消订阅
    unsubRoute: null,           // 路由变化取消订阅

    // 训练流程状态机
    stage: 'input',             // 'input' | 'validating' | 'analyzing' | 'review'
    mode: 'single',             // 'single' | 'batch'
    text: '',                   // textarea 原始内容
    category: null,             // AI 识别出的品类（runAnalysis 时填充；null 表示尚未识别）
    categoryScores: null,       // 识别得分明细 {品类: 得分}
    tagIds: [],                 // 已选标签组 id

    // 校验阶段产物
    items: [],                  // [{ text, status: 'ok'|'invalid', reasons: [string], skip: bool }]

    // 分析阶段产物
    analyses: [],               // 每条语料对应的 analyzeStyle 结果
    mergedFeatures: null,        // 本次新学到的聚合特征
    prevTopWords: [],            // 之前已有的 topWords（同品类聚合，用于摘要生成）
    prevAvgSentenceLength: 0,    // 之前同品类语料的平均句长
    summary: '',                // 中文摘要文案
    typicalExpressions: [],     // 用户可编辑的典型表达 [{ text, source: 'word'|'opener' }]
    modified: false,             // 用户是否手动修改了典型表达
    expandedHistoryId: null,     // 训练历史展开的 id
    expandedAnalysisIdx: 0,      // 逐条深度分析展开的索引（默认展开第一条）
    analysisProgress: { current: 0, total: 0, useAI: false }, // 深度分析进度
    analysisToken: 0,            // 分析令牌：每次新分析递增，用于取消过期异步分析
    lottieInstance: null,        // Lottie 动画实例（分析中加载态）
    improveAIChat: [],           // 鞭策AI聊天历史 [{role, content, corpusAdded?}]
    improveAILoading: false,     // 鞭策AI 是否正在等待 AI 响应
    // 系统性深度优化产物
    crossCorpusPatterns: null,   // 跨语料模式挖掘结果（写作DNA签名）
    corpusQuality: null,         // 语料质量评估结果
    categorySource: 'pending'    // 品类检测来源：'ai' | 'pending' | 'unknown'
  };

  /* ===================================================================
     二、常量
     =================================================================== */

  // 广告营销词（spec 5.2 要求）
  var AD_WORDS = [
    '微信', '加我',  '点击链接',
    '加群',  '公众号', 'http://', 'https://', 'www.',
    '抢购', '淘宝', '拼多多', '抖音号'
  ];

  // 校验阈值
  var MIN_LENGTH = 20;
  var EMOJI_MIN_NON_EMOJI_LEN = 5;

  /* ---------- 视图专有样式（一次性注入，使用 main.css 设计令牌） ---------- */
  var STYLE_ID = 'dpr-train-view-styles';
  function injectStyles() {
    if (global.document && global.document.getElementById(STYLE_ID)) return;
    if (!global.document) return;
    var style = global.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      /* 训练页通用容器（卡片统一间距） */
      '.view[data-view="train"].is-active { display: flex; flex-direction: column; gap: var(--space-4); }',
      '.train { display: flex; flex-direction: column; gap: var(--space-4); }',
      '.train-section { padding: var(--space-4); }',
      '.train-section__title { font-size: var(--fs-headline); font-weight: 600; letter-spacing: var(--tracking-display); line-height: var(--leading-tight); margin-bottom: var(--space-2); }',
      /* 引导卡片：暖橙左侧色条，柔和底 */
      '.train-guide { background: rgba(255,149,0,0.06); border: 1px solid rgba(255,149,0,0.16); border-left: 3px solid var(--brand-orange); box-shadow: none; }',
      '.train-guide__title { font-size: var(--fs-headline); font-weight: 600; letter-spacing: var(--tracking-display); margin-bottom: var(--space-2); }',
      '.train-guide__text { font-size: var(--fs-body); color: var(--text-secondary); line-height: var(--leading-body); }',
      /* 输入区 */
      /* 模式切换：iOS 分段控件（灰轨道 + 白色活动段） */
      '.train-mode-row { display: flex; gap: 2px; margin: var(--space-3) 0; padding: 2px; background: rgba(120,120,128,0.10); border-radius: var(--radius-pill); }',
      '.train-mode-row .chip { flex: 1; justify-content: center; padding: 7px 14px; font-size: var(--fs-body); background: transparent; border: none; border-radius: var(--radius-pill); color: var(--text-secondary); }',
      '.train-mode-row .chip.is-active { background: var(--surface); color: var(--text-primary); font-weight: 600; border: none; box-shadow: 0 1px 4px rgba(0,0,0,0.10), 0 0.5px 1px rgba(0,0,0,0.06); }',
      /* 文本域：内敛灰底，聚焦抬升白底 */
      '.train-textarea { min-height: 140px; background: var(--bg); border-color: transparent; }',
      '.train-textarea:focus { background: var(--surface); border-color: var(--accent); }',
      '.train-batch-count { font-size: var(--fs-caption); color: var(--accent); font-weight: 500; margin-top: var(--space-2); }',
      '.train-batch-count--muted { color: var(--text-tertiary); font-weight: 400; }',
      '.train-field { margin-top: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }',
      '.train-label { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase; }',
      '.train-chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
      /* 主 CTA：点评品牌橙（页面唯一主按钮，品牌点缀） */
      '.train-start-btn { margin-top: var(--space-4); min-height: 50px; font-size: var(--fs-headline); font-weight: 600; background: var(--brand-orange); box-shadow: 0 4px 14px rgba(255,149,0,0.28); }',
      '.train-start-btn:active { background: var(--brand-orange-deep); box-shadow: 0 2px 8px rgba(255,149,0,0.22); }',
      /* 校验结果 */
      '.train-validate-list { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-3) 0; }',
      '.train-validate-item { padding: var(--space-3); background: var(--bg); border-radius: var(--radius-md); border: 1px solid var(--border); }',
      '.train-validate-item--invalid { border-color: rgba(255,149,0,0.3); background: rgba(255,149,0,0.05); border-left: 3px solid var(--brand-orange); }',
      '.train-validate-preview { font-size: var(--fs-body); line-height: var(--leading-body); margin-bottom: var(--space-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
      '.train-validate-status { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-2); }',
      '.train-validate-reasons { margin: var(--space-1) 0 0 var(--space-4); padding: 0; list-style: disc; color: var(--text-secondary); font-size: var(--fs-caption); }',
      '.train-validate-reason { line-height: 1.5; }',
      '.train-validate-badge { display: inline-flex; padding: 2px 8px; font-size: var(--fs-caption); font-weight: 500; border-radius: var(--radius-pill); align-self: flex-start; }',
      '.train-validate-badge--ok { background: rgba(48,209,88,0.14); color: #248a3d; }',
      '.train-validate-badge--warn { background: rgba(255,149,0,0.16); color: #c93400; }',
      '.train-validate-toggle { align-self: flex-start; margin-top: var(--space-2); min-height: 32px; padding: 0 var(--space-3); font-size: var(--fs-caption); }',
      '.train-validate-actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); }',
      '.train-validate-actions .btn { flex: 1; }',
      /* 分析中：大圆角浮层卡 + 品牌橙进度 */
      '.train-analyzing { display: flex; justify-content: center; padding: var(--space-8) var(--space-4); }',
      '.train-analyzing__card { text-align: center; padding: var(--space-6) var(--space-5); max-width: 320px; border-radius: var(--radius-xl); box-shadow: var(--shadow-strong); }',
      '.train-analyzing__lottie { width: 120px; height: 120px; margin: 0 auto var(--space-3); display: flex; align-items: center; justify-content: center; }',
      '.train-analyzing__lottie svg { display: block; }',
      '.train-analyzing__text { font-size: var(--fs-headline); font-weight: 600; letter-spacing: var(--tracking-display); margin-bottom: var(--space-1); }',
      '.train-analyzing__hint { font-size: var(--fs-caption); color: var(--text-tertiary); }',
      '.train-analyzing__progress { margin-top: var(--space-3); width: 100%; height: 6px; background: rgba(255,149,0,0.14); border-radius: var(--radius-pill); overflow: hidden; }',
      '.train-analyzing__progress-bar { height: 100%; background: var(--brand-orange); border-radius: var(--radius-pill); transition: width 300ms var(--ease-out); }',
      '.train-analyzing__progress-text { margin-top: var(--space-1); font-size: var(--fs-caption); color: var(--brand-orange-deep); font-weight: 600; font-variant-numeric: tabular-nums; }',
      /* 摘要卡片：白卡 + 蓝色顶部标识条（弹簧入场 + 缩放） */
      '.train-summary-card { background: var(--surface); border: 1px solid rgba(0,122,255,0.14); border-top: 3px solid var(--accent); border-radius: var(--radius-lg); padding: var(--space-5); transform: scale(0.94); opacity: 0; transition: transform 420ms var(--spring-default), opacity 280ms var(--ease-out); box-shadow: var(--shadow); }',
      '.train-summary-card.is-entered { transform: scale(1); opacity: 1; }',
      '.train-summary-card__label { font-size: var(--fs-caption); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: var(--space-2); }',
      '.train-summary-card__text { font-size: var(--fs-title); font-weight: 600; letter-spacing: var(--tracking-display); line-height: var(--leading-tight); color: var(--text-primary); margin-bottom: var(--space-3); }',
      '.train-summary-card__meta { display: flex; gap: var(--space-4); flex-wrap: wrap; padding-top: var(--space-3); border-top: 1px solid var(--border); }',
      '.train-meta-item { display: flex; flex-direction: column; gap: 2px; }',
      '.train-meta-label { font-size: var(--fs-caption); color: var(--text-tertiary); }',
      '.train-meta-value { font-size: var(--fs-body); font-weight: 500; }',
      /* 高频词 / emoji 横向滚动 */
      '.train-chip-scroller { display: flex; gap: var(--space-2); overflow-x: auto; padding: 2px 0 var(--space-2); -webkit-overflow-scrolling: touch; scrollbar-width: none; }',
      '.train-chip-scroller::-webkit-scrollbar { display: none; }',
      '.train-chip-word { flex: 0 0 auto; }',
      '.train-chip-count { margin-left: 6px; font-size: 10px; opacity: 0.6; font-variant-numeric: tabular-nums; }',
      '.train-emoji-row { display: flex; gap: var(--space-3); flex-wrap: wrap; }',
      '.train-emoji-item { display: inline-flex; align-items: center; gap: 4px; font-size: 24px; line-height: 1; }',
      '.train-emoji-count { font-size: var(--fs-caption); color: var(--text-tertiary); font-variant-numeric: tabular-nums; }',
      /* 典型表达 */
      '.train-typical-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0; }',
      '.train-typical-chip { flex: 0 0 auto; padding-right: 6px; }',
      '.train-typical-text { font-weight: 500; }',
      '.train-typical-del { width: 18px; height: 18px; border-radius: 50%; background: rgba(60,60,67,0.18); color: var(--text-secondary); display: inline-flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1; transition: background 120ms var(--ease-out); margin-left: 4px; }',
      '.train-typical-del:hover { background: rgba(255,59,48,0.2); color: var(--danger); }',
      '.train-typical-add { display: flex; gap: var(--space-2); margin-top: var(--space-2); }',
      '.train-typical-add .input { flex: 1; }',
      '.train-typical-add-btn { flex: 0 0 auto; }',
      /* 操作按钮 */
      '.train-review { display: flex; flex-direction: column; gap: var(--space-3); }',
      '.train-review-actions { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-1); }',
      '.train-review-actions .btn { min-height: 48px; }',
      /* 逐条深度分析 */
      '.train-deep-analysis { margin-top: var(--space-2); }',
      '.train-deep-analysis__title { font-size: var(--fs-headline); font-weight: 600; letter-spacing: var(--tracking-display); margin-bottom: var(--space-1); }',
      '.train-deep-analysis__hint { font-size: var(--fs-caption); color: var(--text-tertiary); margin-bottom: var(--space-3); line-height: 1.4; }',
      '.train-deep-list { display: flex; flex-direction: column; gap: var(--space-2); }',
      '.train-deep-item { background: var(--surface); border-radius: var(--radius-md); border: 1px solid var(--border); overflow: hidden; transition: border-color 200ms var(--ease-out), box-shadow 200ms var(--ease-out); }',
      '.train-deep-item.is-expanded { border-color: rgba(0,122,255,0.25); box-shadow: var(--shadow); }',
      '.train-deep-item__head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3); cursor: pointer; transition: background 160ms var(--ease-out); }',
      '.train-deep-item__head:active { background: rgba(60,60,67,0.05); }',
      '.train-deep-item__index { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }',
      '.train-deep-item__preview { flex: 1 1 auto; min-width: 0; font-size: var(--fs-body); color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.train-deep-item__chevron { flex: 0 0 auto; color: var(--text-tertiary); font-size: 12px; transition: transform 200ms var(--ease-out); }',
      '.train-deep-item.is-expanded .train-deep-item__chevron { transform: rotate(90deg); }',
      '.train-deep-item__body { display: none; padding: 0 var(--space-3) var(--space-3); border-top: 1px solid var(--border); }',
      '.train-deep-item.is-expanded .train-deep-item__body { display: block; }',
      '.train-deep-dim { margin-top: var(--space-3); }',
      '.train-deep-dim:first-child { margin-top: var(--space-3); }',
      '.train-deep-dim__label { font-size: var(--fs-caption); font-weight: 600; color: var(--accent); letter-spacing: 0.02em; text-transform: uppercase; margin-bottom: var(--space-1); }',
      '.train-deep-sub { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: 500; margin-top: var(--space-2); margin-bottom: 4px; }',
      '.train-deep-sub:first-of-type { margin-top: var(--space-1); }',
      '.train-deep-dim__tags { display: flex; flex-wrap: wrap; gap: 6px; }',
      '.train-deep-tag { display: inline-flex; align-items: center; padding: 3px 10px; font-size: var(--fs-caption); font-weight: 500; border-radius: var(--radius-pill); background: rgba(0,122,255,0.08); color: var(--accent); border: 1px solid rgba(0,122,255,0.15); }',
      '.train-deep-tag--format { background: rgba(48,209,88,0.08); color: #248a3d; border-color: rgba(48,209,88,0.18); }',
      '.train-deep-tag--style { background: rgba(255,149,0,0.08); color: #c93400; border-color: rgba(255,149,0,0.18); }',
      '.train-deep-tag--neutral { background: rgba(60,60,67,0.06); color: var(--text-secondary); border-color: transparent; }',
      /* 训练历史 */
      '.train-history { display: flex; flex-direction: column; }',
      '.train-hist-list { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2); }',
      '.train-hist-item { background: var(--surface); border-radius: var(--radius-md); border: 1px solid var(--border); overflow: hidden; transition: border-color 200ms var(--ease-out), box-shadow 200ms var(--ease-out); }',
      '.train-hist-item.is-expanded { box-shadow: var(--shadow); border-color: rgba(0,122,255,0.22); }',
      '.train-hist-item__header { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-3); cursor: pointer; transition: background 160ms var(--ease-out); }',
      '.train-hist-item__header:active { background: rgba(60,60,67,0.05); }',
      '.train-hist-item__body { flex: 1 1 auto; min-width: 0; }',
      '.train-hist-item__meta { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-caption); color: var(--text-tertiary); margin-bottom: 2px; flex-wrap: wrap; }',
      '.train-hist-item__sep { opacity: 0.5; }',
      '.train-hist-item__modified { color: var(--star); font-weight: 500; }',
      '.train-hist-item__summary { font-size: var(--fs-body); line-height: 1.4; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
      '.train-hist-item__chevron { color: var(--text-tertiary); font-size: 12px; line-height: 1.4; flex: 0 0 auto; }',
      '.train-hist-detail { padding: 0 var(--space-3) var(--space-3); display: flex; flex-direction: column; gap: var(--space-3); border-top: 1px solid var(--border); margin-top: 0; padding-top: var(--space-3); }',
      '.train-hist-detail-row { display: flex; flex-direction: column; gap: var(--space-1); }',
      '.train-hist-detail-label { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: 500; }',
      '.train-hist-detail-value { font-size: var(--fs-body); line-height: var(--leading-body); color: var(--text-primary); }',
      '.train-hist-corpus-list { display: flex; flex-wrap: wrap; gap: 6px; }',
      '.train-hist-corpus-id { font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--text-secondary); }',
      '.train-hist-rollback { margin-top: var(--space-2); }',
      /* 训练历史 chip */
      '.train-hist-chip { font-size: var(--fs-caption); padding: 4px 10px; flex: 0 0 auto; }',
      /* 空状态 */
      '.train-empty { padding: var(--space-5) var(--space-3); text-align: center; }',
      '.train-empty__text { font-size: var(--fs-body); color: var(--text-secondary); font-weight: 500; margin-bottom: var(--space-1); }',
      '.train-empty__hint { font-size: var(--fs-caption); color: var(--text-tertiary); }',
      /* reduced-motion：去掉弹簧缩放，改为淡入 */
      '@media (prefers-reduced-motion: reduce) {',
      '  .train-summary-card { transform: none; transition: opacity 200ms ease; }',
      '  .train-summary-card.is-entered { transform: none; }',
      '  .train-dot { animation: none; opacity: 0.6; }',
      '  .train-dot:nth-child(2) { opacity: 0.8; }',
      '  .train-dot:nth-child(3) { opacity: 1; }',
      '}',
      /* AI 识别品类徽章 */
      '.train-cat-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; font-size: var(--fs-caption); font-weight: 600; color: var(--accent); background: rgba(0,122,255,0.10); border: 1px solid rgba(0,122,255,0.22); border-radius: var(--radius-pill); }',
      '.train-cat-badge::before { content: "✨"; font-size: 11px; }',
      '.train-cat-badge--other { color: var(--text-secondary); background: rgba(60,60,67,0.08); border-color: var(--border); }',
      '.train-cat-badge--other::before { content: "❓"; }',
      /* 识别置信度条 */
      '.train-cat-confidence { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--border); }',
      '.train-cat-confidence__title { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: 500; margin-bottom: var(--space-2); }',
      '.train-cat-bar-row { display: flex; align-items: center; gap: var(--space-2); margin-bottom: 6px; font-size: var(--fs-caption); }',
      '.train-cat-bar-label { flex: 0 0 64px; color: var(--text-secondary); }',
      '.train-cat-bar-wrap { flex: 1 1 auto; height: 6px; background: var(--bg); border-radius: var(--radius-pill); overflow: hidden; }',
      '.train-cat-bar { height: 100%; background: var(--accent); border-radius: var(--radius-pill); transition: width 320ms var(--spring-default); }',
      '.train-cat-bar-row.is-winner .train-cat-bar { background: #ff9500; }',
      '.train-cat-bar-row.is-winner .train-cat-bar-label { color: var(--star); font-weight: 600; }',
      '.train-cat-bar-value { flex: 0 0 32px; text-align: right; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }',
      /* 品类检测来源标记 */
      '.train-cat-source { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; font-size: 10px; font-weight: 500; border-radius: var(--radius-pill); margin-left: 6px; vertical-align: middle; }',
      '.train-cat-source--ai { background: rgba(48,209,88,0.14); color: #248a3d; }',
      '.train-cat-source--pending { background: rgba(255,149,0,0.14); color: #c93400; }',
      '.train-cat-source--unknown { background: rgba(60,60,67,0.08); color: var(--text-tertiary); }',
      '.train-cat-badge--pending { color: var(--text-secondary); background: rgba(255,149,0,0.06); border-color: rgba(255,149,0,0.2); }',
      /* 写作DNA签名卡片 */
      '.train-dna-card { background: rgba(88,86,214,0.05); border: 1px solid rgba(88,86,214,0.16); border-radius: var(--radius-lg); padding: var(--space-4); }',
      '.train-dna-card__label { font-size: var(--fs-caption); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #5856d6; margin-bottom: var(--space-2); }',
      '.train-dna-card__signature { font-size: var(--fs-body); font-weight: 600; line-height: var(--leading-body); color: var(--text-primary); margin-bottom: var(--space-3); }',
      '.train-dna-card__section { margin-top: var(--space-2); }',
      '.train-dna-card__section-title { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: 500; margin-bottom: 4px; }',
      '.train-dna-patterns { display: flex; flex-wrap: wrap; gap: 6px; }',
      '.train-dna-pattern { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; font-size: var(--fs-caption); font-weight: 500; border-radius: var(--radius-pill); background: rgba(88,86,214,0.08); color: #5856d6; border: 1px solid rgba(88,86,214,0.15); }',
      '.train-dna-pattern__count { font-size: 10px; opacity: 0.7; font-variant-numeric: tabular-nums; }',
      '.train-dna-template { font-size: var(--fs-caption); color: var(--text-secondary); padding: 4px 0; }',
      '.train-dna-template__count { font-size: 10px; color: var(--text-tertiary); margin-left: 4px; }',
      /* 质量评估卡片 */
      '.train-quality-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); box-shadow: var(--shadow); }',
      '.train-quality-card__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }',
      '.train-quality-card__title { font-size: var(--fs-headline); font-weight: 600; letter-spacing: var(--tracking-display); }',
      '.train-quality-score { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; font-size: var(--fs-body); font-weight: 700; border-radius: var(--radius-pill); font-variant-numeric: tabular-nums; }',
      '.train-quality-score--high { background: rgba(48,209,88,0.14); color: #248a3d; }',
      '.train-quality-score--mid { background: rgba(255,149,0,0.14); color: #c93400; }',
      '.train-quality-score--low { background: rgba(255,59,48,0.14); color: #c93400; }',
      '.train-quality-dims { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-3); }',
      '.train-quality-dim { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-caption); }',
      '.train-quality-dim-label { flex: 0 0 64px; color: var(--text-secondary); }',
      '.train-quality-dim-bar-wrap { flex: 1 1 auto; height: 6px; background: var(--bg); border-radius: var(--radius-pill); overflow: hidden; }',
      '.train-quality-dim-bar { height: 100%; border-radius: var(--radius-pill); transition: width 420ms var(--spring-default); }',
      '.train-quality-dim-bar--diversity { background: #5856d6; }',
      '.train-quality-dim-bar--coverage { background: #007aff; }',
      '.train-quality-dim-bar--length { background: #34c759; }',
      '.train-quality-dim-value { flex: 0 0 36px; text-align: right; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }',
      '.train-quality-outliers { margin-bottom: var(--space-2); }',
      '.train-quality-outliers-title { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: 500; margin-bottom: 4px; }',
      '.train-quality-outlier { font-size: var(--fs-caption); color: #c93400; padding: 3px 0; line-height: 1.4; }',
      '.train-quality-suggestions { display: flex; flex-direction: column; gap: 4px; }',
      '.train-quality-suggestion { font-size: var(--fs-caption); color: var(--text-secondary); padding: 6px 10px; background: rgba(255,149,0,0.06); border-left: 3px solid rgba(255,149,0,0.4); border-radius: 4px; line-height: 1.4; }'
      /* 鞭策AI 聊天样式统一由 main.css 提供，此处不再重复定义 */
    ].join('\n');
    global.document.head.appendChild(style);
  }
  // 模块加载即注入
  injectStyles();

  /* ===================================================================
     三、工具
     =================================================================== */

  /** 注册监听并记录到 state.listeners，便于 unmount 时统一移除 */
  function on(el, type, fn, opts) {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    state.listeners.push([el, type, fn, opts || false]);
  }

  /** 清理所有监听 */
  function clearListeners() {
    state.listeners.forEach(function (item) {
      var el = item[0], type = item[1], fn = item[2], opts = item[3];
      try { el.removeEventListener(type, fn, opts); } catch (e) {}
    });
    state.listeners = [];
  }

  /** 清理所有定时器 */
  function clearTimers() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    state.timers.forEach(function (t) { clearTimeout(t); });
    state.timers = [];
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** I18n 翻译取用：失败回退 key 本身 */
  function tr(key, params) {
    var i = global.I18n;
    return (i && typeof i.t === 'function') ? i.t(key, params) : key;
  }

  /** 品类中文码 → 国际化显示键（数据值保留中文码，仅展示经翻译） */
  var CATEGORY_LABEL_KEYS = {
    '美食': 'train.catFood',
    '甜品饮品': 'train.catDessert',
    '美发': 'train.catHair',
    '酒店': 'train.catHotel',
    '休闲': 'train.catLeisure',
    '健身': 'train.catFitness',
    '电影': 'train.catMovie',
    '亲子': 'train.catParentChild',
    '购物': 'train.catShopping',
    '美甲美睫': 'train.catNails',
    'KTV': 'train.catKtv',
    '其他': 'train.catOther'
  };
  /** 把品类中文码翻译为展示文本；未知码原样返回 */
  function catLabel(cat) {
    return CATEGORY_LABEL_KEYS[cat] ? tr(CATEGORY_LABEL_KEYS[cat]) : cat;
  }

  /** 相对时间格式化 */
  function formatRelative(isoOrTs) {
    if (!isoOrTs) return '';
    var ts = typeof isoOrTs === 'number' ? isoOrTs : new Date(isoOrTs).getTime();
    if (!ts || isNaN(ts)) return '';
    var now = Date.now();
    var diff = Math.max(0, now - ts);
    var min = 60 * 1000;
    var hour = 60 * min;
    var day = 24 * hour;

    if (diff < min) return tr('train.timeJustNow');
    if (diff < hour) return tr('train.timeMinutesAgo', { 0: Math.floor(diff / min) });
    if (diff < day) return tr('train.timeHoursAgo', { 0: Math.floor(diff / hour) });
    if (diff < 7 * day) return tr('train.timeDaysAgo', { 0: Math.floor(diff / day) });

    var d = new Date(ts);
    var m = (d.getMonth() + 1).toString().padStart(2, '0');
    var dd = d.getDate().toString().padStart(2, '0');
    var hh = d.getHours().toString().padStart(2, '0');
    var mm = d.getMinutes().toString().padStart(2, '0');
    return m + '-' + dd + ' ' + hh + ':' + mm;
  }

  /** 取 Store，做存在性兜底 */
  function store() { return global.Store || null; }
  /** 取 AIEngine，做存在性兜底 */
  function ai() { return global.AIEngine || null; }
  /** 取 App，做存在性兜底 */
  function app() { return global.App || null; }

  /** 是否处于 reduced-motion */
  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** 拆分批量输入：连续两个换行或仅空白的行视作分隔 */
  function splitBatchItems(text) {
    if (!text) return [];
    // 先按连续两个换行（含中间空白）拆分
    var parts = text.split(/\n\s*\n/);
    var items = [];
    parts.forEach(function (p) {
      var t = p.replace(/^\s+|\s+$/g, '');
      if (t) items.push(t);
    });
    return items;
  }

  /** 判断是否含广告词 */
  function detectAdWords(text) {
    if (!text) return null;
    for (var i = 0; i < AD_WORDS.length; i++) {
      if (text.indexOf(AD_WORDS[i]) !== -1) return AD_WORDS[i];
    }
    return null;
  }

  /** 移除 emoji 后的字符串长度 */
  function nonEmojiLength(text) {
    if (!text) return 0;
    var chars = Array.from(text);
    var len = 0;
    for (var i = 0; i < chars.length; i++) {
      var cp = chars[i].codePointAt(0);
      var isEmoji = (
        (cp >= 0x1F300 && cp <= 0x1FAFF) ||
        (cp >= 0x1F600 && cp <= 0x1F64F) ||
        (cp >= 0x1F680 && cp <= 0x1F6FF) ||
        (cp >= 0x2600 && cp <= 0x27BF) ||
        (cp >= 0x1F900 && cp <= 0x1F9FF)
      );
      if (!isEmoji && chars[i].trim()) len++;
    }
    return len;
  }

  /** 对单条文本做校验，返回 { valid, reasons[] } */
  function validateItem(text) {
    var reasons = [];
    var len = Array.from(text || '').length;
    if (len < MIN_LENGTH) {
      reasons.push(tr('train.reasonTooShort', { 0: len }));
    }
    if (nonEmojiLength(text) < EMOJI_MIN_NON_EMOJI_LEN) {
      reasons.push(tr('train.reasonPureEmoji'));
    }
    var ad = detectAdWords(text);
    if (ad) {
      reasons.push(tr('train.reasonAdContent', { 0: ad }));
    }
    return { valid: reasons.length === 0, reasons: reasons };
  }

  /** 对 topWords 数组加随机扰动（用于「重新分析」模拟差异） */
  function perturbTopWords(topWords) {
    if (!topWords || !topWords.length) return topWords;
    return topWords.slice().map(function (w) {
      // 随机 +/- 1 抖动 count
      var delta = Math.random() < 0.5 ? -1 : 1;
      return { word: w.word, count: Math.max(1, (w.count || 1) + delta) };
    }).sort(function (a, b) {
      // 同 count 时随机顺序，制造轻微差异
      if (b.count !== a.count) return b.count - a.count;
      return Math.random() < 0.5 ? -1 : 1;
    });
  }

  /** 聚合多个分析结果为一个 merged 特征对象 */
  function mergeAnalyses(analyses) {
    var AI = ai();
    if (!AI || !analyses.length) return null;
    var merged = null;
    analyses.forEach(function (feat) {
      merged = merged ? AI.mergeFeatures(merged, feat) : feat;
    });
    return merged;
  }

  /** 取语录库中同品类的语料，聚合其风格特征（含 topWords 与 avgSentenceLength） */
  function getPrevFeaturesForCategory(category) {
    var Store = store();
    if (!Store) return null;
    var corpus = Store.getCorpus();
    var sameCategory = corpus.filter(function (c) { return c.category === category; });
    if (!sameCategory.length) return null;
    var AI = ai();
    if (!AI) return null;
    return AI.aggregateStyle(sameCategory);
  }

  /** 从分析结果中提取典型表达（去重，限制数量） */
  function extractTypicalExpressions(mergedFeatures) {
    if (!mergedFeatures) return [];
    var seen = {};
    var list = [];
    (mergedFeatures.topWords || []).forEach(function (w) {
      if (!seen[w.word] && w.word.length >= 2) {
        list.push({ text: w.word, source: 'word' });
        seen[w.word] = true;
      }
    });
    (mergedFeatures.sentenceOpeners || []).forEach(function (op) {
      if (!seen[op] && op.length >= 2) {
        list.push({ text: op, source: 'opener' });
        seen[op] = true;
      }
    });
    return list.slice(0, 10);
  }

  /* ===================================================================
     四、阶段渲染：input / validating / analyzing / review
     =================================================================== */

  function render() {
    if (!state.container) return;
    var html;
    switch (state.stage) {
      case 'analyzing':
        html = renderAnalyzing();
        break;
      case 'review':
        html = renderReview();
        break;
      case 'validating':
        html = renderInput() + renderValidation();
        break;
      case 'input':
      default:
        html = renderInput() + renderHistory();
        break;
    }
    state.container.innerHTML = html;
    // 分析阶段：渲染后初始化 Lottie 动画；其他阶段：销毁动画实例
    if (state.stage === 'analyzing') {
      initAnalyzingAnimation();
    } else {
      destroyAnalyzingAnimation();
    }
  }

  /* ---------- 4.1 引导卡片（5.7） ---------- */
  function renderGuide() {
    var Store = store();
    var corpusEmpty = !Store || Store.getCorpus().length === 0;
    if (!corpusEmpty) return '';
    return (
      '<section class="train-guide card" aria-label="' + tr('train.guideAria') + '">' +
        '<div class="train-guide__title">' + tr('train.guideTitle') + '</div>' +
        '<p class="train-guide__text">' + tr('train.guideText') + '</p>' +
      '</section>'
    );
  }

  /* ---------- 4.2 输入区（5.1） ---------- */
  function renderInput() {
    var Store = store();
    var tagGroups = Store ? Store.getTagGroups() : [];

    // 模式切换 chips
    var modeChips =
      '<div class="train-mode-row" role="tablist" aria-label="' + tr('train.modeAria') + '">' +
        '<button type="button" class="chip pressable' + (state.mode === 'single' ? ' is-active' : '') + '" data-mode="single">' + tr('train.modeSingle') + '</button>' +
        '<button type="button" class="chip pressable' + (state.mode === 'batch' ? ' is-active' : '') + '" data-mode="batch">' + tr('train.modeBatch') + '</button>' +
      '</div>';

    // placeholder
    var placeholder = state.mode === 'batch'
      ? tr('train.placeholderBatch')
      : tr('train.placeholderSingle');

    // 批量模式：识别条数
    var batchHint = '';
    if (state.mode === 'batch') {
      var items = splitBatchItems(state.text);
      batchHint = items.length
        ? '<div class="train-batch-count">' + tr('train.batchCount', { 0: items.length }) + '</div>'
        : '<div class="train-batch-count train-batch-count--muted">' + tr('train.batchSeparatorHint') + '</div>';
    }

    // 标签组 chips
    var tagChipsHtml = tagGroups.map(function (g) {
      var active = state.tagIds.indexOf(g.id) !== -1;
      var styleAttr = active && g.color
        ? ' style="background:' + escapeHtml(g.color) + ';border-color:' + escapeHtml(g.color) + ';color:#fff;"'
        : '';
      return '<button type="button" class="chip pressable' + (active ? ' is-active' : '') + '"' +
        styleAttr + ' data-tag-id="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</button>';
    }).join('');

    return (
      renderGuide() +
      '<section class="train-input card" aria-label="' + tr('train.inputAria') + '">' +
        '<h2 class="card__title">' + tr('train.inputTitle') + '</h2>' +
        '<p class="card__subtitle">' + tr('train.inputSubtitle') + '</p>' +
        modeChips +
        '<textarea class="textarea train-textarea" data-field="text" placeholder="' + escapeHtml(placeholder) + '">' +
          escapeHtml(state.text) +
        '</textarea>' +
        batchHint +
        '<div class="train-field">' +
          '<label class="train-label">' + tr('train.tagGroupLabel') + '</label>' +
          '<div class="train-chip-row">' +
            (tagChipsHtml || '<span class="text-tertiary">' + tr('train.noTagGroups') + '</span>') +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-primary pressable full-width train-start-btn" data-action="start">' +
          tr('train.startBtn') +
        '</button>' +
      '</section>'
    );
  }

  /* ---------- 4.3 校验结果（5.2） ---------- */
  function renderValidation() {
    if (!state.items.length) return '';
    var invalid = state.items.filter(function (it) { return it.status === 'invalid' && !it.skip; });
    var valid = state.items.filter(function (it) { return it.status === 'ok' || it.skip; });

    if (!invalid.length) return ''; // 全部合法，直接进入分析

    var itemsHtml = state.items.map(function (it, idx) {
      var cls = it.status === 'invalid' && !it.skip
        ? 'train-validate-item train-validate-item--invalid'
        : 'train-validate-item';
      var statusHtml = '';
      if (it.status === 'invalid') {
        var reasonsHtml = it.reasons.map(function (r) {
          return '<li class="train-validate-reason">' + escapeHtml(r) + '</li>';
        }).join('');
        statusHtml =
          '<div class="train-validate-status">' +
            '<span class="train-validate-badge train-validate-badge--warn">' + tr('train.validateWarn') + '</span>' +
            '<ul class="train-validate-reasons">' + reasonsHtml + '</ul>' +
          '</div>';
        var btnLabel = it.skip ? tr('train.validateSkippedResume') : tr('train.validateSkipItem');
        statusHtml +=
          '<button type="button" class="btn pressable train-validate-toggle" data-toggle-index="' + idx + '">' +
            btnLabel +
          '</button>';
      } else {
        statusHtml = '<span class="train-validate-badge train-validate-badge--ok">✓ ' + tr('train.validateOk') + '</span>';
      }

      var preview = it.text.length > 80 ? it.text.slice(0, 80) + '…' : it.text;
      return (
        '<div class="' + cls + '" data-item-index="' + idx + '">' +
          '<div class="train-validate-preview">' + escapeHtml(preview) + '</div>' +
          statusHtml +
        '</div>'
      );
    }).join('');

    return (
      '<section class="train-validate card" aria-label="' + tr('train.validateAria') + '">' +
        '<h2 class="card__title">' + tr('train.validateTitle') + '</h2>' +
        '<p class="card__subtitle">' +
          tr('train.validateCount', { 0: state.items.length, 1: valid.length }) +
          (invalid.length ? tr('train.validateCountWarn', { 0: invalid.length }) : '') +
        '</p>' +
        '<div class="train-validate-list">' + itemsHtml + '</div>' +
        '<div class="train-validate-actions">' +
          '<button type="button" class="btn pressable" data-action="back-to-input">' + tr('train.backToInput') + '</button>' +
          '<button type="button" class="btn btn-primary pressable" data-action="proceed-analyze">' +
            tr('train.continueAnalyze') + (invalid.length ? tr('train.analyzeSkipCount', { 0: invalid.length }) : '') +
          '</button>' +
        '</div>' +
      '</section>'
    );
  }

  /* ---------- 4.4 分析中（加载态） ---------- */
  function renderAnalyzing() {
    var items = state.items.filter(function (it) { return it.status === 'ok' || it.skip === false; });
    var count = items.length;
    var prog = state.analysisProgress;
    var useAI = prog.useAI;
    var current = prog.current;
    var total = prog.total || count;

    var text, hint;
    if (useAI && current > 0) {
      text = tr('train.analyzingPerItem', { 0: current, 1: total });
      hint = tr('train.analyzingPerHint');
    } else if (useAI) {
      text = tr('train.analyzingPreparing', { 0: count });
      hint = tr('train.analyzingPrepareHint');
    } else {
      text = tr('train.analyzingNeedConfig');
      hint = tr('train.analyzingNeedConfigHint');
    }

    // 进度条（仅 AI 模式显示）
    var progressBar = '';
    if (useAI && total > 0) {
      var pct = Math.round((current / total) * 100);
      progressBar =
        '<div class="train-analyzing__progress">' +
          '<div class="train-analyzing__progress-bar" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="train-analyzing__progress-text">' + pct + '%</div>';
    }

    return (
      '<section class="train-analyzing" aria-label="' + tr('train.analyzingAria') + '" aria-live="polite">' +
        '<div class="train-analyzing__card card">' +
          '<div class="train-analyzing__lottie" id="train-analyzing-lottie"></div>' +
          '<div class="train-analyzing__text">' + text + '</div>' +
          '<div class="train-analyzing__hint">' + hint + '</div>' +
          progressBar +
        '</div>' +
      '</section>'
    );
  }

  /* ---------- 4.4a Lottie 动画加载/销毁 ---------- */

  /** 加载分析中 Lottie 动画（donghua/AI-doing/lottie.json） */
  function initAnalyzingAnimation() {
    if (!global.lottie) return; // lottie-web 未加载则跳过
    if (!state.container) return;
    var container = state.container.querySelector('#train-analyzing-lottie');
    if (!container) return;
    // 先销毁旧实例，避免容器被 innerHTML 重置后残留引用
    destroyAnalyzingAnimation();
    try {
      state.lottieInstance = global.lottie.loadAnimation({
        container: container,
        path: 'donghua/AI-doing/lottie.json?v=1',
        renderer: 'svg',
        loop: true,
        autoplay: true,
        name: 'ai-doing'
      });
    } catch (e) {
      state.lottieInstance = null;
    }
  }

  /** 销毁 Lottie 动画实例，释放资源 */
  function destroyAnalyzingAnimation() {
    if (state.lottieInstance) {
      try { state.lottieInstance.destroy(); } catch (e) {}
      state.lottieInstance = null;
    }
  }

  /* ---------- 4.5a 逐条深度分析 HTML 生成 ---------- */

  /** 将标签数组渲染为 chips */
  function renderDeepTags(tags, modifier) {
    var modClass = modifier ? ' train-deep-tag--' + modifier : '';
    if (!tags || !tags.length) {
      return '<span class="train-deep-tag train-deep-tag--neutral">' + tr('train.noFeatureDetected') + '</span>';
    }
    return tags.map(function (t) {
      return '<span class="train-deep-tag' + modClass + '">' + escapeHtml(t) + '</span>';
    }).join('');
  }

  /** 形式化程度标签（data 值 → 翻译键） */
  var FORMALITY_LABEL_KEYS = { formal: 'train.formalityFormal', informal: 'train.formalityInformal', mixed: 'train.formalityMixed' };

  /** 生成单条语料的深度分析 HTML */
  function renderDeepAnalysisItem(analysis, idx) {
    var isExpanded = idx === state.expandedAnalysisIdx;
    var lp = (analysis && analysis.languagePatterns) || {};
    var ff = (analysis && analysis.formatFeatures) || {};
    var st = (analysis && analysis.styleTraits) || {};

    // 预览文本：取分析对应原始语料前 40 字
    var previewText = (analysis && analysis._sourceText) || '';
    var preview = previewText.slice(0, 40);
    if (previewText.length > 40) preview += '…';
    if (!preview) preview = tr('train.corpusItemLabel', { 0: idx + 1 });

    return (
      '<div class="train-deep-item' + (isExpanded ? ' is-expanded' : '') + '" data-deep-idx="' + idx + '">' +
        '<div class="train-deep-item__head" data-deep-toggle="' + idx + '" role="button" tabindex="0" aria-expanded="' + (isExpanded ? 'true' : 'false') + '">' +
          '<span class="train-deep-item__index">' + (idx + 1) + '</span>' +
          '<span class="train-deep-item__preview">' + escapeHtml(preview) + '</span>' +
          '<span class="train-deep-item__chevron">›</span>' +
        '</div>' +
        '<div class="train-deep-item__body">' +
          // 维度一：语言表达规律
          '<div class="train-deep-dim">' +
            '<div class="train-deep-dim__label">' + tr('train.dimLanguage') + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subGrammar') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags(lp.sentenceStructures) + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subVocabulary') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags(lp.vocabularyPreference) + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subSemantics') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags(lp.semanticRelations) + '</div>' +
          '</div>' +
          // 维度二：文本格式特征
          '<div class="train-deep-dim">' +
            '<div class="train-deep-dim__label">' + tr('train.dimFormat') + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subParagraph') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags([ff.paragraphStructure], 'format') + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subPunctuation') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags(ff.punctuationUsage, 'format') + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subSpecialMarkers') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags(ff.specialMarkers, 'format') + '</div>' +
          '</div>' +
          // 维度三：内容风格特点
          '<div class="train-deep-dim">' +
            '<div class="train-deep-dim__label">' + tr('train.dimStyle') + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subFormality') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags([tr(FORMALITY_LABEL_KEYS[st.formality] || 'train.formalityUnknown')], 'style') + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subDomain') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags([st.domain || tr('train.domainGeneric')], 'style') + '</div>' +
            '<div class="train-deep-sub">' + tr('train.subEmotion') + '</div>' +
            '<div class="train-deep-dim__tags">' + renderDeepTags([st.emotionalTone || tr('train.emotionObjective')], 'style') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /** 生成逐条深度分析区块 HTML */
  function renderDeepAnalysisSection() {
    if (!state.analyses || !state.analyses.length) return '';
    var itemsHtml = state.analyses.map(function (a, idx) {
      return renderDeepAnalysisItem(a, idx);
    }).join('');
    return (
      '<div class="card train-section">' +
        '<h3 class="train-section__title">' + tr('train.deepAnalysisTitle') + '</h3>' +
        '<p class="train-deep-analysis__hint">' + tr('train.deepAnalysisHint') + '</p>' +
        '<div class="train-deep-list">' + itemsHtml + '</div>' +
      '</div>'
    );
  }

  /* ---------- 4.5 分析结果（5.3） ---------- */
  function renderReview() {
    var mf = state.mergedFeatures || {};
    var summary = state.summary || tr('train.defaultSummary');
    var sentimentLabel = '';
    if (mf.sentiment === 'positive') sentimentLabel = tr('train.sentimentPositive');
    else if (mf.sentiment === 'negative') sentimentLabel = tr('train.sentimentNegative');
    else sentimentLabel = tr('train.sentimentNeutral');

    // 识别到的品类（AI 自主识别）
    var detectedCategory = state.category || tr('train.catPending');
    var isOther = detectedCategory === '其他';
    var isPending = state.categorySource === 'pending';
    // 品类检测来源标记
    var sourceBadgeHtml;
    if (state.categorySource === 'ai') {
      sourceBadgeHtml = '<span class="train-cat-source train-cat-source--ai" title="' + escapeHtml(tr('train.sourceAiTitle')) + '">AI</span>';
    } else if (isPending) {
      sourceBadgeHtml = '<span class="train-cat-source train-cat-source--pending" title="' + escapeHtml(tr('train.sourcePendingTitle')) + '">' + escapeHtml(tr('train.catPending')) + '</span>';
    } else {
      sourceBadgeHtml = '<span class="train-cat-source train-cat-source--unknown" title="' + escapeHtml(tr('train.sourceUnknownTitle')) + '">' + escapeHtml(tr('train.catUnknown')) + '</span>';
    }
    var categoryBadgeHtml =
      '<span class="train-cat-badge' + (isOther ? ' train-cat-badge--other' : '') + (isPending ? ' train-cat-badge--pending' : '') + '">' +
        escapeHtml(catLabel(detectedCategory)) +
      '</span>' + sourceBadgeHtml;

    // 置信度条：取前 5 个得分最高的品类
    var scores = state.categoryScores || {};
    var sortedCats = Object.keys(scores)
      .map(function (cat) { return { cat: cat, score: scores[cat] || 0 }; })
      .filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 5);
    var maxScore = sortedCats.length ? sortedCats[0].score : 1;
    var confidenceHtml = '';
    if (sortedCats.length) {
      var rowsHtml = sortedCats.map(function (x) {
        var pct = Math.max(4, Math.round((x.score / maxScore) * 100));
        var isWinner = x.cat === detectedCategory && !isOther;
        return (
          '<div class="train-cat-bar-row' + (isWinner ? ' is-winner' : '') + '">' +
            '<span class="train-cat-bar-label">' + escapeHtml(catLabel(x.cat)) + '</span>' +
            '<span class="train-cat-bar-wrap">' +
              '<span class="train-cat-bar" style="width:' + pct + '%"></span>' +
            '</span>' +
            '<span class="train-cat-bar-value">' + x.score + '</span>' +
          '</div>'
        );
      }).join('');
      confidenceHtml =
        '<div class="train-cat-confidence">' +
          '<div class="train-cat-confidence__title">' + tr('train.confidenceTitle') + '</div>' +
          rowsHtml +
        '</div>';
    }

    // 新增高频词 chips（横向滚动）
    var topWordsHtml = (mf.topWords || []).slice(0, 8).map(function (w) {
      return '<span class="chip train-chip-word" data-word="' + escapeHtml(w.word) + '">' +
        escapeHtml(w.word) +
        '<span class="train-chip-count">' + w.count + '</span>' +
      '</span>';
    }).join('');
    if (!topWordsHtml) topWordsHtml = '<span class="text-tertiary">' + tr('train.noTopWords') + '</span>';

    // emoji 列表
    var emojisHtml = (mf.emojis || []).slice(0, 6).map(function (e) {
      return '<span class="train-emoji-item" title="' + escapeHtml(tr('train.emojiAppearTimes', { 0: e.count })) + '">' +
        escapeHtml(e.char) +
        '<span class="train-emoji-count">×' + e.count + '</span>' +
      '</span>';
    }).join('');
    if (!emojisHtml) emojisHtml = '<span class="text-tertiary">' + tr('train.noEmojis') + '</span>';

    // 句长信息
    var avgLen = mf.avgSentenceLength || 0;
    var prevAvg = state.prevAvgSentenceLength || 0;
    var lenChange = prevAvg ? (avgLen - prevAvg) : 0;
    var lenChangeHtml = prevAvg
      ? (lenChange > 0
          ? tr('train.lenIncrease', { 0: lenChange })
          : (lenChange < 0 ? tr('train.lenDecrease', { 0: Math.abs(lenChange) }) : tr('train.lenSame')))
      : '';

    // 典型表达列表（可删除/添加）
    var typicalHtml = state.typicalExpressions.map(function (expr, idx) {
      return (
        '<span class="chip train-typical-chip">' +
          '<span class="train-typical-text">' + escapeHtml(expr.text) + '</span>' +
          '<button type="button" class="train-typical-del pressable" data-del-typical="' + idx + '" aria-label="' + escapeHtml(tr('train.deleteTypicalAria')) + '">×</button>' +
        '</span>'
      );
    }).join('');

    return (
      '<section class="train-review" aria-label="' + escapeHtml(tr('train.reviewAria')) + '">' +
        // 摘要卡片（弹簧入场）
        '<article class="train-summary-card" aria-live="polite">' +
          '<div class="train-summary-card__label">' + tr('train.summaryLabel') + '</div>' +
          '<p class="train-summary-card__text">' + escapeHtml(summary) + '</p>' +
          '<div class="train-summary-card__meta">' +
            '<div class="train-meta-item">' +
              '<span class="train-meta-label">' + tr('train.metaCategory') + '</span>' +
              '<span class="train-meta-value">' + categoryBadgeHtml + '</span>' +
            '</div>' +
            '<div class="train-meta-item">' +
              '<span class="train-meta-label">' + tr('train.metaSentiment') + '</span>' +
              '<span class="train-meta-value">' + escapeHtml(sentimentLabel) + '</span>' +
            '</div>' +
            '<div class="train-meta-item">' +
              '<span class="train-meta-label">' + tr('train.metaAvgLength') + '</span>' +
              '<span class="train-meta-value">' + avgLen + ' ' + tr('train.unitChar') + lenChangeHtml + '</span>' +
            '</div>' +
          '</div>' +
          confidenceHtml +
        '</article>' +

        // 写作DNA签名卡片（跨语料模式挖掘）
        renderDnaSignatureCard() +

        // 语料质量评估卡片
        renderQualityCard() +

        // 高频词
        '<div class="card train-section">' +
          '<h3 class="train-section__title">' + tr('train.topWordsTitle') + '</h3>' +
          '<div class="train-chip-scroller">' + topWordsHtml + '</div>' +
        '</div>' +

        // emoji
        '<div class="card train-section">' +
          '<h3 class="train-section__title">' + tr('train.emojiTitle') + '</h3>' +
          '<div class="train-emoji-row">' + emojisHtml + '</div>' +
        '</div>' +

        // 典型表达（可编辑）
        '<div class="card train-section">' +
          '<h3 class="train-section__title">' + tr('train.typicalTitle') + '</h3>' +
          '<p class="card__subtitle">' + tr('train.typicalHint') + '</p>' +
          '<div class="train-typical-list">' +
            (typicalHtml || '<span class="text-tertiary">' + tr('train.noTypical') + '</span>') +
          '</div>' +
          '<div class="train-typical-add">' +
            '<input type="text" class="input train-typical-input" data-field="new-typical" placeholder="' + escapeHtml(tr('train.typicalPlaceholder')) + '" />' +
            '<button type="button" class="btn pressable train-typical-add-btn" data-action="add-typical">' + tr('train.addTypicalBtn') + '</button>' +
          '</div>' +
        '</div>' +

        // 逐条深度分析（语言规律 / 格式特征 / 风格特点）
        renderDeepAnalysisSection() +

        // 操作按钮
        '<div class="train-review-actions">' +
          '<button type="button" class="btn pressable" data-action="improve-ai">' + tr('train.improveAiBtn') + '</button>' +
          '<button type="button" class="btn pressable" data-action="re-analyze">' + tr('train.reAnalyzeBtn') + '</button>' +
          '<button type="button" class="btn pressable" data-action="back-to-input">' + tr('train.backToEditBtn') + '</button>' +
          '<button type="button" class="btn btn-primary pressable full-width" data-action="confirm-save">' + tr('train.confirmSaveBtn') + '</button>' +
        '</div>' +
      '</section>'
    );
  }

  /* ---------- 4.5a 写作DNA签名卡片（跨语料模式挖掘产物） ---------- */
  function renderDnaSignatureCard() {
    var p = state.crossCorpusPatterns;
    if (!p || !p.styleSignature) return '';

    // 高频写作模式（跨语料重复出现的标签）
    var patternsHtml = (p.recurringPatterns || []).slice(0, 8).map(function (item) {
      return '<span class="train-dna-pattern">' +
        escapeHtml(item.pattern) +
        '<span class="train-dna-pattern__count">×' + item.frequency + '</span>' +
      '</span>';
    }).join('');

    // 结构模板（段落结构 + 长度模式）
    var templatesHtml = (p.structuralTemplates || []).slice(0, 3).map(function (t) {
      return '<div class="train-dna-template">' +
        escapeHtml(t.template) +
        '<span class="train-dna-template__count">' + escapeHtml(tr('train.dnaTemplateCount', { 0: t.count })) + '</span>' +
      '</div>';
    }).join('');

    return (
      '<article class="train-dna-card">' +
        '<div class="train-dna-card__label">' + tr('train.dnaLabel') + '</div>' +
        '<p class="train-dna-card__signature">' + escapeHtml(p.styleSignature) + '</p>' +
        (patternsHtml ? (
          '<div class="train-dna-card__section">' +
            '<div class="train-dna-card__section-title">' + tr('train.dnaPatternsTitle') + '</div>' +
            '<div class="train-dna-patterns">' + patternsHtml + '</div>' +
          '</div>'
        ) : '') +
        (templatesHtml ? (
          '<div class="train-dna-card__section">' +
            '<div class="train-dna-card__section-title">' + tr('train.dnaTemplatesTitle') + '</div>' +
            templatesHtml +
          '</div>'
        ) : '') +
      '</article>'
    );
  }

  /* ---------- 4.5b 语料质量评估卡片 ---------- */
  function renderQualityCard() {
    var q = state.corpusQuality;
    if (!q) return '';

    // 质量分数（带颜色等级）
    var scoreClass = q.score >= 80 ? 'train-quality-score--high'
      : q.score >= 50 ? 'train-quality-score--mid'
      : 'train-quality-score--low';
    var scoreHtml = '<span class="train-quality-score ' + scoreClass + '">' + q.score + ' ' + tr('train.unitScore') + '</span>';

    // 三维度进度条（多样性 / 覆盖度 / 数量）
    var lengthScore = Math.min(100, (q.corpusCount || 0) * 12.5);
    var dimsHtml = [
      { label: tr('train.dimDiversity'), value: q.diversity || 0, barClass: 'train-quality-dim-bar--diversity' },
      { label: tr('train.dimCoverage'), value: q.coverage || 0, barClass: 'train-quality-dim-bar--coverage' },
      { label: tr('train.dimCorpusCount'), value: lengthScore, barClass: 'train-quality-dim-bar--length' }
    ].map(function (d) {
      return '<div class="train-quality-dim">' +
        '<span class="train-quality-dim-label">' + escapeHtml(d.label) + '</span>' +
        '<span class="train-quality-dim-bar-wrap">' +
          '<span class="train-quality-dim-bar ' + d.barClass + '" style="width:' + Math.min(100, d.value) + '%"></span>' +
        '</span>' +
        '<span class="train-quality-dim-value">' + Math.round(d.value) + '%</span>' +
      '</div>';
    }).join('');

    // 异常语料列表
    var outliersHtml = '';
    if (q.outliers && q.outliers.length) {
      var outlierItems = q.outliers.slice(0, 3).map(function (o) {
        return '<div class="train-quality-outlier">' +
          escapeHtml(tr('train.outlierItem', { 0: o.index + 1 })) + escapeHtml(o.issues.join('；')) +
          (o.preview ? '（"' + escapeHtml(o.preview) + '…"）' : '') +
        '</div>';
      }).join('');
      outliersHtml =
        '<div class="train-quality-outliers">' +
          '<div class="train-quality-outliers-title">' + tr('train.outliersTitle', { 0: q.outliers.length }) + '</div>' +
          outlierItems +
        '</div>';
    }

    // 改进建议
    var suggestionsHtml = (q.suggestions || []).map(function (s) {
      return '<div class="train-quality-suggestion">' + escapeHtml(s) + '</div>';
    }).join('');

    return (
      '<article class="train-quality-card">' +
        '<div class="train-quality-card__header">' +
          '<h3 class="train-quality-card__title">' + tr('train.qualityTitle') + '</h3>' +
          scoreHtml +
        '</div>' +
        '<div class="train-quality-dims">' + dimsHtml + '</div>' +
        outliersHtml +
        (suggestionsHtml ? '<div class="train-quality-suggestions">' + suggestionsHtml + '</div>' : '') +
      '</article>'
    );
  }

  /* ---------- 4.6 训练历史（5.6） ---------- */
  function renderHistory() {
    var Store = store();
    var history = Store ? Store.getTrainingHistory() : [];
    // 倒序
    history = history.slice().sort(function (a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (!history.length) {
      return (
        '<section class="train-history" aria-label="' + escapeHtml(tr('train.historyAria')) + '">' +
          '<h2 class="train-section__title">' + tr('train.historyTitle') + '</h2>' +
          '<div class="train-empty">' +
            '<p class="train-empty__text">' + tr('train.emptyHistory') + '</p>' +
            '<p class="train-empty__hint">' + tr('train.emptyHistoryHint') + '</p>' +
          '</div>' +
        '</section>'
      );
    }

    var itemsHtml = history.map(function (h) {
      var expanded = state.expandedHistoryId === h.id;
      var summaryPreview = (h.summary || '').slice(0, 50);
      if ((h.summary || '').length > 50) summaryPreview += '…';

      var detailHtml = '';
      if (expanded) {
        var featuresAdded = (h.featuresAdded || []).slice(0, 8).map(function (w) {
          return '<span class="chip train-hist-chip">' + escapeHtml(w) + '</span>';
        }).join('');
        var corpusIds = (h.corpusIds || []).map(function (cid) {
          return '<button type="button" class="train-hist-corpus-id pressable" data-corpus-id="' + escapeHtml(cid) + '">' +
            escapeHtml(cid.slice(-6)) +
          '</button>';
        }).join('');

        detailHtml =
          '<div class="train-hist-detail">' +
            '<div class="train-hist-detail-row">' +
              '<span class="train-hist-detail-label">' + tr('train.histFullSummary') + '</span>' +
              '<span class="train-hist-detail-value">' + escapeHtml(h.summary || tr('train.noSummary')) + '</span>' +
            '</div>' +
            '<div class="train-hist-detail-row">' +
              '<span class="train-hist-detail-label">' + tr('train.histNewFeatures') + '</span>' +
              '<div class="train-chip-scroller">' +
                (featuresAdded || '<span class="text-tertiary">' + tr('train.none') + '</span>') +
              '</div>' +
            '</div>' +
            '<div class="train-hist-detail-row">' +
              '<span class="train-hist-detail-label">' + tr('train.histThisCorpus') + '</span>' +
              '<div class="train-hist-corpus-list">' +
                (corpusIds || '<span class="text-tertiary">' + tr('train.none') + '</span>') +
              '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-danger pressable train-hist-rollback" data-rollback-id="' + escapeHtml(h.id) + '">' +
              tr('train.rollbackBtn') +
            '</button>' +
          '</div>';
      }

      return (
        '<article class="train-hist-item' + (expanded ? ' is-expanded' : '') + '" data-hist-id="' + escapeHtml(h.id) + '">' +
          '<div class="train-hist-item__header">' +
            '<div class="train-hist-item__body">' +
              '<div class="train-hist-item__meta">' +
                '<span class="train-hist-item__time">' + formatRelative(h.createdAt) + '</span>' +
                '<span class="train-hist-item__sep">·</span>' +
                '<span class="train-hist-item__count">' + tr('train.histCorpusCount', { 0: (h.corpusIds || []).length }) + '</span>' +
                (h.modified ? '<span class="train-hist-item__sep">·</span><span class="train-hist-item__modified">' + tr('train.histModified') + '</span>' : '') +
              '</div>' +
              '<div class="train-hist-item__summary">' + escapeHtml(summaryPreview || tr('train.noSummary')) + '</div>' +
            '</div>' +
            '<span class="train-hist-item__chevron" aria-hidden="true">' + (expanded ? '▾' : '▸') + '</span>' +
          '</div>' +
          detailHtml +
        '</article>'
      );
    }).join('');

    return (
      '<section class="train-history" aria-label="' + escapeHtml(tr('train.historyAria')) + '">' +
        '<h2 class="train-section__title">' + tr('train.historyTitle') + '</h2>' +
        '<div class="train-hist-list">' + itemsHtml + '</div>' +
      '</section>'
    );
  }

  /* ===================================================================
     五、动作处理
     =================================================================== */

  /** 切换模式（单条 / 批量） */
  function setMode(mode) {
    if (mode !== 'single' && mode !== 'batch') return;
    state.mode = mode;
    render();
  }

  /** 切换标签选中 */
  function toggleTag(id) {
    var idx = state.tagIds.indexOf(id);
    if (idx === -1) state.tagIds.push(id);
    else state.tagIds.splice(idx, 1);
    render();
  }

  /** 点击「开始训练」：拆分 → 校验 → 进入 validating 阶段或直接 analyzing */
  function handleStart() {
    var text = state.text || '';
    if (!text.trim()) {
      var App = app();
      if (App) App.showToast(tr('train.toastPasteFirst'), 'error');
      return;
    }

    // 拆分条目
    var items;
    if (state.mode === 'batch') {
      items = splitBatchItems(text);
    } else {
      // 单条模式：把整段作为一条（也允许内含换行）
      items = [text.trim()];
    }

    if (!items.length) {
      var App2 = app();
      if (App2) App2.showToast(tr('train.toastNoValidContent'), 'error');
      return;
    }

    // 逐条校验
    state.items = items.map(function (t) {
      var v = validateItem(t);
      return { text: t, status: v.valid ? 'ok' : 'invalid', reasons: v.reasons, skip: false };
    });

    var hasInvalid = state.items.some(function (it) { return it.status === 'invalid'; });
    if (hasInvalid) {
      // 进入校验阶段：让用户决定跳过/返回
      state.stage = 'validating';
      render();
      return;
    }

    // 全部合法：直接进入分析
    enterAnalyzing();
  }

  /** 切换某条目的 skip 标记 */
  function toggleSkipItem(idx) {
    if (idx < 0 || idx >= state.items.length) return;
    var it = state.items[idx];
    if (it.status !== 'invalid') return;
    it.skip = !it.skip;
    render();
  }

  /** 进入分析阶段 */
  function enterAnalyzing() {
    state.stage = 'analyzing';
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;
    var useAI = !!(cfg && cfg.enabled && cfg.baseURL && cfg.apiKey && cfg.model);
    state.analysisProgress = { current: 0, total: 0, useAI: useAI };
    render();
    // AI 模式直接开始；未配置 AI 时 runAnalysis 内部会提示并返回 input
    runAnalysis(false);
  }

  /**
   * 执行分析：逐条深度分析 + 聚合 + 生成摘要；同时让 AI 自主识别品类
   * - 必须配置 AI API，否则拒绝训练（已移除本地分析兜底）
   * - 逐条串行调用 AI 深度分析（避免并发触发风控）
   * - 单条网络异常 → 提示并跳过，继续后续条目
   */
  function runAnalysis(perturb) {
    var AI = ai();
    if (!AI) {
      var App = app();
      if (App) App.showToast(tr('train.toastAiEngineMissing'), 'error');
      state.stage = 'input';
      render();
      return;
    }

    // 取出有效条目（跳过的 invalid 不分析）
    var validItems = state.items.filter(function (it) {
      return it.status === 'ok' || (it.status === 'invalid' && it.skip);
    }).map(function (it) { return it.text; });

    if (!validItems.length) {
      var App2 = app();
      if (App2) App2.showToast(tr('train.toastNoAnalyzableCorpus'), 'error');
      state.stage = 'input';
      render();
      return;
    }

    // 校验 AI 配置（不再支持本地模式）
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;
    var useAI = !!(cfg && cfg.enabled && cfg.baseURL && cfg.apiKey && cfg.model);
    if (!useAI || typeof AI.deepAnalyzeStyle !== 'function') {
      var App3 = app();
      if (App3) App3.showToast(tr('train.toastNeedAiConfig'), 'error');
      state.stage = 'input';
      render();
      return;
    }

    // ---- 串行深度分析模式（逐条调用，避免并发封号） ----
    var token = ++state.analysisToken;
    state.analysisProgress.total = validItems.length;
    state.analysisProgress.current = 0;
    render(); // 显示 "AI 正在准备深度分析..."

    var results = new Array(validItems.length);
    var skippedCount = 0;
    var chain = Promise.resolve();

    validItems.forEach(function (text, idx) {
      chain = chain.then(function () {
        if (token !== state.analysisToken) return Promise.reject({ cancelled: true });
        state.analysisProgress.current = idx + 1;
        render();
        return AI.deepAnalyzeStyle(text);
      }).then(function (feat) {
        if (token !== state.analysisToken) return;
        feat._sourceText = text;
        feat._analyzedAt = Date.now();
        results[idx] = feat;
      }).catch(function (err) {
        if (token !== state.analysisToken) return;
        if (err && err.cancelled) return;
        // 网络异常 / AI 调用失败 → 提示并跳过，不使用本地兜底
        skippedCount++;
        var App4 = app();
        if (App4) {
          var errMsg = (err && err.message) ? err.message : String(err);
          App4.showToast(tr('train.toastItemFailed', { 0: idx + 1, 1: errMsg }), 'warn', 3200);
        }
        var StoreForLog = store();
        if (StoreForLog && typeof StoreForLog.addOperationLog === 'function') {
          StoreForLog.addOperationLog({
            type: 'ai_analysis',
            op: 'deepAnalyzeStyle #' + idx,
            error: (err && err.message) ? err.message : String(err),
            context: { preview: text.slice(0, 60), index: idx }
          });
        }
      });
    });

    chain.then(function () {
      if (token !== state.analysisToken) return;
      // 过滤掉跳过的条目（稀疏数组中的 holes）
      var validResults = results.filter(function (r) { return r; });
      // 训练总结日志：让用户能在控制台确认 AI 深度训练真实发生
      var aiCount = validResults.filter(function (r) { return r && r._analyzedByAI; }).length;
      var durations = validResults.map(function (r) { return r ? (r._analysisDuration || 0) : 0; }).filter(function (d) { return d > 0; });
      var totalMs = durations.reduce(function (s, d) { return s + d; }, 0);
      var avgMs = durations.length ? Math.round(totalMs / durations.length) : 0;
      console.log('[训练总结] 成功 ' + validResults.length + '/' + validItems.length + ' 条 | AI 深度分析 ' + aiCount + ' 条 | 平均耗时 ' + avgMs + 'ms/条 | 总耗时 ' + totalMs + 'ms');
      // 全部失败 → 提示并返回输入
      if (validResults.length === 0) {
        var App5 = app();
        if (App5) App5.showToast(tr('train.toastAllAnalyzeFailed'), 'error', 4000);
        state.stage = 'input';
        render();
        return;
      }
      // 部分跳过 → 提示
      if (skippedCount > 0) {
        var App6 = app();
        if (App6) App6.showToast(tr('train.toastPartialSkipped', { 0: skippedCount, 1: validResults.length }), 'warn');
      }
      finishAnalysis(validResults, validItems, perturb, AI);
    }).catch(function (err) {
      if (err && err.cancelled) return; // 用户取消，不提示
      if (token !== state.analysisToken) return;
      var App7 = app();
      if (App7) App7.showToast(tr('train.toastInterrupted'), 'error');
      state.stage = 'input';
      render();
    });
  }

  /** 分析完成后的统一处理：跨语料挖掘 → 质量评估 → 聚合 → 品类识别 → 摘要 → 渲染 */
  function finishAnalysis(analyses, validItems, perturb, AI) {
    state.analyses = analyses;
    state.expandedAnalysisIdx = analyses.length > 0 ? 0 : -1;

    // 系统性优化 1：跨语料模式挖掘（提取用户"写作DNA签名"）
    state.crossCorpusPatterns = (typeof AI.mineCrossCorpusPatterns === 'function')
      ? AI.mineCrossCorpusPatterns(analyses)
      : null;

    // 系统性优化 2：语料质量评估（多样性 / 覆盖度 / 异常检测 / 改进建议）
    state.corpusQuality = (typeof AI.assessCorpusQuality === 'function')
      ? AI.assessCorpusQuality(analyses)
      : null;

    // 聚合（融合所有分析结果）
    var merged = mergeAnalyses(state.analyses);
    if (perturb && merged) {
      merged.topWords = perturbTopWords(merged.topWords);
    }
    state.mergedFeatures = merged;

    // 品类检测：纯 AI 语义识别（已移除本地关键词兜底）
    state.category = null;
    state.categoryScores = null;
    state.categorySource = 'pending'; // 等待 AI 识别

    // 完成摘要与渲染（品类待定时先用默认值）
    finalizeReviewStage(merged, analyses, AI);

    // 异步：AI 语义品类检测
    if (typeof AI.aiDetectCategory === 'function') {
      var cfg = (global.Store && typeof global.Store.getAIConfig === 'function')
        ? global.Store.getAIConfig() : null;
      var token = state.analysisToken;
      AI.aiDetectCategory(validItems, cfg).then(function (aiResult) {
        if (token !== state.analysisToken) return; // 已过期
        if (!aiResult || aiResult.source !== 'ai') {
          // AI 未生效 → 归为"其他"
          state.category = '其他';
          state.categorySource = 'unknown';
          state.categoryScores = null;
          var prevFeatures = getPrevFeaturesForCategory(state.category);
          var prevTopWords = prevFeatures ? (prevFeatures.topWords || []) : [];
          state.prevTopWords = prevTopWords;
          state.prevAvgSentenceLength = prevFeatures ? (prevFeatures.avgSentenceLength || 0) : 0;
          state.summary = generateSummarySmart(AI, merged, analyses, state.corpusQuality, prevTopWords, state.crossCorpusPatterns);
          render();
          return;
        }
        state.category = aiResult.category || '其他';
        state.categorySource = 'ai';
        if (aiResult.scores && Object.keys(aiResult.scores).length) {
          state.categoryScores = aiResult.scores;
        }
        // 品类变化 → 重新计算 prevFeatures 与摘要
        var prevFeatures = getPrevFeaturesForCategory(state.category);
        var prevTopWords = prevFeatures ? (prevFeatures.topWords || []) : [];
        state.prevTopWords = prevTopWords;
        state.prevAvgSentenceLength = prevFeatures ? (prevFeatures.avgSentenceLength || 0) : 0;
        state.summary = generateSummarySmart(AI, merged, analyses, state.corpusQuality, prevTopWords, state.crossCorpusPatterns);
        render();
      }).catch(function () {
        if (token !== state.analysisToken) return;
        // AI 品类检测失败 → 归为"其他"
        state.category = '其他';
        state.categorySource = 'unknown';
        state.categoryScores = null;
        var prevFeatures = getPrevFeaturesForCategory(state.category);
        var prevTopWords = prevFeatures ? (prevFeatures.topWords || []) : [];
        state.prevTopWords = prevTopWords;
        state.prevAvgSentenceLength = prevFeatures ? (prevFeatures.avgSentenceLength || 0) : 0;
        state.summary = generateSummarySmart(AI, merged, analyses, state.corpusQuality, prevTopWords, state.crossCorpusPatterns);
        render();
      });
    } else {
      // 无 AI 品类检测能力 → 归为"其他"
      state.category = '其他';
      state.categorySource = 'unknown';
    }
  }

  /** 智能摘要生成：优先用增强版（含质量评估+风格签名），回落旧版 */
  function generateSummarySmart(AI, merged, analyses, quality, prevTopWords, patterns) {
    if (typeof AI.generateEnhancedSummary === 'function') {
      return AI.generateEnhancedSummary(merged, analyses, quality, prevTopWords, patterns);
    }
    return AI.generateSummary(merged, prevTopWords);
  }

  /** 完成 review 阶段的统一渲染 */
  function finalizeReviewStage(merged, analyses, AI) {
    var prevFeatures = getPrevFeaturesForCategory(state.category);
    var prevTopWords = prevFeatures ? (prevFeatures.topWords || []) : [];
    state.prevTopWords = prevTopWords;
    state.prevAvgSentenceLength = prevFeatures ? (prevFeatures.avgSentenceLength || 0) : 0;

    state.summary = generateSummarySmart(AI, merged, analyses, state.corpusQuality, prevTopWords, state.crossCorpusPatterns);
    state.typicalExpressions = extractTypicalExpressions(merged);
    state.modified = false;

    state.stage = 'review';
    render();

    // 触发摘要卡片弹簧入场
    requestAnimationFrame(function () {
      if (!state.container) return;
      var card = state.container.querySelector('.train-summary-card');
      if (card) card.classList.add('is-entered');
    });
  }

  /** 重新分析（带随机扰动） */
  function handleReAnalyze() {
    state.stage = 'analyzing';
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;
    var useAI = !!(cfg && cfg.enabled && cfg.baseURL && cfg.apiKey && cfg.model);
    state.analysisProgress = { current: 0, total: 0, useAI: useAI };
    render();
    runAnalysis(true);
  }

  /** 添加典型表达 */
  function addTypicalExpression(text) {
    text = (text || '').trim();
    if (!text) return;
    // 去重
    var exists = state.typicalExpressions.some(function (e) { return e.text === text; });
    if (exists) {
      var App = app();
      if (App) App.showToast(tr('train.toastDuplicateTypical'), 'default');
      return;
    }
    state.typicalExpressions.push({ text: text, source: 'manual' });
    state.modified = true;
    render();
  }

  /** 删除典型表达 */
  function deleteTypicalExpression(idx) {
    if (idx < 0 || idx >= state.typicalExpressions.length) return;
    state.typicalExpressions.splice(idx, 1);
    state.modified = true;
    render();
  }

  /** 切换逐条深度分析展开/收起（仅局部更新 class，避免整列重渲破坏滚动位置） */
  function toggleDeepAnalysis(idx) {
    if (idx < 0 || idx >= state.analyses.length) return;
    // 再次点击已展开项则收起（设为 -1）
    var newIdx = state.expandedAnalysisIdx === idx ? -1 : idx;
    state.expandedAnalysisIdx = newIdx;
    // 局部更新：避免整列重渲导致跳动
    if (!state.container) return;
    var items = state.container.querySelectorAll('.train-deep-item');
    items.forEach(function (el, i) {
      var head = el.querySelector('[data-deep-toggle]');
      if (i === newIdx) {
        el.classList.add('is-expanded');
        if (head) head.setAttribute('aria-expanded', 'true');
      } else {
        el.classList.remove('is-expanded');
        if (head) head.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /** 确认入库（5.4）—— 非回滚机制：单条失败不中断，成功项保留 */
  function handleConfirmSave() {
    var Store = store();
    var App = app();
    if (!Store) {
      if (App) App.showToast(tr('train.toastStoreMissing'), 'error');
      return;
    }

    // 取出要入库的条目（跳过的 invalid 不入）
    var validItems = state.items.filter(function (it) {
      return it.status === 'ok' || (it.status === 'invalid' && it.skip);
    });
    if (!validItems.length) {
      if (App) App.showToast(tr('train.toastNoCorpusToSave'), 'error');
      return;
    }

    // 构建 text → analysis 的查找表（跳过失败条目后索引不再连续）
    var analysisMap = {};
    (state.analyses || []).forEach(function (a) {
      if (a && a._sourceText) analysisMap[a._sourceText] = a;
    });

    // 非回滚批量入库：单条失败记录日志并继续，成功项保留
    var batchResult = Store.batchExecuteNoRollback(
      validItems,
      function (it, idx) {
        var feat = analysisMap[it.text] || null;
        var added = Store.addCorpus({
          text: it.text,
          category: state.category,
          tagIds: state.tagIds.slice(),
          source: 'manual',
          styleFeatures: feat || {}
        });
        if (!added) throw new Error(tr('train.errWriteFail'));
        return added;
      },
      { type: 'corpus_save', opName: 'addCorpus' }
    );

    // 收集成功入库的语料 id
    var corpusIds = batchResult.succeeded.map(function (s) { return s.result.id; });

    // 记录训练历史（即使部分失败也记录成功的 id）
    var featuresAdded = (state.mergedFeatures && state.mergedFeatures.topWords)
      ? state.mergedFeatures.topWords.slice(0, 6).map(function (w) { return w.word; })
      : [];

    Store.addTrainingHistory({
      corpusIds: corpusIds,
      summary: state.summary,
      featuresAdded: featuresAdded,
      modified: !!state.modified
    });

    // 根据批量结果给出反馈
    var totalCorpus = Store.getCorpus().length;
    var okCount = batchResult.succeeded.length;
    var failCount = batchResult.failed.length;
    if (failCount === 0) {
      if (App) App.showToast(tr('train.toastTrainDone', { 0: totalCorpus }), 'success');
    } else if (okCount === 0) {
      if (App) App.showToast(tr('train.toastSaveAllFailed', { 0: failCount }), 'error');
    } else {
      if (App) App.showToast(tr('train.toastSavePartial', { 0: okCount, 1: failCount }), 'warn');
    }

    // 重置到 input 阶段
    resetToInput();

    // 弹出抽屉询问是否跳转语录库或继续训练
    if (App && typeof App.showDrawer === 'function' && okCount > 0) {
      promptNextAction(App);
    }
  }

  /** 提示用户后续操作：跳转语录库 / 继续训练 */
  function promptNextAction(App) {
    var wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '12px';
    wrap.style.padding = '4px 0';

    var msg = document.createElement('div');
    msg.textContent = tr('train.nextActionMsg');
    msg.style.fontSize = 'var(--fs-body)';
    msg.style.lineHeight = '1.5';
    msg.style.color = 'var(--text-primary)';
    wrap.appendChild(msg);

    var btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';

    var continueBtn = document.createElement('button');
    continueBtn.className = 'btn pressable';
    continueBtn.style.flex = '1';
    continueBtn.textContent = tr('train.continueTrain');

    var gotoLibBtn = document.createElement('button');
    gotoLibBtn.className = 'btn btn-primary pressable';
    gotoLibBtn.style.flex = '1';
    gotoLibBtn.textContent = tr('train.gotoLibrary');

    btnRow.appendChild(continueBtn);
    btnRow.appendChild(gotoLibBtn);
    wrap.appendChild(btnRow);

    var close = App.showDrawer(wrap, {
      title: tr('train.drawerTrainDoneTitle'),
      onClose: function () {}
    });

    continueBtn.addEventListener('click', function () {
      close();
    });
    gotoLibBtn.addEventListener('click', function () {
      close();
      if (typeof App.navigate === 'function') App.navigate('library');
    });
  }

  /* ===================================================================
     六.5 鞭策 AI · 对话式追加训练语料
     - 用户通过自然语言指令要求 AI 补充语料
     - AI 生成的新语料只能【追加】，不得修改或删除已有内容
     - 聊天历史在 state.improveAIChat 中维护
     =================================================================== */

  /** 打开鞭策 AI 聊天抽屉 */
  function openImproveAIChat() {
    var App = app();
    var Store = store();
    if (!App || !Store || typeof App.showDrawer !== 'function') {
      if (App) App.showToast(tr('train.toastDrawerMissing'), 'error');
      return;
    }

    // 检查 AI 配置
    var cfg = Store.getAIConfig();
    var useAI = !!(cfg && cfg.enabled && cfg.baseURL && cfg.apiKey && cfg.model);
    if (!useAI) {
      if (App) App.showToast(tr('train.toastImproveNeedAi'), 'warn');
      return;
    }

    // 首次打开时加入系统欢迎语
    if (state.improveAIChat.length === 0) {
      state.improveAIChat.push({
        role: 'assistant',
        content: tr('train.improveWelcome')
      });
    }

    var drawerHTML = renderImproveAIChat();
    App.showDrawer({
      title: tr('train.improveDrawerTitle'),
      content: drawerHTML,
      actions: [] // 操作按钮内嵌在 content 中
    });

    // 抽屉渲染后绑定事件并滚动到底部
    setTimeout(function () {
      bindImproveAIEvents();
      scrollImproveAIToBottom();
    }, 50);
  }

  /** 渲染鞭策 AI 聊天界面 */
  function renderImproveAIChat() {
    var messages = state.improveAIChat || [];
    var messagesHtml = messages.map(function (m) {
      var isUser = m.role === 'user';
      var cls = isUser ? 'improve-msg--user' : 'improve-msg--ai';
      var corpusTag = m.corpusAdded
        ? '<div class="improve-msg__tag">' + tr('train.improveCorpusAdded', { 0: m.corpusAdded.count }) + '</div>'
        : '';
      return (
        '<div class="improve-msg ' + cls + '">' +
          '<div class="improve-msg__bubble">' + escapeHtml(m.content) + '</div>' +
          corpusTag +
        '</div>'
      );
    }).join('');

    var loadingHtml = state.improveAILoading
      ? '<div class="improve-msg improve-msg--ai improve-msg--loading">' +
          '<div class="improve-msg__bubble"><span class="improve-typing">' + tr('train.improveGenerating') + '</span></div>' +
        '</div>'
      : '';

    return (
      '<div class="improve-chat" aria-label="' + escapeHtml(tr('train.improveChatAria')) + '">' +
        '<div class="improve-chat__messages" id="improve-chat-messages">' +
          messagesHtml +
          loadingHtml +
        '</div>' +
        '<div class="improve-chat__input-row">' +
          '<textarea class="textarea improve-chat__input" id="improve-chat-input" ' +
            'placeholder="' + escapeHtml(tr('train.improveInputPlaceholder')) + '" rows="2"></textarea>' +
          '<button type="button" class="btn btn-primary pressable improve-chat__send" ' +
            'id="improve-chat-send" data-action="improve-send"' +
            (state.improveAILoading ? ' disabled' : '') + '>' + tr('train.sendBtn') + '</button>' +
        '</div>' +
        '<p class="improve-chat__hint">' + tr('train.improveRuleHint') + '</p>' +
      '</div>'
    );
  }

  /** 绑定鞭策 AI 聊天事件 */
  function bindImproveAIEvents() {
    var sendBtn = document.getElementById('improve-chat-send');
    var inputEl = document.getElementById('improve-chat-input');
    if (sendBtn) {
      // 使用直接绑定（抽屉内容不在 state.container 内，委托不生效）
      sendBtn.addEventListener('click', handleImproveAISend);
    }
    if (inputEl) {
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleImproveAISend();
        }
      });
    }
  }

  /** 发送鞭策 AI 指令 */
  function handleImproveAISend() {
    var App = app();
    var Store = store();
    var AIClient = ai();
    var inputEl = document.getElementById('improve-chat-input');
    if (!inputEl) return;
    var text = (inputEl.value || '').trim();
    if (!text) return;
    if (state.improveAILoading) return;

    // 校验
    if (!AIClient || typeof AIClient.chat !== 'function') {
      if (App) App.showToast(tr('train.toastAiClientMissing'), 'error');
      return;
    }
    var cfg = Store.getAIConfig();

    // 追加用户消息
    state.improveAIChat.push({ role: 'user', content: text });
    state.improveAILoading = true;
    inputEl.value = '';
    refreshImproveAIChat();

    // 构造对话上下文
    var systemPrompt = buildImproveAISystemPrompt();
    var conversationMessages = [{ role: 'system', content: systemPrompt }];
    // 附带最近 6 轮对话（避免 prompt 过长）
    var recent = state.improveAIChat.slice(-6);
    recent.forEach(function (m) {
      conversationMessages.push({ role: m.role, content: m.content });
    });

    AIClient.chat({
      messages: conversationMessages,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: 800,
      temperature: 0.85,
      timeout: cfg.testTimeout || 60000
    }).then(function (response) {
      state.improveAILoading = false;
      // 解析 AI 返回的新语料
      var parsed = parseImproveAIResponse(response);
      var validCorpusItems = [];
      if (parsed.corpusItems && parsed.corpusItems.length) {
        parsed.corpusItems.forEach(function (corpusText) {
          if (corpusText && corpusText.length >= 10) validCorpusItems.push(corpusText);
        });
      }

      if (!validCorpusItems.length) {
        // 没有有效新语料：仅追加 AI 回复
        state.improveAIChat.push({
          role: 'assistant',
          content: parsed.reply || response || tr('train.improveProcessed'),
          corpusAdded: null
        });
        if (state.stage === 'review') render();
        refreshImproveAIChat();
        return;
      }

      // 任务1：非回滚批量持久化到 Store（单条失败不中断，失败项记入日志）
      var persistResult = Store.batchExecuteNoRollback(
        validCorpusItems,
        function (corpusText, idx) {
          var added = Store.addCorpus({
            text: corpusText,
            category: state.category || '',
            tagIds: state.tagIds.slice(),
            source: 'improve_ai',
            styleFeatures: {}
          });
          if (!added) throw new Error(tr('train.errWriteFail'));
          return { id: added.id, text: corpusText };
        },
        { type: 'improve_ai_persist', opName: 'addCorpus' }
      );

      // 同步追加到内存 state.items（仅追加，不修改已有）
      persistResult.succeeded.forEach(function (s) {
        state.items.push({ text: s.result.text, status: 'ok', reasons: [], skip: false });
      });

      // 鞭策AI 新增语料：使用 deepAnalyzeStyle 逐条 AI 深度分析（不再使用本地 analyzeStyle 占位）
      var hasDeepAnalyze = typeof AIClient.deepAnalyzeStyle === 'function';

      var analysisPromises = persistResult.succeeded.map(function (s) {
        var corpusText = s.result.text;
        if (!hasDeepAnalyze) return Promise.resolve();

        return AIClient.deepAnalyzeStyle(corpusText).then(function (deepFeat) {
          deepFeat._sourceText = corpusText;
          deepFeat._analyzedAt = Date.now();
          state.analyses.push(deepFeat);
        }).catch(function () {
          // AI 分析失败 → 跳过该条，不加入 state.analyses
          var App = app();
          if (App) App.showToast(tr('train.toastNewCorpusAnalyzeFailed'), 'warn');
        });
      });

      // 等所有深度分析完成后，重新聚合特征与摘要
      Promise.all(analysisPromises).then(function () {
        if (state.analyses.length) {
          var merged = mergeAnalyses(state.analyses);
          if (merged) state.mergedFeatures = merged;
          if (typeof AIClient.generateSummary === 'function') {
            state.summary = AIClient.generateSummary(merged, state.prevTopWords);
          }
        }
        if (state.stage === 'review') render();
        refreshImproveAIChat();
      }).catch(function () {
        // 兜底：即使 Promise.all 失败也刷新一次
        if (state.stage === 'review') render();
        refreshImproveAIChat();
      });

      var addedCount = persistResult.succeeded.length;
      var failedCount = persistResult.failed.length;

      // 追加 AI 回复
      var replyText = parsed.reply || response || tr('train.improveProcessed');
      if (failedCount > 0) {
        replyText += '\n\n' + tr('train.improvePersistFailNote', { 0: failedCount });
      }
      var aiMessage = {
        role: 'assistant',
        content: replyText,
        corpusAdded: addedCount > 0 ? { count: addedCount, failed: failedCount } : null
      };
      state.improveAIChat.push(aiMessage);

      // 立即刷新主视图（新语料出现在 review 列表中），深度分析完成后会再刷新一次
      if (state.stage === 'review') render();
      refreshImproveAIChat();
    }).catch(function (err) {
      state.improveAILoading = false;
      var errMsg = (err && err.message) ? err.message : tr('train.requestFailed');
      state.improveAIChat.push({
        role: 'assistant',
        content: tr('train.improveFailReply', { 0: errMsg })
      });
      // 记录错误日志
      if (Store && typeof Store.addOperationLog === 'function') {
        Store.addOperationLog({
          type: 'improve_ai',
          op: 'chat',
          error: errMsg,
          context: { instruction: text.slice(0, 60) }
        });
      }
      refreshImproveAIChat();
    });
  }

  /** 构造鞭策 AI 系统提示词 */
  function buildImproveAISystemPrompt() {
    var category = state.category || '通用';
    var features = state.mergedFeatures || {};
    var topWords = (features.topWords || []).slice(0, 8).map(function (w) { return w.word; }).join('、');
    var avgLen = features.avgSentenceLength || 0;
    var sampleTexts = state.items.slice(0, 3).map(function (it) {
      return '「' + (it.text || '').slice(0, 80) + '」';
    }).join('\n');

    return [
      '你是一个评价语料生成助手。用户已训练了一些大众点评风格评价语料，现在要通过对话追加新语料。',
      '【严格规则】',
      '1. 只能生成新语料【追加】到训练集，绝不修改或删除已有语料',
      '2. 新语料必须与已有语料风格一致（同品类、同语气、同用词习惯）',
      '3. 每次生成 1-3 条新语料，每条 50-200 字',
      '4. 回复格式：先用一句话说明你做了什么，然后给出新语料',
      '5. 每条新语料用 <corpus> 标签包裹，如：<corpus>这里是新评价内容</corpus>',
      '',
      '【当前训练集信息】',
      '品类：' + category,
      '高频词：' + (topWords || '无'),
      '平均句长：' + (avgLen ? Math.round(avgLen) + '字' : '未知'),
      '已有语料示例：',
      sampleTexts || '（暂无）'
    ].join('\n');
  }

  /** 解析鞭策 AI 返回，提取新语料 */
  function parseImproveAIResponse(response) {
    if (!response || typeof response !== 'string') {
      return { reply: tr('train.improveReceived'), corpusItems: [] };
    }
    var corpusItems = [];
    // 提取 <corpus>...</corpus> 标签内容
    var regex = /<corpus>([\s\S]*?)<\/corpus>/g;
    var match;
    while ((match = regex.exec(response)) !== null) {
      var text = match[1].trim();
      if (text) corpusItems.push(text);
    }
    // 提取回复说明（去掉 corpus 标签后的文本）
    var reply = response.replace(/<corpus>[\s\S]*?<\/corpus>/g, '').trim();
    if (!reply) {
      reply = corpusItems.length
        ? tr('train.improveGeneratedCount', { 0: corpusItems.length })
        : tr('train.improveProcessed');
    }
    return { reply: reply, corpusItems: corpusItems };
  }

  /** 局部刷新鞭策 AI 聊天区域（不重建整个抽屉） */
  function refreshImproveAIChat() {
    var container = document.getElementById('improve-chat-messages');
    if (!container) return;
    var messages = state.improveAIChat || [];
    var messagesHtml = messages.map(function (m) {
      var isUser = m.role === 'user';
      var cls = isUser ? 'improve-msg--user' : 'improve-msg--ai';
      var corpusTag = m.corpusAdded
        ? '<div class="improve-msg__tag">' + tr('train.improveCorpusAdded', { 0: m.corpusAdded.count }) + '</div>'
        : '';
      return (
        '<div class="improve-msg ' + cls + '">' +
          '<div class="improve-msg__bubble">' + escapeHtml(m.content) + '</div>' +
          corpusTag +
        '</div>'
      );
    }).join('');

    var loadingHtml = state.improveAILoading
      ? '<div class="improve-msg improve-msg--ai improve-msg--loading">' +
          '<div class="improve-msg__bubble"><span class="improve-typing">' + tr('train.improveGenerating') + '</span></div>' +
        '</div>'
      : '';

    container.innerHTML = messagesHtml + loadingHtml;

    // 更新发送按钮状态
    var sendBtn = document.getElementById('improve-chat-send');
    if (sendBtn) sendBtn.disabled = state.improveAILoading;

    scrollImproveAIToBottom();
  }

  /** 滚动聊天到底部 */
  function scrollImproveAIToBottom() {
    var container = document.getElementById('improve-chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  /** 重置到 input 阶段（清空输入） */
  function resetToInput() {
    // 递增分析令牌：取消任何挂起的异步 AI 品类检测回调，防止污染已清空的 state
    state.analysisToken++;
    state.stage = 'input';
    state.text = '';
    state.items = [];
    state.analyses = [];
    state.expandedAnalysisIdx = 0;
    state.mergedFeatures = null;
    state.summary = '';
    state.typicalExpressions = [];
    state.modified = false;
    // category 重置：每次训练都由 AI 重新识别
    state.category = null;
    state.categoryScores = null;
    // 系统性优化产物重置
    state.crossCorpusPatterns = null;
    state.corpusQuality = null;
    state.categorySource = 'pending';
    // 鞭策AI聊天历史重置
    state.improveAIChat = [];
    state.improveAILoading = false;
    // tagIds 保留（用户可能想继续用相同标签组）
    render();
  }

  /** 返回修改：保留 textarea 内容，回到 input 阶段 */
  function backToInput() {
    state.stage = 'input';
    render();
  }

  /** 展开/收起训练历史条目 */
  function toggleHistoryExpand(id) {
    if (state.expandedHistoryId === id) state.expandedHistoryId = null;
    else state.expandedHistoryId = id;
    render();
  }

  /** 回滚训练历史（5.6） */
  function handleRollback(id) {
    var App = app();
    var Store = store();
    if (!App || !Store) return;
    App.showConfirm(tr('train.rollbackConfirmMsg'), {
      title: tr('train.rollbackTitle'),
      confirmText: tr('train.rollbackConfirmBtn'),
      cancelText: tr('train.cancelBtn'),
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      var ok2 = Store.deleteTrainingHistory(id);
      if (ok2) {
        if (App.showToast) App.showToast(tr('train.toastRolledBack'), 'success');
        state.expandedHistoryId = null;
        render();
      } else {
        if (App.showToast) App.showToast(tr('train.toastRollbackFailed'), 'error');
      }
    });
  }

  /** 查看语料详情（点击 corpusId） */
  function viewCorpusDetail(corpusId) {
    var Store = store();
    var App = app();
    if (!Store || !App) return;
    var c = Store.getCorpusById(corpusId);
    if (!c) {
      if (App.showToast) App.showToast(tr('train.toastCorpusRemoved'), 'default');
      return;
    }
    var wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '8px';

    var text = document.createElement('div');
    text.textContent = c.text;
    text.style.fontSize = 'var(--fs-body)';
    text.style.lineHeight = '1.55';
    text.style.color = 'var(--text-primary)';
    text.style.padding = '8px 0';
    wrap.appendChild(text);

    var meta = document.createElement('div');
    meta.style.fontSize = 'var(--fs-caption)';
    meta.style.color = 'var(--text-tertiary)';
    meta.textContent = tr('train.corpusDetailMeta', {
      0: c.category ? catLabel(c.category) : tr('train.uncategorized'),
      1: c.source || 'manual'
    });
    wrap.appendChild(meta);

    App.showDrawer(wrap, { title: tr('train.corpusDetailTitle') });
  }

  /* ===================================================================
     六、事件绑定
     =================================================================== */

  function bindEvents() {
    if (!state.container) return;
    var App = app();
    var Store = store();

    // 委托：input 变化
    on(state.container, 'input', function (e) {
      var target = e.target.closest('[data-field]');
      if (!target) return;
      var field = target.getAttribute('data-field');
      if (field === 'text') {
        state.text = target.value;
        // 批量模式下实时更新计数（轻量局部刷新，避免重渲破坏焦点）
        if (state.mode === 'batch') {
          updateBatchCount();
        }
      } else if (field === 'new-typical') {
        // 不立即写入 state，由 add 按钮触发
      }
    });

    // 委托：click（按钮 / chip）
    on(state.container, 'click', function (e) {
      // 优先匹配带 data-action 的元素
      var actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        var action = actionEl.getAttribute('data-action');
        handleAction(action);
        return;
      }
      // 注意：hist-item 内部有 rollback / corpus-id 等子按钮，必须先于 data-hist-id 匹配
      // 否则 closest('[data-hist-id]') 会先匹配到父容器，导致子按钮失效。
      // 回滚（在 hist-item 内）
      var rollbackEl = e.target.closest('[data-rollback-id]');
      if (rollbackEl) {
        handleRollback(rollbackEl.getAttribute('data-rollback-id'));
        return;
      }
      // 语料 id 查看（在 hist-item detail 内）
      var corpusEl = e.target.closest('[data-corpus-id]');
      if (corpusEl) {
        viewCorpusDetail(corpusEl.getAttribute('data-corpus-id'));
        return;
      }
      // 校验跳过切换
      var toggleEl = e.target.closest('[data-toggle-index]');
      if (toggleEl) {
        var idx = parseInt(toggleEl.getAttribute('data-toggle-index'), 10);
        toggleSkipItem(idx);
        return;
      }
      // 典型表达删除
      var delTypEl = e.target.closest('[data-del-typical]');
      if (delTypEl) {
        var di = parseInt(delTypEl.getAttribute('data-del-typical'), 10);
        deleteTypicalExpression(di);
        return;
      }
      // 逐条深度分析展开/收起
      var deepToggleEl = e.target.closest('[data-deep-toggle]');
      if (deepToggleEl) {
        var deepIdx = parseInt(deepToggleEl.getAttribute('data-deep-toggle'), 10);
        toggleDeepAnalysis(deepIdx);
        return;
      }
      // 模式切换
      var modeEl = e.target.closest('[data-mode]');
      if (modeEl) {
        setMode(modeEl.getAttribute('data-mode'));
        return;
      }
      // 标签切换
      var tagEl = e.target.closest('[data-tag-id]');
      if (tagEl) {
        toggleTag(tagEl.getAttribute('data-tag-id'));
        return;
      }
      // 训练历史展开/收起（放在最后，避免拦截子按钮）
      var histEl = e.target.closest('[data-hist-id]');
      if (histEl) {
        var hid = histEl.getAttribute('data-hist-id');
        toggleHistoryExpand(hid);
        return;
      }
    });

    // 键盘可达性：Enter 触发 data-action
    on(state.container, 'keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      // 排除 input/textarea 自身的 Enter
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      handleAction(actionEl.getAttribute('data-action'));
    });

    // Store 变化 → refresh（仅在当前视图激活时）
    if (Store && typeof Store.onChange === 'function') {
      state.unsubStore = Store.onChange(function () {
        if (App && App.getCurrentView && App.getCurrentView() === 'train') {
          // 仅在 input 阶段或 review 完成后刷新（避免破坏分析流程）
          if (state.stage === 'input' || state.stage === 'validating') {
            refresh();
          }
        }
      });
    }

    // 路由切换回 train 时，重渲一次
    if (App && typeof App.onRouteChange === 'function') {
      state.unsubRoute = App.onRouteChange(function (toView) {
        if (toView === 'train') {
          state.rafId = requestAnimationFrame(function () {
            refresh();
          });
        }
      });
    }
  }

  /** 批量计数局部刷新（不破坏 textarea 焦点） */
  function updateBatchCount() {
    if (!state.container) return;
    var node = state.container.querySelector('.train-batch-count');
    if (!node) {
      // 节点不存在（可能未渲染过），重新渲染
      render();
      return;
    }
    var items = splitBatchItems(state.text);
    if (items.length) {
      node.textContent = tr('train.batchDetected', { 0: items.length });
      node.classList.remove('train-batch-count--muted');
    } else {
      node.textContent = tr('train.batchSeparatorHint');
      node.classList.add('train-batch-count--muted');
    }
  }

  /** 统一动作分发 */
  function handleAction(action) {
    switch (action) {
      case 'start':
        handleStart();
        break;
      case 'proceed-analyze':
        enterAnalyzing();
        break;
      case 'back-to-input':
        backToInput();
        break;
      case 're-analyze':
        handleReAnalyze();
        break;
      case 'confirm-save':
        handleConfirmSave();
        break;
      case 'improve-ai':
        openImproveAIChat();
        break;
      case 'add-typical':
        var input = state.container && state.container.querySelector('[data-field="new-typical"]');
        addTypicalExpression(input ? input.value : '');
        break;
      default:
        break;
    }
  }

  /* ===================================================================
     七、视图契约：mount / unmount / refresh
     =================================================================== */

  function mount(container) {
    state.container = container || document.querySelector('.view[data-view="train"]');
    if (!state.container) return;

    // 若上次卸载时卡在 analyzing（setTimeout 被清理），重置回 input 避免空转
    if (state.stage === 'analyzing') {
      state.stage = 'input';
    }
    // 首次挂载时初始化 mode
    if (!state.mode) state.mode = 'single';

    render();
    bindEvents();
  }

  function unmount() {
    // 取消进行中的异步分析（令牌递增使旧 Promise 链失效）
    state.analysisToken++;
    destroyAnalyzingAnimation();
    clearListeners();
    clearTimers();
    if (state.unsubStore) {
      try { state.unsubStore(); } catch (e) {}
      state.unsubStore = null;
    }
    if (state.unsubRoute) {
      try { state.unsubRoute(); } catch (e) {}
      state.unsubRoute = null;
    }
    state.container = null;
  }

  function refresh() {
    if (!state.container) return;
    // 保留滚动位置
    var scrollTop = state.container.scrollTop;
    render();
    if (state.container) state.container.scrollTop = scrollTop;
    // 已渲染的元素置为 entered（避免视觉跳动）
    if (state.stage === 'review' && state.container) {
      var card = state.container.querySelector('.train-summary-card');
      if (card) card.classList.add('is-entered');
    }
  }

  /* ===================================================================
     八、注册视图
     =================================================================== */

  if (global.App && typeof global.App.registerView === 'function') {
    global.App.registerView('train', {
      mount: mount,
      unmount: unmount,
      refresh: refresh
    });
  } else {
    // app.js 尚未加载，延迟注册
    global.addEventListener('DOMContentLoaded', function () {
      if (global.App && typeof global.App.registerView === 'function') {
        global.App.registerView('train', {
          mount: mount,
          unmount: unmount,
          refresh: refresh
        });
      }
    });
  }

})(typeof window !== 'undefined' ? window : this);
