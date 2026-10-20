/* =====================================================================
   大众点评 AI 评价生成器 · 首页概览视图 (dashboard)
   契约：App.registerView('dashboard', { mount, unmount, refresh })
   - mount(container): 渲染到 <section class="view" data-view="dashboard">
   - unmount(): 清理监听 / 取消未完成动画
   - refresh(): 数据变化时重渲（如训练后语料数变化）
   设计：Apple 风格 —— 留白克制、层级清晰、大字号负字距、
        卡片弹簧错峰入场、入口 .pressable 即时反馈。
   ===================================================================== */
(function (global) {
  'use strict';

  /* ===================================================================
     一、模块状态
     =================================================================== */

  var state = {
    container: null,         // 当前挂载的 section.view 元素
    listeners: [],           // 待清理的事件监听器 [el, type, fn]
    rafId: null,             // 入场动画 rAF id
    enterTimers: [],         // 错峰入场的 setTimeout id 集合
    unsubStore: null,        // Store 变化取消订阅
    unsubRoute: null,        // 路由变化取消订阅
    rendered: false          // 是否已渲染（避免重复挂载）
  };

  /* ===================================================================
     二、工具
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

  /** 清理入场动画相关 rAF / 定时器 */
  function clearEnterTimers() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    state.enterTimers.forEach(function (t) { clearTimeout(t); });
    state.enterTimers = [];
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

  function tr(key, params) {
    var i = global.I18n;
    return (i && typeof i.t === 'function') ? i.t(key, params) : key;
  }

  /** 相对时间格式化：刚刚 / X 分钟前 / X 小时前 / X 天前 / 日期 */
  function formatRelative(isoOrTs) {
    if (!isoOrTs) return '';
    var ts = typeof isoOrTs === 'number' ? isoOrTs : new Date(isoOrTs).getTime();
    if (!ts || isNaN(ts)) return '';
    var now = Date.now();
    var diff = now - ts;
    if (diff < 0) diff = 0;
    var min = 60 * 1000;
    var hour = 60 * min;
    var day = 24 * hour;

    if (diff < min) return tr('dashboard.timeJustNow');
    if (diff < hour) return tr('dashboard.timeMinutesAgo', { 0: Math.floor(diff / min) });
    if (diff < day) return tr('dashboard.timeHoursAgo', { 0: Math.floor(diff / hour) });
    if (diff < 7 * day) return tr('dashboard.timeDaysAgo', { 0: Math.floor(diff / day) });

    var d = new Date(ts);
    var m = (d.getMonth() + 1).toString().padStart(2, '0');
    var dd = d.getDate().toString().padStart(2, '0');
    return m + '-' + dd;
  }

  /** 取 Store，做存在性兜底（防止首次加载时序问题） */
  function store() {
    return global.Store || null;
  }

  /* ===================================================================
     三、图标（内联 SVG，无外部依赖）
     =================================================================== */

  var ICONS = {
    // 数据概览
    corpus: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4H8V20H4V4ZM10 4H14V20H10V4ZM16.5 4.5L20.4 5.7L17.3 19.3L13.4 18.1L16.5 4.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    train: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3L13.5 8.5L19 10L13.5 11.5L12 17L10.5 11.5L5 10L10.5 8.5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    generate: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 4V20M4 14H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6C16 4.89543 15.1046 4 14 4H6C4.89543 4 4 4.89543 4 6V14C4 15.1046 4.89543 16 6 16H8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    // 时间线
    spark: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3L13.5 8.5L19 10L13.5 11.5L12 17L10.5 11.5L5 10L10.5 8.5L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.06 4.94L19 9.88L8 21H3V16L14.06 4.94Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12.5 6.5L17.5 11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ===================================================================
     四、数据合并（最近活动时间线）
     =================================================================== */

  /**
   * 合并训练 + 生成历史，按时间倒序取前 N 条
   * @returns {Array<{type, ts, title, view}>}
   */
  function buildRecentActivity(limit) {
    limit = limit || 6;
    var Store = store();
    if (!Store) return [];

    var items = [];

    // 训练记录
    try {
      var trainings = Store.getTrainingHistory() || [];
      trainings.forEach(function (t) {
        var count = Array.isArray(t.corpusIds) ? t.corpusIds.length : 0;
        items.push({
          type: 'train',
          ts: new Date(t.createdAt).getTime(),
          title: count > 0
            ? tr('dashboard.trainedX', { 0: count })
            : tr('dashboard.trainedOnce'),
          view: 'train'
        });
      });
    } catch (e) {}

    // 生成记录
    try {
      var histories = Store.getHistory() || [];
      histories.forEach(function (h) {
        var merchant = h.merchant || tr('dashboard.merchantDefault');
        items.push({
          type: 'generate',
          ts: new Date(h.createdAt).getTime(),
          title: tr('dashboard.generatedFor', { 0: merchant }),
          view: 'history'
        });
      });
    } catch (e) {}

    // 倒序排序
    items.sort(function (a, b) { return b.ts - a.ts; });

    return items.slice(0, limit);
  }

  /* ===================================================================
     五、渲染：子片段
     =================================================================== */

  /** Hero / 产品介绍区（顶部） */
  function renderHero(stats) {
    var isEmpty = !stats || stats.totalCorpus === 0;
    var product = tr('dashboard.productName');
    var slogan = tr('dashboard.slogan');

    if (isEmpty) {
      // 空状态：突出 CTA「先去训练，喂第一条语料」
      return (
        '<header class="dash-hero dash-hero--empty">' +
          '<div class="dash-hero__badge">' + escapeHtml(tr('dashboard.startHere')) + '</div>' +
          '<h1 class="dash-hero__title">' + escapeHtml(product) + '</h1>' +
          '<p class="dash-hero__slogan">' + escapeHtml(slogan) + '</p>' +
          '<p class="dash-hero__hint">' + escapeHtml(tr('dashboard.heroEmptyHint')) + '</p>' +
          '<button class="btn btn-primary pressable dash-hero__cta" data-action="goto-train" type="button">' +
            '<span>' + escapeHtml(tr('dashboard.trainCta')) + '</span>' +
            '<span class="dash-hero__cta-arrow">' + ICONS.arrow + '</span>' +
          '</button>' +
        '</header>'
      );
    }

    return (
      '<header class="dash-hero">' +
        '<div class="dash-hero__badge">' + escapeHtml(tr('dashboard.heroBadge')) + '</div>' +
        '<h1 class="dash-hero__title">' + escapeHtml(product) + '</h1>' +
        '<p class="dash-hero__slogan">' + escapeHtml(slogan) + '</p>' +
        '<p class="dash-hero__hint">' + escapeHtml(tr('dashboard.heroHint')) + '</p>' +
      '</header>'
    );
  }

  /** 数据概览卡片网格 */
  function renderStatsCards(stats) {
    var cards = [
      {
        key: 'corpus',
        accent: 'orange',
        icon: ICONS.corpus,
        value: String(stats.totalCorpus || 0),
        unit: tr('dashboard.unitCorpus'),
        title: tr('dashboard.cardCorpusTitle'),
        subtitle: tr('dashboard.cardCorpusSub', { 0: (stats.categoryCount || 0) })
      },
      {
        key: 'weekTrain',
        accent: 'purple',
        icon: ICONS.train,
        value: String(stats.weekTrainCount || 0),
        unit: tr('dashboard.unitTimes'),
        title: tr('dashboard.cardWeekTrainTitle'),
        subtitle: tr('dashboard.cardWeekTrainSub')
      },
      {
        key: 'weekGen',
        accent: 'blue',
        icon: ICONS.generate,
        value: String(stats.weekGenCount || 0),
        unit: tr('dashboard.unitCorpus'),
        title: tr('dashboard.cardWeekGenTitle'),
        subtitle: tr('dashboard.cardWeekGenSub')
      },
      {
        key: 'copyRate',
        accent: 'green',
        icon: ICONS.copy,
        value: String(stats.copyRate || 0),
        unit: '%',
        title: tr('dashboard.cardCopyRateTitle'),
        subtitle: tr('dashboard.cardCopyRateSub')
      }
    ];

    var html = '<section class="dash-stats" aria-label="' + escapeHtml(tr('dashboard.statsLabel')) + '">';
    cards.forEach(function (c, i) {
      html +=
        '<article class="dash-stat-card pressable dash-stat-card--' + c.accent + '" ' +
          'data-index="' + i + '" style="--enter-index:' + i + '" role="button" tabindex="0" aria-label="' + escapeHtml(c.title) + '">' +
          '<div class="dash-stat-card__icon">' + c.icon + '</div>' +
          '<div class="dash-stat-card__body">' +
            '<div class="dash-stat-card__title">' + escapeHtml(c.title) + '</div>' +
            '<div class="dash-stat-card__value">' +
              '<span class="dash-stat-card__num">' + escapeHtml(c.value) + '</span>' +
              '<span class="dash-stat-card__unit">' + escapeHtml(c.unit) + '</span>' +
            '</div>' +
            '<div class="dash-stat-card__subtitle">' + escapeHtml(c.subtitle) + '</div>' +
          '</div>' +
        '</article>';
    });
    html += '</section>';
    return html;
  }

  /** 快捷入口大按钮 */
  function renderQuickEntries() {
    var entries = [
      {
        key: 'train',
        accent: 'orange',
        icon: ICONS.train,
        title: tr('dashboard.entryTrainTitle'),
        desc: tr('dashboard.entryTrainDesc'),
        action: 'goto-train'
      },
      {
        key: 'generate',
        accent: 'blue',
        icon: ICONS.generate,
        title: tr('dashboard.entryGenTitle'),
        desc: tr('dashboard.entryGenDesc'),
        action: 'goto-generate'
      },
      {
        key: 'library',
        accent: 'purple',
        icon: ICONS.corpus,
        title: tr('dashboard.entryLibTitle'),
        desc: tr('dashboard.entryLibDesc'),
        action: 'goto-library'
      }
    ];

    var html = '<section class="dash-entries" aria-label="' + escapeHtml(tr('dashboard.entriesLabel')) + '">';
    entries.forEach(function (e, i) {
      html +=
        '<button class="dash-entry pressable dash-entry--' + e.accent + '" ' +
          'data-action="' + e.action + '" type="button" style="--enter-index:' + i + '">' +
          '<span class="dash-entry__icon">' + e.icon + '</span>' +
          '<span class="dash-entry__text">' +
            '<span class="dash-entry__title">' + escapeHtml(e.title) + '</span>' +
            '<span class="dash-entry__desc">' + escapeHtml(e.desc) + '</span>' +
          '</span>' +
          '<span class="dash-entry__arrow">' + ICONS.arrow + '</span>' +
        '</button>';
    });
    html += '</section>';
    return html;
  }

  /** 最近活动时间线 */
  function renderTimeline() {
    var activities = buildRecentActivity(6);

    if (!activities.length) {
      return (
        '<section class="dash-timeline" aria-label="' + escapeHtml(tr('dashboard.timelineLabel')) + '">' +
          '<h2 class="dash-section__title">' + escapeHtml(tr('dashboard.timelineTitle')) + '</h2>' +
          '<div class="dash-empty">' +
            '<div class="dash-empty__icon">' + ICONS.spark + '</div>' +
            '<p class="dash-empty__text">' + escapeHtml(tr('dashboard.timelineEmpty')) + '</p>' +
            '<p class="dash-empty__hint">' + escapeHtml(tr('dashboard.timelineEmptyHint')) + '</p>' +
          '</div>' +
        '</section>'
      );
    }

    var html =
      '<section class="dash-timeline" aria-label="' + escapeHtml(tr('dashboard.timelineLabel')) + '">' +
        '<h2 class="dash-section__title">' + escapeHtml(tr('dashboard.timelineTitle')) + '</h2>' +
        '<ol class="dash-timeline__list">';

    activities.forEach(function (a, i) {
      var icon = a.type === 'train' ? ICONS.spark : ICONS.pen;
      var typeLabel = a.type === 'train' ? tr('dashboard.typeTrain') : tr('dashboard.typeGenerate');
      html +=
        '<li class="dash-tl-item pressable" data-action="goto-' + a.view + '" tabindex="0" style="--enter-index:' + i + '">' +
          '<div class="dash-tl-item__rail">' +
            '<span class="dash-tl-item__dot dash-tl-item__dot--' + a.type + '">' + icon + '</span>' +
            (i < activities.length - 1 ? '<span class="dash-tl-item__line"></span>' : '') +
          '</div>' +
          '<div class="dash-tl-item__body">' +
            '<div class="dash-tl-item__title">' + escapeHtml(a.title) + '</div>' +
            '<div class="dash-tl-item__meta">' +
              '<span class="dash-tl-item__type">' + typeLabel + '</span>' +
              '<span class="dash-tl-item__sep">·</span>' +
              '<span class="dash-tl-item__time">' + escapeHtml(formatRelative(a.ts)) + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="dash-tl-item__arrow">' + ICONS.arrow + '</span>' +
        '</li>';
    });

    html += '</ol></section>';
    return html;
  }

  /** 三大模块关系说明卡片 */
  function renderModulesCard() {
    return (
      '<section class="dash-modules card" aria-label="' + escapeHtml(tr('dashboard.modulesLabel')) + '">' +
        '<h2 class="dash-section__title">' + escapeHtml(tr('dashboard.modulesTitle')) + '</h2>' +
        '<ol class="dash-modules__list">' +
          '<li class="dash-modules__item">' +
            '<span class="dash-modules__badge">1</span>' +
            '<div class="dash-modules__text">' +
              tr('dashboard.module1') +
            '</div>' +
          '</li>' +
          '<li class="dash-modules__item">' +
            '<span class="dash-modules__badge">2</span>' +
            '<div class="dash-modules__text">' +
              tr('dashboard.module2') +
            '</div>' +
          '</li>' +
          '<li class="dash-modules__item">' +
            '<span class="dash-modules__badge">3</span>' +
            '<div class="dash-modules__text">' +
              tr('dashboard.module3') +
            '</div>' +
          '</li>' +
        '</ol>' +
      '</section>'
    );
  }

  /* ===================================================================
     六、渲染：整体
     =================================================================== */

  function render() {
    var Store = store();
    var stats = Store ? Store.getStats() : {
      totalCorpus: 0, categoryCount: 0, tagGroupCount: 0,
      lastTrainAt: null, weekTrainCount: 0, weekGenCount: 0, copyRate: 0
    };

    var html =
      '<div class="dash">' +
        renderHero(stats) +
        renderStatsCards(stats) +
        renderQuickEntries() +
        renderTimeline() +
        renderModulesCard() +
      '</div>';

    if (state.container) {
      state.container.innerHTML = html;
    }
    state.rendered = true;
  }

  /* ===================================================================
     七、事件绑定
     =================================================================== */

  function bindEvents() {
    if (!state.container) return;
    var App = global.App;
    var Store = store();

    // 委托：data-action 跳转
    on(state.container, 'click', function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');
      handleAction(action);
    });

    // 键盘可达性：Enter / Space 触发 data-action
    on(state.container, 'keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var target = e.target.closest('[data-action]');
      if (!target) return;
      e.preventDefault();
      var action = target.getAttribute('data-action');
      handleAction(action);
    });

    // Store 变化 → refresh（仅在当前视图激活时）
    if (Store && typeof Store.onChange === 'function') {
      state.unsubStore = Store.onChange(function (change) {
        // 仅当前视图激活时刷新，避免后台渲染浪费
        if (App && App.getCurrentView && App.getCurrentView() === 'dashboard') {
          refresh();
        }
      });
    }

    // 路由切换回 dashboard 时，重渲一次（数据可能已变）
    if (App && typeof App.onRouteChange === 'function') {
      state.unsubRoute = App.onRouteChange(function (toView) {
        if (toView === 'dashboard') {
          // 下一帧重渲，避免与视图切换动画抢帧
          state.rafId = requestAnimationFrame(function () {
            refresh();
          });
        }
      });
    }
  }

  function handleAction(action) {
    var App = global.App;
    if (!App || typeof App.navigate !== 'function') return;
    switch (action) {
      case 'goto-train':
        App.navigate('train');
        break;
      case 'goto-generate':
        App.navigate('generate');
        break;
      case 'goto-library':
        App.navigate('library');
        break;
      case 'goto-history':
        App.navigate('history');
        break;
      default:
        break;
    }
  }

  /* ===================================================================
     八、入场动画（错峰 50ms）
     =================================================================== */

  function playEnterAnimation() {
    if (!state.container) return;
    clearEnterTimers();

    var animatables = state.container.querySelectorAll(
      '.dash-stat-card, .dash-entry, .dash-tl-item'
    );
    if (!animatables.length) return;

    var reduceMotion = global.matchMedia &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // reduced-motion：跳过 transform 动画，仅简单淡入
    var delay = 0;
    for (var i = 0; i < animatables.length; i++) {
      (function (el, d) {
        var t = setTimeout(function () {
          el.classList.add('is-entered');
        }, d);
        state.enterTimers.push(t);
      })(animatables[i], reduceMotion ? 0 : delay);
      delay += 50;
    }
  }

  /* ===================================================================
     九、视图契约：mount / unmount / refresh
     =================================================================== */

  function mount(container) {
    state.container = container || (document.querySelector('.view[data-view="dashboard"]'));
    if (!state.container) return;

    render();
    bindEvents();

    // 下一帧触发入场动画（确保 DOM 已绘制初始状态）
    state.rafId = requestAnimationFrame(function () {
      playEnterAnimation();
    });
  }

  function unmount() {
    clearListeners();
    clearEnterTimers();
    if (state.unsubStore) {
      try { state.unsubStore(); } catch (e) {}
      state.unsubStore = null;
    }
    if (state.unsubRoute) {
      try { state.unsubRoute(); } catch (e) {}
      state.unsubRoute = null;
    }
    state.container = null;
    state.rendered = false;
  }

  function refresh() {
    if (!state.container) return;
    // 重渲：保留滚动位置
    var scrollTop = state.container.scrollTop;
    render();
    if (state.container) state.container.scrollTop = scrollTop;
    // 数据变化后重渲，元素已是新 DOM，直接置为 entered 避免视觉跳动
    var fresh = state.container.querySelectorAll(
      '.dash-stat-card:not(.is-entered), .dash-entry:not(.is-entered), .dash-tl-item:not(.is-entered)'
    );
    fresh.forEach(function (el) { el.classList.add('is-entered'); });
  }

  /* ===================================================================
     十、注册视图
     注意 defer 脚本执行顺序：store.js → ai-engine.js → views/*.js → app.js
     因此本文件执行时 window.App 尚未定义。app.js 在 readyState='interactive'
     时同步调用 start()（早于 DOMContentLoaded），若 dashboard 为初始视图且
     未注册，start() 会渲染占位符。这里在 DOMContentLoaded 时补注册并补挂载。
     =================================================================== */

  var viewModule = { mount: mount, unmount: unmount, refresh: refresh };

  function registerAndMountIfNeeded() {
    if (!global.App || typeof global.App.registerView !== 'function') return;
    // 注册视图
    global.App.registerView('dashboard', viewModule);

    // 若 app.js 的 start() 已先于本注册运行（dashboard 是初始视图但当时未注册），
    // 此时 dashboard 视图元素会显示占位符 —— 主动补挂载，避免首屏停留在占位。
    if (state.rendered) return;
    var el = document.querySelector('.view[data-view="dashboard"]');
    if (el && el.classList.contains('is-active') && el.querySelector('.view-placeholder')) {
      try { mount(el); } catch (e) {
        console.warn('[dashboard] 初始补挂载失败:', e);
      }
    }
  }

  if (global.App && typeof global.App.registerView === 'function') {
    // app.js 已加载（理论上不会发生，因 defer 顺序，但兜底）
    registerAndMountIfNeeded();
  } else {
    // 等待 DOMContentLoaded：此时所有 defer 脚本（含 app.js）已执行完，
    // App 已定义且 start() 已运行。
    global.addEventListener('DOMContentLoaded', registerAndMountIfNeeded);
  }

})(typeof window !== 'undefined' ? window : this);
