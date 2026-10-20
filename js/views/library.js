/* =====================================================================
   大众点评 AI 评价生成器 · 语录库视图 (library)
   契约：App.registerView('library', { mount, unmount, refresh })
   - mount(container): 渲染到 <section class="view" data-view="library">
   - unmount(): 清理监听 / 取消未完成动画 / 关闭抽屉
   - refresh(): 数据变化时重渲（保留筛选 / 排序 / 多选状态）
   设计：Apple 风格 —— 半透明批量操作栏、弹簧重排、左滑删除 1:1 跟手 +
        回弹边界、卡片错峰入场、按压即时反馈、reduced-motion 适配。
   ===================================================================== */
(function (global) {
  'use strict';

  /* ===================================================================
     一、常量
     =================================================================== */

  var CATEGORIES = [
    '全部', '美食', '美发', '酒店', '休闲', '健身',
    '电影', '亲子', '购物', '美甲美睫', 'KTV', '其他'
  ];

  var SORT_OPTIONS = [
    { key: 'time-desc', label: 'library.sortLatest' },
    { key: 'length-desc', label: 'library.sortLength' },
    { key: 'random', label: 'library.sortRandom' }
  ];

  // 标签组颜色预设色板
  var PRESET_COLORS = [
    '#FF9500', '#FF2D55', '#5856D6', '#34C759',
    '#007AFF', '#AF52DE', '#FF3B30', '#5AC8FA'
  ];

  // 来源元信息（与 Store 数据契约对齐）
  var SOURCE_META = {
    manual:  { label: '自己训练', icon: 'pen' },
    import:  { label: '导入',     icon: 'upload' },
    reverse: { label: '反向入库', icon: 'reverse' }
  };

  // 左滑删除交互常量
  var SWIPE_MAX_DRAG = 120;       // 最大位移（负方向）
  var SWIPE_DELETE_THRESHOLD = 80;// 释放时超过此阈值则触发删除
  var SWIPE_LOCK_THRESHOLD = 5;   // 水平锁定阈值
  var SWIPE_VERTICAL_CANCEL = 10; // 垂直取消阈值（避免与滚动冲突）

  /* ===================================================================
     二、模块状态
     =================================================================== */

  var state = {
    container: null,           // 当前挂载的 section.view 元素
    listeners: [],             // [el, type, fn, opts] 集合
    enterTimers: [],           // 错峰入场 setTimeout id
    rafId: null,               // 入场动画 rAF
    unsubStore: null,          // Store 变化取消订阅
    unsubRoute: null,          // 路由变化取消订阅
    rendered: false,

    // 筛选 / 排序状态（refresh 时保留）
    filter: { category: '全部', tagId: null, keyword: '', sort: 'time-desc' },

    // 多选模式
    multiSelectMode: false,
    selectedIds: {},           // {id: true}

    // 搜索防抖
    searchTimer: null,

    // 抽屉关闭函数（用于 unmount 时强制关闭）
    drawerClose: null,

    // 当前激活的左滑会话
    activeSwipe: null,

    // 标记 swipe 刚结束（避免误触发 click 打开详情）
    swipeJustEnded: false,
    swipeJustEndedTimer: null,

    // 长按标签组的检测句柄
    longPressTimer: null,
    longPressFired: false,

    // 随机排序的稳定种子（仅在切换到 random 时洗牌一次）
    randomOrder: null
  };

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

  /** 清理入场动画相关定时器 */
  function clearEnterTimers() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    state.enterTimers.forEach(function (t) { clearTimeout(t); });
    state.enterTimers = [];
  }

  /** 清理搜索 / 长按 / swipe-end 等杂项定时器 */
  function clearMiscTimers() {
    if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
    if (state.swipeJustEndedTimer) { clearTimeout(state.swipeJustEndedTimer); state.swipeJustEndedTimer = null; }
    if (state.longPressTimer) { clearTimeout(state.longPressTimer); state.longPressTimer = null; }
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

  /**
   * i18n 取词：调用全局 I18n.t，取不到时回退为 key 本身
   */
  function tr(key, params) {
    var i = global.I18n;
    return (i && typeof i.t === 'function') ? i.t(key, params) : key;
  }

  /** 品类名称映射为 i18n 文案（品类数据码仍保留中文，仅展示翻译） */
  function catLabel(cat) {
    var key = {
      '全部': 'library.catAll',
      '美食': 'library.catFood',
      '美发': 'library.catHair',
      '酒店': 'library.catHotel',
      '休闲': 'library.catLeisure',
      '健身': 'library.catFitness',
      '电影': 'library.catMovie',
      '亲子': 'library.catParentChild',
      '购物': 'library.catShopping',
      '美甲美睫': 'library.catNails',
      'KTV': 'library.catKtv',
      '其他': 'library.catOther'
    }[cat] || cat;
    return tr(key);
  }

  /** 来源说明映射为 i18n 文案 */
  function srcLabel(source) {
    var key = {
      manual: 'library.sourceManual',
      import: 'library.sourceImport',
      reverse: 'library.sourceReverse'
    }[source] || 'library.sourceManual';
    return tr(key);
  }

  /** 相对时间格式化：刚刚 / X 分钟前 / X 小时前 / X 天前 / 日期 */
  function formatRelative(isoOrTs) {
    if (!isoOrTs) return tr('library.timeNone');
    var ts = typeof isoOrTs === 'number' ? isoOrTs : new Date(isoOrTs).getTime();
    if (!ts || isNaN(ts)) return tr('library.timeNone');
    var now = Date.now();
    var diff = now - ts;
    if (diff < 0) diff = 0;
    var min = 60 * 1000;
    var hour = 60 * min;
    var day = 24 * hour;

    if (diff < min) return tr('library.timeJustNow');
    if (diff < hour) return tr('library.timeMinutesAgo', { 0: Math.floor(diff / min) });
    if (diff < day) return tr('library.timeHoursAgo', { 0: Math.floor(diff / hour) });
    if (diff < 7 * day) return tr('library.timeDaysAgo', { 0: Math.floor(diff / day) });

    var d = new Date(ts);
    var m = (d.getMonth() + 1).toString().padStart(2, '0');
    var dd = d.getDate().toString().padStart(2, '0');
    return m + '-' + dd;
  }

  /**
   * Apple 回弹边界公式
   * rubberband(overshoot, dimension, constant=0.55)
   * 来自 apple-design skill 的 Quick Reference
   */
  function rubberband(overshoot, dimension, constant) {
    if (constant == null) constant = 0.55;
    if (dimension === 0) return 0;
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function store() { return global.Store || null; }
  function app() { return global.App || null; }

  /* ===================================================================
     四、图标（内联 SVG）
     =================================================================== */

  var ICONS = {
    trash: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4H13M6 4V3C6 2.45 6.45 2 7 2H9C9.55 2 10 2.45 10 3V4M5 4L5.5 13C5.55 13.55 6 14 6.55 14H9.45C10 14 10.45 13.55 10.5 13L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7L6 10L11 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pen: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 3L13 5L6 12L3 13L4 10L11 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    upload: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 11V3M8 3L4 7M8 3L12 7M3 13H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    reverse: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8C3 5.24 5.24 3 8 3C9.52 3 10.89 3.68 11.84 4.76M13 8C13 10.76 10.76 13 8 13C6.48 13 5.11 12.32 4.16 11.24M11.84 4.76V3M11.84 4.76H13M4.16 11.24V13M4.16 11.24H3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    emptyBook: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M12 8H30C33.31 8 36 10.69 36 14V40C36 41.1 35.1 42 34 42H14C12.9 42 12 41.1 12 40V8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 8V40" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 18H29M19 24H29M19 30H25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tag: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3H8L13 8L8 13L3 8V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6" cy="6" r="1" fill="currentColor"/></svg>',
    folder: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 5C2 4.45 2.45 4 3 4H6L7.5 5.5H13C13.55 5.5 14 5.95 14 6.5V12C14 12.55 13.55 13 13 13H3C2.45 13 2 12.55 2 12V5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  };

  function sourceIcon(source) {
    var key = (SOURCE_META[source] || SOURCE_META.manual).icon;
    return ICONS[key] || ICONS.pen;
  }

  /* ===================================================================
     五、筛选 + 排序
     =================================================================== */

  function getFilteredCorpus() {
    var Store = store();
    if (!Store) return [];
    var all = Store.getCorpus() || [];
    var f = state.filter;

    // 1. 筛选
    var filtered = all.filter(function (c) {
      if (f.category && f.category !== '全部' && c.category !== f.category) return false;
      if (f.tagId && (!Array.isArray(c.tagIds) || c.tagIds.indexOf(f.tagId) === -1)) return false;
      if (f.keyword) {
        var kw = f.keyword.toLowerCase();
        if (!c.text || c.text.toLowerCase().indexOf(kw) === -1) return false;
      }
      return true;
    });

    // 2. 排序
    var sort = f.sort;
    if (sort === 'time-desc') {
      filtered.sort(function (a, b) {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      state.randomOrder = null;
    } else if (sort === 'length-desc') {
      filtered.sort(function (a, b) {
        return (b.text || '').length - (a.text || '').length;
      });
      state.randomOrder = null;
    } else if (sort === 'random') {
      // 切换到 random 时洗牌一次；后续 refresh 保持稳定（除非数据条数变化）
      if (!state.randomOrder || state.randomOrder.length !== filtered.length) {
        state.randomOrder = shuffleIndexes(filtered.length);
      }
      var order = state.randomOrder;
      filtered = order.map(function (idx) { return filtered[idx]; });
    }

    return filtered;
  }

  function shuffleIndexes(n) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(i);
    for (var j = n - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
    }
    return arr;
  }

  /* ===================================================================
     六、渲染：子片段
     =================================================================== */

  /** 顶部标题区 + 编辑按钮 */
  function renderHeader(stats) {
    var editActive = state.multiSelectMode ? ' is-active' : '';
    var editLabel = state.multiSelectMode ? tr('library.done') : tr('library.edit');
    return (
      '<header class="lib-header">' +
        '<div>' +
          '<h1 class="lib-title">' + tr('library.title') + '</h1>' +
          '<div class="lib-subtitle">' + tr('library.subtitleCorpus', { 0: (stats.totalCorpus || 0) }) + ' · ' +
            tr('library.subtitleCategory', { 0: (stats.categoryCount || 0) }) + '</div>' +
        '</div>' +
        '<button class="lib-edit-btn pressable' + editActive + '" type="button" data-action="toggle-multi">' +
          escapeHtml(editLabel) +
        '</button>' +
      '</header>'
    );
  }

  /** 统计概览卡片（4.1） */
  function renderStats(stats) {
    var lastTrain = stats.lastTrainAt ? formatRelative(stats.lastTrainAt) : tr('library.timeNone');
    return (
      '<section class="lib-stats card" aria-label="' + tr('library.statsAriaLabel') + '">' +
        '<div class="lib-stat">' +
          '<div class="lib-stat__num">' + (stats.totalCorpus || 0) + '</div>' +
          '<div class="lib-stat__label">' + tr('library.statsTotalLabel') + '</div>' +
        '</div>' +
        '<div class="lib-stat">' +
          '<div class="lib-stat__num">' + (stats.categoryCount || 0) + '</div>' +
          '<div class="lib-stat__label">' + tr('library.statsCategoryLabel') + '</div>' +
        '</div>' +
        '<div class="lib-stat">' +
          '<div class="lib-stat__num">' + (stats.tagGroupCount || 0) + '</div>' +
          '<div class="lib-stat__label">' + tr('library.statsTagGroupLabel') + '</div>' +
        '</div>' +
        '<div class="lib-stat">' +
          '<div class="lib-stat__num lib-stat__num--text">' + escapeHtml(lastTrain) + '</div>' +
          '<div class="lib-stat__label">' + tr('library.statsLastTrainLabel') + '</div>' +
        '</div>' +
      '</section>'
    );
  }

  /** 筛选栏 + 排序（4.2） */
  function renderFilters(tagGroups) {
    var f = state.filter;

    // 品类行
    var catHtml = '<div class="lib-filter-row" data-filter="category" role="group" aria-label="' + tr('library.filterCategoryAria') + '">';
    CATEGORIES.forEach(function (cat) {
      var active = (f.category === cat) ? ' is-active' : '';
      catHtml += '<button class="chip pressable' + active + '" type="button" data-cat="' + escapeHtml(cat) + '">' +
        escapeHtml(catLabel(cat)) + '</button>';
    });
    catHtml += '</div>';

    // 标签组行
    var tagHtml = '<div class="lib-filter-row" data-filter="tag" role="group" aria-label="' + tr('library.filterTagAria') + '">';
    var allActive = !f.tagId ? ' is-active' : '';
    tagHtml += '<button class="chip lib-tag-chip pressable' + allActive + '" type="button" data-tag="" data-role="tag-filter">' +
      tr('library.filterAllTags') + '</button>';
    tagGroups.forEach(function (g) {
      var active = (f.tagId === g.id) ? ' is-active' : '';
      var style = g.color ? ' style="color:' + escapeHtml(g.color) + '"' : '';
      tagHtml += '<button class="chip lib-tag-chip pressable' + active + '"' + style +
        ' type="button" data-tag="' + escapeHtml(g.id) + '" data-role="tag-filter" data-tag-group-id="' + escapeHtml(g.id) + '">' +
        '<span class="lib-tag-chip__dot"></span>' +
        escapeHtml(g.name) +
        '</button>';
    });
    // 新建标签组按钮
    tagHtml += '<button class="lib-filter-add pressable" type="button" data-action="new-tag-group" aria-label="' + tr('library.filterNewTagGroupAria') + '">+</button>';
    tagHtml += '</div>';

    // 工具行：搜索 + 排序
    var toolHtml = '<div class="lib-filter-row lib-filter-row--tools">';
    toolHtml += '<input class="input lib-search" type="search" placeholder="' + tr('library.filterSearchPlaceholder') + '" value="' +
      escapeHtml(f.keyword) + '" data-role="search" aria-label="' + tr('library.filterSearchAria') + '" />';
    toolHtml += '<div class="lib-sort" role="group" aria-label="' + tr('library.filterSortAria') + '">';
    SORT_OPTIONS.forEach(function (s) {
      var active = (f.sort === s.key) ? ' is-active' : '';
      toolHtml += '<button class="chip pressable' + active + '" type="button" data-sort="' + s.key + '">' +
        escapeHtml(tr(s.label)) + '</button>';
    });
    toolHtml += '</div>';
    toolHtml += '</div>';

    return '<section class="lib-filters">' + catHtml + tagHtml + toolHtml + '</section>';
  }

  /** 单张语料卡片（4.3） */
  function renderCard(corpus, tagGroups, index) {
    var text = corpus.text || '';
    var preview = text.length > 80 ? text.slice(0, 80) + '…' : text;

    // 品类 chip
    var catChip = corpus.category
      ? '<span class="chip lib-card__cat">' + escapeHtml(corpus.category) + '</span>'
      : '';

    // 标签 chips（最多展示 3 个，多了显示 +N）
    var tagChips = '';
    var tagIds = Array.isArray(corpus.tagIds) ? corpus.tagIds : [];
    var shown = 0;
    var extraCount = 0;
    tagIds.forEach(function (tid) {
      var g = findTagGroup(tagGroups, tid);
      if (!g) return;
      if (shown < 3) {
        var style = g.color ? ' style="color:' + escapeHtml(g.color) + ';border-color:' + escapeHtml(g.color) + '40"' : '';
        tagChips += '<span class="chip lib-card__tag"' + style + '>' +
          '<span class="lib-tag-chip__dot"></span>' +
          escapeHtml(g.name) + '</span>';
        shown++;
      } else {
        extraCount++;
      }
    });
    if (extraCount > 0) {
      tagChips += '<span class="chip lib-card__tag">+' + extraCount + '</span>';
    }

    // 来源
    var srcMeta = SOURCE_META[corpus.source] || SOURCE_META.manual;
    var srcLabelTxt = srcLabel(corpus.source);
    var sourceHtml =
      '<span class="lib-card__source" title="' + escapeHtml(srcLabelTxt) + '">' +
        sourceIcon(corpus.source) +
        '<span>' + escapeHtml(srcLabelTxt) + '</span>' +
      '</span>';

    // 时间
    var timeHtml = '<span class="lib-card__time">' + escapeHtml(formatRelative(corpus.createdAt)) + '</span>';

    // 多选状态
    var multiClass = state.multiSelectMode ? ' is-multi' : '';
    var checkOn = state.selectedIds[corpus.id] ? ' is-on' : '';

    return (
      '<article class="lib-card' + multiClass + '" data-id="' + escapeHtml(corpus.id) + '" style="--enter-index:' + index + '">' +
        '<button class="lib-card__delete" type="button" data-action="swipe-delete" data-id="' + escapeHtml(corpus.id) + '" aria-label="' + tr('library.cardDeleteAria') + '">' +
          ICONS.trash + '<span>' + tr('library.cardDelete') + '</span>' +
        '</button>' +
        '<div class="lib-card__swipe" data-id="' + escapeHtml(corpus.id) + '" data-role="card-swipe">' +
          '<div class="lib-card__check' + checkOn + '" data-action="toggle-select" data-id="' + escapeHtml(corpus.id) + '" role="checkbox" aria-checked="' + (state.selectedIds[corpus.id] ? 'true' : 'false') + '">' +
            ICONS.check +
          '</div>' +
          '<div class="lib-card__content">' +
            '<p class="lib-card__preview">' + escapeHtml(preview) + '</p>' +
            '<div class="lib-card__meta">' +
              catChip + tagChips + sourceHtml + timeHtml +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function findTagGroup(tagGroups, id) {
    for (var i = 0; i < tagGroups.length; i++) {
      if (tagGroups[i].id === id) return tagGroups[i];
    }
    return null;
  }

  /** 列表 + 空状态（4.3） */
  function renderList(tagGroups) {
    var list = getFilteredCorpus();

    if (!list.length) {
      // 区分「语录库为空」与「筛选无结果」
      var Store = store();
      var total = Store ? (Store.getCorpus() || []).length : 0;
      if (total === 0) {
        return renderEmptyState(true);
      }
      return renderEmptyState(false);
    }

    var html = '<section class="lib-list" aria-label="' + tr('library.listAriaLabel') + '">';
    list.forEach(function (c, i) {
      html += renderCard(c, tagGroups, i);
    });
    html += '</section>';
    return html;
  }

  /** 空状态卡片 */
  function renderEmptyState(isTotalEmpty) {
    if (isTotalEmpty) {
      return (
        '<section class="lib-empty card">' +
          '<div class="lib-empty__icon">' + ICONS.emptyBook + '</div>' +
          '<div class="lib-empty__title">' + tr('library.emptyTitle') + '</div>' +
          '<div class="lib-empty__desc">' + tr('library.emptyDesc') + '</div>' +
          '<button class="btn btn-primary pressable lib-empty__cta" type="button" data-action="goto-train">' +
            tr('library.emptyTrainCta') +
          '</button>' +
        '</section>'
      );
    }
    return (
      '<section class="lib-empty card">' +
        '<div class="lib-empty__icon">' + ICONS.tag + '</div>' +
        '<div class="lib-empty__title">' + tr('library.emptyFilterTitle') + '</div>' +
        '<div class="lib-empty__desc">' + tr('library.emptyFilterDesc') + '</div>' +
        '<button class="btn pressable lib-empty__cta" type="button" data-action="clear-filters">' + tr('library.emptyClearFilter') + '</button>' +
      '</section>'
    );
  }

  /** 批量操作栏（4.6，仅多选模式下显示） */
  function renderBatchBar() {
    var count = Object.keys(state.selectedIds).length;
    return (
      '<div class="lib-batch-bar' + (state.multiSelectMode ? ' is-visible' : '') + '"' +
        (state.multiSelectMode ? '' : ' hidden') + ' role="toolbar" aria-label="' + tr('library.batchAria') + '">' +
        '<div class="lib-batch-bar__count">' + tr('library.batchCount', { 0: count }) + '</div>' +
        '<div class="lib-batch-bar__actions">' +
          '<button class="lib-batch-bar__btn pressable" type="button" data-action="batch-tag"' +
            (count ? '' : ' disabled') + '>' + tr('library.batchTag') + '</button>' +
          '<button class="lib-batch-bar__btn pressable" type="button" data-action="batch-move"' +
            (count ? '' : ' disabled') + '>' + tr('library.batchMove') + '</button>' +
          '<button class="lib-batch-bar__btn lib-batch-bar__btn--danger pressable" type="button" data-action="batch-delete"' +
            (count ? '' : ' disabled') + '>' + tr('library.cardDelete') + '</button>' +
          '<button class="lib-batch-bar__btn lib-batch-bar__btn--primary pressable" type="button" data-action="exit-multi">' + tr('library.done') + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  /* ===================================================================
     七、渲染：整体
     =================================================================== */

  function render() {
    var Store = store();
    var stats = Store ? Store.getStats() : {
      totalCorpus: 0, categoryCount: 0, tagGroupCount: 0, lastTrainAt: null
    };
    var tagGroups = Store ? Store.getTagGroups() : [];

    var html =
      renderHeader(stats) +
      renderStats(stats) +
      renderFilters(tagGroups) +
      renderList(tagGroups) +
      renderBatchBar();

    if (state.container) {
      state.container.innerHTML = html;
    }
    state.rendered = true;
  }

  /* ===================================================================
     八、事件绑定
     =================================================================== */

  function bindEvents() {
    if (!state.container) return;
    var App = app();
    var Store = store();

    // 委托：点击事件统一处理 data-action / 筛选 chip / 卡片
    on(state.container, 'click', onClickDelegate);

    // 键盘可达性
    on(state.container, 'keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var target = e.target.closest('[data-action], [data-role="tag-filter"], [data-cat], [data-sort]');
      if (!target) return;
      e.preventDefault();
      onClickDelegate(e);
    });

    // 搜索：防抖 300ms
    on(state.container, 'input', function (e) {
      var input = e.target.closest('[data-role="search"]');
      if (!input) return;
      if (state.searchTimer) clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(function () {
        state.filter.keyword = input.value || '';
        state.randomOrder = null;
        rerenderListOnly();
      }, 300);
    });

    // 标签组长按：500ms 触发管理抽屉
    bindLongPressOnTagChips();

    // 卡片左滑删除：在容器上委托 pointerdown
    on(state.container, 'pointerdown', onPointerDownDelegate);

    // Store 变化 → refresh
    if (Store && typeof Store.onChange === 'function') {
      state.unsubStore = Store.onChange(function () {
        if (App && App.getCurrentView && App.getCurrentView() === 'library') {
          refresh();
        }
      });
    }

    // 路由切回 library 时刷新
    if (App && typeof App.onRouteChange === 'function') {
      state.unsubRoute = App.onRouteChange(function (toView) {
        if (toView === 'library') {
          state.rafId = requestAnimationFrame(function () { refresh(); });
        }
      });
    }
  }

  /** 点击事件统一处理 */
  function onClickDelegate(e) {
    // swipe 刚结束，吞掉 click
    if (state.swipeJustEnded) {
      state.swipeJustEnded = false;
      if (state.swipeJustEndedTimer) { clearTimeout(state.swipeJustEndedTimer); state.swipeJustEndedTimer = null; }
      return;
    }

    var target = e.target.closest(
      '[data-action], [data-role="tag-filter"], [data-cat], [data-sort], [data-role="card-swipe"]'
    );
    if (!target) return;

    // 1. data-action 优先
    var action = target.getAttribute('data-action');
    if (action) {
      handleAction(action, target, e);
      return;
    }

    // 2. 标签筛选 chip
    if (target.getAttribute('data-role') === 'tag-filter') {
      var tagId = target.getAttribute('data-tag') || '';
      state.filter.tagId = tagId ? tagId : null;
      state.randomOrder = null;
      updateFilterChips();
      rerenderListOnly();
      return;
    }

    // 3. 品类 chip
    var cat = target.getAttribute('data-cat');
    if (cat) {
      state.filter.category = cat;
      state.randomOrder = null;
      updateFilterChips();
      rerenderListOnly();
      return;
    }

    // 4. 排序 chip
    var sort = target.getAttribute('data-sort');
    if (sort) {
      state.filter.sort = sort;
      // 切换排序时重置随机种子
      if (sort !== 'random') state.randomOrder = null;
      else state.randomOrder = null;
      updateFilterChips();
      rerenderListOnly();
      return;
    }

    // 5. 卡片本身（点击打开详情）
    if (target.getAttribute('data-role') === 'card-swipe') {
      if (state.multiSelectMode) {
        var id = target.getAttribute('data-id');
        if (id) toggleSelection(id);
      } else {
        var cid = target.getAttribute('data-id');
        if (cid) openDetailDrawer(cid);
      }
    }
  }

  /** Action 分发 */
  function handleAction(action, target, e) {
    var App = app();
    var Store = store();
    if (!App || !Store) return;

    switch (action) {
      case 'toggle-multi':
        if (state.multiSelectMode) exitMultiSelectMode();
        else enterMultiSelectMode();
        break;

      case 'exit-multi':
        exitMultiSelectMode();
        break;

      case 'swipe-delete': {
        var id = target.getAttribute('data-id');
        if (id) {
          // 关闭已打开的抽屉（如详情）
          if (state.drawerClose) { try { state.drawerClose(true); } catch (err) {} state.drawerClose = null; }
          confirmDeleteCorpus(id);
        }
        break;
      }

      case 'toggle-select': {
        var sid = target.getAttribute('data-id');
        if (sid) toggleSelection(sid);
        break;
      }

      case 'new-tag-group':
        openTagGroupCreateDrawer();
        break;

      case 'manage-tag-group': {
        var tid = target.getAttribute('data-tag-group-id');
        if (tid) openTagGroupManageDrawer(tid);
        break;
      }

      case 'batch-tag':
        if (anySelected()) openBatchTagDrawer();
        break;

      case 'batch-move':
        if (anySelected()) openBatchMoveDrawer();
        break;

      case 'batch-delete':
        if (anySelected()) confirmBatchDelete();
        break;

      case 'goto-train':
        App.navigate('train');
        break;

      case 'clear-filters':
        state.filter = { category: '全部', tagId: null, keyword: '', sort: 'time-desc' };
        state.randomOrder = null;
        refresh();
        break;

      default:
        break;
    }
  }

  /** 更新筛选 chip 高亮（不重渲整个列表） */
  function updateFilterChips() {
    if (!state.container) return;
    // 品类
    var catChips = state.container.querySelectorAll('[data-cat]');
    catChips.forEach(function (el) {
      if (el.getAttribute('data-cat') === state.filter.category) el.classList.add('is-active');
      else el.classList.remove('is-active');
    });
    // 标签组
    var tagChips = state.container.querySelectorAll('[data-role="tag-filter"]');
    tagChips.forEach(function (el) {
      var v = el.getAttribute('data-tag') || '';
      var cur = state.filter.tagId || '';
      if (v === cur) el.classList.add('is-active');
      else el.classList.remove('is-active');
    });
    // 排序
    var sortChips = state.container.querySelectorAll('[data-sort]');
    sortChips.forEach(function (el) {
      if (el.getAttribute('data-sort') === state.filter.sort) el.classList.add('is-active');
      else el.classList.remove('is-active');
    });
  }

  /** 仅重渲列表 + 批量栏（保留筛选区 DOM 与焦点） */
  function rerenderListOnly() {
    if (!state.container) return;
    var Store = store();
    var tagGroups = Store ? Store.getTagGroups() : [];

    var listEl = state.container.querySelector('.lib-list');
    var emptyEl = state.container.querySelector('.lib-empty');
    if (listEl) {
      listEl.remove();
    }
    if (emptyEl) {
      emptyEl.remove();
    }
    var batchBarEl = state.container.querySelector('.lib-batch-bar');
    if (batchBarEl) batchBarEl.remove();

    // 重新构建列表 + 批量栏 HTML
    var html = renderList(tagGroups) + renderBatchBar();
    state.container.insertAdjacentHTML('beforeend', html);

    // 触发列表入场动画
    playEnterAnimation();
  }

  /* ===================================================================
     九、左滑删除（Pointer Events + setPointerCapture + 1:1 追踪）
     =================================================================== */

  function onPointerDownDelegate(e) {
    if (state.multiSelectMode) return; // 多选模式下禁用
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    var cardEl = e.target.closest('[data-role="card-swipe"]');
    if (!cardEl) return;

    // 不在多选模式下，点击 check 也不应启动 swipe
    if (e.target.closest('[data-action="toggle-select"]')) return;

    // 不响应「删除按钮」上的指针（删除按钮在 swipe 层之外）
    if (e.target.closest('.lib-card__delete')) return;

    startSwipe(cardEl, e);
  }

  function startSwipe(cardEl, e) {
    // 任意时刻只允许一个 swipe 会话
    if (state.activeSwipe) {
      try { cancelActiveSwipe(); } catch (err) {}
    }

    var initialDx = readSwipeDx(cardEl);
    var session = {
      cardEl: cardEl,
      corpusId: cardEl.getAttribute('data-id'),
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startDx: initialDx,
      dx: initialDx,
      horizontalLocked: false,
      canceled: false,
      moved: false
    };
    state.activeSwipe = session;

    try { cardEl.setPointerCapture(e.pointerId); } catch (err) {}
    cardEl.addEventListener('pointermove', onPointerMove);
    cardEl.addEventListener('pointerup', onPointerUp);
    cardEl.addEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(e) {
    var s = state.activeSwipe;
    if (!s || s.canceled) return;
    if (e.pointerId !== s.pointerId) return;

    var rawDx = e.clientX - s.startX;
    var rawDy = e.clientY - s.startY;

    if (!s.horizontalLocked) {
      // 判定方向：垂直超过阈值且大于水平 → 取消（让滚动接管）
      if (Math.abs(rawDy) > SWIPE_VERTICAL_CANCEL && Math.abs(rawDy) > Math.abs(rawDx)) {
        s.canceled = true;
        cleanupSwipeListeners(s);
        try { s.cardEl.releasePointerCapture(s.pointerId); } catch (err) {}
        // 维持原位（不动 transform）
        return;
      }
      // 水平超过阈值 → 锁定为水平 swipe
      if (Math.abs(rawDx) > SWIPE_LOCK_THRESHOLD) {
        s.horizontalLocked = true;
        s.moved = true;
        s.cardEl.classList.add('is-dragging');
        // 移除可能存在的过渡类
        s.cardEl.classList.remove('is-snapping-back');
        // 屏蔽全局 pressable 视觉（避免 scale 与 translateX 冲突）
        s.cardEl.classList.remove('is-pressed');
      } else {
        return; // 未达阈值时不动作
      }
    }

    // 1:1 跟随手指：目标 dx = startDx + rawDx，但仅在负方向应用回弹
    var targetDx = s.startDx + rawDx;

    // 正方向（右滑）直接钳到 0，不露出左侧
    if (targetDx > 0) targetDx = 0;

    var finalDx = targetDx;
    // 超过最大位移（负方向），应用 rubberband
    if (targetDx < -SWIPE_MAX_DRAG) {
      var overshoot = -targetDx - SWIPE_MAX_DRAG; // 正数
      var rubberbanded = rubberband(overshoot, SWIPE_MAX_DRAG);
      finalDx = -(SWIPE_MAX_DRAG + rubberbanded);
    }

    s.dx = finalDx;
    writeSwipeDx(s.cardEl, finalDx);

    // 阻止默认行为以避免触发滚动
    e.preventDefault();
  }

  function onPointerUp(e) {
    var s = state.activeSwipe;
    if (!s) return;
    if (e.pointerId !== s.pointerId) return;

    cleanupSwipeListeners(s);
    try { s.cardEl.releasePointerCapture(s.pointerId); } catch (err) {}

    state.activeSwipe = null;

    if (s.canceled || !s.horizontalLocked) {
      // 未真正拖动或被取消 → 不做改动（不动 transform）
      // 但若 dx 不为 0（残留），归位
      if (Math.abs(s.dx) > 0.5) {
        animateSwipeReset(s.cardEl, 0);
      }
      return;
    }

    s.cardEl.classList.remove('is-dragging');

    // 标记 swipe 刚结束，避免 click 误触发详情
    state.swipeJustEnded = true;
    if (state.swipeJustEndedTimer) clearTimeout(state.swipeJustEndedTimer);
    state.swipeJustEndedTimer = setTimeout(function () {
      state.swipeJustEnded = false;
    }, 120);

    if (s.dx < -SWIPE_DELETE_THRESHOLD) {
      // 超过阈值 → 弹到 -SWIPE_MAX_DRAG 然后弹确认
      animateSwipeTo(s.cardEl, -SWIPE_MAX_DRAG, function () {
        triggerSwipeDeleteConfirm(s.corpusId, s.cardEl);
      });
    } else {
      // 未达阈值 → 弹簧归位（damping 0.8 轻微回弹感）
      animateSwipeReset(s.cardEl, 0);
    }
  }

  function onPointerCancel(e) {
    var s = state.activeSwipe;
    if (!s) return;
    if (e.pointerId !== s.pointerId) return;
    s.canceled = true;
    cleanupSwipeListeners(s);
    try { s.cardEl.releasePointerCapture(s.pointerId); } catch (err) {}
    // 归位
    s.cardEl.classList.remove('is-dragging');
    animateSwipeReset(s.cardEl, 0);
    state.activeSwipe = null;
  }

  function cleanupSwipeListeners(s) {
    if (!s || !s.cardEl) return;
    s.cardEl.removeEventListener('pointermove', onPointerMove);
    s.cardEl.removeEventListener('pointerup', onPointerUp);
    s.cardEl.removeEventListener('pointercancel', onPointerCancel);
  }

  function cancelActiveSwipe() {
    var s = state.activeSwipe;
    if (!s) return;
    cleanupSwipeListeners(s);
    try { s.cardEl.releasePointerCapture(s.pointerId); } catch (err) {}
    s.cardEl.classList.remove('is-dragging');
    animateSwipeReset(s.cardEl, 0);
    state.activeSwipe = null;
  }

  /** 读取 swipe 层当前的 dx（从 CSS 变量） */
  function readSwipeDx(el) {
    var v = el.style.getPropertyValue('--swipe-dx');
    if (!v) return 0;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function writeSwipeDx(el, dx) {
    el.style.setProperty('--swipe-dx', dx + 'px');
  }

  /** 弹簧归位到 targetDx（damping 0.8 轻微回弹） */
  function animateSwipeReset(el, targetDx) {
    if (!el) return;
    if (prefersReducedMotion()) {
      // 简化：200ms opacity+transform
      el.style.transition = 'transform 200ms ease';
      writeSwipeDx(el, targetDx);
      setTimeout(function () {
        el.style.transition = '';
      }, 220);
      return;
    }
    el.classList.add('is-snapping-back');
    writeSwipeDx(el, targetDx);
    // 过渡结束后清理类
    setTimeout(function () {
      el.classList.remove('is-snapping-back');
    }, 340);
  }

  /** 弹簧到指定 dx 后回调 */
  function animateSwipeTo(el, targetDx, callback) {
    if (!el) { if (callback) callback(); return; }
    if (prefersReducedMotion()) {
      el.style.transition = 'transform 200ms ease';
      writeSwipeDx(el, targetDx);
      setTimeout(function () {
        el.style.transition = '';
        if (callback) callback();
      }, 220);
      return;
    }
    el.classList.add('is-snapping-back');
    writeSwipeDx(el, targetDx);
    setTimeout(function () {
      el.classList.remove('is-snapping-back');
      if (callback) callback();
    }, 340);
  }

  /** 触发左滑删除二次确认 */
  function triggerSwipeDeleteConfirm(corpusId, cardEl) {
    var App = app();
    if (!App) {
      // 没有确认弹窗可用 → 直接归位
      animateSwipeReset(cardEl, 0);
      return;
    }
    App.showConfirm(tr('library.confirmDelete'), { danger: true }).then(function (ok) {
      if (ok) {
        var Store = store();
        if (Store) {
          // 删除前给个淡出动画
          if (cardEl && cardEl.parentNode) {
            var cardWrap = cardEl.closest('.lib-card');
            if (cardWrap) {
              cardWrap.style.transition = 'opacity 200ms ease, transform 200ms ease, height 200ms ease, margin 200ms ease';
              cardWrap.style.opacity = '0';
              cardWrap.style.transform = 'translateX(-100%)';
              // 等动画结束后真正删除（由 refresh 重渲）
            }
          }
          setTimeout(function () {
            Store.deleteCorpus(corpusId);
            App.showToast(tr('library.toastDeleted'), 'success');
            // Store.onChange 会触发 refresh
          }, 180);
        }
      } else {
        // 取消 → 归位
        animateSwipeReset(cardEl, 0);
      }
    });
  }

  /** 普通删除按钮点击（不通过 swipe） */
  function confirmDeleteCorpus(corpusId) {
    var App = app();
    var Store = store();
    if (!App || !Store) return;
    App.showConfirm(tr('library.confirmDelete'), { danger: true }).then(function (ok) {
      if (ok) {
        Store.deleteCorpus(corpusId);
        App.showToast(tr('library.toastDeleted'), 'success');
      }
    });
  }

  /* ===================================================================
     十、长按标签组 chip → 管理抽屉
     =================================================================== */

  function bindLongPressOnTagChips() {
    // 在容器上委托 pointerdown
    on(state.container, 'pointerdown', function (e) {
      var chip = e.target.closest('[data-role="tag-filter"][data-tag-group-id]');
      if (!chip) return;

      state.longPressFired = false;
      if (state.longPressTimer) clearTimeout(state.longPressTimer);
      state.longPressTimer = setTimeout(function () {
        state.longPressFired = true;
        chip.classList.add('is-pressed');
        var tid = chip.getAttribute('data-tag-group-id');
        // 触觉反馈（如果可用）
        if (global.navigator && navigator.vibrate) {
          try { navigator.vibrate(10); } catch (err) {}
        }
        openTagGroupManageDrawer(tid);
      }, 500);
    });

    on(state.container, 'pointermove', function (e) {
      // 移动超过 10px → 取消长按
      if (!state.longPressTimer) return;
      if (Math.abs(e.movementX || 0) > 5 || Math.abs(e.movementY || 0) > 5) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
    });

    on(state.container, 'pointerup', function (e) {
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
      // 长按已触发 → 吞掉此次 click
      if (state.longPressFired) {
        state.longPressFired = false;
        // 在 capture 阶段阻止后续 click
        var blocker = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
          state.container.removeEventListener('click', blocker, true);
        };
        state.container.addEventListener('click', blocker, true);
      }
      // 清理 is-pressed
      var chips = state.container.querySelectorAll('.lib-tag-chip.is-pressed');
      chips.forEach(function (c) { c.classList.remove('is-pressed'); });
    });

    on(state.container, 'pointercancel', function () {
      if (state.longPressTimer) { clearTimeout(state.longPressTimer); state.longPressTimer = null; }
    });
  }

  /* ===================================================================
     十一、多选模式
     =================================================================== */

  function enterMultiSelectMode() {
    state.multiSelectMode = true;
    state.selectedIds = {};
    // 取消任何进行中的 swipe
    if (state.activeSwipe) cancelActiveSwipe();

    // 给所有卡片加 is-multi 类
    if (state.container) {
      var cards = state.container.querySelectorAll('.lib-card');
      cards.forEach(function (c) { c.classList.add('is-multi'); });
      // 编辑按钮变「完成」
      var editBtn = state.container.querySelector('.lib-edit-btn');
      if (editBtn) {
        editBtn.textContent = tr('library.done');
        editBtn.classList.add('is-active');
      }
      // 显示批量栏
      var bar = state.container.querySelector('.lib-batch-bar');
      if (bar) {
        bar.hidden = false;
        // 强制 reflow 后加 is-visible（触发弹簧入场）
        void bar.offsetWidth;
        bar.classList.add('is-visible');
      }
      updateBatchBarCount();
    }
  }

  function exitMultiSelectMode() {
    state.multiSelectMode = false;
    state.selectedIds = {};
    if (state.container) {
      var cards = state.container.querySelectorAll('.lib-card');
      cards.forEach(function (c) {
        c.classList.remove('is-multi');
        var check = c.querySelector('.lib-card__check');
        if (check) check.classList.remove('is-on');
      });
      var editBtn = state.container.querySelector('.lib-edit-btn');
      if (editBtn) {
        editBtn.textContent = tr('library.edit');
        editBtn.classList.remove('is-active');
      }
      var bar = state.container.querySelector('.lib-batch-bar');
      if (bar) {
        bar.classList.remove('is-visible');
        setTimeout(function () { if (bar && !state.multiSelectMode) bar.hidden = true; }, 320);
      }
    }
  }

  function toggleSelection(id) {
    if (!state.multiSelectMode) {
      // 自动进入多选模式（点 checkbox 时）
      enterMultiSelectMode();
    }
    if (state.selectedIds[id]) {
      delete state.selectedIds[id];
    } else {
      state.selectedIds[id] = true;
    }
    // 更新对应卡片的勾选 UI
    if (state.container) {
      var card = state.container.querySelector('.lib-card[data-id="' + cssEscape(id) + '"]');
      if (card) {
        var check = card.querySelector('.lib-card__check');
        if (check) {
          if (state.selectedIds[id]) {
            check.classList.add('is-on');
            check.setAttribute('aria-checked', 'true');
          } else {
            check.classList.remove('is-on');
            check.setAttribute('aria-checked', 'false');
          }
        }
      }
    }
    updateBatchBarCount();
  }

  function updateBatchBarCount() {
    if (!state.container) return;
    var bar = state.container.querySelector('.lib-batch-bar');
    if (!bar) return;
    var count = Object.keys(state.selectedIds).length;
    var countEl = bar.querySelector('.lib-batch-bar__count');
    if (countEl) countEl.textContent = tr('library.batchCount', { 0: count });
    // 启用/禁用按钮
    var btns = bar.querySelectorAll('.lib-batch-bar__btn[data-action]');
    btns.forEach(function (b) {
      if (count > 0) b.removeAttribute('disabled');
      else b.setAttribute('disabled', 'disabled');
    });
  }

  function anySelected() {
    return Object.keys(state.selectedIds).length > 0;
  }

  function getSelectedIds() {
    return Object.keys(state.selectedIds);
  }

  /** 简易 CSS 选择器转义（id 形如 corpus_xxx_yyy，基本无需转义，保险起见） */
  function cssEscape(s) {
    return String(s).replace(/(["\\])/g, '\\$1');
  }

  /* ===================================================================
     十二、抽屉：详情编辑 / 标签组管理 / 批量操作
     ===================================================================== */

  /** 单条详情编辑抽屉（4.5） */
  function openDetailDrawer(corpusId) {
    var Store = store();
    var App = app();
    if (!Store || !App) return;
    var corpus = Store.getCorpusById(corpusId);
    if (!corpus) {
      App.showToast(tr('library.toastCorpusNotFound'), 'error');
      return;
    }
    var tagGroups = Store.getTagGroups() || [];

    var wrap = document.createElement('div');
    wrap.className = 'lib-drawer-form';

    // 文本
    wrap.appendChild(buildFormRow(tr('library.formContent'), function (cell) {
      var ta = document.createElement('textarea');
      ta.className = 'textarea';
      ta.value = corpus.text || '';
      ta.setAttribute('data-field', 'text');
      ta.style.minHeight = '160px';
      cell.appendChild(ta);
    }));

    // 品类
    wrap.appendChild(buildFormRow(tr('library.formCategory'), function (cell) {
      var sel = document.createElement('select');
      sel.className = 'select';
      sel.setAttribute('data-field', 'category');
      // 「未分类」选项
      var uncategorized = document.createElement('option');
      uncategorized.value = '';
      uncategorized.textContent = tr('library.formUncategorized');
      if (!corpus.category) uncategorized.selected = true;
      sel.appendChild(uncategorized);
      CATEGORIES.filter(function (c) { return c !== '全部'; }).forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c;
        opt.textContent = catLabel(c);
        if (corpus.category === c) opt.selected = true;
        sel.appendChild(opt);
      });
      cell.appendChild(sel);
    }));

    // 标签 chips 多选
    wrap.appendChild(buildFormRow(tr('library.formTagGroups'), function (cell) {
      var picker = document.createElement('div');
      picker.className = 'lib-tag-picker';
      picker.setAttribute('data-field', 'tagIds');
      var selected = {};
      (corpus.tagIds || []).forEach(function (tid) { selected[tid] = true; });
      tagGroups.forEach(function (g) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'lib-tag-pick pressable' + (selected[g.id] ? ' is-on' : '');
        chip.setAttribute('data-tag-id', g.id);
        chip.style.color = selected[g.id] ? '#fff' : (g.color || '');
        if (selected[g.id]) chip.style.background = (g.color || 'var(--accent)');
        if (selected[g.id]) chip.style.borderColor = (g.color || 'var(--accent)');
        chip.innerHTML = '<span class="lib-tag-pick__dot"></span>' + escapeHtml(g.name);
        chip.addEventListener('click', function () {
          if (selected[g.id]) {
            delete selected[g.id];
            chip.classList.remove('is-on');
            chip.style.background = '';
            chip.style.borderColor = '';
            chip.style.color = g.color || '';
          } else {
            selected[g.id] = true;
            chip.classList.add('is-on');
            chip.style.background = (g.color || 'var(--accent)');
            chip.style.borderColor = (g.color || 'var(--accent)');
            chip.style.color = '#fff';
          }
        });
        picker.appendChild(chip);
      });
      if (!tagGroups.length) {
        var hint = document.createElement('div');
        hint.style.color = 'var(--text-tertiary)';
        hint.style.fontSize = 'var(--fs-caption)';
        hint.textContent = tr('library.noTagGroupsHint');
        picker.appendChild(hint);
      }
      cell.appendChild(picker);
    }));

    // 操作按钮
    var actions = document.createElement('div');
    actions.className = 'lib-drawer-actions';
    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger pressable';
    deleteBtn.textContent = tr('library.cardDelete');
    deleteBtn.addEventListener('click', function () {
      App.showConfirm(tr('library.confirmDelete'), { danger: true }).then(function (ok) {
        if (ok) {
          Store.deleteCorpus(corpusId);
          App.showToast(tr('library.toastDeleted'), 'success');
          if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
        }
      });
    });

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary pressable';
    saveBtn.textContent = tr('library.btnSave');
    saveBtn.addEventListener('click', function () {
      var text = wrap.querySelector('[data-field="text"]').value.trim();
      if (!text) { App.showToast(tr('library.toastContentEmpty'), 'error'); return; }
      var category = wrap.querySelector('[data-field="category"]').value;
      var tagIds = [];
      var picker = wrap.querySelector('[data-field="tagIds"]');
      var chips = picker.querySelectorAll('.lib-tag-pick.is-on');
      chips.forEach(function (c) { tagIds.push(c.getAttribute('data-tag-id')); });

      Store.updateCorpus(corpusId, { text: text, category: category, tagIds: tagIds });
      App.showToast(tr('library.toastSaved'), 'success');
      if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
    });

    actions.appendChild(deleteBtn);
    actions.appendChild(saveBtn);
    wrap.appendChild(actions);

    state.drawerClose = App.showDrawer(wrap, {
      title: tr('library.drawerEditTitle'),
      onClose: function () {
        state.drawerClose = null;
      }
    });
  }

  /** 新建标签组抽屉（4.7） */
  function openTagGroupCreateDrawer() {
    var App = app();
    var Store = store();
    if (!App || !Store) return;

    var wrap = document.createElement('div');
    wrap.className = 'lib-drawer-form';

    var nameRef = { el: null };
    var descRef = { el: null };
    var colorRef = { value: PRESET_COLORS[0] };

    wrap.appendChild(buildFormRow(tr('library.formName'), function (cell) {
      var inp = document.createElement('input');
      inp.className = 'input';
      inp.type = 'text';
      inp.placeholder = tr('library.namePlaceholder');
      inp.maxLength = 16;
      cell.appendChild(inp);
      nameRef.el = inp;
    }));

    wrap.appendChild(buildFormRow(tr('library.formDescOptional'), function (cell) {
      var ta = document.createElement('textarea');
      ta.className = 'textarea';
      ta.placeholder = tr('library.descPlaceholder');
      ta.maxLength = 60;
      ta.style.minHeight = '80px';
      cell.appendChild(ta);
      descRef.el = ta;
    }));

    wrap.appendChild(buildFormRow(tr('library.formColor'), function (cell) {
      var palette = document.createElement('div');
      palette.className = 'lib-color-palette';
      PRESET_COLORS.forEach(function (c, i) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'lib-color-swatch pressable' + (i === 0 ? ' is-on' : '');
        sw.style.background = c;
        sw.setAttribute('data-color', c);
        sw.setAttribute('aria-label', tr('library.colorAria', { 0: c }));
        sw.addEventListener('click', function () {
          colorRef.value = c;
          palette.querySelectorAll('.lib-color-swatch').forEach(function (s) { s.classList.remove('is-on'); });
          sw.classList.add('is-on');
        });
        palette.appendChild(sw);
      });
      cell.appendChild(palette);
    }));

    var actions = document.createElement('div');
    actions.className = 'lib-drawer-actions';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn pressable';
    cancelBtn.textContent = tr('library.btnCancel');
    cancelBtn.addEventListener('click', function () {
      if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
    });
    var createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'btn btn-primary pressable';
    createBtn.textContent = tr('library.btnCreate');
    createBtn.addEventListener('click', function () {
      var name = (nameRef.el.value || '').trim();
      if (!name) { App.showToast(tr('library.toastNameRequired'), 'error'); return; }
      Store.addTagGroup({ name: name, description: (descRef.el.value || '').trim(), color: colorRef.value });
      App.showToast(tr('library.toastTagGroupCreated'), 'success');
      if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);
    wrap.appendChild(actions);

    state.drawerClose = App.showDrawer(wrap, {
      title: tr('library.drawerNewTagGroupTitle'),
      onClose: function () { state.drawerClose = null; }
    });
  }

  /** 管理（重命名/删除）标签组抽屉（4.7） */
  function openTagGroupManageDrawer(tagGroupId) {
    var App = app();
    var Store = store();
    if (!App || !Store) return;
    var g = Store.getTagGroupById(tagGroupId);
    if (!g) {
      App.showToast(tr('library.toastTagGroupNotFound'), 'error');
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'lib-drawer-form';

    var nameRef = { el: null };
    var descRef = { el: null };
    var colorRef = { value: g.color || PRESET_COLORS[0] };

    wrap.appendChild(buildFormRow(tr('library.formName'), function (cell) {
      var inp = document.createElement('input');
      inp.className = 'input';
      inp.type = 'text';
      inp.value = g.name || '';
      inp.maxLength = 16;
      cell.appendChild(inp);
      nameRef.el = inp;
    }));

    wrap.appendChild(buildFormRow(tr('library.formDescOptional'), function (cell) {
      var ta = document.createElement('textarea');
      ta.className = 'textarea';
      ta.value = g.description || '';
      ta.maxLength = 60;
      ta.style.minHeight = '80px';
      cell.appendChild(ta);
      descRef.el = ta;
    }));

    wrap.appendChild(buildFormRow(tr('library.formColor'), function (cell) {
      var palette = document.createElement('div');
      palette.className = 'lib-color-palette';
      PRESET_COLORS.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'lib-color-swatch pressable' + (c === colorRef.value ? ' is-on' : '');
        sw.style.background = c;
        sw.setAttribute('data-color', c);
        sw.addEventListener('click', function () {
          colorRef.value = c;
          palette.querySelectorAll('.lib-color-swatch').forEach(function (s) { s.classList.remove('is-on'); });
          sw.classList.add('is-on');
        });
        palette.appendChild(sw);
      });
      cell.appendChild(palette);
    }));

    // 预置标签组提示
    if (g.isPreset) {
      var note = document.createElement('div');
      note.style.fontSize = 'var(--fs-caption)';
      note.style.color = 'var(--text-tertiary)';
      note.textContent = tr('library.presetNote');
      wrap.appendChild(note);
    }

    var actions = document.createElement('div');
    actions.className = 'lib-drawer-actions';

    // 删除按钮（仅非预置）
    if (!g.isPreset) {
      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger pressable';
      deleteBtn.textContent = tr('library.cardDelete');
      deleteBtn.addEventListener('click', function () {
        App.showConfirm(tr('library.confirmDeleteTagGroup'), { danger: true }).then(function (ok) {
          if (ok) {
            Store.deleteTagGroup(tagGroupId);
            // 若当前筛选用的就是这个标签，清除
            if (state.filter.tagId === tagGroupId) state.filter.tagId = null;
            App.showToast(tr('library.toastTagGroupDeleted'), 'success');
            if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
          }
        });
      });
      actions.appendChild(deleteBtn);
    }

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary pressable';
    saveBtn.textContent = tr('library.btnSave');
    saveBtn.addEventListener('click', function () {
      var name = (nameRef.el.value || '').trim();
      if (!name) { App.showToast(tr('library.toastNameRequired'), 'error'); return; }
      Store.updateTagGroup(tagGroupId, {
        name: name,
        description: (descRef.el.value || '').trim(),
        color: colorRef.value
      });
      App.showToast(tr('library.toastSaved'), 'success');
      if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
    });
    actions.appendChild(saveBtn);

    if (!g.isPreset) {
      // 已有删除 + 保存两个按钮
    } else {
      // 预置组只有保存
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn pressable';
      cancelBtn.textContent = tr('library.btnCancel');
      cancelBtn.addEventListener('click', function () {
        if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
      });
      actions.insertBefore(cancelBtn, saveBtn);
    }

    wrap.appendChild(actions);

    state.drawerClose = App.showDrawer(wrap, {
      title: tr('library.drawerEditTagGroupTitle'),
      onClose: function () { state.drawerClose = null; }
    });
  }

  /** 批量打标签抽屉（4.6） */
  function openBatchTagDrawer() {
    var App = app();
    var Store = store();
    if (!App || !Store) return;
    var tagGroups = Store.getTagGroups() || [];
    var selected = {}; // 此抽屉内勾选状态

    var wrap = document.createElement('div');
    wrap.className = 'lib-drawer-form';

    var hint = document.createElement('div');
    hint.style.fontSize = 'var(--fs-body)';
    hint.style.color = 'var(--text-secondary)';
    hint.style.lineHeight = 'var(--leading-body)';
    hint.textContent = tr('library.batchTagHint', { 0: getSelectedIds().length });
    wrap.appendChild(hint);

    wrap.appendChild(buildFormRow(tr('library.formLabelTagGroup'), function (cell) {
      var picker = document.createElement('div');
      picker.className = 'lib-tag-picker';
      tagGroups.forEach(function (g) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'lib-tag-pick pressable';
        chip.setAttribute('data-tag-id', g.id);
        chip.style.color = g.color || '';
        chip.innerHTML = '<span class="lib-tag-pick__dot"></span>' + escapeHtml(g.name);
        chip.addEventListener('click', function () {
          if (selected[g.id]) {
            delete selected[g.id];
            chip.classList.remove('is-on');
            chip.style.background = '';
            chip.style.borderColor = '';
            chip.style.color = g.color || '';
          } else {
            selected[g.id] = true;
            chip.classList.add('is-on');
            chip.style.background = (g.color || 'var(--accent)');
            chip.style.borderColor = (g.color || 'var(--accent)');
            chip.style.color = '#fff';
          }
        });
        picker.appendChild(chip);
      });
      if (!tagGroups.length) {
        var empty = document.createElement('div');
        empty.style.color = 'var(--text-tertiary)';
        empty.style.fontSize = 'var(--fs-caption)';
        empty.textContent = tr('library.noTagGroups');
        picker.appendChild(empty);
      }
      cell.appendChild(picker);
    }));

    var actions = document.createElement('div');
    actions.className = 'lib-drawer-actions';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn pressable';
    cancelBtn.textContent = tr('library.btnCancel');
    cancelBtn.addEventListener('click', function () {
      if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
    });
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary pressable';
    confirmBtn.textContent = tr('library.batchAdd');
    confirmBtn.addEventListener('click', function () {
      var ids = getSelectedIds();
      var toAdd = Object.keys(selected);
      if (!toAdd.length) { App.showToast(tr('library.toastSelectTagGroup'), 'error'); return; }
      ids.forEach(function (id) {
        var c = Store.getCorpusById(id);
        if (!c) return;
        var exist = Array.isArray(c.tagIds) ? c.tagIds.slice() : [];
        toAdd.forEach(function (tid) { if (exist.indexOf(tid) === -1) exist.push(tid); });
        Store.updateCorpus(id, { tagIds: exist });
      });
      App.showToast(tr('library.toastTagsAdded', { 0: ids.length }), 'success');
      if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
      exitMultiSelectMode();
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    wrap.appendChild(actions);

    state.drawerClose = App.showDrawer(wrap, {
      title: tr('library.batchTagTitle'),
      onClose: function () { state.drawerClose = null; }
    });
  }

  /** 批量移动到标签组抽屉（4.6，替换 tagIds 为单个） */
  function openBatchMoveDrawer() {
    var App = app();
    var Store = store();
    if (!App || !Store) return;
    var tagGroups = Store.getTagGroups() || [];
    var picked = { id: null };

    var wrap = document.createElement('div');
    wrap.className = 'lib-drawer-form';

    var hint = document.createElement('div');
    hint.style.fontSize = 'var(--fs-body)';
    hint.style.color = 'var(--text-secondary)';
    hint.style.lineHeight = 'var(--leading-body)';
    hint.textContent = tr('library.batchMoveHint', { 0: getSelectedIds().length });
    wrap.appendChild(hint);

    wrap.appendChild(buildFormRow(tr('library.formTargetTagGroup'), function (cell) {
      var picker = document.createElement('div');
      picker.className = 'lib-tag-picker';
      tagGroups.forEach(function (g) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'lib-tag-pick pressable';
        chip.setAttribute('data-tag-id', g.id);
        chip.style.color = g.color || '';
        chip.innerHTML = '<span class="lib-tag-pick__dot"></span>' + escapeHtml(g.name);
        chip.addEventListener('click', function () {
          picked.id = g.id;
          picker.querySelectorAll('.lib-tag-pick').forEach(function (c) {
            c.classList.remove('is-on');
            c.style.background = '';
            c.style.borderColor = '';
            c.style.color = g.color || '';
          });
          chip.classList.add('is-on');
          chip.style.background = (g.color || 'var(--accent)');
          chip.style.borderColor = (g.color || 'var(--accent)');
          chip.style.color = '#fff';
        });
        picker.appendChild(chip);
      });
      if (!tagGroups.length) {
        var empty = document.createElement('div');
        empty.style.color = 'var(--text-tertiary)';
        empty.style.fontSize = 'var(--fs-caption)';
        empty.textContent = tr('library.noTagGroups');
        picker.appendChild(empty);
      }
      cell.appendChild(picker);
    }));

    var actions = document.createElement('div');
    actions.className = 'lib-drawer-actions';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn pressable';
    cancelBtn.textContent = tr('library.btnCancel');
    cancelBtn.addEventListener('click', function () {
      if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
    });
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary pressable';
    confirmBtn.textContent = tr('library.batchMove');
    confirmBtn.addEventListener('click', function () {
      if (!picked.id) { App.showToast(tr('library.toastPickTagGroup'), 'error'); return; }
      var ids = getSelectedIds();
      ids.forEach(function (id) {
        Store.updateCorpus(id, { tagIds: [picked.id] });
      });
      App.showToast(tr('library.toastMoved', { 0: ids.length }), 'success');
      if (state.drawerClose) { try { state.drawerClose(true); } catch (e) {} state.drawerClose = null; }
      exitMultiSelectMode();
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    wrap.appendChild(actions);

    state.drawerClose = App.showDrawer(wrap, {
      title: tr('library.batchMoveTitle'),
      onClose: function () { state.drawerClose = null; }
    });
  }

  /** 批量删除二次确认（4.6） */
  function confirmBatchDelete() {
    var App = app();
    var Store = store();
    if (!App || !Store) return;
    var ids = getSelectedIds();
    if (!ids.length) return;
    App.showConfirm(tr('library.confirmBatchDelete', { 0: ids.length }), { danger: true }).then(function (ok) {
      if (ok) {
        Store.deleteCorpusBatch(ids);
        App.showToast(tr('library.toastBatchDeleted', { 0: ids.length }), 'success');
        exitMultiSelectMode();
      }
    });
  }

  /** 工具：构建表单行 */
  function buildFormRow(label, buildContent) {
    var row = document.createElement('div');
    row.className = 'lib-form-row';
    var lab = document.createElement('div');
    lab.className = 'lib-form-label';
    lab.textContent = label;
    row.appendChild(lab);
    var cell = document.createElement('div');
    row.appendChild(cell);
    if (typeof buildContent === 'function') buildContent(cell);
    return row;
  }

  /* ===================================================================
     十三、入场动画
     =================================================================== */

  function playEnterAnimation() {
    if (!state.container) return;
    clearEnterTimers();

    var cards = state.container.querySelectorAll('.lib-card:not(.is-entered)');
    if (!cards.length) return;

    var reduceMotion = prefersReducedMotion();
    var delay = 0;
    for (var i = 0; i < cards.length; i++) {
      (function (el, d) {
        var t = setTimeout(function () {
          el.classList.add('is-entered');
        }, reduceMotion ? 0 : d);
        state.enterTimers.push(t);
      })(cards[i], delay);
      delay += 40;
      // 最多前 12 张错峰，其余立即显示
      if (i >= 11) delay = 0;
    }
  }

  /* ===================================================================
     十四、视图契约：mount / unmount / refresh
     =================================================================== */

  function mount(container) {
    state.container = container || document.querySelector('.view[data-view="library"]');
    if (!state.container) return;

    // 重置一次性状态（保留 filter / multiSelect / selectedIds 在重新 mount 时也重置）
    state.filter = { category: '全部', tagId: null, keyword: '', sort: 'time-desc' };
    state.multiSelectMode = false;
    state.selectedIds = {};
    state.randomOrder = null;
    state.activeSwipe = null;
    state.swipeJustEnded = false;

    render();
    bindEvents();

    state.rafId = requestAnimationFrame(function () {
      playEnterAnimation();
    });
  }

  function unmount() {
    // 取消任何进行中的 swipe
    if (state.activeSwipe) {
      try { cancelActiveSwipe(); } catch (e) {}
    }

    // 关闭已打开的抽屉
    if (state.drawerClose) {
      try { state.drawerClose(true); } catch (e) {}
      state.drawerClose = null;
    }

    clearListeners();
    clearEnterTimers();
    clearMiscTimers();

    if (state.unsubStore) {
      try { state.unsubStore(); } catch (e) {}
      state.unsubStore = null;
    }
    if (state.unsubRoute) {
      try { state.unsubRoute(); } catch (e) {}
      state.unsubRoute = null;
    }

    // 清空 DOM 引用
    state.container = null;
    state.rendered = false;
    state.activeSwipe = null;
  }

  function refresh() {
    if (!state.container) return;

    // 若有 swipe 进行中，先归位（避免 DOM 被替换造成卡片残留位移）
    if (state.activeSwipe) {
      try { cancelActiveSwipe(); } catch (e) {}
    }

    // 保留滚动位置
    var scrollTop = state.container.scrollTop;

    // 保留筛选 / 排序 / 多选状态（state 中已存）
    render();

    // 已渲染的卡片直接置为 entered，避免视觉跳动
    if (state.container) {
      var cards = state.container.querySelectorAll('.lib-card:not(.is-entered)');
      cards.forEach(function (c) { c.classList.add('is-entered'); });
      // 恢复滚动位置
      state.container.scrollTop = scrollTop;

      // 多选模式下重新加 is-multi 类
      if (state.multiSelectMode) {
        var allCards = state.container.querySelectorAll('.lib-card');
        allCards.forEach(function (c) {
          c.classList.add('is-multi');
          var id = c.getAttribute('data-id');
          var check = c.querySelector('.lib-card__check');
          if (check) {
            if (state.selectedIds[id]) {
              check.classList.add('is-on');
              check.setAttribute('aria-checked', 'true');
            } else {
              check.classList.remove('is-on');
              check.setAttribute('aria-checked', 'false');
            }
          }
        });
        // 编辑按钮文案
        var editBtn = state.container.querySelector('.lib-edit-btn');
        if (editBtn) {
          editBtn.textContent = tr('library.done');
          editBtn.classList.add('is-active');
        }
        // 批量栏显示
        var bar = state.container.querySelector('.lib-batch-bar');
        if (bar) {
          bar.hidden = false;
          void bar.offsetWidth;
          bar.classList.add('is-visible');
        }
        updateBatchBarCount();
      }
    }
  }

  /* ===================================================================
     十五、注册视图
     =================================================================== */

  if (global.App && typeof global.App.registerView === 'function') {
    global.App.registerView('library', {
      mount: mount,
      unmount: unmount,
      refresh: refresh
    });
  } else {
    // app.js 尚未加载，延迟注册
    global.addEventListener('DOMContentLoaded', function () {
      if (global.App && typeof global.App.registerView === 'function') {
        global.App.registerView('library', {
          mount: mount,
          unmount: unmount,
          refresh: refresh
        });
      }
    });
  }

})(typeof window !== 'undefined' ? window : this);
