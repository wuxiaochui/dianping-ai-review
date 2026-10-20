/* =====================================================================
   点评 AI 评价生成器 · 生成视图 (generate) — 核心模块
   契约：App.registerView('generate', { mount, unmount, refresh })
   - mount(container): 渲染到 <section class="view" data-view="generate">
   - unmount(): 清理监听 / 取消流式 setInterval / 回收拖拽会话
   - refresh(): 数据变化时重渲（保留表单状态与结果文本）
   设计：Apple 风格 —— 星级 1:1 跟手 + 释放弹簧归位、流式逐字显示、
        中断可重定向、.pressable 即时反馈、结果区弹簧入场、
        半透明卡片、留白克制、reduced-motion 适配。
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
    rendered: false,

    /* --- 生成模式（signature 元素：三模式切换器） --- */
    mode: 'default',            // 'default' | 'qa' | 'polish'

    /* --- 表单字段 (6.1 / 6.2) · default 模式 --- */
    merchant: '',               // 商家名（qa 模式也共用）
    category: '美食',           // 品类
    stars: 5,                   // 0.5-5（支持半星，如 4.5）
    length: 220,                // 字数（数字）或 '短'/'中'/'长'（兼容旧值）
    options: {},                // {勾选项 key: true} 动态品类勾选项

    /* --- 风格来源 (6.3) · default 模式 --- */
    styleSourceMode: 'all',     // 'all' | 'single' | 'mixed'
    styleSourceTagId: null,     // single 模式下选中的标签组 id
    styleSourceTagIds: [],      // mixed 模式下选中的标签组 id 集合

    /* --- 风格倾向 (6.3) · default 模式 --- */
    tendencyStyle: null,        // 'casual'|'literary'|'exaggerated'|'restrained'|null
    tendencyEmoji: null,        // true | false | null

    /* --- 提问模式 (qa) 状态 --- */
    qaStage: 'setup',           // 'setup' | 'asking' | 'generating'
    qaQuestions: [],            // AI 生成的问题列表 [{text, options:[]}]
    qaCurrentIdx: 0,            // 当前展示的问题索引
    qaAnswers: {},              // {问题索引: 答案} —— 选择题为数组["选项A","选项B"]，填空题为字符串
    qaLoadingQuestions: false,  // 是否正在加载问题
    qaError: null,              // {message} 提问阶段错误
    qaAdditionalComment: '',    // 补充备注（与问题同等权重传给 AI）
    qaWordCount: 'auto',        // 字数选择：'auto' | 数字 | 'short'/'medium'/'long'

    /* --- 润色模式 (polish) 状态 --- */
    polishRawText: '',          // 用户输入的原始文本
    polishOriginalText: '',     // 已润色前的原文备份（结果态对比用）
    polishStars: 0,             // 目标星级（0 表示不指定）
    polishStage: 'input',       // 'input' | 'streaming' | 'result'
    polishWordCount: 'auto',    // 字数选择：'auto' | 数字

    /* --- 流程阶段（default + qa 模式共用 result；polish 用 polishStage） --- */
    stage: 'input',             // 'input' | 'streaming' | 'result'

    /* --- 流式生成 (Task 6 改造：generateReviewStream 整合) --- */
    abortController: null,      // 当前生成的 AbortController，用于中断 real API fetch / mock setInterval
    generationId: 0,            // 自增 ID，每次新发起生成 +1，旧回调作废
    streamFullText: '',         // 已累积的生成文本（onToken 追加）
    errorState: null,           // {message} 生成失败时设置，结果区显示「生成失败」+ 重试
    historyId: null,            // 已保存历史记录 id（用于 update）

    /* --- 结果 (6.6 / 6.7) --- */
    validationMsg: '',          // 真实性校验提示
    feedback: null,             // 'like' | 'dislike' | null

    /* --- 星级拖拽会话 --- */
    starDragSession: null       // {starsEl, pointerId, cleanup, active}
  };

  /* ===================================================================
     二、常量
     =================================================================== */

  // 生成模式定义（signature 元素：三模式切换器）
  // 每个模式有专属强调色，仅用于切换器选中态与该模式下少量强调元素
  var MODES = [
    { key: 'default', label: '默认', labelKey: 'generate.modeDefault', desc: '填写参数生成', descKey: 'generate.modeDefaultDesc', icon: '✍', accent: 'var(--accent)' },
    { key: 'qa',      label: '提问', labelKey: 'generate.modeQa', desc: 'AI 提问收集信息', descKey: 'generate.modeQaDesc', icon: '?', accent: 'var(--accent-purple)' },
    { key: 'polish',  label: '润色', labelKey: 'generate.modePolish', desc: '优化已有文本', descKey: 'generate.modePolishDesc', icon: '✨', accent: 'var(--accent-teal)' }
  ];

  // 品类列表（与 train.js 保持一致，新增「甜品饮品」共享美食勾选项）
  var CATEGORIES = [
    '美食', '甜品饮品', '美发', '酒店', '休闲', '健身',
    '电影', '亲子', '购物', '美甲美睫', 'KTV', '其他'
  ];

  // 评价长度选项（支持精确字数）
  var LENGTH_OPTIONS = [
    { key: 80,   hint: '80 字',   label: '短' },
    { key: 150,  hint: '150 字',  label: '中短' },
    { key: 220,  hint: '220 字',  label: '中' },
    { key: 350,  hint: '350 字',  label: '长' },
    { key: 500,  hint: '500 字',  label: '超长' }
  ];

  // 美食 / 甜品饮品 共享勾选项（spec 6.2）
  var FOOD_OPTIONS = [
    '菜品推荐', '踩雷菜品', '排队情况', '人均价格',
    '服务满意', '环境满意', '适合拍照', '会回购'
  ];

  // 美发勾选项
  var HAIR_OPTIONS = [
    '发型师', '剪发效果', '染烫效果', '办卡推荐',
    '价格', '环境', '等待时间', '会回购'
  ];

  // 酒店勾选项
  var HOTEL_OPTIONS = [
    '卫生', '位置', '服务', '设施',
    '隔音', '早餐', '性价比', '会回购'
  ];

  // 默认（其他品类）勾选项
  var DEFAULT_OPTIONS = [
    '服务', '环境', '性价比', '会回购'
  ];

  // 风格倾向
  var STYLE_TENDENCIES = [
    { key: 'casual', label: '口语化', labelKey: 'generate.styleCasual' },
    { key: 'literary', label: '文艺', labelKey: 'generate.styleLiterary' },
    { key: 'exaggerated', label: '夸张', labelKey: 'generate.styleExaggerated' },
    { key: 'restrained', label: '克制', labelKey: 'generate.styleRestrained' }
  ];

  // 语料不足阈值
  var INSUFFICIENT_THRESHOLD = 5;

  /** 按品类返回对应勾选项 */
  function getCategoryOptions(category) {
    if (category === '美食' || category === '甜品饮品') return FOOD_OPTIONS;
    if (category === '美发') return HAIR_OPTIONS;
    if (category === '酒店') return HOTEL_OPTIONS;
    return DEFAULT_OPTIONS;
  }

  /** 品类名称 → 显示文案（数据码仍保留中文，仅展示翻译） */
  function catLabel(cat) {
    var key = {
      '美食': 'generate.catFood',
      '甜品饮品': 'generate.catDessert',
      '美发': 'generate.catHair',
      '酒店': 'generate.catHotel',
      '休闲': 'generate.catLeisure',
      '健身': 'generate.catFitness',
      '电影': 'generate.catMovie',
      '亲子': 'generate.catParentChild',
      '购物': 'generate.catShopping',
      '美甲美睫': 'generate.catNails',
      'KTV': 'generate.catKtv',
      '其他': 'generate.catOther'
    }[cat] || cat;
    return tr(key);
  }

  /** 品类勾选项中文码 → 显示文案（数据码仍保留中文，仅展示翻译） */
  function optionLabel(opt) {
    var key = {
      '菜品推荐': 'generate.optDish',
      '踩雷菜品': 'generate.optBadDish',
      '排队情况': 'generate.optQueue',
      '人均价格': 'generate.optAvgPrice',
      '服务满意': 'generate.optServiceSatisfied',
      '环境满意': 'generate.optEnvSatisfied',
      '适合拍照': 'generate.optPhoto',
      '会回购': 'generate.optRebuy',
      '发型师': 'generate.optStylist',
      '剪发效果': 'generate.optCut',
      '染烫效果': 'generate.optDye',
      '办卡推荐': 'generate.optCard',
      '价格': 'generate.optPrice',
      '环境': 'generate.optEnv',
      '等待时间': 'generate.optWait',
      '卫生': 'generate.optHygiene',
      '位置': 'generate.optLocation',
      '服务': 'generate.optService',
      '设施': 'generate.optFacility',
      '隔音': 'generate.optSoundproof',
      '早餐': 'generate.optBreakfast',
      '性价比': 'generate.optValue'
    }[opt] || opt;
    return tr(key);
  }

  /* ===================================================================
     三、样式注入（一次性注入，使用 main.css 设计令牌）
     =================================================================== */

  var STYLE_ID = 'dpr-generate-view-styles';
  function injectStyles() {
    if (global.document && global.document.getElementById(STYLE_ID)) return;
    if (!global.document) return;
    var style = global.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      /* 容器 */
      '.gen { display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: var(--space-4); }',
      '.gen-section { padding: var(--space-4); }',
      '.gen-section__title { font-size: var(--fs-caption); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: var(--space-3); }',
      /* 商家名大字号 */
      '.gen-merchant { font-size: var(--fs-headline); font-weight: 600; letter-spacing: var(--tracking-display); }',
      '.gen-merchant:focus { border-color: var(--accent); }',
      /* 字段 */
      '.gen-field { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-3); }',
      '.gen-field:last-child { margin-bottom: 0; }',
      '.gen-label { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: 500; letter-spacing: 0.02em; }',
      '.gen-row { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }',
      '.gen-chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
      /* 星级（1:1 拖动 + 释放弹簧归位） */
      '.gen-stars { display: inline-flex; align-items: center; gap: 6px; padding: var(--space-2) var(--space-1); touch-action: none; user-select: none; cursor: pointer; }',
      '.gen-stars__star { font-size: 32px; line-height: 1; color: #d1d1d6; transition: color 120ms var(--ease-out), transform 160ms var(--spring-bouncy); }',
      '.gen-stars__star.is-on { color: var(--star); }',
      '.gen-stars__star.is-half { position: relative; color: #d1d1d6; }',
      '.gen-stars__star.is-half::before { content: "★"; position: absolute; left: 0; top: 0; width: 50%; overflow: hidden; color: var(--star); }',
      '.gen-stars__hint { font-size: var(--fs-caption); color: var(--text-tertiary); margin-left: var(--space-2); font-variant-numeric: tabular-nums; }',
      '.gen-stars.is-snapped { animation: gen-stars-snap 220ms var(--spring-bouncy); }',
      '@keyframes gen-stars-snap { 0% { transform: scale(1); } 45% { transform: scale(1.08); } 100% { transform: scale(1); } }',
      /* 长度选项 */
      '.gen-length { display: flex; gap: var(--space-2); }',
      '.gen-length .chip { flex: 1 1 0; justify-content: center; }',
      /* 风格来源 */
      '.gen-source-mode { display: flex; gap: var(--space-2); margin-bottom: var(--space-2); }',
      '.gen-source-mode .chip { flex: 1 1 0; justify-content: center; }',
      '.gen-tag-list { display: flex; flex-wrap: wrap; gap: var(--space-2); padding-top: var(--space-1); }',
      /* 语料不足提示 */
      '.gen-warn { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: rgba(255,149,0,0.08); border: 1px solid rgba(255,149,0,0.25); border-radius: var(--radius-md); }',
      '.gen-warn__icon { flex: 0 0 auto; color: var(--star); font-size: 18px; line-height: 1.4; }',
      '.gen-warn__body { flex: 1 1 auto; min-width: 0; }',
      '.gen-warn__text { font-size: var(--fs-caption); color: var(--text-secondary); line-height: 1.5; }',
      '.gen-warn__btn { margin-top: var(--space-2); min-height: 32px; padding: 0 var(--space-3); font-size: var(--fs-caption); }',
      /* 生成按钮 */
      '.gen-submit { min-height: 52px; font-size: var(--fs-headline); font-weight: 600; letter-spacing: var(--tracking-display); background: var(--brand-orange); box-shadow: 0 4px 14px rgba(255,149,0,0.28); }',
      '.gen-submit:active { background: var(--brand-orange-deep); box-shadow: 0 2px 8px rgba(255,149,0,0.22); }',
      /* AI 记忆卡片 */
      '.gen-memory { background: var(--bg); border: 1px solid var(--border); }',
      '.gen-memory__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2); }',
      '.gen-memory__title { font-size: var(--fs-caption); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }',
      '.gen-memory__count { font-size: var(--fs-caption); color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; }',
      '.gen-memory__insights { display: flex; flex-direction: column; gap: var(--space-1); }',
      '.gen-memory__insight { font-size: var(--fs-caption); color: var(--text-secondary); line-height: 1.5; padding: var(--space-1) var(--space-2); background: var(--surface); border-radius: var(--radius-sm); border-left: 3px solid var(--accent); }',
      '.gen-memory__empty { font-size: var(--fs-caption); color: var(--text-tertiary); line-height: 1.5; }',
      /* 流式状态 */
      '.gen-stream-status { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); background: rgba(0,122,255,0.05); border: 1px solid rgba(0,122,255,0.14); border-radius: var(--radius-md); margin-bottom: var(--space-3); }',
      '.gen-stream-dots { display: flex; gap: 4px; }',
      '.gen-stream-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: gen-dot-pulse 1.2s var(--ease-out) infinite; }',
      '.gen-stream-dot:nth-child(2) { animation-delay: 0.15s; }',
      '.gen-stream-dot:nth-child(3) { animation-delay: 0.3s; }',
      '@keyframes gen-dot-pulse { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }',
      '.gen-stream-text { font-size: var(--fs-caption); color: var(--text-secondary); font-weight: 500; }',
      /* 结果文本框 */
      '.gen-result-text { min-height: 180px; line-height: var(--leading-body); font-size: var(--fs-body); resize: vertical; }',
      '.gen-result-meta { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); font-size: var(--fs-caption); color: var(--text-tertiary); }',
      '.gen-result-meta__star { color: var(--star); }',
      /* 校验提示 */
      '.gen-validation { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); background: rgba(255,149,0,0.08); border-left: 3px solid var(--star); border-radius: var(--radius-sm); font-size: var(--fs-caption); color: var(--text-secondary); line-height: 1.5; }',
      /* 结果动作 */
      '.gen-actions { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); transform: translateY(16px); opacity: 0; transition: transform 420ms var(--spring-bouncy), opacity 280ms var(--ease-out); }',
      '.gen-actions.is-entered { transform: translateY(0); opacity: 1; }',
      '.gen-actions-row { display: flex; gap: var(--space-2); }',
      '.gen-actions-row .btn { flex: 1 1 0; min-height: 44px; }',
      '.gen-actions-row--primary .btn-primary { flex: 2 1 0; }',
      /* 反馈 */
      '.gen-feedback { display: flex; gap: var(--space-3); justify-content: center; padding: var(--space-3) 0 0; margin-top: var(--space-2); border-top: 1px solid var(--border); }',
      '.gen-feedback__btn { display: inline-flex; align-items: center; gap: 6px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); font-size: var(--fs-caption); font-weight: 500; transition: transform 100ms ease-out, background 160ms var(--ease-out), color 160ms var(--ease-out); }',
      '.gen-feedback__btn:active { transform: scale(0.96); }',
      '.gen-feedback__btn.is-active { background: var(--accent); color: #fff; border-color: var(--accent); }',
      '.gen-feedback__btn--dislike.is-active { background: var(--danger); border-color: var(--danger); }',
      /* 空语料兜底提示 */
      '.gen-empty-hint { padding: var(--space-2) var(--space-3); background: rgba(0,122,255,0.06); border-radius: var(--radius-sm); font-size: var(--fs-caption); color: var(--text-secondary); line-height: 1.5; margin-bottom: var(--space-3); }',
      /* 生成失败错误态 */
      '.gen-error { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: var(--space-5) var(--space-4); text-align: center; }',
      '.gen-error__icon { font-size: 36px; line-height: 1; color: var(--danger, #ff3b30); }',
      '.gen-error__text { font-size: var(--fs-body); color: var(--text-primary); line-height: var(--leading-body); }',
      '.gen-error__actions { display: flex; gap: var(--space-2); width: 100%; }',
      '.gen-error__actions .btn { flex: 1 1 0; min-height: 44px; }',
      /* reduced-motion */
      '@media (prefers-reduced-motion: reduce) {',
      '  .gen-stars.is-snapped { animation: none; }',
      '  .gen-stream-dot { animation: none; opacity: 0.7; }',
      '  .gen-actions { transform: none; transition: opacity 200ms ease; }',
      '}',
      /* ===== 模式切换器（signature 元素） ===== */
      '.gen-mode-switcher { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 6px; margin-bottom: var(--space-4);',
      '  background: var(--surface-translucent); border: 1px solid var(--border); border-radius: var(--radius-lg);',
      '  -webkit-backdrop-filter: blur(var(--blur-strength)) saturate(var(--saturate));',
      '  backdrop-filter: blur(var(--blur-strength)) saturate(var(--saturate)); }',
      '.gen-mode-tab { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: var(--space-2) var(--space-1);',
      '  border-radius: var(--radius-md); color: var(--text-tertiary); background: transparent;',
      '  transition: color 160ms var(--ease-out), background 200ms var(--spring-default), transform 100ms ease-out; }',
      '.gen-mode-tab:active { transform: scale(0.96); }',
      '.gen-mode-tab.is-active { color: var(--mode-accent, var(--accent)); background: var(--surface-elevated, #fff);',
      '  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04); }',
      '.gen-mode-tab__icon { font-size: 20px; line-height: 1; font-weight: 600; }',
      '.gen-mode-tab.is-active .gen-mode-tab__icon { transform: scale(1.08); transition: transform 200ms var(--spring-bouncy); }',
      '.gen-mode-tab__label { font-size: 13px; font-weight: 600; letter-spacing: 0.01em; }',
      '.gen-mode-tab__desc { font-size: 10px; color: var(--text-tertiary); font-weight: 400; }',
      '.gen-mode-tab.is-active .gen-mode-tab__desc { color: var(--mode-accent, var(--accent)); opacity: 0.7; }',
      /* ===== 模式介绍文案 ===== */
      '.gen-mode-intro { font-size: var(--fs-caption); color: var(--text-secondary); line-height: 1.5; margin-bottom: var(--space-3); padding: var(--space-2) var(--space-3); background: rgba(0,122,255,0.04); border-radius: var(--radius-sm); }',
      /* qa 模式标题色 */
      '.gen-section--qa .gen-section__title--qa { color: var(--accent-purple); }',
      '.gen-section--polish .gen-section__title--polish { color: var(--accent-teal); }',
      /* ===== 提问模式 · QA 列表 ===== */
      '.gen-qa-progress { height: 4px; background: var(--bg); border-radius: var(--radius-pill); overflow: hidden; margin-bottom: 6px; }',
      '.gen-qa-progress__bar { height: 100%; background: #5856d6; border-radius: var(--radius-pill); transition: width 320ms var(--spring-default); }',
      '.gen-qa-progress__text { font-size: var(--fs-caption); color: var(--text-tertiary); margin-bottom: var(--space-3); font-variant-numeric: tabular-nums; }',
      '.gen-qa-list { display: flex; flex-direction: column; gap: var(--space-3); }',
      '.gen-qa-item { padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); transition: border-color 200ms var(--ease-out), box-shadow 200ms var(--ease-out); }',
      '.gen-qa-item.is-current { border-color: var(--accent-purple); box-shadow: 0 0 0 3px rgba(88,86,214,0.12); }',
      '.gen-qa-item__q { display: flex; gap: var(--space-2); align-items: flex-start; margin-bottom: var(--space-2); }',
      '.gen-qa-item__num { flex: 0 0 auto; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: var(--accent-purple); background: rgba(88,86,214,0.10); border-radius: 50%; font-variant-numeric: tabular-nums; }',
      '.gen-qa-item__text { flex: 1 1 auto; font-size: var(--fs-body); color: var(--text-primary); line-height: 1.45; }',
      '.gen-qa-item__hint { flex: 0 0 auto; font-size: var(--fs-caption); color: var(--text-tertiary); background: var(--bg); padding: 2px 8px; border-radius: var(--radius-pill); }',
      '.gen-qa-item__a { min-height: 56px; font-size: var(--fs-body); }',
      /* 选择题选项：每行一个，带选择框（radio 风格） */
      '.gen-qa-options { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2); }',
      '.gen-qa-option { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-2) var(--space-3); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; transition: all 180ms var(--ease-out); text-align: left; font-size: var(--fs-body); color: var(--text-primary); line-height: 1.4; }',
      '.gen-qa-option:hover { border-color: rgba(88,86,214,0.4); background: rgba(88,86,214,0.04); }',
      '.gen-qa-option.is-active { border-color: var(--accent-purple); background: rgba(88,86,214,0.08); }',
      '.gen-qa-option__checkbox { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--text-tertiary); display: inline-flex; align-items: center; justify-content: center; transition: all 180ms var(--ease-out); background: #fff; }',
      '.gen-qa-option.is-active .gen-qa-option__checkbox { border-color: var(--accent-purple); background: var(--accent-purple); }',
      '.gen-qa-option__checkbox-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; opacity: 0; transition: opacity 120ms var(--ease-out); }',
      '.gen-qa-option.is-active .gen-qa-option__checkbox-dot { opacity: 1; }',
      '.gen-qa-option__letter { flex: 0 0 auto; font-size: var(--fs-caption); font-weight: 600; color: var(--text-tertiary); width: 18px; font-variant-numeric: tabular-nums; }',
      '.gen-qa-option.is-active .gen-qa-option__letter { color: var(--accent-purple); }',
      '.gen-qa-option__text { flex: 1 1 auto; }',
      /* 其他（自定义输入） */
      '.gen-qa-other { margin-top: var(--space-2); }',
      '.gen-qa-other__label { display: flex; align-items: center; gap: 6px; font-size: var(--fs-body); color: var(--text-secondary); cursor: pointer; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg); transition: all 180ms var(--ease-out); }',
      '.gen-qa-other__label:hover { border-color: rgba(88,86,214,0.4); }',
      '.gen-qa-other__label.is-active { border-color: var(--accent-purple); background: rgba(88,86,214,0.08); color: var(--accent-purple); }',
      '.gen-qa-other__input { margin-top: var(--space-2); }',
      '.gen-qa-actions { display: flex; gap: var(--space-2); margin-top: var(--space-4); }',
      '.gen-qa-actions .btn { flex: 1 1 0; min-height: 48px; }',
      /* ===== 润色模式 ===== */
      '.gen-polish-raw { min-height: 160px; font-size: var(--fs-body); line-height: var(--leading-body); }',
      '.gen-polish-meta { display: flex; justify-content: flex-end; margin-top: 4px; }',
      '.gen-polish-meta__count { font-size: var(--fs-caption); color: var(--text-tertiary); font-variant-numeric: tabular-nums; }',
      '.gen-polish-hint { font-size: var(--fs-caption); color: var(--text-tertiary); margin-top: var(--space-2); text-align: center; }',
      /* 润色模式 0 星占位（∅） */
      '.gen-stars__star--zero { font-size: 22px; color: var(--text-tertiary); }',
      '.gen-stars__star--zero.is-on { color: var(--text-secondary); }',
      /* 润色结果双栏对比 */
      '.gen-polish-original { margin-bottom: var(--space-3); padding: var(--space-2) var(--space-3); background: var(--bg); border-radius: var(--radius-md); }',
      '.gen-polish-original summary { font-size: var(--fs-caption); color: var(--text-tertiary); cursor: pointer; padding: var(--space-1) 0; user-select: none; }',
      '.gen-polish-original__body { font-size: var(--fs-caption); color: var(--text-secondary); line-height: 1.6; padding: var(--space-2) 0 0; white-space: pre-wrap; }',
      '.gen-polish-result-label { font-size: var(--fs-caption); font-weight: 600; color: var(--accent-teal); letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: var(--space-2); }',
      '.gen-polish-result { min-height: 200px; border-left: 3px solid var(--accent-teal); }'
    ].join('\n');
    global.document.head.appendChild(style);
  }
  // 模块加载即注入
  injectStyles();

  /* ===================================================================
     四、工具
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

  /** 中断当前流式生成（real 模式 fetch 中断；mock 模式 generateReviewStream 内部清 interval）。
   *  增加 generationId 让旧回调作废；不修改 stage，由调用方决定后续状态转换。 */
  function abortCurrentGeneration() {
    state.generationId++;
    if (state.abortController) {
      try { state.abortController.abort(); } catch (e) { /* ignore */ }
      state.abortController = null;
    }
  }

  /** 清理星级拖拽会话 */
  function clearStarDragSession() {
    if (state.starDragSession && typeof state.starDragSession.cleanup === 'function') {
      try { state.starDragSession.cleanup(); } catch (e) {}
    }
    state.starDragSession = null;
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

  /** 国际化取文本，找不到回退中文/key */
  function tr(key, params) {
    var i = global.I18n;
    return (i && typeof i.t === 'function') ? i.t(key, params) : key;
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function store() { return global.Store || null; }
  function ai() { return global.AIEngine || null; }
  function app() { return global.App || null; }

  function showToast(msg, type) {
    var App = app();
    if (App && typeof App.showToast === 'function') {
      App.showToast(msg, type);
    }
  }

  /** 把回调延迟到下一帧，便于让 UI 先刷新 */
  function nextTick(fn) {
    state.timers.push(setTimeout(fn, 30));
  }

  /* ===================================================================
     五、数据筛选
     =================================================================== */

  /** 按当前风格来源模式筛选语料 */
  function getFilteredCorpus() {
    var Store = store();
    if (!Store) return [];
    var all = Store.getCorpus() || [];
    if (state.styleSourceMode === 'all') return all;
    if (state.styleSourceMode === 'single') {
      var tagId = state.styleSourceTagId;
      if (!tagId) return all;
      return all.filter(function (c) {
        return Array.isArray(c.tagIds) && c.tagIds.indexOf(tagId) !== -1;
      });
    }
    // mixed
    var tagIds = state.styleSourceTagIds;
    if (!tagIds || !tagIds.length) return all;
    return all.filter(function (c) {
      if (!Array.isArray(c.tagIds)) return false;
      for (var i = 0; i < tagIds.length; i++) {
        if (c.tagIds.indexOf(tagIds[i]) !== -1) return true;
      }
      return false;
    });
  }

  /** 统计「当前风格来源 + 当前品类」下的语料条数（用于不足提示） */
  function getCategoryCorpusCount() {
    var filtered = getFilteredCorpus();
    var count = 0;
    for (var i = 0; i < filtered.length; i++) {
      if (filtered[i].category === state.category) count++;
    }
    return count;
  }

  /** 是否完全无语料（触发空语料兜底提示） */
  function isCorpusEmpty() {
    var Store = store();
    if (!Store) return true;
    var all = Store.getCorpus() || [];
    return all.length === 0;
  }

  /** 构造 AI 生成参数 */
  function buildParams(prevText) {
    var params = {
      merchant: state.merchant.trim() || '这家店',
      category: state.category,
      stars: state.stars,
      length: state.length,
      options: state.options,
      styleSource: getStyleSourceForHistory(),
      tendency: {
        style: state.tendencyStyle,
        emoji: state.tendencyEmoji
      },
      corpusList: getFilteredCorpus(),
      history: (store() && store().getHistory && store().getHistory()) || []
    };
    if (prevText) params.prevText = prevText;
    return params;
  }

  /** 风格来源 → 历史记录持久化值 */
  function getStyleSourceForHistory() {
    if (state.styleSourceMode === 'all') return 'all';
    if (state.styleSourceMode === 'single') return state.styleSourceTagId || 'all';
    if (state.styleSourceMode === 'mixed') {
      return state.styleSourceTagIds && state.styleSourceTagIds.length
        ? state.styleSourceTagIds.slice()
        : 'all';
    }
    return 'all';
  }

  /** 流式状态文案（spec: 正在用 XX 风格生成...） */
  function getStreamingStatusText() {
    var Store = store();
    if (!Store) return tr('generate.streamingGeneric');
    var allEmpty = isCorpusEmpty();
    if (allEmpty) return tr('generate.streamingEmpty');
    var count = getCategoryCorpusCount();
    if (count < INSUFFICIENT_THRESHOLD) {
      return tr('generate.streamingInsufficient');
    }
    if (state.styleSourceMode === 'single' && state.styleSourceTagId) {
      var g = Store.getTagGroupById(state.styleSourceTagId);
      if (g) return tr('generate.streamingSingle', { 0: g.name });
    }
    if (state.styleSourceMode === 'mixed' && state.styleSourceTagIds.length) {
      return tr('generate.streamingMixed', { 0: state.styleSourceTagIds.length });
    }
    return tr('generate.streamingAll');
  }

  /* ===================================================================
     六、渲染
     =================================================================== */

  function render() {
    if (!state.container) return;
    // 顶部模式切换器（signature 元素）始终显示
    var modeSwitcher = renderModeSwitcher();

    // 润色模式走独立流程（polishStage），不共用 stage
    if (state.mode === 'polish') {
      if (state.polishStage === 'input') {
        state.container.innerHTML = modeSwitcher + renderPolishInput();
      } else if (state.polishStage === 'streaming') {
        state.container.innerHTML = modeSwitcher + renderPolishResult(true);
      } else {
        state.container.innerHTML = modeSwitcher + renderPolishResult(false);
      }
      state.rendered = true;
      return;
    }

    // 提问模式：setup/asking 阶段独立；generating 阶段复用 result 渲染
    if (state.mode === 'qa') {
      if (state.qaStage === 'setup') {
        state.container.innerHTML = modeSwitcher + renderQASetup();
      } else if (state.qaStage === 'asking') {
        state.container.innerHTML = modeSwitcher + renderQAAsking();
      } else if (state.qaStage === 'generating') {
        // 复用 default 模式的 result 渲染（streaming/result）
        if (state.stage === 'streaming') {
          state.container.innerHTML = modeSwitcher + renderResult(true);
        } else {
          state.container.innerHTML = modeSwitcher + renderResult(false);
        }
      }
      state.rendered = true;
      return;
    }

    // 默认模式
    if (state.stage === 'input') {
      state.container.innerHTML = modeSwitcher + renderInput();
    } else if (state.stage === 'streaming') {
      state.container.innerHTML = modeSwitcher + renderResult(true);
    } else {
      state.container.innerHTML = modeSwitcher + renderResult(false);
    }
    state.rendered = true;
  }

  /* ---------- 模式切换器（signature 元素） ---------- */
  function renderModeSwitcher() {
    var html = '<div class="gen-mode-switcher" role="tablist" aria-label="' + tr('generate.modeSwitcherAria') + '">';
    MODES.forEach(function (m) {
      var active = state.mode === m.key ? ' is-active' : '';
      html += '<button class="gen-mode-tab' + active + '" type="button" role="tab" ' +
        'aria-selected="' + (state.mode === m.key ? 'true' : 'false') + '" ' +
        'data-action="switch-mode" data-value="' + m.key + '" ' +
        'style="--mode-accent:' + m.accent + '">';
      html += '<span class="gen-mode-tab__icon">' + m.icon + '</span>';
      html += '<span class="gen-mode-tab__label">' + escapeHtml(tr(m.labelKey)) + '</span>';
      html += '<span class="gen-mode-tab__desc">' + escapeHtml(tr(m.descKey)) + '</span>';
      html += '</button>';
    });
    html += '</div>';
    return html;
  }

  /** 输入表单 · default 模式 */
  function renderInput() {
    var html = '<div class="gen">';
    // 基础信息卡片
    html += '<section class="card gen-section">';
    html += '<div class="gen-section__title">' + tr('generate.basicInfo') + '</div>';
    html += renderForm();
    html += '</section>';
    // 勾选项卡片
    html += '<section class="card gen-section">';
    html += '<div class="gen-section__title">' + tr('generate.optionsTitle') + '</div>';
    html += renderCategoryOptions();
    html += '</section>';
    // 风格来源卡片
    html += '<section class="card gen-section">';
    html += '<div class="gen-section__title">' + tr('generate.styleSourceTitle') + '</div>';
    html += renderStyleSource();
    html += '</section>';
    // 风格倾向卡片
    html += '<section class="card gen-section">';
    html += '<div class="gen-section__title">' + tr('generate.tendencyTitle') + '</div>';
    html += renderTendency();
    html += '</section>';
    // AI 记忆卡片
    html += renderAIMemory();
    // 语料不足提示
    html += renderInsufficientWarning();
    // 生成按钮
    html += '<button class="btn btn-primary gen-submit pressable" type="button" data-action="generate">' + tr('generate.generateBtn') + '</button>';
    html += '</div>';
    return html;
  }

  /* ---------- 提问模式 (Q&A) 渲染 ---------- */

  /** 提问模式 · setup 阶段：输入商家名 + 星级，点击开始提问 */
  function renderQASetup() {
    var html = '<div class="gen">';
    html += '<section class="card gen-section gen-section--qa">';
    html += '<div class="gen-section__title gen-section__title--qa">' + tr('generate.qaTitle') + '</div>';
    html += '<p class="gen-mode-intro">' + tr('generate.qaIntro') + '</p>';
    // 商家名
    html += '<div class="gen-field">';
    html += '<label class="gen-label" for="gen-merchant">' + tr('generate.merchantLabel') + '</label>';
    html += '<input class="input gen-merchant" id="gen-merchant" type="text" placeholder="' + tr('generate.merchantPlaceholder') + '" value="' + escapeHtml(state.merchant) + '" maxlength="30" />';
    html += '</div>';
    // 星级（支持半星）
    html += '<div class="gen-field">';
    html += '<label class="gen-label">' + tr('generate.starsLabel') + '</label>';
    html += '<div class="gen-row">';
    html += '<div class="gen-stars" data-action="star-drag" role="slider" aria-label="' + tr('generate.starsAria') + '" aria-valuemin="0.5" aria-valuemax="5" aria-valuenow="' + state.stars + '" tabindex="0">';
    var qaFull = Math.floor(state.stars);
    var qaHalf = (state.stars % 1) >= 0.25 && (state.stars % 1) < 0.75;
    for (var i = 1; i <= 5; i++) {
      var qaClass = 'gen-stars__star';
      if (i <= qaFull) qaClass += ' is-on';
      else if (i === qaFull + 1 && qaHalf) qaClass += ' is-half';
      html += '<span class="' + qaClass + '" data-star="' + i + '">★</span>';
    }
    html += '</div>';
    html += '<span class="gen-stars__hint">' + tr('generate.starsHint', { 0: (state.stars % 1 === 0 ? state.stars : state.stars.toFixed(1)) }) + '</span>';
    html += '</div>';
    html += '</div>';
    // 字数选择（任务6）
    html += renderWordCountSelector('qa');
    // 错误提示
    if (state.qaError) {
      html += '<div class="gen-warn"><div class="gen-warn__icon">⚠</div><div class="gen-warn__body"><div class="gen-warn__text">' + escapeHtml(state.qaError.message) + '</div></div></div>';
    }
    // 开始提问按钮
    html += '<button class="btn btn-primary gen-submit pressable" type="button" data-action="qa-start"' + (state.qaLoadingQuestions ? ' disabled' : '') + '>';
    html += state.qaLoadingQuestions ? tr('generate.qaPreparing') : tr('generate.qaStartBtn');
    html += '</button>';
    html += '</section>';
    html += '</div>';
    return html;
  }

  /** 字数选择器（任务6：提问/润色模式共用） */
  function renderWordCountSelector(scope) {
    var currentVal = scope === 'polish' ? state.polishWordCount : state.qaWordCount;
    var dataField = scope === 'polish' ? 'polish-word-count' : 'qa-word-count';
    var presets = [
      { key: 'auto', labelKey: 'generate.wcAuto', desc: '' },
      { key: '80', labelKey: 'generate.wcShort', descKey: 'generate.wc80Desc' },
      { key: '180', labelKey: 'generate.wcMedium', descKey: 'generate.wc180Desc' },
      { key: '300', labelKey: 'generate.wcLong', descKey: 'generate.wc300Desc' },
      { key: '450', labelKey: 'generate.wcExtraLong', descKey: 'generate.wc450Desc' }
    ];
    var chipsHtml = presets.map(function (p) {
      var active = String(currentVal) === p.key ? ' is-active' : '';
      var chipLabel = escapeHtml(tr(p.labelKey));
      if (p.desc || p.descKey) chipLabel += '<span style="font-size:var(--fs-caption);opacity:.7;margin-left:4px">' + escapeHtml(tr(p.descKey)) + '</span>';
      return '<button class="chip pressable' + active + '" type="button" data-action="' + dataField + '" data-value="' + p.key + '">' + chipLabel + '</button>';
    }).join('');

    var isCustom = currentVal !== 'auto' && presets.every(function (p) { return p.key !== String(currentVal); });
    var customVal = isCustom ? String(currentVal) : '';

    return (
      '<div class="gen-field">' +
        '<label class="gen-label">' + tr('generate.wordCountLabel') + '</label>' +
        '<div class="gen-chip-row">' + chipsHtml + '</div>' +
        '<div class="gen-wordcount-custom">' +
          '<input class="input gen-wordcount-input" type="number" min="30" max="800" step="10" ' +
            'placeholder="' + tr('generate.wcCustomPlaceholder') + '" value="' + escapeHtml(customVal) + '" ' +
            'data-field="' + dataField + '-custom" inputmode="numeric" />' +
          '<span class="gen-wordcount-suffix">' + tr('generate.wcUnit') + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  /** 提问模式 · asking 阶段：展示问题列表（含选择题选项），逐个回答 */
  function renderQAAsking() {
    var html = '<div class="gen">';
    html += '<section class="card gen-section gen-section--qa">';
    html += '<div class="gen-section__title gen-section__title--qa">' + tr('generate.qaAnswerTitle') + '</div>';
    html += '<p class="gen-mode-intro">' + tr('generate.qaAskingIntro', { 0: escapeHtml(state.merchant || tr('generate.thisStore')), 1: state.qaQuestions.length }) + '</p>';

    // 进度条
    var answered = 0;
    Object.keys(state.qaAnswers).forEach(function (k) {
      var v = state.qaAnswers[k];
      if (Array.isArray(v) ? v.length > 0 : (v && v.trim())) answered++;
    });
    var total = state.qaQuestions.length;
    var pct = total ? Math.round((answered / total) * 100) : 0;
    html += '<div class="gen-qa-progress">';
    html += '<div class="gen-qa-progress__bar" style="width:' + pct + '%"></div>';
    html += '</div>';
    html += '<div class="gen-qa-progress__text">' + tr('generate.qaAnswered', { 0: answered, 1: total }) + '</div>';

    // 问题列表（一次性展示，每题含选项 + Other 输入）
    html += '<div class="gen-qa-list">';
    state.qaQuestions.forEach(function (q, idx) {
      var isCurrent = idx === state.qaCurrentIdx;
      html += '<div class="gen-qa-item' + (isCurrent ? ' is-current' : '') + '" data-qa-idx="' + idx + '">';
      html += buildQAItemOptionsHTML(q, idx);
      html += '</div>';
    });
    html += '</div>';

    // 补充备注（任务7：与问题同等权重传给 AI）
    html += '<div class="gen-field gen-qa-additional">';
    html += '<label class="gen-label" for="gen-qa-additional">' + tr('generate.qaAdditionalLabel') + '</label>';
    html += '<p class="gen-mode-intro" style="font-size:var(--fs-caption);margin-top:4px;">' + tr('generate.qaAdditionalHint') + '</p>';
    html += '<textarea class="textarea gen-qa-additional__input" id="gen-qa-additional" data-field="qa-additional" ' +
      'placeholder="' + tr('generate.qaAdditionalPlaceholder') + '" rows="2">' + escapeHtml(state.qaAdditionalComment) + '</textarea>';
    html += '</div>';

    // 操作按钮
    html += '<div class="gen-qa-actions">';
    html += '<button class="btn pressable" type="button" data-action="qa-back-setup">' + tr('generate.backToEdit') + '</button>';
    html += '<button class="btn btn-primary pressable" type="button" data-action="qa-generate">' + tr('generate.generateBtn') + '</button>';
    html += '</div>';
    html += '</section>';
    html += '</div>';
    return html;
  }

  /* ---------- 润色模式 (Polish) 渲染 ---------- */

  /** 润色模式 · input 阶段：输入原文，可选目标星级 */
  function renderPolishInput() {
    var html = '<div class="gen">';
    html += '<section class="card gen-section gen-section--polish">';
    html += '<div class="gen-section__title gen-section__title--polish">' + tr('generate.polishTitle') + '</div>';
    html += '<p class="gen-mode-intro">' + tr('generate.polishIntro') + '</p>';
    // 原文输入
    html += '<div class="gen-field">';
    html += '<label class="gen-label" for="gen-polish-raw">' + tr('generate.polishRawLabel') + '</label>';
    html += '<textarea class="textarea gen-polish-raw" id="gen-polish-raw" data-field="polish-raw" placeholder="' + tr('generate.polishRawPlaceholder') + '" rows="8">' + escapeHtml(state.polishRawText) + '</textarea>';
    html += '<div class="gen-polish-meta">';
    html += '<span class="gen-polish-meta__count">' + tr('generate.charCount', { 0: state.polishRawText.length }) + '</span>';
    html += '</div>';
    html += '</div>';
    // 目标星级（可选）
    html += '<div class="gen-field">';
    html += '<label class="gen-label">' + tr('generate.polishTargetStarsLabel') + '</label>';
    html += '<div class="gen-row">';
    html += '<div class="gen-stars" data-action="star-drag-polish" role="slider" aria-label="' + tr('generate.polishTargetStarsAria') + '" aria-valuemin="0" aria-valuemax="5" aria-valuenow="' + state.polishStars + '" tabindex="0">';
    html += '<span class="gen-stars__star gen-stars__star--zero' + (state.polishStars === 0 ? ' is-on' : '') + '" data-star="0">∅</span>';
    var pFull = Math.floor(state.polishStars);
    var pHalf = (state.polishStars % 1) >= 0.25 && (state.polishStars % 1) < 0.75;
    for (var i = 1; i <= 5; i++) {
      var pClass = 'gen-stars__star';
      if (i <= pFull) pClass += ' is-on';
      else if (i === pFull + 1 && pHalf) pClass += ' is-half';
      html += '<span class="' + pClass + '" data-star="' + i + '">★</span>';
    }
    html += '</div>';
    html += '<span class="gen-stars__hint">' + (state.polishStars === 0 ? tr('generate.polishNoStars') : tr('generate.starsHint', { 0: (state.polishStars % 1 === 0 ? state.polishStars : state.polishStars.toFixed(1)) })) + '</span>';
    html += '</div>';
    html += '</div>';
    // 字数选择（任务6）
    html += renderWordCountSelector('polish');
    // 润色按钮
    var canPolish = state.polishRawText.trim().length >= 10;
    html += '<button class="btn btn-primary gen-submit pressable" type="button" data-action="polish-start"' + (canPolish ? '' : ' disabled') + '>' + tr('generate.polishStartBtn') + '</button>';
    if (!canPolish) {
      html += '<p class="gen-polish-hint">' + tr('generate.polishMinHint') + '</p>';
    }
    html += '</section>';
    html += '</div>';
    return html;
  }

  /** 润色模式 · 结果区（含流式与最终结果、错误态） */
  function renderPolishResult(isStreaming) {
    var hasError = !isStreaming && state.errorState;
    var html = '<div class="gen">';
    // 流式状态
    if (isStreaming) {
      html += '<div class="gen-stream-status">';
      html += '<div class="gen-stream-dots"><span class="gen-stream-dot"></span><span class="gen-stream-dot"></span><span class="gen-stream-dot"></span></div>';
      html += '<div class="gen-stream-text">' + tr('generate.polishing') + '</div>';
      html += '</div>';
    }
    if (!hasError) {
      // 双栏对比：原文 vs 润色后
      html += '<section class="card gen-section gen-section--polish">';
      // 原文（折叠展示）
      html += '<details class="gen-polish-original">';
      html += '<summary>' + tr('generate.viewOriginal', { 0: state.polishOriginalText.length }) + '</summary>';
      html += '<div class="gen-polish-original__body">' + escapeHtml(state.polishOriginalText).replace(/\n/g, '<br>') + '</div>';
      html += '</details>';
      // 润色结果
      html += '<div class="gen-polish-result-label">' + tr('generate.polishResultLabel') + '</div>';
      var text = state.streamFullText;
      var readonly = isStreaming ? ' readonly' : '';
      html += '<textarea class="textarea gen-result-text gen-polish-result" id="gen-result-text" placeholder="' + tr('generate.polishResultPlaceholder') + '"' + readonly + '>' + escapeHtml(text) + '</textarea>';
      html += '<div class="gen-result-meta">';
      html += '<span>' + tr('generate.charCount', { 0: text.length }) + '</span>';
      if (!isStreaming && state.polishOriginalText) {
        var delta = text.length - state.polishOriginalText.length;
        var deltaStr = delta > 0 ? '+' + delta : String(delta);
        html += '<span>·</span>';
        html += '<span>' + tr('generate.deltaChange', { 0: deltaStr }) + '</span>';
      }
      html += '</div>';
      html += '</section>';
    }
    // 动作区
    if (hasError) {
      html += '<section class="card gen-section">';
      html += '<div class="gen-error" id="gen-actions">';
      html += '<div class="gen-error__icon">⚠</div>';
      html += '<div class="gen-error__text">' + tr('generate.polishFail', { 0: escapeHtml(state.errorState.message) }) + '</div>';
      html += '<div class="gen-error__actions">';
      html += '<button class="btn btn-primary pressable" type="button" data-action="retry">' + tr('generate.retry') + '</button>';
      html += '<button class="btn pressable" type="button" data-action="polish-back-input">' + tr('generate.editOriginal') + '</button>';
      html += '</div>';
      html += '</div>';
      html += '</section>';
    } else if (isStreaming) {
      html += '<div class="gen-actions is-entered" style="transform:none;opacity:1">';
      html += '<div class="gen-actions-row gen-actions-row--primary">';
      html += '<button class="btn btn-primary pressable" type="button" data-action="stop">' + tr('generate.stop') + '</button>';
      html += '</div>';
      html += '</div>';
    } else {
      html += '<div class="gen-actions" id="gen-actions">';
      html += '<div class="gen-actions-row gen-actions-row--primary">';
      html += '<button class="btn btn-primary pressable" type="button" data-action="copy">' + tr('generate.copy') + '</button>';
      html += '<button class="btn pressable" type="button" data-action="polish-again">' + tr('generate.polishAgain') + '</button>';
      html += '</div>';
      html += '<div class="gen-actions-row">';
      html += '<button class="btn pressable" type="button" data-action="add-corpus">' + tr('generate.addCorpus') + '</button>';
      html += '<button class="btn pressable" type="button" data-action="polish-back-input">' + tr('generate.editOriginal') + '</button>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  /** 基础信息表单字段 */
  function renderForm() {
    var html = '';
    // 商家名（大字号）
    html += '<div class="gen-field">';
    html += '<label class="gen-label" for="gen-merchant">' + tr('generate.merchantLabel') + '</label>';
    html += '<input class="input gen-merchant" id="gen-merchant" type="text" placeholder="' + tr('generate.merchantPlaceholder') + '" value="' + escapeHtml(state.merchant) + '" maxlength="30" />';
    html += '</div>';
    // 品类
    html += '<div class="gen-field">';
    html += '<label class="gen-label" for="gen-category">' + tr('generate.categoryLabel') + '</label>';
    html += '<select class="select" id="gen-category">';
    CATEGORIES.forEach(function (cat) {
      var sel = cat === state.category ? ' selected' : '';
      html += '<option value="' + escapeHtml(cat) + '"' + sel + '>' + escapeHtml(catLabel(cat)) + '</option>';
    });
    html += '</select>';
    html += '</div>';
    // 星级（支持半星，0.5 步进）
    html += '<div class="gen-field">';
    html += '<label class="gen-label">' + tr('generate.starsLabelDesc') + '</label>';
    html += '<div class="gen-row">';
    html += '<div class="gen-stars" data-action="star-drag" role="slider" aria-label="' + tr('generate.starsAria') + '" aria-valuemin="0.5" aria-valuemax="5" aria-valuenow="' + state.stars + '" tabindex="0">';
    var fullStars = Math.floor(state.stars);
    var hasHalf = (state.stars % 1) >= 0.25 && (state.stars % 1) < 0.75;
    for (var i = 1; i <= 5; i++) {
      var starClass = 'gen-stars__star';
      if (i <= fullStars) starClass += ' is-on';
      else if (i === fullStars + 1 && hasHalf) starClass += ' is-half';
      html += '<span class="' + starClass + '" data-star="' + i + '">★</span>';
    }
    html += '</div>';
    html += '<span class="gen-stars__hint">' + tr('generate.starsHint', { 0: (state.stars % 1 === 0 ? state.stars : state.stars.toFixed(1)) }) + '</span>';
    html += '</div>';
    html += '</div>';
    // 长度（字数选择）
    html += '<div class="gen-field">';
    html += '<label class="gen-label">' + tr('generate.lenLabel') + '</label>';
    html += '<div class="gen-length">';
    LENGTH_OPTIONS.forEach(function (opt) {
      var active = opt.key === state.length ? ' is-active' : '';
      html += '<button class="chip pressable' + active + '" type="button" data-action="length" data-value="' + opt.key + '">' +
        escapeHtml(tr('generate.lenHint', { 0: opt.key })) + '</button>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  }

  /** 品类动态勾选项 */
  function renderCategoryOptions() {
    var options = getCategoryOptions(state.category);
    var html = '<div class="gen-chip-row">';
    options.forEach(function (key) {
      var active = state.options[key] ? ' is-active' : '';
      html += '<button class="chip pressable' + active + '" type="button" data-action="option" data-value="' + escapeHtml(key) + '">' +
        escapeHtml(optionLabel(key)) + '</button>';
    });
    html += '</div>';
    return html;
  }

  /** 风格来源选择 */
  function renderStyleSource() {
    var Store = store();
    var tagGroups = (Store && Store.getTagGroups && Store.getTagGroups()) || [];
    var html = '';
    // 空语料兜底提示
    if (isCorpusEmpty()) {
      html += '<div class="gen-empty-hint">' + tr('generate.styleEmptyHint') + '</div>';
    }
    // 模式切换
    html += '<div class="gen-source-mode">';
    var modes = [
      { key: 'all', labelKey: 'generate.sourceAll' },
      { key: 'single', labelKey: 'generate.sourceSingle' },
      { key: 'mixed', labelKey: 'generate.sourceMixed' }
    ];
    modes.forEach(function (m) {
      var active = state.styleSourceMode === m.key ? ' is-active' : '';
      html += '<button class="chip pressable' + active + '" type="button" data-action="source-mode" data-value="' + m.key + '">' +
        escapeHtml(tr(m.labelKey)) + '</button>';
    });
    html += '</div>';
    // 标签组
    if (state.styleSourceMode !== 'all' && tagGroups.length) {
      html += '<div class="gen-tag-list">';
      tagGroups.forEach(function (g) {
        var isOn = false;
        if (state.styleSourceMode === 'single') {
          isOn = state.styleSourceTagId === g.id;
        } else {
          isOn = state.styleSourceTagIds.indexOf(g.id) !== -1;
        }
        var active = isOn ? ' is-active' : '';
        var dotStyle = g.color ? ' style="box-shadow:0 0 0 2px ' + escapeHtml(g.color) + '"' : '';
        html += '<button class="chip pressable' + active + '" type="button" data-action="source-tag" data-value="' + escapeHtml(g.id) + '">' +
          '<span class="lib-tag-chip__dot"' + dotStyle + ' style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + (g.color || '#8E8E93') + ';margin-right:4px"></span>' +
          escapeHtml(g.name) + '</button>';
      });
      html += '</div>';
    }
    if (state.styleSourceMode !== 'all' && !tagGroups.length) {
      html += '<div class="gen-empty-hint">' + tr('generate.noTagGroupsHint') + '</div>';
    }
    return html;
  }

  /** 风格倾向选择 */
  function renderTendency() {
    var html = '<div class="gen-field">';
    html += '<label class="gen-label">' + tr('generate.styleLabel') + '</label>';
    html += '<div class="gen-chip-row">';
    var naturalActive = !state.tendencyStyle ? ' is-active' : '';
    html += '<button class="chip pressable' + naturalActive + '" type="button" data-action="tendency-style" data-value="">' + tr('generate.tendencyNatural') + '</button>';
    STYLE_TENDENCIES.forEach(function (t) {
      var active = state.tendencyStyle === t.key ? ' is-active' : '';
      html += '<button class="chip pressable' + active + '" type="button" data-action="tendency-style" data-value="' + t.key + '">' +
        escapeHtml(tr(t.labelKey)) + '</button>';
    });
    html += '</div>';
    html += '</div>';
    html += '<div class="gen-field">';
    html += '<label class="gen-label">' + tr('generate.emojiLabel') + '</label>';
    html += '<div class="gen-chip-row">';
    var emojiOpts = [
      { key: '', labelKey: 'generate.emojiDefault' },
      { key: 'true', labelKey: 'generate.emojiAdd' },
      { key: 'false', labelKey: 'generate.emojiNo' }
    ];
    emojiOpts.forEach(function (e) {
      var isOn = false;
      if (e.key === '') isOn = state.tendencyEmoji === null;
      else if (e.key === 'true') isOn = state.tendencyEmoji === true;
      else isOn = state.tendencyEmoji === false;
      var active = isOn ? ' is-active' : '';
      html += '<button class="chip pressable' + active + '" type="button" data-action="tendency-emoji" data-value="' + e.key + '">' +
        escapeHtml(tr(e.labelKey)) + '</button>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  }

  /** AI 记忆与认知展示（让用户看到 AI 的学习积累） */
  function renderAIMemory() {
    var Store = store();
    if (!Store || typeof Store.getAIMemory !== 'function') return '';
    var memory;
    try { memory = Store.getAIMemory(); } catch (e) { return ''; }
    if (!memory) return '';

    var count = memory.generationCount || 0;
    var insights = memory.insights || [];
    var html = '<section class="card gen-section gen-memory">';
    html += '<div class="gen-memory__header">';
    html += '<span class="gen-memory__title">' + tr('generate.memoryTitle', { 0: count }) + '</span>';
    if (insights.length) {
      html += '<span class="gen-memory__count">' + tr('generate.memoryInsightCount', { 0: insights.length }) + '</span>';
    }
    html += '</div>';

    if (!insights.length) {
      html += '<p class="gen-memory__empty">' + tr('generate.memoryEmpty') + '</p>';
    } else {
      html += '<div class="gen-memory__insights">';
      // 只展示最近 3 条
      insights.slice(0, 3).forEach(function (insight) {
        html += '<div class="gen-memory__insight">' + escapeHtml(insight) + '</div>';
      });
      if (insights.length > 3) {
        html += '<div class="gen-memory__empty">' + tr('generate.memoryMore', { 0: (insights.length - 3) }) + '</div>';
      }
      html += '</div>';
    }

    html += '</section>';
    return html;
  }

  /** 语料不足提示 */
  function renderInsufficientWarning() {
    if (isCorpusEmpty()) return ''; // 空语料已在风格来源卡片内提示
    var count = getCategoryCorpusCount();
    if (count >= INSUFFICIENT_THRESHOLD) return '';
    var html = '<div class="gen-warn">';
    html += '<div class="gen-warn__icon">⚠</div>';
    html += '<div class="gen-warn__body">';
    html += '<div class="gen-warn__text">' + tr('generate.insufficient', { 0: count }) + '</div>';
    html += '<button class="btn gen-warn__btn pressable" type="button" data-action="goto-train">' + tr('generate.gotoTrain') + '</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  /** 结果区（含流式与最终结果、错误态） */
  function renderResult(isStreaming) {
    var hasError = !isStreaming && state.errorState;
    var html = '<div class="gen">';
    // 流式状态
    if (isStreaming) {
      html += '<div class="gen-stream-status">';
      html += '<div class="gen-stream-dots"><span class="gen-stream-dot"></span><span class="gen-stream-dot"></span><span class="gen-stream-dot"></span></div>';
      html += '<div class="gen-stream-text">' + escapeHtml(getStreamingStatusText()) + '</div>';
      html += '</div>';
    }
    // 结果卡片（错误态时不显示文本框，仅显示错误信息卡片）
    if (!hasError) {
      html += '<section class="card gen-section">';
      // 商家名 + 星级元信息
      html += '<div class="gen-result-meta" style="margin-top:0;margin-bottom:var(--space-3);justify-content:space-between">';
      html += '<strong style="font-size:var(--fs-headline);font-weight:600;letter-spacing:var(--tracking-display)">' + escapeHtml(state.merchant || tr('generate.thisStore')) + '</strong>';
      html += '<span><span class="gen-result-meta__star">' + '★'.repeat(state.stars) + '</span><span style="color:#d1d1d6">' + '★'.repeat(5 - state.stars) + '</span></span>';
      html += '</div>';
      // 结果文本框（流式阶段：onToken 直接 append；结果阶段：完整文本，可编辑）
      var text = state.streamFullText;
      var readonly = isStreaming ? ' readonly' : '';
      html += '<textarea class="textarea gen-result-text" id="gen-result-text" placeholder="' + tr('generate.resultPlaceholder') + '"' + readonly + '>' + escapeHtml(text) + '</textarea>';
      // 元信息
      html += '<div class="gen-result-meta">';
      html += '<span>' + escapeHtml(catLabel(state.category)) + '</span>';
      html += '<span>·</span>';
      html += '<span>' + tr('generate.lengthReview', { 0: escapeHtml(state.length) }) + '</span>';
      html += '<span>·</span>';
      html += '<span>' + tr('generate.charCount', { 0: text.length }) + '</span>';
      html += '</div>';
      // 校验提示
      if (!isStreaming && state.validationMsg) {
        html += '<div class="gen-validation">' + escapeHtml(state.validationMsg) + '</div>';
      }
      html += '</section>';
    }
    // 动作区
    if (hasError) {
      // 错误态：错误信息 + 重试 + 修改参数
      html += '<section class="card gen-section">';
      html += '<div class="gen-error" id="gen-actions">';
      html += '<div class="gen-error__icon">⚠</div>';
      html += '<div class="gen-error__text">' + tr('generate.genFail', { 0: escapeHtml(state.errorState.message) }) + '</div>';
      html += '<div class="gen-error__actions">';
      html += '<button class="btn btn-primary pressable" type="button" data-action="retry">' + tr('generate.retry') + '</button>';
      html += '<button class="btn pressable" type="button" data-action="reset-params">' + tr('generate.resetParams') + '</button>';
      html += '</div>';
      html += '</div>';
      html += '</section>';
    } else if (isStreaming) {
      html += '<div class="gen-actions is-entered" style="transform:none;opacity:1">';
      html += '<div class="gen-actions-row gen-actions-row--primary">';
      html += '<button class="btn btn-primary pressable" type="button" data-action="stop">' + tr('generate.stop') + '</button>';
      html += '<button class="btn pressable" type="button" data-action="regenerate">' + tr('generate.regenerate') + '</button>';
      html += '</div>';
      html += '</div>';
    } else {
      html += '<div class="gen-actions" id="gen-actions">';
      // 主操作
      html += '<div class="gen-actions-row gen-actions-row--primary">';
      html += '<button class="btn btn-primary pressable" type="button" data-action="copy">' + tr('generate.copy') + '</button>';
      html += '<button class="btn pressable" type="button" data-action="regenerate">' + tr('generate.regenerate') + '</button>';
      html += '</div>';
      // 次操作
      html += '<div class="gen-actions-row">';
      html += '<button class="btn pressable" type="button" data-action="expand">' + tr('generate.expand') + '</button>';
      html += '<button class="btn pressable" type="button" data-action="shorten">' + tr('generate.shorten') + '</button>';
      html += '<button class="btn pressable" type="button" data-action="add-corpus">' + tr('generate.addCorpus') + '</button>';
      html += '</div>';
      // 重设参数
      html += '<div class="gen-actions-row">';
      html += '<button class="btn pressable" type="button" data-action="reset-params" style="flex:1 1 0">' + tr('generate.resetParams') + '</button>';
      html += '</div>';
      // 点赞 / 点踩
      html += renderFeedback();
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  /** 点赞 / 点踩 */
  function renderFeedback() {
    var likeActive = state.feedback === 'like' ? ' is-active' : '';
    var dislikeActive = state.feedback === 'dislike' ? ' is-active' : '';
    var html = '<div class="gen-feedback">';
    html += '<button class="gen-feedback__btn' + likeActive + ' pressable" type="button" data-action="feedback" data-value="like">👍 ' + tr('generate.feedbackLike') + '</button>';
    html += '<button class="gen-feedback__btn gen-feedback__btn--dislike' + dislikeActive + ' pressable" type="button" data-action="feedback" data-value="dislike">👎 ' + tr('generate.feedbackDislike') + '</button>';
    html += '</div>';
    return html;
  }

  /* ===================================================================
     七、星级拖动（Pointer Events + setPointerCapture + 1:1 跟手）
     =================================================================== */

  /** 根据指针位置更新星级（支持 0.5 步进半星）
   *  default/qa 模式：0.5-5 星
   *  polish 模式：0-5 星（含 0 = 不指定，第一个元素为 ∅ 占位）
   */
  function updateStarsFromPointer(e) {
    var starsEl = state.starDragSession && state.starDragSession.starsEl;
    if (!starsEl) return;
    var isPolish = state.starDragSession.isPolish;
    var rect = starsEl.getBoundingClientRect();
    if (rect.width === 0) return;
    var x = e.clientX - rect.left;
    // polish 模式有 6 个元素（0-5），其他有 5 个（1-5）
    var slots = isPolish ? 6 : 5;
    var slotWidth = rect.width / slots;
    var slot = Math.floor(x / slotWidth);
    if (slot < 0) slot = 0;
    if (slot > slots - 1) slot = slots - 1;
    // 计算半星：在 slot 内的位置 > 50% → 整星，否则 → 半星
    var posInSlot = (x - slot * slotWidth) / slotWidth;
    var halfStar = posInSlot < 0.5 ? 0.5 : 1;
    var starCount;
    if (isPolish) {
      starCount = slot === 0 ? 0 : (slot - 1 + halfStar); // polish: 0..5
    } else {
      starCount = slot + halfStar; // default/qa: 0.5..5
    }
    // 最小值约束
    if (!isPolish && starCount < 0.5) starCount = 0.5;
    // 量化到 0.5
    starCount = Math.round(starCount * 2) / 2;
    if (isPolish) {
      if (starCount !== state.polishStars) {
        state.polishStars = starCount;
        updateStarUI(starsEl, true);
      }
    } else {
      if (starCount !== state.stars) {
        state.stars = starCount;
        updateStarUI(starsEl, false);
      }
    }
  }

  /** 更新星级 UI（支持半星，仅在拖拽过程中调用，避免全量重渲）
   *  @param {boolean} isPolish 是否为润色模式（0-5 含 ∅）
   */
  function updateStarUI(starsEl, isPolish) {
    if (!starsEl) return;
    var stars = starsEl.querySelectorAll('.gen-stars__star');
    var currentVal = isPolish ? state.polishStars : state.stars;
    var fullStars = Math.floor(currentVal);
    var hasHalf = (currentVal % 1) >= 0.25 && (currentVal % 1) < 0.75;
    if (isPolish) {
      // polish: 第一个元素是 ∅（star=0），后面是 1..5
      for (var i = 0; i < stars.length; i++) {
        var starVal = i; // 0,1,2,3,4,5
        stars[i].classList.remove('is-on', 'is-half');
        if (starVal === 0) {
          stars[i].classList.toggle('is-on', currentVal === 0);
        } else if (starVal <= fullStars) {
          stars[i].classList.add('is-on');
        } else if (starVal === fullStars + 1 && hasHalf) {
          stars[i].classList.add('is-half');
        }
      }
    } else {
      // default/qa: 1..5（支持半星）
      for (var j = 0; j < stars.length; j++) {
        var idx = j + 1;
        stars[j].classList.remove('is-on', 'is-half');
        if (idx <= fullStars) {
          stars[j].classList.add('is-on');
        } else if (idx === fullStars + 1 && hasHalf) {
          stars[j].classList.add('is-half');
        }
      }
    }
    var hint = starsEl.parentNode.querySelector('.gen-stars__hint');
    if (hint) {
      var display = currentVal % 1 === 0 ? currentVal : currentVal.toFixed(1);
      hint.textContent = isPolish
        ? (currentVal === 0 ? tr('generate.polishNoStars') : tr('generate.starsHint', { 0: display }))
        : tr('generate.starsHint', { 0: display });
    }
    starsEl.setAttribute('aria-valuenow', String(currentVal));
  }

  /** 星级拖拽 pointerdown 委托处理 */
  function onStarPointerDown(e) {
    var starsEl = e.target.closest('.gen-stars');
    if (!starsEl) return;
    // 仅响应主键
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();

    var isPolish = starsEl.getAttribute('data-action') === 'star-drag-polish';
    state.starDragSession = {
      starsEl: starsEl,
      pointerId: e.pointerId,
      active: true,
      isPolish: isPolish,
      cleanup: null
    };

    // 立即按当前指针位置更新
    updateStarsFromPointer(e);

    // 捕获指针，确保后续 move/up 即使离开元素也能收到
    try { starsEl.setPointerCapture(e.pointerId); } catch (err) {}

    var onMove = function (ev) {
      if (!state.starDragSession || !state.starDragSession.active) return;
      updateStarsFromPointer(ev);
    };
    var onUp = function (ev) {
      if (!state.starDragSession || !state.starDragSession.active) return;
      state.starDragSession.active = false;
      starsEl.removeEventListener('pointermove', onMove);
      starsEl.removeEventListener('pointerup', onUp);
      starsEl.removeEventListener('pointercancel', onUp);
      try { starsEl.releasePointerCapture(ev.pointerId); } catch (err) {}
      // 释放后弹簧归位
      starsEl.classList.add('is-snapped');
      var t = setTimeout(function () {
        if (starsEl) starsEl.classList.remove('is-snapped');
      }, 240);
      state.timers.push(t);
      state.starDragSession = null;
    };

    starsEl.addEventListener('pointermove', onMove);
    starsEl.addEventListener('pointerup', onUp);
    starsEl.addEventListener('pointercancel', onUp);

    state.starDragSession.cleanup = function () {
      starsEl.removeEventListener('pointermove', onMove);
      starsEl.removeEventListener('pointerup', onUp);
      starsEl.removeEventListener('pointercancel', onUp);
      try { starsEl.releasePointerCapture(state.starDragSession.pointerId); } catch (err) {}
    };
  }

  /* ===================================================================
     八、流式生成（Task 6 改造：消费 AIEngine.generateReviewStream）
     - real 模式：真实 SSE token 逐字渲染
     - mock 模式：generateReviewStream 内部 setInterval 模拟流式
     - 中断：AbortController.abort()（real 中断 fetch；mock 内部清 interval）
     =================================================================== */

  /** 启动一次流式生成。params 同原 generateReview 参数。 */
  function startGeneration(params) {
    state.generationId++;
    var genId = state.generationId;
    try {
      state.abortController = new AbortController();
    } catch (e) {
      state.abortController = null;
    }
    state.errorState = null;

    var AI = ai();
    if (!AI || typeof AI.generateReviewStream !== 'function') {
      failGeneration(tr('generate.errAiEngine'));
      return;
    }

    var signal = state.abortController ? state.abortController.signal : undefined;

    AI.generateReviewStream(params, {
      signal: signal,
      onToken: function (chunk) {
        // 旧回调作废 / 已离开 streaming 阶段：忽略
        if (genId !== state.generationId) return;
        if (state.stage !== 'streaming') return;
        if (!chunk) return;
        state.streamFullText += chunk;
        appendTokenToTextarea(chunk);
      },
      onDone: function (fullText) {
        if (genId !== state.generationId) return;
        if (state.stage !== 'streaming') return;
        // fullText 为权威完整文本，覆盖累积值（避免 token 顺序/拼接误差）
        if (fullText && fullText.length > 0) {
          state.streamFullText = fullText;
        }
        finishGeneration();
      },
      onError: function (err) {
        if (genId !== state.generationId) return;
        if (state.stage !== 'streaming') return;
        var type = err && err.type;
        if (type === 'aborted') {
          // 用户主动中断：静默进入结果态，保留已显示内容
          finishGeneration();
          return;
        }
        // 其他错误：显示错误态（不回落本地，直接报错）
        var msg = (err && err.message) ? err.message : tr('generate.errGenRetry');
        failGeneration(msg);
      }
    });
  }

  /** 增量追加 token 到结果文本框（不全量重渲） */
  function appendTokenToTextarea(chunk) {
    if (!state.container) return;
    var ta = state.container.querySelector('#gen-result-text');
    if (ta) {
      ta.value += chunk;
    }
  }

  /** 流式正常结束：进入结果阶段，校验、保存历史、播放入场动画。
   *  幂等：通过 generationId 自增让旧回调作废，多次调用安全。 */
  function finishGeneration() {
    state.generationId++; // 旧回调作废
    state.abortController = null;

    var text = state.streamFullText;

    // 太短则丢弃，回到输入
    if (!text || text.length < 15) {
      state.stage = 'input';
      state.streamFullText = '';
      state.errorState = null;
      render();
      showToast(tr('generate.toastTooShort'), 'error');
      return;
    }

    // 真实性校验
    var AI = ai();
    if (AI && typeof AI.validateReview === 'function') {
      try {
        var vr = AI.validateReview(text);
        state.validationMsg = (vr && !vr.valid) ? vr.reason : '';
      } catch (e) {}
    }

    // 保存 / 更新历史
    var Store = store();
    if (Store) {
      if (state.historyId) {
        try {
          Store.updateHistory(state.historyId, { content: text, feedback: null });
        } catch (e) {}
      } else {
        try {
          var item = Store.addHistory({
            merchant: state.merchant.trim(),
            category: state.category,
            stars: state.stars,
            length: state.length,
            content: text,
            styleSource: getStyleSourceForHistory(),
            options: state.options,
            feedback: null
          });
          if (item) state.historyId = item.id;
        } catch (e) {}
      }
    }

    state.stage = 'result';
    render();
    playResultEnterAnimation();
  }

  /** 生成失败：进入错误态，显示「生成失败」+ 重试按钮 */
  function failGeneration(message) {
    state.generationId++; // 旧回调作废
    state.abortController = null;
    state.errorState = { message: message || tr('generate.errGenRetry') };
    state.stage = 'result';
    render();
    playResultEnterAnimation();
  }

  /** 结果区入场弹簧动画 */
  function playResultEnterAnimation() {
    if (!state.container) return;
    var actions = state.container.querySelector('#gen-actions');
    if (!actions) return;
    if (prefersReducedMotion()) {
      actions.classList.add('is-entered');
      return;
    }
    // 下一帧触发，确保初始 transform 生效
    state.rafId = requestAnimationFrame(function () {
      state.rafId = null;
      actions.classList.add('is-entered');
    });
  }

  /* ===================================================================
     九、动作处理
     =================================================================== */

  /** 获取结果文本框当前值（用户可能已编辑） */
  function getResultText() {
    if (!state.container) return state.streamFullText;
    var ta = state.container.querySelector('#gen-result-text');
    return ta ? ta.value : state.streamFullText;
  }

  /** 同步结果文本框值到 state */
  function syncResultText() {
    state.streamFullText = getResultText();
  }

  /** 生成（首次） */
  function handleGenerate() {
    if (!state.merchant.trim()) {
      showToast(tr('generate.toastMerchantRequired'), 'error');
      var merchantEl = state.container.querySelector('#gen-merchant');
      if (merchantEl) merchantEl.focus();
      return;
    }
    var AI = ai();
    if (!AI || typeof AI.generateReviewStream !== 'function') {
      showToast(tr('generate.errAiEngine'), 'error');
      return;
    }

    // 中断任何进行中的流式（防御性）
    abortCurrentGeneration();

    // 重置历史 id（新一轮生成）
    state.historyId = null;
    state.feedback = null;
    state.validationMsg = '';
    state.streamFullText = '';
    state.errorState = null;

    // 先进入流式阶段显示「正在生成...」，再延迟调用 AI（避免 UI 卡顿）
    state.stage = 'streaming';
    render();

    nextTick(function () {
      var params = buildParams();
      startGeneration(params);
    });
  }

  /** 换一条（中断可重定向） */
  function handleRegenerate() {
    var AI = ai();
    if (!AI || typeof AI.generateReviewStream !== 'function') {
      showToast(tr('generate.errAiEngine'), 'error');
      return;
    }

    // 取 prevText：流式中取已累积文本，结果态取当前文本框值（用于 mock 模式相似度控制）
    var prevText = state.stage === 'streaming' ? state.streamFullText : getResultText();

    // 中断当前流式（real: abort fetch；mock: 内部清 interval；旧回调作废）
    abortCurrentGeneration();

    // 重置反馈与文本
    state.feedback = null;
    state.validationMsg = '';
    state.streamFullText = '';
    state.errorState = null;
    if (state.historyId) {
      var Store = store();
      if (Store) {
        try { Store.updateHistory(state.historyId, { feedback: null }); } catch (e) {}
      }
    }

    // 进入流式阶段
    state.stage = 'streaming';
    render();

    nextTick(function () {
      var params = buildParams(prevText);
      startGeneration(params);
    });
  }

  /** 停止流式：abort 当前生成并进入结果态（保留已显示内容）。
   *  - real 模式：abort 中断 fetch；mock 模式：generateReviewStream 内部监听 abort 清 interval
   *  - mock 模式 abort 不会触发 onError，所以这里直接调 finishGeneration 进入结果态。
   *  - real 模式 abort 可能触发 onError({type:'aborted'})，但 generationId 已自增，旧回调作废，
   *    不会重复处理。
   */
  function handleStop() {
    // 润色模式
    if (state.mode === 'polish') {
      if (state.polishStage !== 'streaming') return;
      abortCurrentGeneration();
      finishPolish();
      return;
    }
    // default / qa 模式
    if (state.stage !== 'streaming') return;
    abortCurrentGeneration();
    finishGeneration();
  }

  /** 一键复制 */
  function handleCopy() {
    var text = getResultText();
    if (!text) {
      showToast(tr('generate.toastNothingToCopy'), 'error');
      return;
    }
    var done = function () {
      showToast(tr('generate.toastCopied'), 'success');
      // 回写历史 copied 标记
      if (state.historyId) {
        var Store = store();
        if (Store) {
          try { Store.updateHistory(state.historyId, { copied: true }); } catch (e) {}
        }
      }
    };
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(done, function () {
        legacyCopy(text, done);
      });
    } else {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, done) {
    try {
      var ta = global.document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      global.document.body.appendChild(ta);
      ta.select();
      global.document.execCommand('copy');
      global.document.body.removeChild(ta);
      done();
    } catch (e) {
      showToast(tr('generate.toastCopyFailed'), 'error');
    }
  }

  /** 加长 */
  function handleExpand() {
    var AI = ai();
    if (!AI || typeof AI.expand !== 'function') return;
    syncResultText();
    var text = AI.expand(state.streamFullText);
    state.streamFullText = text;
    updateResultText(text);
    updateHistoryContent(text);
  }

  /** 缩短 */
  function handleShorten() {
    var AI = ai();
    if (!AI || typeof AI.shorten !== 'function') return;
    syncResultText();
    var text = AI.shorten(state.streamFullText);
    state.streamFullText = text;
    updateResultText(text);
    updateHistoryContent(text);
  }

  /** 更新结果文本框 + 字数 */
  function updateResultText(text) {
    if (!state.container) return;
    var ta = state.container.querySelector('#gen-result-text');
    if (ta) ta.value = text;
    // 更新字数
    var meta = state.container.querySelector('.gen-result-meta');
    if (meta) {
      var spans = meta.querySelectorAll('span');
      if (spans.length >= 3) {
        spans[spans.length - 1].textContent = tr('generate.charCount', { 0: text.length });
      }
    }
  }

  /** 回写历史 content */
  function updateHistoryContent(text) {
    if (!state.historyId) return;
    var Store = store();
    if (!Store) return;
    try { Store.updateHistory(state.historyId, { content: text }); } catch (e) {}
  }

  /** 加入语录库（反向入库） */
  function handleAddToCorpus() {
    var Store = store();
    var AI = ai();
    if (!Store) {
      showToast(tr('generate.errDataLayer'), 'error');
      return;
    }
    var text = getResultText();
    if (!text || text.length < 10) {
      showToast(tr('generate.toastTooShortCorpus'), 'error');
      return;
    }
    var tagIds = [];
    if (state.styleSourceMode === 'single' && state.styleSourceTagId) {
      tagIds = [state.styleSourceTagId];
    } else if (state.styleSourceMode === 'mixed') {
      tagIds = state.styleSourceTagIds.slice();
    }
    var styleFeatures = null;
    if (AI && typeof AI.analyzeStyle === 'function') {
      try { styleFeatures = AI.analyzeStyle(text); } catch (e) {}
    }
    try {
      Store.addCorpus({
        text: text,
        category: state.category,
        tagIds: tagIds,
        source: 'reverse',
        styleFeatures: styleFeatures || {}
      });
      showToast(tr('generate.toastAdded'), 'success');
    } catch (e) {
      showToast(tr('generate.toastAddFailed'), 'error');
    }
  }

  /** 修改参数（回到输入态，保留表单字段） */
  function handleResetParams() {
    abortCurrentGeneration();
    state.stage = 'input';
    // spec: 修改参数后视为新一轮，应新建历史
    state.historyId = null;
    state.feedback = null;
    state.streamFullText = '';
    state.errorState = null;
    state.validationMsg = '';
    render();
  }

  /* ===================================================================
     八-2、模式切换 / 提问模式 / 润色模式 动作处理
     =================================================================== */

  /** 切换生成模式 */
  function handleSwitchMode(newMode) {
    if (newMode === state.mode) return;
    // 中断任何进行中的流式
    abortCurrentGeneration();
    // 切换前清理上一模式的残留状态（保留 merchant/stars 共用字段）
    state.streamFullText = '';
    state.errorState = null;
    state.validationMsg = '';
    state.feedback = null;
    state.historyId = null;
    state.qaError = null;
    state.qaLoadingQuestions = false;

    state.mode = newMode;
    // 各模式回到对应的 input 阶段
    if (newMode === 'qa') {
      state.qaStage = 'setup';
      state.qaQuestions = [];
      state.qaCurrentIdx = 0;
      state.qaAnswers = {};
      state.stage = 'input';
    } else if (newMode === 'polish') {
      state.polishStage = 'input';
      state.polishOriginalText = '';
    } else {
      // default
      state.stage = 'input';
    }
    render();
  }

  /* ---------- 提问模式 ---------- */

  /** 开始提问：调 AIEngine.generateQuestions 获取问题列表 */
  function handleQAStart() {
    if (!state.merchant.trim()) {
      state.qaError = { message: tr('generate.toastMerchantRequired') };
      render();
      var merchantEl = state.container.querySelector('#gen-merchant');
      if (merchantEl) merchantEl.focus();
      return;
    }
    var AI = ai();
    if (!AI || typeof AI.generateQuestions !== 'function') {
      state.qaError = { message: tr('generate.errAiEngine') };
      render();
      return;
    }
    state.qaError = null;
    state.qaLoadingQuestions = true;
    // 先切到 asking 阶段（显示 loading 占位）
    state.qaStage = 'asking';
    state.qaQuestions = [];
    state.qaAnswers = {};
    state.qaCurrentIdx = 0;
    render();

    var params = {
      merchant: state.merchant.trim(),
      stars: state.stars,
      category: '', // 提问模式不强制品类，由 AI 自由提问
      answeredQuestions: [],
      corpusList: getFilteredCorpus()
    };

    try {
      state.abortController = new AbortController();
    } catch (e) {
      state.abortController = null;
    }
    var signal = state.abortController ? state.abortController.signal : undefined;

    AI.generateQuestions(params, {
      signal: signal,
      onQuestions: function (questions) {
        if (!questions || !questions.length) {
          state.qaLoadingQuestions = false;
          state.qaError = { message: 'AI 未能生成问题，请重试（错误代码：30001）' + err.code + '，错误信息：' + err.message + '））' };
          render();
          return;
        }
        state.qaLoadingQuestions = false;
        state.qaQuestions = questions; // 不限制问题个数
        render();
      },
      onError: function (err) {
        state.qaLoadingQuestions = false;
        var msg = (err && err.message) ? err.message : tr('generate.errQaFailed');
        state.qaError = { message: msg };
        render();
      }
    });
  }

  /** 返回 setup 修改商家/星级 */
  function handleQABackSetup() {
    abortCurrentGeneration();
    state.qaStage = 'setup';
    state.qaQuestions = [];
    state.qaAnswers = {};
    state.qaCurrentIdx = 0;
    state.qaError = null;
    state.qaLoadingQuestions = false;
    render();
  }

  /** 提问模式生成评价：基于问答调 generateFromAnswersStream */
  function handleQAGenerate() {
    var AI = ai();
    if (!AI || typeof AI.generateFromAnswersStream !== 'function') {
      showToast(tr('generate.errAiEngine'), 'error');
      return;
    }
    // 检查至少有一个回答
    var hasAnswer = false;
    Object.keys(state.qaAnswers).forEach(function (k) {
      var v = state.qaAnswers[k];
      if (Array.isArray(v) ? v.length > 0 : (v && v.trim())) hasAnswer = true;
    });
    if (!hasAnswer) {
      showToast(tr('generate.toastAnswerRequired'), 'error');
      return;
    }

    // 同步所有 textarea 值到 state（防止用户未失焦）
    syncQaAnswersFromUI();

    // 构造 answers 数组（多选答案合并为 "选项A、选项B" 字符串）
    var answers = [];
    state.qaQuestions.forEach(function (q, idx) {
      var raw = state.qaAnswers[idx];
      var ansStr = '';
      if (Array.isArray(raw)) {
        ansStr = raw.join('、');
      } else if (typeof raw === 'string') {
        ansStr = raw;
      }
      if (ansStr.trim()) {
        answers.push({ question: q, answer: ansStr.trim() });
      }
    });

    // 中断任何进行中的流式
    abortCurrentGeneration();
    state.historyId = null;
    state.feedback = null;
    state.validationMsg = '';
    state.streamFullText = '';
    state.errorState = null;

    // 进入 generating 阶段（复用 default result 渲染）
    state.qaStage = 'generating';
    state.stage = 'streaming';
    render();

    nextTick(function () {
      var params = {
        merchant: state.merchant.trim() || '这家店',
        category: state.category,
        stars: state.stars,
        length: state.length,
        wordCount: state.qaWordCount, // 任务5：提问模式字数选择
        tendency: {
          style: state.tendencyStyle,
          emoji: state.tendencyEmoji
        },
        corpusList: getFilteredCorpus(),
        answers: answers,
        additionalComment: state.qaAdditionalComment // 任务7：补充备注
      };
      startQAStream(params);
    });
  }

  /** 启动提问模式的流式生成 */
  function startQAStream(params) {
    state.generationId++;
    var genId = state.generationId;
    try {
      state.abortController = new AbortController();
    } catch (e) {
      state.abortController = null;
    }
    state.errorState = null;

    var AI = ai();
    var signal = state.abortController ? state.abortController.signal : undefined;

    AI.generateFromAnswersStream(params, {
      signal: signal,
      onToken: function (chunk) {
        if (genId !== state.generationId) return;
        if (state.stage !== 'streaming') return;
        if (!chunk) return;
        state.streamFullText += chunk;
        appendTokenToTextarea(chunk);
      },
      onDone: function (fullText) {
        if (genId !== state.generationId) return;
        if (state.stage !== 'streaming') return;
        if (fullText && fullText.length > 0) {
          state.streamFullText = fullText;
        }
        finishGeneration();
      },
      onError: function (err) {
        if (genId !== state.generationId) return;
        if (state.stage !== 'streaming') return;
        var type = err && err.type;
        if (type === 'aborted') {
          finishGeneration();
          return;
        }
        var msg = (err && err.message) ? err.message : tr('generate.errGenRetry');
        failGeneration(msg);
      }
    });
  }

  /** 同步所有 QA textarea 值到 state（处理多选+其他共存） */
  function syncQaAnswersFromUI() {
    if (!state.container) return;
    var tas = state.container.querySelectorAll('[data-field="qa-answer"]');
    for (var i = 0; i < tas.length; i++) {
      var idx = parseInt(tas[i].getAttribute('data-qa-idx'), 10);
      if (!isNaN(idx)) {
        var val = tas[i].value.trim();
        if (tas[i].classList.contains('gen-qa-other__input')) {
          // "其他"输入框：与多选选项合并
          var cur = state.qaAnswers[idx];
          var optsQ2 = state.qaQuestions[idx];
          var optsList2 = (optsQ2 && Array.isArray(optsQ2.options)) ? optsQ2.options : [];
          if (Array.isArray(cur)) {
            cur = cur.filter(function (a) { return optsList2.indexOf(a) !== -1; });
            if (val) cur.push(val);
            if (cur.length === 0) delete state.qaAnswers[idx];
            else state.qaAnswers[idx] = cur;
          } else {
            if (val) state.qaAnswers[idx] = val;
            else if (!optsList2.length) delete state.qaAnswers[idx]; // 纯填空题清空
          }
        } else {
          // 纯填空题
          state.qaAnswers[idx] = tas[i].value;
        }
        if (global.document.activeElement === tas[i]) {
          state.qaCurrentIdx = idx;
        }
      }
    }
  }

  /* ---------- 润色模式 ---------- */

  /** 开始润色：调 AIEngine.polishStream */
  function handlePolishStart() {
    var AI = ai();
    if (!AI || typeof AI.polishStream !== 'function') {
      showToast(tr('generate.errAiEngine'), 'error');
      return;
    }
    // 同步 textarea 值
    syncPolishRawFromUI();
    if (state.polishRawText.trim().length < 10) {
      showToast(tr('generate.toastMinChars'), 'error');
      return;
    }

    // 中断任何进行中的流式
    abortCurrentGeneration();
    state.historyId = null;
    state.feedback = null;
    state.streamFullText = '';
    state.errorState = null;
    state.validationMsg = '';

    // 备份原文
    state.polishOriginalText = state.polishRawText;

    // 进入流式阶段
    state.polishStage = 'streaming';
    render();

    nextTick(function () {
      var params = {
        rawText: state.polishRawText,
        tendency: {
          style: state.tendencyStyle,
          emoji: state.tendencyEmoji
        },
        stars: state.polishStars,
        merchant: state.merchant.trim(),
        corpusList: getFilteredCorpus(),
        wordCount: state.polishWordCount // 任务5：润色模式字数选择
      };
      startPolishStream(params);
    });
  }

  /** 启动润色流式 */
  function startPolishStream(params) {
    state.generationId++;
    var genId = state.generationId;
    try {
      state.abortController = new AbortController();
    } catch (e) {
      state.abortController = null;
    }
    state.errorState = null;

    var AI = ai();
    var signal = state.abortController ? state.abortController.signal : undefined;

    AI.polishStream(params, {
      signal: signal,
      onToken: function (chunk) {
        if (genId !== state.generationId) return;
        if (state.polishStage !== 'streaming') return;
        if (!chunk) return;
        state.streamFullText += chunk;
        appendTokenToTextarea(chunk);
      },
      onDone: function (fullText) {
        if (genId !== state.generationId) return;
        if (state.polishStage !== 'streaming') return;
        if (fullText && fullText.length > 0) {
          state.streamFullText = fullText;
        }
        finishPolish();
      },
      onError: function (err) {
        if (genId !== state.generationId) return;
        if (state.polishStage !== 'streaming') return;
        var type = err && err.type;
        if (type === 'aborted') {
          finishPolish();
          return;
        }
        var msg = (err && err.message) ? err.message : tr('generate.errPolishRetry');
        failPolish(msg);
      }
    });
  }

  /** 同步 polish textarea 值到 state */
  function syncPolishRawFromUI() {
    if (!state.container) return;
    var ta = state.container.querySelector('#gen-polish-raw');
    if (ta) state.polishRawText = ta.value;
  }

  /** 润色完成：进入结果态，保存历史 */
  function finishPolish() {
    state.generationId++;
    state.abortController = null;

    var text = state.streamFullText;
    if (!text || text.length < 5) {
      // 润色结果过短，回落原文
      state.streamFullText = state.polishOriginalText || '';
    }

    // 保存历史（润色结果也存入历史，标注 mode=polish）
    var Store = store();
    if (Store) {
      try {
        var item = Store.addHistory({
          merchant: state.merchant.trim() || '润色',
          category: '润色',
          stars: state.polishStars || 5,
          length: '中',
          content: state.streamFullText,
          styleSource: 'polish',
          options: { originalLength: state.polishOriginalText.length },
          feedback: null
        });
        if (item) state.historyId = item.id;
      } catch (e) {}
    }

    state.polishStage = 'result';
    render();
    playResultEnterAnimation();
  }

  /** 润色失败 */
  function failPolish(message) {
    state.generationId++;
    state.abortController = null;
    state.errorState = { message: message || tr('generate.errPolishRetry') };
    state.polishStage = 'result';
    render();
    playResultEnterAnimation();
  }

  /** 返回润色输入态 */
  function handlePolishBackInput() {
    abortCurrentGeneration();
    state.polishStage = 'input';
    state.streamFullText = '';
    state.errorState = null;
    state.polishOriginalText = '';
    state.historyId = null;
    render();
  }

  /** 点赞 / 点踩 —— 触发 AI 记忆反思 */
  function handleFeedback(type) {
    var Store = store();
    // toggle
    if (state.feedback === type) {
      state.feedback = null;
    } else {
      state.feedback = type;
    }
    // 更新 UI
    var btns = state.container.querySelectorAll('[data-action="feedback"]');
    for (var i = 0; i < btns.length; i++) {
      var v = btns[i].getAttribute('data-value');
      btns[i].classList.toggle('is-active', v === state.feedback);
    }
    // 回写历史
    if (state.historyId && Store) {
      try { Store.updateHistory(state.historyId, { feedback: state.feedback }); } catch (e) {}
    }
    // AI 记忆反思：记录用户反馈，让 AI 从中学习
    if (Store && typeof Store.recordGenerationAndReflect === 'function' && state.feedback) {
      try {
        Store.recordGenerationAndReflect({
          merchant: state.merchant,
          stars: state.stars,
          feedback: state.feedback,
          text: state.streamFullText
        });
      } catch (e) {}
    }
    if (state.feedback === 'dislike') {
      showToast(tr('generate.toastFeedbackDislike'), 'default');
    } else if (state.feedback === 'like') {
      showToast(tr('generate.toastFeedbackLike'), 'success');
    }
  }

  /** 动作分发 */
  function handleAction(action, target) {
    switch (action) {
      case 'generate':
        handleGenerate();
        break;
      case 'regenerate':
        handleRegenerate();
        break;
      case 'retry':
        // 错误态重试：润色模式用 polish 重试，其他用 regenerate
        if (state.mode === 'polish') handlePolishStart();
        else handleRegenerate();
        break;
      case 'stop':
        handleStop();
        break;
      case 'copy':
        handleCopy();
        break;
      case 'expand':
        handleExpand();
        break;
      case 'shorten':
        handleShorten();
        break;
      case 'add-corpus':
        handleAddToCorpus();
        break;
      case 'reset-params':
        handleResetParams();
        break;
      case 'feedback':
        handleFeedback(target.getAttribute('data-value'));
        break;
      case 'goto-train':
        var App = app();
        if (App && typeof App.navigate === 'function') App.navigate('train');
        break;
      /* ---- 模式切换 ---- */
      case 'switch-mode':
        handleSwitchMode(target.getAttribute('data-value'));
        break;
      /* ---- 提问模式 ---- */
      case 'qa-start':
        handleQAStart();
        break;
      case 'qa-back-setup':
        handleQABackSetup();
        break;
      case 'qa-generate':
        handleQAGenerate();
        break;
      case 'qa-select-option': {
        var qaIdx = target.getAttribute('data-qa-idx');
        var optIdx = parseInt(target.getAttribute('data-opt-idx'), 10);
        var q = state.qaQuestions[qaIdx];
        var opts = (q && Array.isArray(q.options)) ? q.options : [];
        if (opts[optIdx]) {
          // 多选模式：答案为数组，切换选中状态
          var cur = state.qaAnswers[qaIdx];
          var arr = Array.isArray(cur) ? cur.slice() : [];
          var optVal = opts[optIdx];
          var pos = arr.indexOf(optVal);
          if (pos !== -1) {
            arr.splice(pos, 1); // 取消选中
          } else {
            arr.push(optVal); // 添加选中
          }
          if (arr.length === 0) {
            delete state.qaAnswers[qaIdx];
          } else {
            state.qaAnswers[qaIdx] = arr;
          }
          refreshQAItem(qaIdx);
          updateQAProgress();
        }
        break;
      }
      case 'qa-select-other': {
        // 点击"其他"标签：聚焦到对应的自定义输入框
        var otherIdx = target.getAttribute('data-qa-idx');
        if (otherIdx !== null) {
          // "其他"输入与选项可共存（多选），不清除选项
          // 确保 qaAnswers 有字符串槽位（若当前是数组则保留，输入时再合并）
          refreshQAItem(otherIdx);
          updateQAProgress();
          var otherInput = state.container.querySelector('.gen-qa-item[data-qa-idx="' + otherIdx + '"] .gen-qa-other__input');
          if (otherInput) {
            setTimeout(function () { otherInput.focus(); }, 50);
          }
        }
        break;
      }
      case 'qa-word-count':
        state.qaWordCount = target.getAttribute('data-value');
        // 清除自定义输入
        var qaCustomEl = state.container && state.container.querySelector('[data-field="qa-word-count-custom"]');
        if (qaCustomEl) qaCustomEl.value = '';
        updateChipsActive('qa-word-count', state.qaWordCount);
        break;
      case 'polish-word-count':
        state.polishWordCount = target.getAttribute('data-value');
        var polishCustomEl = state.container && state.container.querySelector('[data-field="polish-word-count-custom"]');
        if (polishCustomEl) polishCustomEl.value = '';
        updateChipsActive('polish-word-count', state.polishWordCount);
        break;
      /* ---- 润色模式 ---- */
      case 'polish-start':
        handlePolishStart();
        break;
      case 'polish-again':
        handlePolishStart();
        break;
      case 'polish-back-input':
        handlePolishBackInput();
        break;
      case 'length':
        state.length = parseInt(target.getAttribute('data-value'), 10) || target.getAttribute('data-value');
        updateChipsActive('length', state.length);
        break;
      case 'option': {
        var key = target.getAttribute('data-value');
        if (state.options[key]) {
          delete state.options[key];
          target.classList.remove('is-active');
        } else {
          state.options[key] = true;
          target.classList.add('is-active');
        }
        break;
      }
      case 'source-mode':
        state.styleSourceMode = target.getAttribute('data-value');
        // 切换模式时重置已选标签
        state.styleSourceTagId = null;
        state.styleSourceTagIds = [];
        rerenderPreservingMerchant();
        break;
      case 'source-tag': {
        var tagId = target.getAttribute('data-value');
        if (state.styleSourceMode === 'single') {
          state.styleSourceTagId = (state.styleSourceTagId === tagId) ? null : tagId;
        } else {
          var idx = state.styleSourceTagIds.indexOf(tagId);
          if (idx === -1) state.styleSourceTagIds.push(tagId);
          else state.styleSourceTagIds.splice(idx, 1);
        }
        rerenderPreservingMerchant();
        break;
      }
      case 'tendency-style': {
        var v = target.getAttribute('data-value');
        state.tendencyStyle = v || null;
        updateChipsActive('tendency-style', v);
        break;
      }
      case 'tendency-emoji': {
        var ev = target.getAttribute('data-value');
        if (ev === 'true') state.tendencyEmoji = true;
        else if (ev === 'false') state.tendencyEmoji = false;
        else state.tendencyEmoji = null;
        updateChipsActive('tendency-emoji', ev);
        break;
      }
    }
  }

  /** 更新某组 chip 的 is-active 状态（不全量重渲） */
  function updateChipsActive(action, value) {
    if (!state.container) return;
    var chips = state.container.querySelectorAll('[data-action="' + action + '"]');
    var strValue = String(value);
    for (var i = 0; i < chips.length; i++) {
      var v = chips[i].getAttribute('data-value');
      chips[i].classList.toggle('is-active', v === strValue);
    }
  }

  /** 重渲表单（保留商家名输入焦点与光标位置） */
  function rerenderPreservingMerchant() {
    if (!state.container) return;
    var merchantEl = state.container.querySelector('#gen-merchant');
    var merchantValue = merchantEl ? merchantEl.value : state.merchant;
    var focused = merchantEl ? (global.document.activeElement === merchantEl) : false;
    var selStart = merchantEl ? merchantEl.selectionStart : null;
    var selEnd = merchantEl ? merchantEl.selectionEnd : null;

    state.merchant = merchantValue;
    render();

    if (focused) {
      var newEl = state.container.querySelector('#gen-merchant');
      if (newEl) {
        newEl.focus();
        if (selStart !== null && selEnd !== null) {
          try { newEl.setSelectionRange(selStart, selEnd); } catch (e) {}
        }
      }
    }
  }

  /* ===================================================================
     十、事件绑定
     =================================================================== */

  function bindEvents() {
    if (!state.container) return;

    // 商家名输入 + 结果文本编辑 + 润色原文 + QA 回答
    on(state.container, 'input', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'gen-merchant') {
        state.merchant = t.value;
      } else if (t.id === 'gen-result-text') {
        // 用户编辑结果文本，同步到 state
        state.streamFullText = t.value;
      } else if (t.id === 'gen-polish-raw' || t.getAttribute('data-field') === 'polish-raw') {
        state.polishRawText = t.value;
        // 更新字数显示（不全量重渲）
        var countEl = state.container.querySelector('.gen-polish-meta__count');
        if (countEl) countEl.textContent = tr('generate.charCount', { 0: t.value.length });
        // 更新润色按钮可用态
        var btn = state.container.querySelector('[data-action="polish-start"]');
        if (btn) btn.disabled = t.value.trim().length < 10;
        // 更新提示
        var hint = state.container.querySelector('.gen-polish-hint');
        if (hint) {
          if (t.value.trim().length >= 10) hint.style.display = 'none';
          else hint.style.display = '';
        }
      } else if (t.getAttribute('data-field') === 'qa-answer') {
        var idx = parseInt(t.getAttribute('data-qa-idx'), 10);
        if (!isNaN(idx)) {
          state.qaCurrentIdx = idx;
          if (t.classList.contains('gen-qa-other__input')) {
            // "其他"输入框：存为字符串（与多选数组共存——选项放数组，其他放字符串）
            // 但 qaAnswers[idx] 只能存一个值，所以多选+其他需要合并
            // 策略：如果有选项数组，把其他文本也加入数组；否则直接存字符串
            var curAns = state.qaAnswers[idx];
            var otherText = t.value.trim();
            if (Array.isArray(curAns)) {
              // 已有多选选项：把"其他"文本作为额外项加入数组
              // 先移除旧的"其他"文本（非选项的项）
              var optsQ = state.qaQuestions[idx];
              var optsList = (optsQ && Array.isArray(optsQ.options)) ? optsQ.options : [];
              curAns = curAns.filter(function (a) { return optsList.indexOf(a) !== -1; });
              if (otherText) curAns.push(otherText);
              if (curAns.length === 0) delete state.qaAnswers[idx];
              else state.qaAnswers[idx] = curAns;
            } else {
              // 无多选选项：直接存字符串
              if (otherText) state.qaAnswers[idx] = otherText;
              else delete state.qaAnswers[idx];
            }
            // 更新 Other 标签和选择框态
            var otherWrap = t.closest('.gen-qa-other');
            if (otherWrap) {
              var otherLab = otherWrap.querySelector('.gen-qa-other__label');
              var otherCheckbox = otherWrap.querySelector('.gen-qa-option__checkbox');
              var hasContent = otherText.length > 0;
              if (otherLab) {
                if (hasContent) otherLab.classList.add('is-active');
                else otherLab.classList.remove('is-active');
              }
              if (otherCheckbox) {
                if (hasContent) otherCheckbox.classList.add('is-active');
                else otherCheckbox.classList.remove('is-active');
              }
            }
          } else {
            // 纯填空题 textarea
            state.qaAnswers[idx] = t.value;
          }
          updateQAProgress();
        }
      } else if (t.getAttribute('data-field') === 'qa-additional') {
        state.qaAdditionalComment = t.value;
      } else if (t.getAttribute('data-field') === 'qa-word-count-custom') {
        var qaCustomVal = parseInt(t.value, 10);
        if (isFinite(qaCustomVal) && qaCustomVal >= 30 && qaCustomVal <= 800) {
          state.qaWordCount = qaCustomVal;
          updateChipsActive('qa-word-count', 'none'); // 清除预设高亮
        }
      } else if (t.getAttribute('data-field') === 'polish-word-count-custom') {
        var polishCustomVal = parseInt(t.value, 10);
        if (isFinite(polishCustomVal) && polishCustomVal >= 30 && polishCustomVal <= 800) {
          state.polishWordCount = polishCustomVal;
          updateChipsActive('polish-word-count', 'none');
        }
      }
    });

    // 品类切换
    on(state.container, 'change', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'gen-category') {
        state.category = t.value;
        // 品类变化时清空已勾选项（不同品类勾选项不同）
        state.options = {};
        rerenderPreservingMerchant();
      }
    });

    // 点击事件委托（按钮 / chip）
    on(state.container, 'click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (action === 'star-drag' || action === 'star-drag-polish') return; // 星级由 pointerdown 处理
      handleAction(action, btn);
    });

    // 星级拖拽（pointerdown 委托，default + qa + polish 共用）
    on(state.container, 'pointerdown', onStarPointerDown);

    // 星级键盘可访问性
    on(state.container, 'keydown', function (e) {
      var starsEl = e.target.closest && e.target.closest('.gen-stars');
      if (!starsEl) return;
      var isPolish = starsEl.getAttribute('data-action') === 'star-drag-polish';
      var key = e.key;
      if (key === 'ArrowLeft' || key === 'ArrowDown') {
        e.preventDefault();
        if (isPolish) {
          state.polishStars = Math.max(0, state.polishStars - 1);
        } else {
          state.stars = Math.max(1, state.stars - 1);
        }
        updateStarUI(starsEl, isPolish);
        starsEl.classList.add('is-snapped');
        var t = setTimeout(function () { starsEl.classList.remove('is-snapped'); }, 240);
        state.timers.push(t);
      } else if (key === 'ArrowRight' || key === 'ArrowUp') {
        e.preventDefault();
        if (isPolish) {
          state.polishStars = Math.min(5, state.polishStars + 1);
        } else {
          state.stars = Math.min(5, state.stars + 1);
        }
        updateStarUI(starsEl, isPolish);
        starsEl.classList.add('is-snapped');
        var t2 = setTimeout(function () { starsEl.classList.remove('is-snapped'); }, 240);
        state.timers.push(t2);
      }
    });

    // Store 数据变化 → refresh
    var Store = store();
    if (Store && typeof Store.onChange === 'function') {
      state.unsubStore = Store.onChange(function () {
        // 输入态下数据变化（如反向入库），重渲以更新不足提示
        if (state.stage === 'input' && state.mode === 'default') refresh();
      });
    }

    // 路由变化 → 卸载阶段如还在流式则截断保存
    var App = app();
    if (App && typeof App.onRouteChange === 'function') {
      state.unsubRoute = App.onRouteChange(function (toView, fromView) {
        if (fromView === 'generate' && toView !== 'generate') {
          // 即将离开本视图（unmount 会处理清理）
        }
      });
    }
  }

  /** 局部更新 QA 进度条与计数（不全量重渲，避免 textarea 失焦） */
  function updateQAProgress() {
    if (!state.container) return;
    var answered = 0;
    Object.keys(state.qaAnswers).forEach(function (k) {
      var v = state.qaAnswers[k];
      if (Array.isArray(v) ? v.length > 0 : (v && v.trim())) answered++;
    });
    var total = state.qaQuestions.length;
    var pct = total ? Math.round((answered / total) * 100) : 0;
    var bar = state.container.querySelector('.gen-qa-progress__bar');
    if (bar) bar.style.width = pct + '%';
    var text = state.container.querySelector('.gen-qa-progress__text');
    if (text) text.textContent = tr('generate.qaAnswered', { 0: answered, 1: total });
    // 更新当前问题高亮
    var items = state.container.querySelectorAll('.gen-qa-item');
    for (var i = 0; i < items.length; i++) {
      var idx = parseInt(items[i].getAttribute('data-qa-idx'), 10);
      if (idx === state.qaCurrentIdx) items[i].classList.add('is-current');
      else items[i].classList.remove('is-current');
    }
  }

  /** 构建单个 QA 选项区 HTML（供 renderQAAsking 和 refreshQAItem 共用） */
  function buildQAItemOptionsHTML(q, idx) {
    var qText = typeof q === 'string' ? q : (q && q.text) || '';
    var qOptions = (typeof q === 'object' && Array.isArray(q.options)) ? q.options : [];
    var rawAns = state.qaAnswers[idx];
    // 解析答案：数组中属于选项的项 → 选中态；不属于选项的项 → "其他"文本
    var selectedOpts = [];
    var otherText = '';
    if (Array.isArray(rawAns)) {
      rawAns.forEach(function (item) {
        if (qOptions.indexOf(item) !== -1) selectedOpts.push(item);
        else otherText = item; // 非选项的项视为"其他"文本
      });
    } else if (typeof rawAns === 'string') {
      if (qOptions.length && qOptions.indexOf(rawAns) === -1) {
        otherText = rawAns; // 选择题但答案是自定义文本
      } else if (qOptions.indexOf(rawAns) !== -1) {
        selectedOpts.push(rawAns);
      } else {
        otherText = rawAns; // 纯填空题
      }
    }
    var isOtherSelected = !!otherText;
    var html = '';
    // 问题标题
    html += '<div class="gen-qa-item__q">';
    html += '<span class="gen-qa-item__num">' + (idx + 1) + '</span>';
    html += '<span class="gen-qa-item__text">' + escapeHtml(qText) + '</span>';
    if (qOptions.length) html += '<span class="gen-qa-item__hint">' + tr('generate.qaMulti') + '</span>';
    html += '</div>';
    // 选择题选项（支持多选）
    if (qOptions.length) {
      html += '<div class="gen-qa-options" data-qa-opts-idx="' + idx + '">';
      qOptions.forEach(function (opt, oi) {
        var letter = String.fromCharCode(65 + oi);
        var optActive = selectedOpts.indexOf(opt) !== -1 ? ' is-active' : '';
        html += '<button type="button" class="gen-qa-option pressable' + optActive + '" ' +
          'data-action="qa-select-option" data-qa-idx="' + idx + '" data-opt-idx="' + oi + '">' +
          '<span class="gen-qa-option__checkbox"><span class="gen-qa-option__checkbox-dot"></span></span>' +
          '<span class="gen-qa-option__letter">' + letter + '</span>' +
          '<span class="gen-qa-option__text">' + escapeHtml(opt) + '</span>' +
        '</button>';
      });
      html += '</div>';
      // 其他（自定义输入）—— 多选模式下可与选项共存
      html += '<div class="gen-qa-other">';
      html += '<label class="gen-qa-other__label' + (isOtherSelected ? ' is-active' : '') + '" data-action="qa-select-other" data-qa-idx="' + idx + '">' +
        '<span class="gen-qa-option__checkbox' + (isOtherSelected ? ' is-active' : '') + '"><span class="gen-qa-option__checkbox-dot"></span></span>' +
        '<span>' + tr('generate.qaOtherLabel') + '</span>' +
      '</label>';
      html += '<textarea class="textarea gen-qa-item__a gen-qa-other__input" data-field="qa-answer" data-qa-idx="' + idx + '" ' +
        'placeholder="' + tr('generate.qaOtherPlaceholder') + '" rows="1">' + escapeHtml(otherText) + '</textarea>';
      html += '</div>';
    } else {
      // 无选项的纯填空题
      html += '<textarea class="textarea gen-qa-item__a" data-field="qa-answer" data-qa-idx="' + idx + '" placeholder="' + tr('generate.qaAnswerPlaceholder') + '" rows="2">' + escapeHtml(otherText) + '</textarea>';
    }
    return html;
  }

  /** 局部刷新单个 QA 项（不全量重渲，避免其他 textarea 失焦） */
  function refreshQAItem(idx) {
    if (!state.container) return;
    var item = state.container.querySelector('.gen-qa-item[data-qa-idx="' + idx + '"]');
    if (!item) return;
    var q = state.qaQuestions[idx];
    if (!q) return;
    // 保留 is-current 类
    var isCurrent = item.classList.contains('is-current');
    item.innerHTML = buildQAItemOptionsHTML(q, idx);
    if (isCurrent) item.classList.add('is-current');
  }

  /* ===================================================================
     十一、视图契约
     =================================================================== */

  function mount(container) {
    state.container = container;

    // 润色模式：恢复中断的流式
    if (state.mode === 'polish' && state.polishStage === 'streaming') {
      if (state.streamFullText.length >= 5) {
        // 润色结果足够则进入结果态
        finishPolish();
      } else {
        state.polishStage = 'input';
        state.streamFullText = '';
      }
      render();
      bindEvents();
      if (state.polishStage === 'result') playResultEnterAnimation();
      return;
    }

    // default / qa 模式：恢复中断的流式
    if (state.stage === 'streaming') {
      // streamFullText 即为已显示部分（onToken 追加，append-only）
      if (state.streamFullText.length >= 15) {
        // 文本足够则保存并进入结果态
        var Store = store();
        if (Store) {
          if (state.historyId) {
            try { Store.updateHistory(state.historyId, { content: state.streamFullText }); } catch (e) {}
          } else {
            try {
              var item = Store.addHistory({
                merchant: state.merchant.trim(),
                category: state.category,
                stars: state.stars,
                length: state.length,
                content: state.streamFullText,
                styleSource: getStyleSourceForHistory(),
                options: state.options,
                feedback: null
              });
              if (item) state.historyId = item.id;
            } catch (e) {}
          }
        }
        state.stage = 'result';
        // qa 模式同步 qaStage
        if (state.mode === 'qa') state.qaStage = 'generating';
      } else {
        // 太短，丢弃
        state.stage = 'input';
        state.streamFullText = '';
        if (state.mode === 'qa') state.qaStage = 'setup';
      }
    }

    render();
    bindEvents();

    // 若恢复到结果态，播放入场动画
    if (state.stage === 'result' || state.polishStage === 'result') {
      playResultEnterAnimation();
    }
  }

  function unmount() {
    // 流式中被卸载（如用户切换 Tab）：必须中断进行中的流式，避免后台继续推送
    //  - real 模式：abort 中断 fetch
    //  - mock 模式：generateReviewStream/polishStream 内部监听 abort 清 interval
    //  - generationId 自增让旧回调作废（避免卸载后回调操作空 container）
    //  - 保留 stage/polishStage='streaming' 与 streamFullText，以便 mount 时恢复（截断保存为结果）
    if (state.mode === 'polish') {
      if (state.polishStage === 'streaming') {
        abortCurrentGeneration();
      } else if (state.abortController) {
        abortCurrentGeneration();
      }
    } else {
      if (state.stage === 'streaming') {
        abortCurrentGeneration();
      } else if (state.abortController) {
        abortCurrentGeneration();
      }
    }
    clearStarDragSession();
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
    if (state.stage === 'input') {
      // 重渲以更新语料不足提示等
      rerenderPreservingMerchant();
    }
    // streaming / result 阶段不重渲，避免打断流式 / 丢失编辑
  }

  /* ===================================================================
     十二、注册视图（使用 spec 指定的注册模式）
     =================================================================== */

  function register() {
    if (typeof App === 'undefined' || !App.registerView) {
      document.addEventListener('DOMContentLoaded', register);
      return;
    }
    App.registerView('generate', { mount: mount, unmount: unmount, refresh: refresh });
  }
  register();

})(typeof window !== 'undefined' ? window : this);
