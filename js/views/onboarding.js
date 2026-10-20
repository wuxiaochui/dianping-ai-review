/* =====================================================================
   大众点评 AI 评价生成器 · 新用户引导视图 (onboarding)
   特殊契约：非普通 tab 视图，挂载 start() 方法到 App.views.onboarding
   - start(): 渲染全屏引导层到 #onboarding-host
   - 引导流程：介绍 → 训练来源 → 品类标签 → 训练 → 生成体验
   - Apple 设计：半透明 scrim + backdrop-blur、弹簧入场、水平滑动切换、
     按压反馈、reduced-motion 适配；样式一次性注入 <style id="dpr-onboarding-styles">
   ===================================================================== */
(function (global) {
  'use strict';

  /* ===================================================================
     一、模块状态
     =================================================================== */

  var state = {
    host: null,              // #onboarding-host 元素
    overlay: null,           // .ob-overlay 整体容器
    card: null,              // .ob-card 卡片
    body: null,              // .ob-card__body 内容区
    panel: 0,                // 当前面板索引 0-3
    closing: false,          // 是否正在关闭
    // 面板 1（训练来源）状态
    sourceChoice: null,      // 'paste' | 'preset' | null
    text: '',                // 用户粘贴或选择的文本
    presetIdx: -1,           // 选中的预置索引
    // 面板 2（品类+标签）状态
    category: '美食',
    tagIds: [],
    // 面板 3（生成）状态
    generatedText: '',
    streaming: false,
    streamTimer: null,
    hasGenerated: false,
    // 待清理
    timers: [],
    listeners: []
  };

  /* ===================================================================
     二、常量
     =================================================================== */

  // 预置示例（spec 9.2，4 条不同品类；label 为展示键，category/text 为数据值）
  var PRESET_EXAMPLES = [
    {
      category: '美食',
      labelKey: 'onboarding.presetFoodHotpotLabel',
      text: '今天去吃了这家火锅，毛肚绝绝子，七上八下涮个 8 秒就脆得不行！锅底麻辣鲜香，越煮越香。服务员小姐姐还主动帮我们下虾滑，态度真的YYDS。人均 120 排队半小时，但吃完真的封神，下次还要来！'
    },
    {
      category: '美发',
      labelKey: 'onboarding.presetHairCutLabel',
      text: '剪完头发真的惊喜，发型师小哥特别耐心，先听我想要什么风格再动手。剪完效果超出预期，显脸小又好打理。全程没有推销办卡，环境也舒服。98 块性价比超高，已经推荐给闺蜜了。'
    },
    {
      category: '酒店',
      labelKey: 'onboarding.presetHotelStayLabel',
      text: '入住体验很惊喜。房间比想象中大，卫生做得很到位，连角落都干干净净。位置绝了，地铁口出来走两分钟就到。早餐种类不算多但都好吃，尤其现煮的面条。隔音一般，隔壁说话能听到一点。整体推荐入住。'
    },
    {
      category: '休闲',
      labelKey: 'onboarding.presetLeisureCafeLabel',
      text: '藏在巷子深处的小店，推门进去是另一种时光。木质桌椅、暖黄灯光、慢悠悠的爵士乐，连空气都慢了下来。手冲咖啡带着果香，配一块红丝绒蛋糕，甜得恰到好处。适合一个人来发呆，也适合和懂的人低声说话。'
    }
  ];

  // 品类列表（与 train.js 保持一致）
  var CATEGORIES = [
    '美食', '美发', '酒店', '休闲', '健身',
    '电影', '亲子', '购物', '美甲美睫', 'KTV', '其他'
  ];

  // 默认选中的标签组名（spec 9.2 要求）
  var DEFAULT_TAG_NAME = '真实日常风';

  /** 品类中文码 → 国际化显示键（与 train.js 一致；数据值保留中文码，仅展示经翻译） */
  var CATEGORY_LABEL_KEYS = {
    '美食': 'onboarding.catFood',
    '美发': 'onboarding.catHair',
    '酒店': 'onboarding.catHotel',
    '休闲': 'onboarding.catLeisure',
    '健身': 'onboarding.catFitness',
    '电影': 'onboarding.catMovie',
    '亲子': 'onboarding.catParentChild',
    '购物': 'onboarding.catShopping',
    '美甲美睫': 'onboarding.catNails',
    'KTV': 'onboarding.catKtv',
    '其他': 'onboarding.catOther'
  };
  /** 把品类中文码翻译为展示文本；未知码原样返回 */
  function catLabel(cat) {
    return CATEGORY_LABEL_KEYS[cat] ? tr(CATEGORY_LABEL_KEYS[cat]) : cat;
  }

  // 流式显示每字间隔（spec 9.3 要求 ~20ms/字）
  var STREAM_INTERVAL_MS = 20;

  // 训练最小字数（与 train.js 校验阈值一致）
  var MIN_TEXT_LENGTH = 20;

  /* ===================================================================
     三、视图专有样式（一次性注入，使用 main.css 设计令牌）
     =================================================================== */

  var STYLE_ID = 'dpr-onboarding-styles';

  function injectStyles() {
    if (!global.document) return;
    if (global.document.getElementById(STYLE_ID)) return;
    var style = global.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '/* ---------- 覆盖层 ---------- */',
      '.ob-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: var(--space-4); }',
      '.ob-scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.5); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); opacity: 0; transition: opacity 320ms var(--ease-out); }',
      '.ob-overlay.is-visible .ob-scrim { opacity: 1; }',
      '.ob-overlay.is-leaving .ob-scrim { opacity: 0; }',
      '/* ---------- 卡片（弹簧入场 scale 0.9→1） ---------- */',
      '.ob-card { position: relative; width: min(92vw, 440px); max-height: 86vh; background: var(--surface); border-radius: 24px; box-shadow: var(--shadow-strong); display: flex; flex-direction: column; overflow: hidden; transform: scale(0.9); opacity: 0; transition: transform 420ms var(--spring-default), opacity 280ms var(--ease-out); }',
      '.ob-overlay.is-visible .ob-card { transform: scale(1); opacity: 1; }',
      '.ob-overlay.is-leaving .ob-card { transform: scale(0.95); opacity: 0; transition: transform 300ms var(--ease-out), opacity 300ms var(--ease-out); }',
      '/* ---------- 卡片头部：圆点 + 跳过 ---------- */',
      '.ob-card__header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-4) var(--space-5) var(--space-1); flex: 0 0 auto; }',
      '.ob-dots { display: flex; gap: 6px; align-items: center; }',
      '.ob-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(60,60,67,0.18); transition: width 280ms var(--spring-default), background 200ms var(--ease-out); }',
      '.ob-dot.is-active { width: 20px; border-radius: 3px; background: var(--accent); }',
      '.ob-skip-btn { font-size: var(--fs-caption); color: var(--text-tertiary); padding: 6px 10px; border-radius: var(--radius-sm); background: transparent; border: none; cursor: pointer; transition: color 120ms var(--ease-out), background 120ms var(--ease-out); }',
      '.ob-skip-btn:hover { color: var(--text-secondary); background: var(--bg); }',
      '/* ---------- 卡片内容区（水平滑动切换） ---------- */',
      '.ob-card__body { position: relative; overflow: hidden; flex: 1 1 auto; min-height: 440px; }',
      '.ob-panel { position: absolute; inset: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: var(--space-3) var(--space-5) var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); transform: translateX(0); opacity: 1; transition: transform 360ms var(--spring-default), opacity 240ms var(--ease-out); }',
      '.ob-panel.is-entering-forward { transform: translateX(40px); opacity: 0; }',
      '.ob-panel.is-entering-backward { transform: translateX(-40px); opacity: 0; }',
      '.ob-panel.is-leaving-forward { transform: translateX(-40px); opacity: 0; }',
      '.ob-panel.is-leaving-backward { transform: translateX(40px); opacity: 0; }',
      '/* ---------- 介绍面板 ---------- */',
      '.ob-intro { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-3); padding: var(--space-4) 0 var(--space-2); }',
      '.ob-intro__icon { width: 72px; height: 72px; border-radius: 50%; background: #ff9500; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.12); margin-bottom: var(--space-2); }',
      '.ob-intro__name { font-size: var(--fs-body); font-weight: 600; color: var(--text-secondary); letter-spacing: 0.02em; }',
      '.ob-intro__slogan { font-size: var(--fs-title); font-weight: 700; letter-spacing: var(--tracking-display); line-height: var(--leading-tight); color: var(--text-primary); }',
      '.ob-intro__desc { font-size: var(--fs-body); line-height: var(--leading-body); color: var(--text-secondary); max-width: 320px; }',
      '/* ---------- 面板通用 ---------- */',
      '.ob-panel__title { font-size: var(--fs-headline); font-weight: 600; letter-spacing: var(--tracking-display); line-height: var(--leading-tight); color: var(--text-primary); }',
      '.ob-panel__subtitle { font-size: var(--fs-body); color: var(--text-secondary); line-height: var(--leading-body); margin-top: -4px; }',
      '.ob-field { display: flex; flex-direction: column; gap: var(--space-2); }',
      '.ob-label { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }',
      '.ob-chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
      '/* ---------- 训练来源选项 ---------- */',
      '.ob-source-options { display: flex; flex-direction: column; gap: var(--space-2); }',
      '.ob-source-card { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius-md); text-align: left; cursor: pointer; transition: border-color 160ms var(--ease-out), background 160ms var(--ease-out), transform 100ms ease-out; }',
      '.ob-source-card:active { transform: scale(0.98); }',
      '.ob-source-card.is-selected { border-color: var(--accent); background: rgba(0,122,255,0.05); }',
      '.ob-source-card__icon { width: 36px; height: 36px; border-radius: 50%; background: var(--bg); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--accent); }',
      '.ob-source-card__label { font-size: var(--fs-body); font-weight: 500; color: var(--text-primary); }',
      '.ob-paste-area { display: flex; flex-direction: column; gap: var(--space-1); }',
      '.ob-paste-hint { font-size: var(--fs-caption); color: var(--text-tertiary); }',
      '/* ---------- 预置示例卡片 ---------- */',
      '.ob-preset-list { display: flex; flex-direction: column; gap: var(--space-2); }',
      '.ob-preset-card { display: flex; flex-direction: column; gap: 6px; padding: var(--space-3); background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius-md); text-align: left; cursor: pointer; transition: border-color 160ms var(--ease-out), background 160ms var(--ease-out), transform 100ms ease-out; }',
      '.ob-preset-card:active { transform: scale(0.98); }',
      '.ob-preset-card.is-selected { border-color: var(--accent); background: rgba(0,122,255,0.05); }',
      '.ob-preset-card__tag { align-self: flex-start; font-size: var(--fs-caption); font-weight: 500; padding: 2px 8px; border-radius: var(--radius-pill); background: rgba(255,149,0,0.12); color: #c93400; }',
      '.ob-preset-card__text { font-size: var(--fs-caption); line-height: 1.45; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
      '/* ---------- 生成信息表 ---------- */',
      '.ob-gen-info { display: flex; flex-direction: column; gap: 0; background: var(--bg); border-radius: var(--radius-md); padding: var(--space-2) var(--space-4); }',
      '.ob-gen-info__row { display: flex; justify-content: space-between; align-items: center; padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }',
      '.ob-gen-info__row:last-child { border-bottom: none; }',
      '.ob-gen-info__label { font-size: var(--fs-caption); color: var(--text-tertiary); }',
      '.ob-gen-info__value { font-size: var(--fs-body); font-weight: 500; color: var(--text-primary); }',
      '.ob-gen-stars { color: var(--star); letter-spacing: 1px; }',
      '/* ---------- 生成结果区 ---------- */',
      '.ob-gen-result { min-height: 120px; max-height: 200px; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: var(--space-3) var(--space-4); background: var(--bg); border-radius: var(--radius-md); font-size: var(--fs-body); line-height: var(--leading-body); color: var(--text-primary); white-space: pre-wrap; word-break: break-word; }',
      '.ob-gen-result.is-empty { display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); font-size: var(--fs-caption); text-align: center; }',
      '.ob-cursor { display: inline-block; width: 2px; height: 1em; background: var(--accent); margin-left: 1px; vertical-align: text-bottom; animation: ob-blink 1s steps(2) infinite; }',
      '@keyframes ob-blink { 0%,50% { opacity: 1; } 50.01%,100% { opacity: 0; } }',
      '/* ---------- 动作按钮区 ---------- */',
      '.ob-actions { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2); }',
      '.ob-actions-row { display: flex; gap: var(--space-2); }',
      '.ob-actions-row .btn { flex: 1; }',
      '.ob-actions .btn { min-height: 48px; }',
      '/* ---------- reduced-motion：弹簧/滑动替换为 200ms 淡入 ---------- */',
      '@media (prefers-reduced-motion: reduce) {',
      '  .ob-card { transform: none !important; transition: opacity 200ms ease !important; }',
      '  .ob-overlay.is-visible .ob-card { opacity: 1; }',
      '  .ob-overlay.is-leaving .ob-card { opacity: 0; transform: none !important; }',
      '  .ob-panel { transform: none !important; transition: opacity 200ms ease !important; }',
      '  .ob-panel.is-entering-forward, .ob-panel.is-entering-backward, .ob-panel.is-leaving-forward, .ob-panel.is-leaving-backward { transform: none !important; }',
      '  .ob-cursor { animation: none; opacity: 0.6; }',
      '}'
    ].join('\n');
    global.document.head.appendChild(style);
  }

  /* ===================================================================
     四、工具
     =================================================================== */

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

  function store() { return global.Store || null; }
  function ai() { return global.AIEngine || null; }
  function app() { return global.App || null; }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** 清理所有 setTimeout 定时器 */
  function clearTimeouts() {
    state.timers.forEach(function (t) { clearTimeout(t); });
    state.timers = [];
  }

  /** 清理流式显示 setInterval */
  function clearStreamTimer() {
    if (state.streamTimer) {
      clearInterval(state.streamTimer);
      state.streamTimer = null;
    }
  }

  /** 取默认标签组 id（"真实日常风"） */
  function getDefaultTagId() {
    var Store = store();
    if (!Store) return null;
    var groups = Store.getTagGroups();
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].name === DEFAULT_TAG_NAME) return groups[i].id;
    }
    return groups.length ? groups[0].id : null;
  }

  /* ===================================================================
     五、面板内容渲染
     =================================================================== */

  /** 面板索引 → 圆点索引（0,1,2） */
  function dotForPanel(panel) {
    if (panel === 0) return 0;       // 介绍
    if (panel <= 2) return 1;        // 训练来源 / 品类标签
    return 2;                        // 生成体验
  }

  function renderDots() {
    var active = dotForPanel(state.panel);
    var html = '';
    for (var i = 0; i < 3; i++) {
      html += '<span class="ob-dot' + (i === active ? ' is-active' : '') + '"></span>';
    }
    return html;
  }

  /* ---------- 5.1 介绍面板（panel 0） ---------- */
  function renderIntroPanel() {
    return (
      '<div class="ob-intro">' +
        '<div class="ob-intro__icon" aria-hidden="true">' +
          '<svg width="36" height="36" viewBox="0 0 36 36" fill="none">' +
            '<path d="M18 4L20.5 14.5L31 17L20.5 19.5L18 30L15.5 19.5L5 17L15.5 14.5L18 4Z" fill="#fff"/>' +
            '<path d="M27 24L28 27.5L31.5 28.5L28 29.5L27 33L26 29.5L22.5 28.5L26 27.5L27 24Z" fill="#fff" opacity="0.8"/>' +
          '</svg>' +
        '</div>' +
        '<div class="ob-intro__name">' + tr('onboarding.introName') + '</div>' +
        '<h1 class="ob-intro__slogan">' + tr('onboarding.introSlogan') + '</h1>' +
        '<p class="ob-intro__desc">' + tr('onboarding.introDesc') + '</p>' +
      '</div>' +
      '<div class="ob-actions">' +
        '<button type="button" class="btn btn-primary pressable full-width" data-action="intro-next">' + tr('onboarding.introNextBtn') + '</button>' +
      '</div>'
    );
  }

  /* ---------- 5.2 训练来源面板（panel 1） ---------- */
  function renderSourcePanel() {
    var pasteSelected = state.sourceChoice === 'paste';
    var presetSelected = state.sourceChoice === 'preset';

    var optionsHtml =
      '<div class="ob-source-options">' +
        '<button type="button" class="ob-source-card pressable' + (pasteSelected ? ' is-selected' : '') + '" data-source="paste">' +
          '<span class="ob-source-card__icon" aria-hidden="true">' +
            '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M12 2L16 6L6 16H2V12L12 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
          '</span>' +
          '<span class="ob-source-card__label">' + tr('onboarding.sourcePasteLabel') + '</span>' +
        '</button>' +
        '<button type="button" class="ob-source-card pressable' + (presetSelected ? ' is-selected' : '') + '" data-source="preset">' +
          '<span class="ob-source-card__icon" aria-hidden="true">' +
            '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3H7V15H3V3ZM9 3H13V15H9V3ZM15 4L16.5 14.5L15 14.8L13.5 4.3L15 4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
          '</span>' +
          '<span class="ob-source-card__label">' + tr('onboarding.sourcePresetLabel') + '</span>' +
        '</button>' +
      '</div>';

    var pasteHtml = '';
    if (pasteSelected) {
      pasteHtml =
        '<div class="ob-paste-area">' +
          '<textarea class="textarea" data-field="paste-text" placeholder="' + escapeHtml(tr('onboarding.pastePlaceholder')) + '" style="min-height:110px;">' + escapeHtml(state.text) + '</textarea>' +
          '<div class="ob-paste-hint">' + escapeHtml(tr('onboarding.pasteHint')) + '</div>' +
        '</div>';
    }

    var presetHtml = '';
    if (presetSelected) {
      var cards = PRESET_EXAMPLES.map(function (ex, idx) {
        var sel = state.presetIdx === idx;
        return (
          '<button type="button" class="ob-preset-card pressable' + (sel ? ' is-selected' : '') + '" data-preset-idx="' + idx + '">' +
            '<span class="ob-preset-card__tag">' + escapeHtml(tr(ex.labelKey)) + '</span>' +
            '<p class="ob-preset-card__text">' + escapeHtml(ex.text) + '</p>' +
          '</button>'
        );
      }).join('');
      presetHtml = '<div class="ob-preset-list">' + cards + '</div>';
    }

    var canNext = sourceCanNext();

    return (
      '<h2 class="ob-panel__title">' + tr('onboarding.sourceTitle') + '</h2>' +
      '<p class="ob-panel__subtitle">' + tr('onboarding.sourceSubtitle') + '</p>' +
      optionsHtml +
      pasteHtml +
      presetHtml +
      '<div class="ob-actions">' +
        '<div class="ob-actions-row">' +
          '<button type="button" class="btn pressable" data-action="back">' + tr('onboarding.backBtn') + '</button>' +
          '<button type="button" class="btn btn-primary pressable" data-action="source-next"' + (canNext ? '' : ' disabled') + '>' + tr('onboarding.nextBtn') + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function sourceCanNext() {
    if (state.sourceChoice === 'paste' && state.text.trim().length >= MIN_TEXT_LENGTH) return true;
    if (state.sourceChoice === 'preset' && state.presetIdx >= 0) return true;
    return false;
  }

  /* ---------- 5.3 品类+标签面板（panel 2） ---------- */
  function renderConfigPanel() {
    var Store = store();
    var tagGroups = Store ? Store.getTagGroups() : [];

    var categoryOptions = CATEGORIES.map(function (c) {
      var sel = c === state.category ? ' selected' : '';
      return '<option value="' + escapeHtml(c) + '"' + sel + '>' + escapeHtml(catLabel(c)) + '</option>';
    }).join('');

    var tagChips = tagGroups.map(function (g) {
      var active = state.tagIds.indexOf(g.id) !== -1;
      var styleAttr = active && g.color
        ? ' style="background:' + escapeHtml(g.color) + ';border-color:' + escapeHtml(g.color) + ';color:#fff;"'
        : '';
      return '<button type="button" class="chip pressable' + (active ? ' is-active' : '') + '"' +
        styleAttr + ' data-tag-id="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</button>';
    }).join('');

    return (
      '<h2 class="ob-panel__title">' + tr('onboarding.configTitle') + '</h2>' +
      '<p class="ob-panel__subtitle">' + tr('onboarding.configSubtitle') + '</p>' +
      '<div class="ob-field">' +
        '<label class="ob-label">' + tr('onboarding.categoryLabel') + '</label>' +
        '<select class="select" data-field="category">' + categoryOptions + '</select>' +
      '</div>' +
      '<div class="ob-field">' +
        '<label class="ob-label">' + tr('onboarding.tagGroupLabel') + '</label>' +
        '<div class="ob-chip-row">' +
          (tagChips || '<span class="text-tertiary">' + tr('onboarding.noTagGroups') + '</span>') +
        '</div>' +
      '</div>' +
      '<div class="ob-actions">' +
        '<div class="ob-actions-row">' +
          '<button type="button" class="btn pressable" data-action="back">' + tr('onboarding.backBtn') + '</button>' +
          '<button type="button" class="btn btn-primary pressable" data-action="train">' + tr('onboarding.trainBtn') + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---------- 5.4 生成体验面板（panel 3） ---------- */
  function renderGeneratePanel() {
    var resultHtml;
    if (state.streaming || state.generatedText) {
      resultHtml = '<div class="ob-gen-result" data-result-area>' + escapeHtml(state.generatedText);
      if (state.streaming) resultHtml += '<span class="ob-cursor"></span>';
      resultHtml += '</div>';
    } else {
      resultHtml = '<div class="ob-gen-result is-empty" data-result-area>' + escapeHtml(tr('onboarding.genEmptyHint')) + '</div>';
    }

    var generateBtn;
    if (state.streaming) {
      generateBtn = '<button type="button" class="btn btn-primary pressable full-width" disabled>' + escapeHtml(tr('onboarding.generatingBtn')) + '</button>';
    } else {
      var label = state.hasGenerated ? tr('onboarding.regenerateBtn') : tr('onboarding.generateBtn');
      generateBtn = '<button type="button" class="btn btn-primary pressable full-width" data-action="generate">' + escapeHtml(label) + '</button>';
    }

    var copyBtn = (state.hasGenerated && !state.streaming)
      ? '<button type="button" class="btn pressable full-width" data-action="copy">' + escapeHtml(tr('onboarding.copyBtn')) + '</button>'
      : '';

    return (
      '<h2 class="ob-panel__title">' + tr('onboarding.genTitle') + '</h2>' +
      '<p class="ob-panel__subtitle">' + tr('onboarding.genSubtitle') + '</p>' +
      '<div class="ob-gen-info">' +
        '<div class="ob-gen-info__row"><span class="ob-gen-info__label">' + escapeHtml(tr('onboarding.merchantLabel')) + '</span><span class="ob-gen-info__value">' + escapeHtml(tr('onboarding.testMerchant')) + '</span></div>' +
        '<div class="ob-gen-info__row"><span class="ob-gen-info__label">' + escapeHtml(tr('onboarding.categoryLabel')) + '</span><span class="ob-gen-info__value">' + escapeHtml(catLabel(state.category)) + '</span></div>' +
        '<div class="ob-gen-info__row"><span class="ob-gen-info__label">' + escapeHtml(tr('onboarding.starsLabel')) + '</span><span class="ob-gen-info__value ob-gen-stars">★★★★★</span></div>' +
        '<div class="ob-gen-info__row"><span class="ob-gen-info__label">' + escapeHtml(tr('onboarding.lengthLabel')) + '</span><span class="ob-gen-info__value">' + escapeHtml(tr('onboarding.lenMedium')) + '</span></div>' +
      '</div>' +
      resultHtml +
      '<div class="ob-actions">' +
        generateBtn +
        copyBtn +
        '<button type="button" class="btn pressable full-width" data-action="goto-generate">' + escapeHtml(tr('onboarding.gotoGenerateBtn')) + '</button>' +
      '</div>'
    );
  }

  function renderPanel(panel) {
    switch (panel) {
      case 0: return renderIntroPanel();
      case 1: return renderSourcePanel();
      case 2: return renderConfigPanel();
      case 3: return renderGeneratePanel();
      default: return renderIntroPanel();
    }
  }

  /* ===================================================================
     六、面板切换（水平滑动，方向对称）
     =================================================================== */

  function transitionTo(newPanel, direction) {
    if (!state.body) return;
    // 取当前面板（排除正在离开的）
    var oldPanelEl = state.body.querySelector('.ob-panel:not(.is-leaving-forward):not(.is-leaving-backward)');

    // 创建新面板
    var newPanelEl = global.document.createElement('div');
    newPanelEl.className = 'ob-panel is-entering-' + direction;
    newPanelEl.innerHTML = renderPanel(newPanel);
    state.body.appendChild(newPanelEl);

    // 更新状态与圆点
    state.panel = newPanel;
    updateDots();

    // 强制 reflow 让初始状态生效
    void newPanelEl.offsetWidth;

    // 触发动画：新面板进入（移除 entering 类，回到默认 translateX(0) opacity:1）
    newPanelEl.classList.remove('is-entering-forward', 'is-entering-backward');

    // 旧面板离开
    if (oldPanelEl) {
      oldPanelEl.classList.add('is-leaving-' + direction);
    }

    // 动画结束后清理旧面板
    var duration = prefersReducedMotion() ? 220 : 400;
    var t = setTimeout(function () {
      if (oldPanelEl && oldPanelEl.parentNode) oldPanelEl.parentNode.removeChild(oldPanelEl);
    }, duration);
    state.timers.push(t);
  }

  function updateDots() {
    if (!state.card) return;
    var dotsContainer = state.card.querySelector('.ob-dots');
    if (dotsContainer) dotsContainer.innerHTML = renderDots();
  }

  /* ===================================================================
     七、动作处理
     =================================================================== */

  function handleIntroNext() {
    transitionTo(1, 'forward');
  }

  function chooseSource(choice) {
    state.sourceChoice = choice;
    // 切换来源时清空已选预设（保留粘贴文本以便来回切）
    if (choice === 'paste') {
      state.presetIdx = -1;
    }
    rerenderCurrentPanel();
  }

  function setPasteText(text) {
    state.text = text || '';
    // 局部更新下一步按钮的 disabled 状态（避免重渲破坏 textarea 焦点）
    updateSourceNextButton();
  }

  function pickPreset(idx) {
    if (idx < 0 || idx >= PRESET_EXAMPLES.length) return;
    state.presetIdx = idx;
    state.text = PRESET_EXAMPLES[idx].text;
    // 自动填品类（spec 9.2：默认按所选示例自动填）
    state.category = PRESET_EXAMPLES[idx].category;
    rerenderCurrentPanel();
  }

  function updateSourceNextButton() {
    if (!state.body) return;
    var btn = state.body.querySelector('[data-action="source-next"]');
    if (!btn) return;
    btn.disabled = !sourceCanNext();
  }

  function handleSourceNext() {
    if (state.sourceChoice === 'paste' && state.text.trim().length < MIN_TEXT_LENGTH) {
      var App = app();
      if (App) App.showToast(tr('onboarding.toastTooShort'), 'error');
      return;
    }
    if (state.sourceChoice === 'preset' && state.presetIdx < 0) {
      var App2 = app();
      if (App2) App2.showToast(tr('onboarding.toastPickPreset'), 'error');
      return;
    }
    if (!state.sourceChoice) {
      var App3 = app();
      if (App3) App3.showToast(tr('onboarding.toastPickSource'), 'error');
      return;
    }
    transitionTo(2, 'forward');
  }

  function toggleTag(id) {
    var idx = state.tagIds.indexOf(id);
    if (idx === -1) state.tagIds.push(id);
    else state.tagIds.splice(idx, 1);
    rerenderCurrentPanel();
  }

  function setCategory(cat) {
    state.category = cat;
  }

  /** 执行训练（9.2 步骤 3）：分析 → 入库 → 训练历史 → Toast → 进入生成 */
  function handleTrain() {
    var Store = store();
    var AI = ai();
    var App = app();
    if (!Store || !AI) {
      if (App) App.showToast(tr('onboarding.toastServiceNotReady'), 'error');
      return;
    }
    var text = state.text || '';
    if (text.trim().length < MIN_TEXT_LENGTH) {
      if (App) App.showToast(tr('onboarding.toastTooShort'), 'error');
      return;
    }

    // 1. AI 风格分析
    var features;
    try {
      features = AI.analyzeStyle(text);
    } catch (e) {
      if (App) App.showToast(tr('onboarding.toastAnalyzeFailed'), 'error');
      return;
    }

    // 2. 入库（含 styleFeatures）
    var newCorpus;
    try {
      newCorpus = Store.addCorpus({
        text: text,
        category: state.category,
        tagIds: state.tagIds.slice(),
        source: 'manual',
        styleFeatures: features
      });
    } catch (e) {
      if (App) App.showToast(tr('onboarding.toastSaveFailed'), 'error');
      return;
    }

    // 3. 生成摘要 + 训练历史
    var summary;
    try {
      summary = AI.generateSummary(features, []);
    } catch (e) {
      summary = tr('onboarding.trainDoneSummary');
    }
    try {
      Store.addTrainingHistory({
        corpusIds: newCorpus && newCorpus.id ? [newCorpus.id] : [],
        summary: summary,
        featuresAdded: [],
        modified: false
      });
    } catch (e) {}

    // 4. Toast
    if (App) App.showToast(tr('onboarding.toastTrainDone'), 'success');

    // 5. 进入生成体验
    transitionTo(3, 'forward');
  }

  /** 执行生成（9.3）：调 AIEngine.generateReview + 流式显示 */
  function handleGenerate() {
    var Store = store();
    var AI = ai();
    var App = app();
    if (!Store || !AI) {
      if (App) App.showToast(tr('onboarding.toastServiceNotReady'), 'error');
      return;
    }

    var fullText;
    try {
      fullText = AI.generateReview({
        merchant: tr('onboarding.testMerchant'),
        category: state.category,
        stars: 5,
        length: '中',
        options: {},
        styleSource: 'all',
        tendency: {},
        corpusList: Store.getCorpus(),
        history: Store.getHistory()
      });
    } catch (e) {
      if (App) App.showToast(tr('onboarding.toastGenerateFailed'), 'error');
      return;
    }

    if (!fullText) {
      if (App) App.showToast(tr('onboarding.toastGenerateEmpty'), 'error');
      return;
    }

    streamText(fullText);
  }

  /** 逐字流式显示（setInterval 20ms/字） */
  function streamText(fullText) {
    // 清理已有流式定时器
    clearStreamTimer();

    state.streaming = true;
    state.generatedText = '';
    rerenderCurrentPanel();

    var chars = Array.from(fullText);
    var i = 0;

    state.streamTimer = setInterval(function () {
      if (!state.body || state.closing) {
        clearStreamTimer();
        return;
      }
      if (i >= chars.length) {
        clearStreamTimer();
        state.streaming = false;
        state.hasGenerated = true;
        rerenderCurrentPanel();
        return;
      }
      // 每次追加 1 个字符
      state.generatedText += chars[i];
      i++;
      // 局部更新结果区（避免重渲整个面板破坏动画/滚动）
      var resultArea = state.body.querySelector('[data-result-area]');
      if (resultArea) {
        resultArea.className = 'ob-gen-result';
        resultArea.innerHTML = escapeHtml(state.generatedText) + '<span class="ob-cursor"></span>';
        resultArea.scrollTop = resultArea.scrollHeight;
      }
    }, STREAM_INTERVAL_MS);
  }

  /** 复制结果（navigator.clipboard + 兜底） */
  function handleCopy() {
    var App = app();
    var text = state.generatedText || '';
    if (!text) return;

    function onSuccess() {
      if (App) App.showToast(tr('onboarding.toastCopied'), 'success');
    }
    function onError() {
      try {
        var ta = global.document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        global.document.body.appendChild(ta);
        ta.select();
        var ok = global.document.execCommand && global.document.execCommand('copy');
        global.document.body.removeChild(ta);
        if (ok) onSuccess();
        else if (App) App.showToast(tr('history.toastCopyFailed'), 'error');
      } catch (e) {
        if (App) App.showToast(tr('history.toastCopyFailed'), 'error');
      }
    }

    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(onSuccess).catch(onError);
    } else {
      onError();
    }
  }

  /** 去生成页自由发挥（关闭引导 + 跳转 generate） */
  function handleGotoGenerate() {
    var App = app();
    // 关闭引导（close 内部会 markOnboarded）
    close();
    // 立即切换到生成页（在引导层淡出过程中完成视图切换）
    if (App && typeof App.navigate === 'function') {
      try { App.navigate('generate'); } catch (e) {}
    }
  }

  /** 跳过引导（markOnboarded + 关闭） */
  function handleSkip() {
    close();
  }

  function handleBack() {
    if (state.panel === 1) transitionTo(0, 'backward');
    else if (state.panel === 2) transitionTo(1, 'backward');
    else if (state.panel === 3) transitionTo(2, 'backward');
  }

  /* ===================================================================
     八、重渲与事件绑定
     =================================================================== */

  /** 重渲当前面板（无滑动动画，用于面板内状态变化） */
  function rerenderCurrentPanel() {
    if (!state.body) return;
    var panelEl = state.body.querySelector('.ob-panel:not(.is-leaving-forward):not(.is-leaving-backward)');
    if (!panelEl) return;
    panelEl.innerHTML = renderPanel(state.panel);
  }

  function onClick(e) {
    // data-action 统一处理
    var actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      handleAction(actionEl.getAttribute('data-action'));
      return;
    }
    // 训练来源选择
    var sourceEl = e.target.closest('[data-source]');
    if (sourceEl) {
      chooseSource(sourceEl.getAttribute('data-source'));
      return;
    }
    // 预置示例选择
    var presetEl = e.target.closest('[data-preset-idx]');
    if (presetEl) {
      pickPreset(parseInt(presetEl.getAttribute('data-preset-idx'), 10));
      return;
    }
    // 标签切换
    var tagEl = e.target.closest('[data-tag-id]');
    if (tagEl) {
      toggleTag(tagEl.getAttribute('data-tag-id'));
      return;
    }
  }

  function onInput(e) {
    var target = e.target.closest('[data-field]');
    if (!target) return;
    var field = target.getAttribute('data-field');
    if (field === 'paste-text') {
      setPasteText(target.value);
    }
  }

  function onChange(e) {
    var target = e.target.closest('[data-field]');
    if (!target) return;
    var field = target.getAttribute('data-field');
    if (field === 'category') {
      setCategory(target.value);
    }
  }

  function handleAction(action) {
    switch (action) {
      case 'intro-next': handleIntroNext(); break;
      case 'source-next': handleSourceNext(); break;
      case 'back': handleBack(); break;
      case 'train': handleTrain(); break;
      case 'generate': handleGenerate(); break;
      case 'copy': handleCopy(); break;
      case 'goto-generate': handleGotoGenerate(); break;
      case 'skip': handleSkip(); break;
      default: break;
    }
  }

  function bindEvents() {
    if (!state.overlay) return;
    state.overlay.addEventListener('click', onClick);
    state.overlay.addEventListener('input', onInput);
    state.overlay.addEventListener('change', onChange);
    state.listeners.push([state.overlay, 'click', onClick, false]);
    state.listeners.push([state.overlay, 'input', onInput, false]);
    state.listeners.push([state.overlay, 'change', onChange, false]);
  }

  /* ===================================================================
     九、引导生命周期
     =================================================================== */

  /**
   * 启动新用户引导（由 App.startOnboarding 调用）
   * 渲染全屏引导到 #onboarding-host
   */
  function startOnboarding() {
    var host = global.document && global.document.getElementById('onboarding-host');
    if (!host) return;

    // 防御：已有引导层则先清理
    if (host.firstChild) {
      cleanup();
    }

    injectStyles();

    // 初始化状态
    state.host = host;
    state.panel = 0;
    state.sourceChoice = null;
    state.text = '';
    state.presetIdx = -1;
    state.category = '美食';
    state.tagIds = [];
    state.generatedText = '';
    state.streaming = false;
    state.hasGenerated = false;
    state.closing = false;

    // 默认标签组（"真实日常风"）
    var defaultTagId = getDefaultTagId();
    if (defaultTagId) state.tagIds = [defaultTagId];

    // 构建覆盖层结构
    var overlay = global.document.createElement('div');
    overlay.className = 'ob-overlay';
    overlay.innerHTML =
      '<div class="ob-scrim"></div>' +
      '<div class="ob-card" role="dialog" aria-modal="true" aria-label="' + escapeHtml(tr('onboarding.dialogAria')) + '">' +
        '<div class="ob-card__header">' +
          '<div class="ob-dots">' + renderDots() + '</div>' +
          '<button type="button" class="ob-skip-btn pressable" data-action="skip">' + escapeHtml(tr('onboarding.skipBtn')) + '</button>' +
        '</div>' +
        '<div class="ob-card__body"></div>' +
      '</div>';
    host.appendChild(overlay);
    host.setAttribute('aria-hidden', 'false');

    state.overlay = overlay;
    state.card = overlay.querySelector('.ob-card');
    state.body = overlay.querySelector('.ob-card__body');

    // 渲染初始面板（介绍）
    var initialPanel = global.document.createElement('div');
    initialPanel.className = 'ob-panel';
    initialPanel.innerHTML = renderPanel(0);
    state.body.appendChild(initialPanel);

    // 绑定事件
    bindEvents();

    // 触发弹簧入场（双 rAF 确保 transition 生效）
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (state.overlay) state.overlay.classList.add('is-visible');
      });
    });
  }

  /**
   * 关闭引导（弹簧出场 + 清理）
   * 内部会调用 App.markOnboarded（幂等），覆盖「走完」与「跳过」两种结束路径
   */
  function close() {
    if (state.closing) return;
    state.closing = true;

    // 清理定时器（流式 / 面板切换）
    clearTimeouts();
    clearStreamTimer();

    // 标记 onboarded（幂等；spec 9.4 / 9.5 都要求）
    var App = app();
    if (App && typeof App.markOnboarded === 'function') {
      try { App.markOnboarded(); } catch (e) {}
    }

    // 弹簧出场
    if (state.overlay) {
      state.overlay.classList.remove('is-visible');
      state.overlay.classList.add('is-leaving');
    }
    var t = setTimeout(cleanup, prefersReducedMotion() ? 220 : 320);
    state.timers.push(t);
  }

  /** 清理：移除监听 / 定时器 / DOM，重置状态 */
  function cleanup() {
    // 移除事件监听
    state.listeners.forEach(function (item) {
      var el = item[0], type = item[1], fn = item[2], opts = item[3];
      try { el.removeEventListener(type, fn, opts); } catch (e) {}
    });
    state.listeners = [];

    // 清理定时器
    clearTimeouts();
    clearStreamTimer();

    // 移除 DOM
    if (state.host) {
      state.host.innerHTML = '';
      state.host.setAttribute('aria-hidden', 'true');
    }
    state.overlay = null;
    state.card = null;
    state.body = null;
    state.host = null;
    state.closing = false;
    state.streaming = false;
    state.hasGenerated = false;
    state.generatedText = '';
    state.panel = 0;
  }

  /* ===================================================================
     十、注册视图（特殊契约：直接挂载 start 方法）
     ===================================================================== */

  function register() {
    if (typeof global.App === 'undefined' || !global.App || !global.App.registerView) {
      // App 尚未加载，延迟到 DOMContentLoaded
      if (global.document) {
        global.document.addEventListener('DOMContentLoaded', register);
      }
      return;
    }
    // onboarding 不在 VIEW_NAMES 中，不能走 registerView，直接挂载 start 方法
    global.App.views.onboarding = { start: startOnboarding };
  }

  register();

})(typeof window !== 'undefined' ? window : this);
