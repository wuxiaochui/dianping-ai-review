/* =====================================================================
   大众点评 AI 评价生成器 · 设置视图 (settings)
   契约：App.registerView('settings', { mount, unmount, refresh })
   - mount(container): 渲染到 <section class="view" data-view="settings">
   - unmount(): 清理监听 / 取消未完成测试
   - refresh(): 重新读取 Store.getAIConfig 刷新表单
   设计：Apple 风格 —— 圆角卡片分组、大字号输入、
        toggle 开关 200ms 弹簧动画、按压反馈、状态卡片弹簧入场。
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

    // 全局配置
    enabled: false,
    testTimeout: 60000,         // 测试连接超时（毫秒），默认 60s
    activeProviderId: null,     // 当前激活的服务商 id

    // 服务商列表
    providers: [],              // 已保存的服务商数组

    // 编辑表单状态
    formMode: 'add',            // 'add' | 'edit'
    editingId: null,            // 编辑模式下的服务商 id
    formName: '',
    formBaseURL: '',
    formApiKey: '',
    formModel: '',
    showApiKey: false,
    selectedTemplate: null,     // 当前选中模板 id（用于高亮）

    testing: false,             // 连接测试进行中
    importMode: 'merge',        // 导入模式：'merge' | 'replace'
    pendingImport: null,        // 待确认的导入数据包

    // 外观（主题 / 语言）
    theme: 'system',
    lang: 'zh'
  };

  /* ===================================================================
     二、常量
     =================================================================== */

  // 服务商模板：用于在新增表单中一键速填 baseURL + model（不覆盖 apiKey）
  var PROVIDER_TEMPLATES = [
    { id: 'deepseek', name: 'DeepSeek',  baseURL: 'https://api.deepseek.com/v1',                       model: 'deepseek-chat' },
    { id: 'glm',      name: '智谱 GLM',   baseURL: 'https://open.bigmodel.cn/api/paas/v4',              model: 'glm-4-flash' },
    { id: 'moonshot', name: 'Moonshot',  baseURL: 'https://api.moonshot.cn/v1',                         model: 'moonshot-v1-8k' },
    { id: 'qwen',     name: '通义千问',   baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    { id: 'openai',   name: 'OpenAI',    baseURL: 'https://api.openai.com/v1',                          model: 'gpt-4o-mini' }
  ];

  /* ===================================================================
     三、工具
     =================================================================== */

  /** 注册监听并记录到 state.listeners，便于 unmount 时统一移除 */
  function on(el, type, fn, opts) {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    state.listeners.push([el, type, fn, opts || false]);
  }

  function clearListeners() {
    state.listeners.forEach(function (item) {
      var el = item[0], type = item[1], fn = item[2], opts = item[3];
      try { el.removeEventListener(type, fn, opts); } catch (e) {}
    });
    state.listeners = [];
  }

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

  function store() { return global.Store || null; }
  function app() { return global.App || null; }
  function aiClient() { return global.AIClient || null; }
  function i18n() { return global.I18n || null; }

  /** 取翻译文本（找不到时回退中文/key） */
  function tr(key, params) {
    var i = global.I18n;
    return (i && typeof i.t === 'function') ? i.t(key, params) : key;
  }

  /* ---------- 视图专有样式（iOS 风格下拉：行式触发 + 毛玻璃菜单） ---------- */
  var STYLE_ID = 'dpr-settings-view-styles';
  function injectStyles() {
    if (!global.document || global.document.getElementById(STYLE_ID)) return;
    var style = global.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '/* ===== 触发行（iOS 设置：标签左 · 值右 · chevron） ===== */',
      '.settings-select-wrap {',
      '  position: relative;',
      '  background: var(--bg);',
      '  border-radius: var(--radius-md);',
      '  transition: transform 100ms ease-out, box-shadow 200ms var(--ease-out);',
      '}',
      '/* 按压反馈：pointer-down 即时缩放 */',
      '.settings-trigger:active ~ * , .settings-trigger:active { }',
      '.settings-select-wrap.is-pressed { transform: scale(0.98); }',
      '',
      '.settings-trigger {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: var(--space-3);',
      '  width: 100%;',
      '  min-height: 44px;',                    /* HIG 最小触控目标 */
      '  padding: 10px var(--space-4);',
      '  font-size: var(--fs-body);',
      '  color: var(--text-primary);',
      '  text-align: left;',
      '  background: transparent;',
      '  border: none;',
      '  cursor: pointer;',
      '  outline: none;',
      '}',
      '.settings-trigger__value {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  font-weight: 400;',
      '  color: var(--text-secondary);',        /* 值弱于标签层级 */
      '}',
      '.settings-trigger__chevron {',
      '  flex: 0 0 auto;',
      '  color: var(--text-tertiary);',
      '  transition: transform 240ms var(--ease-out), color 160ms var(--ease-out);',
      '}',
      '.settings-select-wrap.is-open .settings-trigger__chevron { transform: rotate(180deg); color: var(--accent); }',
      '.settings-trigger:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); border-radius: var(--radius-md); }',
      '',
      '/* ===== 弹出菜单（毛玻璃材质 · 锚点展开） ===== */',
      '.settings-menu {',
      '  position: absolute;',
      '  z-index: 50;',
      '  top: calc(100% + 6px);',
      '  left: 0; right: 0;',
      '  padding: 4px;',
      '  background: var(--surface-translucent);',
      '  -webkit-backdrop-filter: blur(24px) saturate(180%);',
      '  backdrop-filter: blur(24px) saturate(180%);',
      '  border-radius: 13px;',                 /* iOS menu 圆角 */
      '  border-top: 1px solid rgba(255, 255, 255, 0.5);',
      '  box-shadow: var(--shadow-strong);',
      '  transform-origin: top right;',         /* 从触发锚点展开（空间一致性） */
      '  opacity: 0;',
      '  transform: scale(0.9) translateY(-4px);',
      '  visibility: hidden;',
      '  transition:',
      '    opacity 180ms var(--ease-out),',
      '    transform 220ms var(--ease-out),',
      '    visibility 0s linear 220ms;',
      '}',
      '.settings-select-wrap.up .settings-menu {',
      '  top: auto; bottom: calc(100% + 6px);',
      '  transform-origin: bottom right;',
      '}',
      '.settings-select-wrap.is-open .settings-menu {',
      '  opacity: 1;',
      '  transform: none;',
      '  visibility: visible;',
      '  transition-delay: 0s;',
      '}',
      '',
      '/* 菜单项 */',
      '.settings-menu__item {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  width: 100%;',
      '  min-height: 44px;',
      '  padding: 8px 12px;',
      '  font-size: var(--fs-body);',
      '  color: var(--text-primary);',
      '  text-align: left;',
      '  background: transparent;',
      '  border: none;',
      '  border-radius: 9px;',
      '  cursor: pointer;',
      '  outline: none;',
      '  transition: background 120ms ease-out, transform 80ms ease-out;',
      '}',
      '.settings-menu__item:active { background: var(--border); transform: scale(0.985); }',
      '.settings-menu__item:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }',
      '.settings-menu__item + .settings-menu__item { position: relative; }',
      '.settings-menu__item + .settings-menu__item::before {',
      '  content: "";',
      '  position: absolute;',
      '  top: -2px; left: 12px; right: 12px;',
      '  height: 1px;',
      '  background: var(--border);',
      '}',
      '.settings-menu__check {',
      '  flex: 0 0 auto;',
      '  margin-left: auto;',
      '  color: var(--accent);',
      '  opacity: 0;',
      '  transform: scale(0.5);',
      '  transition: opacity 150ms var(--ease-out), transform 200ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));',
      '}',
      '.settings-menu__item.is-selected .settings-menu__check { opacity: 1; transform: none; }',
      '.settings-menu__swatch {',              /* 主题色板圆点 */
      '  flex: 0 0 auto;',
      '  width: 22px; height: 22px;',
      '  border-radius: 50%;',
      '  border: 1px solid var(--border);',
      '}',
      '',
      '@media (prefers-reduced-motion: reduce) {',
      '  .settings-select-wrap, .settings-trigger__chevron, .settings-menu, .settings-menu__item, .settings-menu__check { transition-duration: 1ms !important; }',
      '  .settings-menu { transform: none !important; }',
      '}'
    ].join('\n');
    global.document.head.appendChild(style);
  }

  /** 从 baseURL 提取域名（用于状态卡片展示），失败返回原值 */
  function extractDomain(baseURL) {
    if (!baseURL) return '';
    try {
      var u = new URL(baseURL);
      return u.hostname || baseURL;
    } catch (e) {
      return baseURL;
    }
  }

  /** 获取当前激活的 provider 对象（来自 state.providers） */
  function getActiveProvider() {
    if (!state.activeProviderId) return null;
    for (var i = 0; i < state.providers.length; i++) {
      if (state.providers[i].id === state.activeProviderId) return state.providers[i];
    }
    return null;
  }

  /** 判断当前激活的 provider 配置是否完整（baseURL + apiKey + model 均非空） */
  function isConfigComplete() {
    var p = getActiveProvider();
    return !!(p && p.baseURL && p.apiKey && p.model);
  }

  /** 根据表单的 baseURL/model 匹配模板 id，决定高亮哪个模板 chip */
  function detectSelectedTemplate() {
    for (var i = 0; i < PROVIDER_TEMPLATES.length; i++) {
      var t = PROVIDER_TEMPLATES[i];
      if (t.baseURL === state.formBaseURL && t.model === state.formModel) {
        return t.id;
      }
    }
    return null;
  }

  /* ===================================================================
     四、渲染
     =================================================================== */

  /** 从 I18n 同步主题/语言到本地 state（用于分段按钮高亮） */
  function syncAppearance() {
    var i = i18n();
    if (!i) return;
    try {
      state.theme = i.getTheme();
      state.lang = i.getLang();
    } catch (e) {}
  }

  function render() {
    if (!state.container) return;
    // 同步外观（主题/语言）高亮
    syncAppearance();
    // 同步模板高亮（baseURL/model 可能被手动改了，需重新匹配）
    state.selectedTemplate = detectSelectedTemplate();
    state.container.innerHTML = renderAll();
    // 状态卡片弹簧入场
    state.rafId = requestAnimationFrame(function () {
      if (!state.container) return;
      var card = state.container.querySelector('.settings-status');
      if (card) card.classList.add('is-entered');
    });
  }

  function renderAll() {
    return (
      '<div class="settings">' +
        renderAppearanceSection() +
        renderStatus() +
        renderEnableSection() +
        renderProvidersSection() +
        renderFormSection() +
        renderTimeoutSection() +
        renderNote() +
        renderDataManagement() +
      '</div>'
    );
  }

  /* ---------- 4.0 外观（主题 / 语言）· iOS 行式下拉 ---------- */
  var CHEVRON_DOWN_SVG = '<svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden="true">' +
    '<path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHECK_SVG = '<svg class="settings-menu__check" width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden="true">' +
    '<path d="M1.5 6.5L5 10L12.5 1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** iOS 风格行式下拉：触发行 + 毛玻璃菜单 */
  function selectRowHtml(id, label, currentValueLabel, items, action, extra) {
    var menuItems = items.map(function (it) {
      var selected = (it.value === it.current);
      return (
        '<button type="button" role="option" aria-selected="' + selected + '" ' +
          'class="settings-menu__item' + (selected ? ' is-selected' : '') + '" ' +
          'data-action="' + action + '" data-value="' + escapeHtml(it.value) + '">' +
          (it.swatch ? '<span class="settings-menu__swatch" style="background:' + it.swatch + '"></span>' : '') +
          '<span>' + escapeHtml(it.label) + '</span>' +
          CHECK_SVG +
        '</button>'
      );
    }).join('');
    return (
      '<div class="settings-row settings-row--col">' +
        '<label class="settings-row__label" id="' + id + '-label">' + escapeHtml(label) + '</label>' +
        '<div class="settings-select-wrap" id="' + id + '-wrap">' +
          '<button type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false" ' +
            'aria-labelledby="' + id + '-label" class="settings-trigger" data-action="open-select" data-select="' + id + '">' +
            '<span>' + escapeHtml(label) + '</span>' +
            '<span class="settings-trigger__value">' + escapeHtml(currentValueLabel) +
              '<span class="settings-trigger__chevron">' + CHEVRON_DOWN_SVG + '</span>' +
            '</span>' +
          '</button>' +
          '<div class="settings-menu" role="listbox" aria-labelledby="' + id + '-label">' + menuItems + '</div>' +
        '</div>' +
        (extra || '') +
      '</div>'
    );
  }

  function renderAppearanceSection() {
    var themeItems = [
      { value: 'light', label: tr('settings.themeLight'), swatch: '#f5f5f7', current: state.theme },
      { value: 'dark', label: tr('settings.themeDark'), swatch: '#1c1c1e', current: state.theme },
      { value: 'system', label: tr('settings.themeSystem'), swatch: 'linear-gradient(135deg, #f5f5f7 50%, #1c1c1e 50%)', current: state.theme }
    ];
    var currentTheme = themeItems.filter(function (t) { return t.value === state.theme; })[0];
    if (!currentTheme) { themeItems[0].current = null; currentTheme = themeItems[2]; }

    var langs = (i18n() && i18n().LANGS) || [];
    var langItems = langs.map(function (l) {
      return { value: l.code, label: l.label, current: state.lang };
    });
    var currentLang = langItems.filter(function (l) { return l.value === state.lang; })[0] || langItems[0];

    return (
      '<section class="card settings-section" aria-label="' + escapeHtml(tr('settings.appearanceTitle')) + '">' +
        '<h2 class="card__title">' + escapeHtml(tr('settings.appearanceTitle')) + '</h2>' +
        selectRowHtml('settingsTheme', tr('settings.theme'),
          currentTheme ? currentTheme.label : '', themeItems, 'set-theme') +
        selectRowHtml('settingsLang', tr('settings.language'),
          currentLang ? currentLang.label : '', langItems, 'set-lang',
          '<p class="settings-row__hint">' + escapeHtml(tr('settings.languageHint')) + '</p>') +
      '</section>'
    );
  }

  /* ---------- 4.1 状态提示卡片（spec 4.5） ---------- */
  function renderStatus() {
    var level, title, text, iconSvg;
    var active = getActiveProvider();
    if (!state.enabled) {
      level = 'info';
      title = tr('settings.statusInfoTitle');
      text = tr('settings.statusInfoText');
      iconSvg = infoIconSvg();
    } else if (!active) {
      level = 'warning';
      title = tr('settings.statusNoProvider');
      text = tr('settings.statusNoProviderText');
      iconSvg = warningIconSvg();
    } else if (!isConfigComplete()) {
      level = 'warning';
      title = tr('settings.statusIncomplete');
      text = tr('settings.statusIncompleteText', { 0: escapeHtml(active.name) });
      iconSvg = warningIconSvg();
    } else {
      level = 'success';
      title = tr('settings.statusSuccess', { 0: escapeHtml(active.name) });
      text = escapeHtml(active.model) + ' @ ' + escapeHtml(extractDomain(active.baseURL));
      iconSvg = successIconSvg();
    }

    return (
      '<div class="settings-status settings-status--' + level + '" role="status" aria-live="polite">' +
        '<span class="settings-status__icon" aria-hidden="true">' + iconSvg + '</span>' +
        '<div class="settings-status__body">' +
          '<div class="settings-status__title">' + escapeHtml(title) + '</div>' +
          '<div class="settings-status__text">' + text + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function infoIconSvg() {
    return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
      '<circle cx="7" cy="7" r="6" stroke="#fff" stroke-width="1.4"/>' +
      '<path d="M7 6.5V10" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="7" cy="4" r="0.9" fill="#fff"/>' +
    '</svg>';
  }
  function warningIconSvg() {
    return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
      '<path d="M7 1.5L12.5 11.5H1.5L7 1.5Z" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M7 6V8.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="7" cy="10.3" r="0.8" fill="#fff"/>' +
    '</svg>';
  }
  function successIconSvg() {
    return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
      '<circle cx="7" cy="7" r="6" stroke="#fff" stroke-width="1.4"/>' +
      '<path d="M4.5 7L6.3 8.8L9.5 5.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  }

  /* ---------- 4.2 启用开关（spec 4.1） ---------- */
  function renderEnableSection() {
    var onCls = state.enabled ? ' is-on' : '';
    var checked = state.enabled ? 'true' : 'false';
    return (
      '<section class="card settings-section" aria-label="' + escapeHtml(tr('settings.enableLabel')) + '">' +
        '<div class="settings-row">' +
          '<div class="settings-row__text">' +
            '<div class="settings-row__label">' + escapeHtml(tr('settings.enableLabel')) + '</div>' +
            '<div class="settings-row__hint">' + escapeHtml(tr('settings.enableHint')) + '</div>' +
          '</div>' +
          '<button type="button" class="settings-toggle pressable' + onCls + '" ' +
            'role="switch" aria-checked="' + checked + '" data-action="toggle-enabled" ' +
            'aria-label="' + escapeHtml(tr('settings.enableLabel')) + '">' +
            '<span class="settings-toggle__thumb"></span>' +
          '</button>' +
        '</div>' +
      '</section>'
    );
  }

  /* ---------- 4.3 我的服务商列表 ---------- */
  function renderProvidersSection() {
    return (
      '<section class="card settings-section" aria-label="' + escapeHtml(tr('settings.providersTitle')) + '">' +
        '<h2 class="card__title">' + escapeHtml(tr('settings.providersTitle')) + '</h2>' +
        '<p class="card__subtitle">' + escapeHtml(tr('settings.providersSubtitle')) + '</p>' +
        '<div class="settings-providers-list">' + renderProvidersSectionInnerHTML() + '</div>' +
      '</section>'
    );
  }

  /* ---------- 4.4 编辑表单（新增 / 编辑服务商） ---------- */
  function renderFormSection() {
    var apiKeyType = state.showApiKey ? 'text' : 'password';
    var eyeBtn = state.showApiKey ? eyeOffSvg() : eyeSvg();
    var isEdit = state.formMode === 'edit';
    var title = tr(isEdit ? 'settings.editTitle' : 'settings.addTitle');
    var subtitle = isEdit
      ? tr('settings.editSubtitle', { 0: state.formName })
      : tr('settings.addSubtitle');
    var primaryAction = tr(isEdit ? 'settings.updateProvider' : 'settings.saveProvider');

    // 模板速填 chips（仅新增时显示，编辑时也可用——只要用户想换模型）
    var templateChipsHtml = PROVIDER_TEMPLATES.map(function (t) {
      var active = state.selectedTemplate === t.id ? ' is-active' : '';
      return '<button type="button" class="settings-provider-chip pressable' + active + '" ' +
        'data-template-id="' + escapeHtml(t.id) + '">' +
        '<span class="settings-provider-chip__dot"></span>' +
        escapeHtml(t.name) +
      '</button>';
    }).join('');

    return (
      '<section class="card settings-section" aria-label="' + escapeHtml(tr('settings.providersTitle')) + '">' +
        '<h2 class="card__title">' + escapeHtml(title) + '</h2>' +
        '<p class="card__subtitle">' + escapeHtml(subtitle) + '</p>' +

        // 模板速填
        '<div class="settings-row settings-row--col">' +
          '<label class="settings-row__label">' + escapeHtml(tr('settings.templateLabel')) + '</label>' +
          '<div class="settings-provider-row">' + templateChipsHtml + '</div>' +
        '</div>' +

        // 名称
        '<div class="settings-row settings-row--col">' +
          '<label class="settings-row__label" for="settings-formName">' + escapeHtml(tr('settings.name')) + '</label>' +
          '<input id="settings-formName" type="text" class="input settings-input" ' +
            'data-field="formName" placeholder="' + escapeHtml(tr('settings.namePlaceholder')) + '" ' +
            'value="' + escapeHtml(state.formName) + '" autocomplete="off" spellcheck="false" />' +
        '</div>' +

        // baseURL
        '<div class="settings-row settings-row--col">' +
          '<label class="settings-row__label" for="settings-formBaseURL">' + escapeHtml(tr('settings.baseURL')) + '</label>' +
          '<input id="settings-formBaseURL" type="text" class="input settings-input" ' +
            'data-field="formBaseURL" placeholder="' + escapeHtml(tr('settings.baseURLPlaceholder')) + '" ' +
            'value="' + escapeHtml(state.formBaseURL) + '" autocomplete="off" spellcheck="false" />' +
        '</div>' +

        // apiKey
        '<div class="settings-row settings-row--col">' +
          '<label class="settings-row__label" for="settings-formApiKey">API Key</label>' +
          '<div class="settings-apikey">' +
            '<input id="settings-formApiKey" type="' + apiKeyType + '" class="input settings-input" ' +
              'data-field="formApiKey" placeholder="sk-..." ' +
              'value="' + escapeHtml(state.formApiKey) + '" autocomplete="off" spellcheck="false" />' +
            '<button type="button" class="settings-apikey__eye pressable" ' +
              'data-action="toggle-apikey" aria-label="' + escapeHtml(tr(state.showApiKey ? 'settings.hideApiKey' : 'settings.showApiKey')) + '">' +
              eyeBtn +
            '</button>' +
          '</div>' +
        '</div>' +

        // model
        '<div class="settings-row settings-row--col">' +
          '<label class="settings-row__label" for="settings-formModel">' + escapeHtml(tr('settings.model')) + '</label>' +
          '<input id="settings-formModel" type="text" class="input settings-input" ' +
            'data-field="formModel" placeholder="' + escapeHtml(tr('settings.modelPlaceholder')) + '" ' +
            'value="' + escapeHtml(state.formModel) + '" autocomplete="off" spellcheck="false" />' +
        '</div>' +

        // 操作按钮
        '<div class="settings-btn-row">' +
          '<button type="button" class="btn pressable" data-action="test"' + (state.testing ? ' disabled' : '') + '>' +
            escapeHtml(state.testing ? tr('settings.testing') : tr('settings.test')) +
          '</button>' +
          '<button type="button" class="btn btn-primary pressable" data-action="save-provider">' +
            escapeHtml(primaryAction) +
          '</button>' +
        '</div>' +
        (isEdit ? '<button type="button" class="settings-form-cancel pressable" data-action="cancel-edit">' + escapeHtml(tr('settings.cancelEdit')) + '</button>' : '') +
      '</section>'
    );
  }

  /* ---------- 4.5 全局测试连接超时 ---------- */
  function renderTimeoutSection() {
    return (
      '<section class="card settings-section" aria-label="连接超时设置">' +
        '<h2 class="card__title">连接超时</h2>' +
        '<div class="settings-row settings-row--col">' +
          '<label class="settings-row__label" for="settings-testTimeout">测试连接超时（秒）</label>' +
          '<div class="settings-timeout">' +
            '<input id="settings-testTimeout" type="number" class="input settings-input settings-timeout__input" ' +
              'data-field="testTimeout" min="5" max="180" step="5" ' +
              'value="' + (Math.round(state.testTimeout / 1000)) + '" inputmode="numeric" />' +
            '<span class="settings-timeout__suffix">秒</span>' +
          '</div>' +
          '<p class="settings-row__hint">范围 5–180 秒，默认 60 秒。海外模型首包较慢时可适当调大。所有服务商共用。</p>' +
        '</div>' +
      '</section>'
    );
  }

  function eyeSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M2 12C2 12 5.5 5.5 12 5.5C18.5 5.5 22 12 22 12C22 12 18.5 18.5 12 18.5C5.5 18.5 2 12 2 12Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>' +
    '</svg>';
  }
  function eyeOffSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M4 4L20 20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M9.5 9.6C8.6 10.3 8 11.2 8 12C8 13.7 9.8 15 12 15C12.8 15 13.5 14.9 14.1 14.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M6.5 6.7C4.6 7.9 3 10 2 12C2 12 5.5 18.5 12 18.5C13.5 18.5 14.8 18.2 15.9 17.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M17.5 13.4C18.4 12.7 19 11.8 19 11C19 9.3 17.2 8 15 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';
  }

  function renderNote() {
    return '<p class="settings-note">API Key 仅保存在本机浏览器，不会上传到任何外部服务。</p>';
  }

  /* ---------- 4.6 数据管理（导出/导入） ---------- */
  function renderDataManagement() {
    var Store = store();
    var stats = Store ? Store.getStats() : {};
    var corpusCount = stats.totalCorpus || 0;
    var histCount = Store ? Store.getHistory().length : 0;
    var trainCount = Store ? Store.getTrainingHistory().length : 0;
    var providerCount = state.providers.length;

    var importConfirmHtml = state.pendingImport
      ? renderImportConfirm(state.pendingImport)
      : '';

    return (
      '<section class="card settings-section" aria-label="数据管理">' +
        '<h2 class="card__title">数据管理</h2>' +
        '<p class="card__subtitle">导出训练语料与历史记录到本地文件，或从文件导入以在新设备继续使用</p>' +
        '<div class="settings-data-summary">' +
          '<div class="settings-data-item"><span class="settings-data-item__num">' + providerCount + '</span><span class="settings-data-item__label">服务商</span></div>' +
          '<div class="settings-data-item"><span class="settings-data-item__num">' + corpusCount + '</span><span class="settings-data-item__label">语料</span></div>' +
          '<div class="settings-data-item"><span class="settings-data-item__num">' + trainCount + '</span><span class="settings-data-item__label">训练历史</span></div>' +
          '<div class="settings-data-item"><span class="settings-data-item__num">' + histCount + '</span><span class="settings-data-item__label">生成历史</span></div>' +
        '</div>' +
        '<div class="settings-btn-row">' +
          '<button type="button" class="btn pressable" data-action="export">导出数据</button>' +
          '<button type="button" class="btn pressable" data-action="import-trigger">从文件导入</button>' +
        '</div>' +
        '<input type="file" id="settings-import-file" accept=".json,application/json" style="display:none" data-action="import-file" />' +
        importConfirmHtml +
      '</section>'
    );
  }

  /** 导入确认区块（选择模式后执行） */
  function renderImportConfirm(pkg) {
    var data = pkg.data || pkg;
    var corpusN = (data.corpus && data.corpus.length) || 0;
    var trainN = (data.trainingHistory && data.trainingHistory.length) || 0;
    var histN = (data.history && data.history.length) || 0;
    var provN = (data.aiProviders && data.aiProviders.length) || 0;
    var exportedAt = pkg.exportedAt ? new Date(pkg.exportedAt).toLocaleString('zh-CN') : '';

    return (
      '<div class="settings-import-confirm" role="alertdialog" aria-label="确认导入">' +
        '<div class="settings-import-confirm__title">确认导入数据</div>' +
        (exportedAt ? '<div class="settings-import-confirm__time">导出时间：' + escapeHtml(exportedAt) + '</div>' : '') +
        '<div class="settings-import-confirm__summary">' +
          '<span>服务商 ' + provN + ' 条</span>' +
          '<span>语料 ' + corpusN + ' 条</span>' +
          '<span>训练历史 ' + trainN + ' 条</span>' +
          '<span>生成历史 ' + histN + ' 条</span>' +
        '</div>' +
        '<div class="settings-import-confirm__mode">' +
          '<label class="settings-radio">' +
            '<input type="radio" name="import-mode" value="merge"' + (state.importMode === 'merge' ? ' checked' : '') + ' data-action="import-mode" />' +
            '<span>合并（保留现有数据，追加新数据）</span>' +
          '</label>' +
          '<label class="settings-radio">' +
            '<input type="radio" name="import-mode" value="replace"' + (state.importMode === 'replace' ? ' checked' : '') + ' data-action="import-mode" />' +
            '<span>替换（覆盖现有数据，慎用）</span>' +
          '</label>' +
        '</div>' +
        '<div class="settings-import-confirm__note">注意：导入的服务商 API Key 已在导出时剥离，需重新填写。</div>' +
        '<div class="settings-btn-row">' +
          '<button type="button" class="btn btn-primary pressable" data-action="import-confirm">确认导入</button>' +
          '<button type="button" class="btn pressable" data-action="import-cancel">取消</button>' +
        '</div>' +
      '</div>'
    );
  }

  /* ===================================================================
     五、局部刷新（不破坏输入焦点）
     =================================================================== */

  /** 仅刷新状态卡片（保持已入场态，不重播动画） */
  function refreshStatusOnly() {
    if (!state.container) return;
    var old = state.container.querySelector('.settings-status');
    if (!old) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = renderStatus();
    var fresh = wrap.firstChild;
    fresh.classList.add('is-entered');
    old.parentNode.replaceChild(fresh, old);
  }

  /** 仅刷新模板 chip 高亮 */
  function refreshTemplateHighlightOnly() {
    if (!state.container) return;
    var chips = state.container.querySelectorAll('.settings-provider-chip');
    for (var i = 0; i < chips.length; i++) {
      var id = chips[i].getAttribute('data-template-id');
      if (id === state.selectedTemplate) chips[i].classList.add('is-active');
      else chips[i].classList.remove('is-active');
    }
  }

  /** 仅刷新服务商列表区域（不动表单，避免输入焦点丢失） */
  function refreshProvidersListOnly() {
    if (!state.container) return;
    var old = state.container.querySelector('.settings-providers-list');
    if (!old) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="settings-providers-list">' + renderProvidersSectionInnerHTML() + '</div>';
    var fresh = wrap.firstChild;
    old.parentNode.replaceChild(fresh, old);
  }

  /** 仅用于 refreshProvidersListOnly，避免整个 section 重渲染 */
  function renderProvidersSectionInnerHTML() {
    var list = state.providers || [];
    if (list.length === 0) {
      return '<div class="settings-providers-empty">' +
        '<div class="settings-providers-empty__title">尚未添加服务商</div>' +
        '<div class="settings-providers-empty__hint">在下方表单中添加第一个服务商（DeepSeek、智谱 GLM、Moonshot、通义千问、OpenAI 或自定义）</div>' +
      '</div>';
    }
    return list.map(function (p) {
      var isActive = p.id === state.activeProviderId;
      var activeBadge = isActive ? '<span class="settings-provider-item__badge">使用中</span>' : '';
      var maskedKey = p.apiKey
        ? ('已保存 · ' + p.apiKey.slice(0, 3) + '••••••' + p.apiKey.slice(-2))
        : '<span class="settings-provider-item__nokey">未填写 API Key</span>';
      var useBtn = isActive
        ? ''
        : '<button type="button" class="settings-provider-item__btn pressable" data-action="use-provider" data-provider-id="' + escapeHtml(p.id) + '">使用</button>';
      return (
        '<div class="settings-provider-item' + (isActive ? ' is-active' : '') + '" data-provider-id="' + escapeHtml(p.id) + '">' +
          '<div class="settings-provider-item__body">' +
            '<div class="settings-provider-item__head">' +
              '<span class="settings-provider-item__name">' + escapeHtml(p.name || '未命名服务商') + '</span>' +
              activeBadge +
            '</div>' +
            '<div class="settings-provider-item__meta">' + escapeHtml(p.model || '未设置模型') + ' @ ' + escapeHtml(extractDomain(p.baseURL) || '未设置地址') + '</div>' +
            '<div class="settings-provider-item__key">' + maskedKey + '</div>' +
          '</div>' +
          '<div class="settings-provider-item__actions">' +
            useBtn +
            '<button type="button" class="settings-provider-item__btn pressable" data-action="edit-provider" data-provider-id="' + escapeHtml(p.id) + '">编辑</button>' +
            '<button type="button" class="settings-provider-item__btn settings-provider-item__btn--danger pressable" data-action="delete-provider" data-provider-id="' + escapeHtml(p.id) + '">删除</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  /** 仅刷新开关态 */
  function refreshToggleOnly() {
    if (!state.container) return;
    var toggle = state.container.querySelector('.settings-toggle');
    if (!toggle) return;
    if (state.enabled) {
      toggle.classList.add('is-on');
      toggle.setAttribute('aria-checked', 'true');
    } else {
      toggle.classList.remove('is-on');
      toggle.setAttribute('aria-checked', 'false');
    }
  }

  /** 仅刷新测试按钮态 */
  function refreshTestButtonOnly() {
    if (!state.container) return;
    var btn = state.container.querySelector('[data-action="test"]');
    if (!btn) return;
    if (state.testing) {
      btn.textContent = '测试中…';
      btn.disabled = true;
    } else {
      btn.textContent = '测试连接';
      btn.disabled = false;
    }
  }

  /* ===================================================================
     六、动作处理
     =================================================================== */

  /* ---------- 外观下拉：开合与选择 ---------- */

  /** 关闭所有打开的下拉菜单 */
  function closeAllSelectMenus() {
    if (!state.container) return;
    state.container.querySelectorAll('.settings-select-wrap.is-open').forEach(function (w) {
      w.classList.remove('is-open');
      var trigger = w.querySelector('.settings-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  /** 切换某个下拉的开合；打开前若下方空间不足则向上弹（up） */
  function toggleSelectMenu(wrap) {
    var wasOpen = wrap.classList.contains('is-open');
    closeAllSelectMenus();
    if (wasOpen) return;

    // 空间检测：菜单高度估算 = 项数 × 46px + padding
    var itemCount = wrap.querySelectorAll('.settings-menu__item').length;
    var menuH = itemCount * 46 + 8;
    var rect = wrap.getBoundingClientRect();
    var spaceBelow = global.innerHeight - rect.bottom;
    if (spaceBelow < menuH + 12 && rect.top > menuH + 12) {
      wrap.classList.add('up');
    } else {
      wrap.classList.remove('up');
    }
    wrap.classList.add('is-open');
    var trigger = wrap.querySelector('.settings-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }

  /** 处理菜单项选择（主题 / 语言共用） */
  function handleMenuPick(itemEl) {
    var value = itemEl.getAttribute('data-value');
    var action = itemEl.getAttribute('data-action');
    var wrap = itemEl.closest('.settings-select-wrap');

    // 先更新选中态（视觉即时反馈），再关闭，最后应用设置
    if (wrap) {
      wrap.querySelectorAll('.settings-menu__item').forEach(function (m) {
        m.classList.toggle('is-selected', m === itemEl);
        m.setAttribute('aria-selected', m === itemEl ? 'true' : 'false');
      });
      // 更新触发行上的当前值文本
      var labelSpan = itemEl.querySelector('span:not(.settings-menu__swatch):not([class])') ||
                      itemEl.querySelector('span > span') || itemEl.querySelector('span');
      var valueSpan = wrap.querySelector('.settings-trigger__value');
      var textNode = itemEl.childNodes.length ?
        Array.prototype.filter.call(itemEl.childNodes, function (n) { return n.nodeType === 3; }) : [];
      if (valueSpan && textNode.length) {
        valueSpan.childNodes[0].nodeValue = textNode[0].nodeValue;
      }
      void labelSpan;
    }

    closeAllSelectMenus();

    if (action === 'set-theme') handleSetTheme(value);
    else if (action === 'set-lang') handleSetLang(value);
  }

  /** 切换主题（浅色 / 深色 / 跟随系统） */
  function handleSetTheme(theme) {
    var i = i18n();
    if (!i || typeof i.setTheme !== 'function') return;
    i.setTheme(theme);
    syncAppearance();
  }

  /** 切换界面语言 */
  function handleSetLang(code) {
    var i = i18n();
    if (!i || typeof i.setLang !== 'function') return;
    i.setLang(code);
    syncAppearance();
  }

  /** 切换「使用真实 AI」开关 —— 立即持久化 */
  function handleToggleEnabled() {
    state.enabled = !state.enabled;
    refreshToggleOnly();
    refreshStatusOnly();
    var Store = store();
    if (Store) Store.setAIConfig({ enabled: state.enabled });
  }

  /** 切换 API Key 显示/隐藏 */
  function handleToggleApikey() {
    state.showApiKey = !state.showApiKey;
    if (!state.container) return;
    var input = state.container.querySelector('[data-field="formApiKey"]');
    var eyeBtn = state.container.querySelector('[data-action="toggle-apikey"]');
    if (input) input.type = state.showApiKey ? 'text' : 'password';
    if (eyeBtn) {
      eyeBtn.innerHTML = state.showApiKey ? eyeOffSvg() : eyeSvg();
      eyeBtn.setAttribute('aria-label', state.showApiKey ? '隐藏 API Key' : '显示 API Key');
    }
  }

  /** 表单字段实时变化 */
  function handleFieldInput(field, value) {
    if (field === 'formName') {
      state.formName = value;
    } else if (field === 'formBaseURL') {
      state.formBaseURL = value;
      state.selectedTemplate = detectSelectedTemplate();
      refreshTemplateHighlightOnly();
    } else if (field === 'formApiKey') {
      state.formApiKey = value;
    } else if (field === 'formModel') {
      state.formModel = value;
      state.selectedTemplate = detectSelectedTemplate();
      refreshTemplateHighlightOnly();
    } else if (field === 'testTimeout') {
      // 输入过程中允许任意数字，blur 时再持久化（见 handleFieldBlur）
      var sec = parseInt(value, 10);
      if (isFinite(sec) && sec > 0) {
        state.testTimeout = sec * 1000;
      }
    }
  }

  /** 字段失焦：仅 testTimeout 需要持久化 */
  function handleFieldBlur(field) {
    if (field !== 'testTimeout') return;
    var Store = store();
    if (Store) Store.setAIConfig({ testTimeout: state.testTimeout });
  }

  /** 点击模板 chip：速填 baseURL + model + name（不覆盖 apiKey） */
  function handleTemplateClick(templateId) {
    var t = null;
    for (var i = 0; i < PROVIDER_TEMPLATES.length; i++) {
      if (PROVIDER_TEMPLATES[i].id === templateId) { t = PROVIDER_TEMPLATES[i]; break; }
    }
    if (!t) return;
    state.formBaseURL = t.baseURL;
    state.formModel = t.model;
    // 名称若为空或仍是某个模板名，则同步为模板名
    var isTemplate = false;
    for (var j = 0; j < PROVIDER_TEMPLATES.length; j++) {
      if (PROVIDER_TEMPLATES[j].name === state.formName) { isTemplate = true; break; }
    }
    if (!state.formName || isTemplate) state.formName = t.name;
    state.selectedTemplate = t.id;
    // 直接更新输入框值（不重渲整体，保留 apiKey 焦点）
    if (state.container) {
      var baseURLInput = state.container.querySelector('[data-field="formBaseURL"]');
      var modelInput = state.container.querySelector('[data-field="formModel"]');
      var nameInput = state.container.querySelector('[data-field="formName"]');
      if (baseURLInput) baseURLInput.value = t.baseURL;
      if (modelInput) modelInput.value = t.model;
      if (nameInput) nameInput.value = state.formName;
    }
    refreshTemplateHighlightOnly();
  }

  /** 测试连接（基于当前表单内容，不要求先保存） */
  function handleTest() {
    var App = app();
    var AIClient = aiClient();
    if (!App || !AIClient) {
      if (App) App.showToast('客户端未加载', 'error');
      return;
    }
    if (state.testing) return;

    if (!state.formBaseURL || !state.formApiKey || !state.formModel) {
      App.showToast('请先在表单中填写 baseURL / API Key / 模型名', 'error');
      return;
    }

    state.testing = true;
    refreshTestButtonOnly();

    AIClient.testConnection({
      baseURL: state.formBaseURL,
      apiKey: state.formApiKey,
      model: state.formModel,
      timeout: state.testTimeout
    }).then(function (result) {
      state.testing = false;
      refreshTestButtonOnly();
      if (!App || !App.showToast) return;
      if (result && result.ok) {
        App.showToast('连接成功', 'success');
      } else {
        var msg = (result && result.message) ? result.message : '未知错误';
        var errType = result && result.type ? result.type : '';
        var toastType = (errType === 'auth') ? 'error' : 'default';
        App.showToast('连接失败：' + msg, toastType);
      }
    });
  }

  /* ---------- 服务商 CRUD 动作 ---------- */

  /** 保存服务商（新增 / 更新） */
  function handleSaveProvider() {
    var App = app();
    var Store = store();
    if (!App || !Store) {
      if (App) App.showToast('数据层未加载', 'error');
      return;
    }
    if (!state.formBaseURL || !state.formApiKey || !state.formModel) {
      App.showToast('请填写完整的 baseURL / API Key / 模型名', 'error');
      return;
    }
    var data = {
      name: state.formName || '未命名服务商',
      baseURL: state.formBaseURL,
      apiKey: state.formApiKey,
      model: state.formModel
    };
    if (state.formMode === 'edit' && state.editingId) {
      Store.updateAIProvider(state.editingId, data);
      App.showToast('已更新「' + data.name + '」', 'success');
    } else {
      Store.addAIProvider(data);
      App.showToast('已添加「' + data.name + '」', 'success');
    }
    // 重置表单到新增模式
    resetForm();
    reloadProviders();
    render();
  }

  /** 切换激活的服务商 */
  function handleUseProvider(id) {
    var App = app();
    var Store = store();
    if (!Store) return;
    var ok = Store.setActiveAIProvider(id);
    if (!ok) {
      if (App) App.showToast('切换失败：未找到该服务商', 'error');
      return;
    }
    reloadProviders();
    // 同步 enabled 与 testTimeout（getAIConfig 会带回激活 provider 信息）
    var cfg = Store.getAIConfig();
    state.enabled = !!cfg.enabled;
    state.activeProviderId = cfg.activeProviderId;
    state.testTimeout = cfg.testTimeout;
    render();
    if (App) {
      var p = Store.getAIProviderById(id);
      App.showToast('已切换为「' + (p ? p.name : '新服务商') + '」', 'success');
    }
  }

  /** 点击「编辑」：将该服务商载入表单，切换为编辑模式 */
  function handleEditProvider(id) {
    var App = app();
    var Store = store();
    if (!Store) return;
    var p = Store.getAIProviderById(id);
    if (!p) {
      if (App) App.showToast('未找到该服务商', 'error');
      return;
    }
    state.formMode = 'edit';
    state.editingId = id;
    state.formName = p.name || '';
    state.formBaseURL = p.baseURL || '';
    state.formApiKey = p.apiKey || '';
    state.formModel = p.model || '';
    state.selectedTemplate = detectSelectedTemplate();
    state.showApiKey = false;
    render();
    // 滚动到表单位置
    if (state.container) {
      var form = state.container.querySelector('[data-action="save-provider"]');
      if (form && form.scrollIntoView) {
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  /** 点击「删除」：删除服务商（若删的是激活的，自动回退） */
  function handleDeleteProvider(id) {
    var App = app();
    var Store = store();
    if (!Store) return;
    var p = Store.getAIProviderById(id);
    if (!p) return;
    var confirmMsg = (id === state.activeProviderId)
      ? '确认删除当前使用中的「' + p.name + '」？将自动切换到其他服务商。'
      : '确认删除「' + p.name + '」？';
    // 直接删除（避免引入 confirm 弹窗）；如需确认可后续扩展
    if (!global.confirm(confirmMsg)) return;
    var ok = Store.deleteAIProvider(id);
    if (!ok) {
      if (App) App.showToast('删除失败', 'error');
      return;
    }
    // 若当前正在编辑此项，重置表单
    if (state.editingId === id) {
      resetForm();
    }
    reloadProviders();
    var cfg = Store.getAIConfig();
    state.enabled = !!cfg.enabled;
    state.activeProviderId = cfg.activeProviderId;
    state.testTimeout = cfg.testTimeout;
    render();
    if (App) App.showToast('已删除「' + p.name + '」', 'success');
  }

  /** 取消编辑，回到新增模式 */
  function handleCancelEdit() {
    resetForm();
    render();
  }

  /** 复位表单到新增模式 */
  function resetForm() {
    state.formMode = 'add';
    state.editingId = null;
    state.formName = '';
    state.formBaseURL = '';
    state.formApiKey = '';
    state.formModel = '';
    state.selectedTemplate = null;
    state.showApiKey = false;
    state.testing = false;
  }

  /** 从 Store 重新载入服务商列表与激活 id */
  function reloadProviders() {
    var Store = store();
    if (!Store) return;
    state.providers = Store.getAIProviders() || [];
    var cfg = Store.getAIConfig();
    state.activeProviderId = cfg.activeProviderId;
    state.enabled = !!cfg.enabled;
    state.testTimeout = cfg.testTimeout;
  }

  /* ---------- 4.6a 数据管理动作 ---------- */

  /** 导出全部数据为 JSON 文件并触发下载 */
  function handleExport() {
    var App = app();
    var Store = store();
    if (!App || !Store) {
      if (App) App.showToast('数据层未加载', 'error');
      return;
    }
    try {
      var pkg = Store.exportAllData();
      var json = JSON.stringify(pkg, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var ts = new Date();
      var stamp = ts.getFullYear() + '' +
        String(ts.getMonth() + 1).padStart(2, '0') + '' +
        String(ts.getDate()).padStart(2, '0') + '_' +
        String(ts.getHours()).padStart(2, '0') + '' +
        String(ts.getMinutes()).padStart(2, '0');
      var filename = 'dianping-ai-data_' + stamp + '.json';
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      App.showToast('已导出 ' + filename, 'success');
    } catch (e) {
      App.showToast('导出失败：' + ((e && e.message) ? e.message : '未知错误'), 'error');
    }
  }

  /** 触发文件选择器 */
  function handleImportTrigger() {
    if (!state.container) return;
    var fileInput = state.container.querySelector('#settings-import-file');
    if (fileInput) fileInput.click();
  }

  /** 读取导入文件 */
  function handleImportFile(file) {
    var App = app();
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (App) App.showToast('文件过大（超过 10MB），请检查是否选错文件', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var pkg = JSON.parse(e.target.result);
        // 基本校验
        if (!pkg || (!pkg.data && !pkg.corpus)) {
          if (App) App.showToast('文件格式不正确：缺少数据字段', 'error');
          return;
        }
        state.pendingImport = pkg;
        render();
      } catch (err) {
        if (App) App.showToast('文件解析失败：' + ((err && err.message) ? err.message : 'JSON 格式错误'), 'error');
      }
    };
    reader.onerror = function () {
      if (App) App.showToast('文件读取失败', 'error');
    };
    reader.readAsText(file);
  }

  /** 确认导入 */
  function handleImportConfirm() {
    var App = app();
    var Store = store();
    if (!App || !Store) {
      if (App) App.showToast('数据层未加载', 'error');
      return;
    }
    if (!state.pendingImport) {
      App.showToast('没有待导入的数据', 'error');
      return;
    }
    var result = Store.importAllData(state.pendingImport, { mode: state.importMode });
    if (result.success && result.errors.length === 0) {
      var parts = [];
      var imported = result.imported;
      if (imported.aiProviders) parts.push(imported.aiProviders + ' 个服务商');
      if (imported.corpus) parts.push(imported.corpus + ' 条语料');
      if (imported.trainingHistory) parts.push(imported.trainingHistory + ' 条训练历史');
      if (imported.history) parts.push(imported.history + ' 条生成历史');
      var msg = parts.length ? ('导入成功：' + parts.join('、')) : '导入完成';
      App.showToast(msg, 'success');
    } else if (result.errors.length) {
      App.showToast('部分导入失败：' + result.errors[0], 'warn');
    } else {
      App.showToast('导入失败', 'error');
    }
    state.pendingImport = null;
    // 刷新当前视图（preferences/aiProviders 可能已被导入覆盖）
    reloadProviders();
    resetForm();
    render();
  }

  /** 取消导入 */
  function handleImportCancel() {
    state.pendingImport = null;
    render();
  }

  /* ===================================================================
     七、事件绑定
     =================================================================== */

  function bindEvents() {
    if (!state.container) return;
    var App = app();
    var Store = store();

    // input 变化（表单字段 / 超时）
    on(state.container, 'input', function (e) {
      var target = e.target.closest('[data-field]');
      if (!target) return;
      var field = target.getAttribute('data-field');
      handleFieldInput(field, target.value);
    });

    // blur：testTimeout 持久化
    on(state.container, 'blur', function (e) {
      var target = e.target.closest('[data-field]');
      if (!target) return;
      handleFieldBlur(target.getAttribute('data-field'));
    }, true);

    // click 委托：button / chip / toggle / 列表项 / 外观下拉
    on(state.container, 'click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        var action = actionEl.getAttribute('data-action');
        // 携带 data-provider-id 的动作
        var pid = actionEl.getAttribute('data-provider-id');
        switch (action) {
          case 'open-select':     toggleSelectMenu(actionEl.closest('.settings-select-wrap')); return;
          case 'set-theme':
          case 'set-lang':        handleMenuPick(actionEl); return;
          case 'toggle-enabled': handleToggleEnabled(); return;
          case 'toggle-apikey':  handleToggleApikey();  return;
          case 'test':           handleTest();           return;
          case 'save-provider':  handleSaveProvider();  return;
          case 'cancel-edit':    handleCancelEdit();    return;
          case 'use-provider':    handleUseProvider(pid);    return;
          case 'edit-provider':   handleEditProvider(pid);   return;
          case 'delete-provider': handleDeleteProvider(pid); return;
          case 'export':         handleExport();        return;
          case 'import-trigger': handleImportTrigger(); return;
          case 'import-confirm': handleImportConfirm(); return;
          case 'import-cancel':  handleImportCancel();  return;
        }
      }
      // 模板 chip（速填）
      var templateEl = e.target.closest('[data-template-id]');
      if (templateEl) {
        handleTemplateClick(templateEl.getAttribute('data-template-id'));
        return;
      }
    });

    // change 事件：文件导入
    on(state.container, 'change', function (e) {
      var fileTarget = e.target.closest('[data-action="import-file"]');
      if (fileTarget && fileTarget.files && fileTarget.files[0]) {
        handleImportFile(fileTarget.files[0]);
        fileTarget.value = ''; // 重置以允许重复选择同一文件
      }
      var modeTarget = e.target.closest('[data-action="import-mode"]');
      if (modeTarget) {
        state.importMode = modeTarget.value;
      }
    });

    // 外观下拉：pointerdown 即时按压反馈（§1 Response）
    on(state.container, 'pointerdown', function (e) {
      var trigger = e.target.closest('.settings-trigger');
      if (trigger) {
        var wrap = trigger.closest('.settings-select-wrap');
        if (wrap) {
          wrap.classList.add('is-pressed');
          var release = function () { wrap.classList.remove('is-pressed'); };
          trigger.addEventListener('pointerup', release, { once: true });
          trigger.addEventListener('pointercancel', release, { once: true });
        }
      }
    });

    // 键盘可达性：Enter/Space 触发 data-action（input 上回车不触发）
    on(state.container, 'keydown', function (e) {
      // Escape 关闭下拉菜单
      if (e.key === 'Escape') {
        closeAllSelectMenus();
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      var action = actionEl.getAttribute('data-action');
      switch (action) {
        case 'open-select':    toggleSelectMenu(actionEl.closest('.settings-select-wrap')); return;
        case 'toggle-enabled': handleToggleEnabled(); return;
        case 'toggle-apikey':  handleToggleApikey();  return;
        case 'test':           handleTest();           return;
        case 'save-provider':  handleSaveProvider();  return;
        case 'cancel-edit':    handleCancelEdit();    return;
      }
    });

    // Store 变化 → refresh（仅当当前视图为 settings）
    if (Store && typeof Store.onChange === 'function') {
      state.unsubStore = Store.onChange(function (change) {
        if (!App || !App.getCurrentView || App.getCurrentView() !== 'settings') return;
        // 服务商变化时同步本地 state 后再 refresh
        if (change && (change.type === 'aiProviders:add' || change.type === 'aiProviders:update' ||
            change.type === 'aiProviders:delete' || change.type === 'aiProviders:active')) {
          reloadProviders();
        }
        refresh();
      });
    }

    // 路由切回 settings 时刷新一次
    if (App && typeof App.onRouteChange === 'function') {
      state.unsubRoute = App.onRouteChange(function (toView) {
        if (toView === 'settings') {
          state.rafId = requestAnimationFrame(function () {
            refresh();
          });
        }
      });
    }
  }

  /* ===================================================================
     八、视图契约：mount / unmount / refresh
     =================================================================== */

  function mount(container) {
    state.container = container || document.querySelector('.view[data-view="settings"]');
    if (!state.container) return;

    // 从 Store 读取配置与服务商列表
    reloadProviders();
    resetForm();
    state.selectedTemplate = detectSelectedTemplate();

    injectStyles();
    render();
    bindEvents();

    // 外部点击关闭下拉（document 级，unmount 时移除）
    if (state.onDocClick) global.document.removeEventListener('click', state.onDocClick);
    state.onDocClick = function (e) {
      if (state.container && !state.container.contains(e.target)) closeAllSelectMenus();
    };
    global.document.addEventListener('click', state.onDocClick);
  }

  function unmount() {
    // 测试请求无法外部中断（AIClient.testConnection 不接收 signal），
    // 仅复位 UI 状态；promise 后续的回调在 state.container=null 时会安全跳过
    state.testing = false;

    clearListeners();
    clearTimers();
    if (state.onDocClick) {
      global.document.removeEventListener('click', state.onDocClick);
      state.onDocClick = null;
    }
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
    reloadProviders();
    // 保留表单输入内容（用户可能正在输入），仅同步模板高亮
    state.selectedTemplate = detectSelectedTemplate();
    // 保留滚动位置
    var scrollTop = state.container.scrollTop;
    render();
    if (state.container) state.container.scrollTop = scrollTop;
  }

  /* ===================================================================
     九、注册视图（处理 defer 时序，参考 train.js）
     =================================================================== */

  function register() {
    if (typeof App === 'undefined' || !App.registerView) {
      document.addEventListener('DOMContentLoaded', register);
      return;
    }
    App.registerView('settings', { mount: mount, unmount: unmount, refresh: refresh });
  }
  register();

})(typeof window !== 'undefined' ? window : this);
