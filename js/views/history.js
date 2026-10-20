/* =====================================================================
   点评 AI 评价生成器 · 历史记录视图
   纯原生 JS · App.registerView('history', {mount, unmount, refresh})
   功能：倒序列表 / 筛选 / 详情抽屉 / 编辑/复制/收藏/删除 / 点赞点踩 / 空状态
   ===================================================================== */
(function (global) {
  'use strict';

  /* ===================================================================
     一、注入视图专属样式（不改 main.css）
     =================================================================== */
  var STYLE_ID = 'history-view-styles';
  if (!document.getElementById(STYLE_ID)) {
    var styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = [
      '/* 历史视图布局 */',
      '.history-view { display: flex; flex-direction: column; gap: var(--space-3); }',
      '.history-filter {',
      '  display: flex; align-items: center; gap: var(--space-2);',
      '  overflow-x: auto; padding: var(--space-1) 0 var(--space-2);',
      '  -webkit-overflow-scrolling: touch;',
      '  scrollbar-width: none;',
      '}',
      '.history-filter::-webkit-scrollbar { display: none; }',
      '.history-filter .chip { flex: 0 0 auto; }',
      '.history-list { display: flex; flex-direction: column; gap: var(--space-3); }',
      '',
      '/* 卡片 */',
      '.history-card { position: relative; padding: var(--space-4); cursor: pointer; transition: box-shadow 200ms var(--ease-out), transform 100ms ease-out; }',
      '.history-card:active { transform: scale(0.985); }',
      '@media (hover: hover) { .history-card:hover { box-shadow: var(--shadow-strong); } }',
      '.history-card__fav {',
      '  position: absolute; top: 14px; right: 14px;',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  width: 28px; height: 28px; border-radius: 50%;',
      '  color: var(--text-tertiary);',
      '  transition: color 160ms var(--ease-out);',
      '}',
      '.history-card__fav.is-on { color: #ff3b30; animation: hist-fav-pop 420ms var(--spring-bouncy) both; }',
      '@keyframes hist-fav-pop {',
      '  0% { transform: scale(0.6); }',
      '  55% { transform: scale(1.25); }',
      '  100% { transform: scale(1); }',
      '}',
      '.history-card__header { margin-bottom: var(--space-2); padding-right: 32px; }',
      '.history-card__merchant {',
      '  font-size: var(--fs-headline); font-weight: 600;',
      '  letter-spacing: var(--tracking-display); line-height: var(--leading-tight);',
      '  color: var(--text-primary); margin-bottom: 4px;',
      '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
      '}',
      '.history-card__meta { display: flex; align-items: center; gap: var(--space-2); }',
      '.history-card__time { font-size: var(--fs-caption); color: var(--text-tertiary); }',
      '.history-card__chips {',
      '  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;',
      '  margin-bottom: var(--space-2);',
      '}',
      '.chip--readonly {',
      '  cursor: default; pointer-events: none;',
      '  background: rgba(60, 60, 67, 0.06); color: var(--text-secondary);',
      '  border-color: transparent;',
      '}',
      '.history-card__feedback {',
      '  font-size: 13px; line-height: 1;',
      '  padding: 3px 8px; border-radius: var(--radius-pill);',
      '  background: rgba(60, 60, 67, 0.08);',
      '}',
      '.history-card__preview {',
      '  font-size: var(--fs-body); line-height: var(--leading-body);',
      '  color: var(--text-secondary);',
      '  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;',
      '  overflow: hidden;',
      '}',
      '',
      '/* 卡片入场动画（弹簧重排感） —— 仅首次挂载时触发，refresh 不重播 */',
      '.history-list .history-card {',
      '  animation: hist-card-in 380ms var(--spring-default) both;',
      '}',
      '.history-list--refresh .history-card {',
      '  animation: none !important;',
      '}',
      '@keyframes hist-card-in {',
      '  from { opacity: 0; transform: translateY(8px) scale(0.985); }',
      '  to   { opacity: 1; transform: translateY(0) scale(1); }',
      '}',
      '/* 删除退出动画：高度坍塌 + 淡出 */',
      '.history-card.is-leaving {',
      '  animation: hist-card-out 260ms var(--ease-out) forwards;',
      '  pointer-events: none;',
      '}',
      '@keyframes hist-card-out {',
      '  0% { opacity: 1; transform: scale(1); max-height: 200px; }',
      '  60% { opacity: 0; transform: scale(0.96); }',
      '  100% { opacity: 0; transform: scale(0.96); max-height: 0; margin: 0; padding: 0; border: 0; }',
      '}',
      '',
      '/* 空状态 */',
      '.history-empty {',
      '  display: flex; flex-direction: column; align-items: center; justify-content: center;',
      '  text-align: center; gap: var(--space-3);',
      '  padding: var(--space-8) var(--space-4);',
      '}',
      '.history-empty--filtered { padding: var(--space-6) var(--space-4); }',
      '.history-empty__art {',
      '  display: flex; align-items: center; justify-content: center;',
      '  margin-bottom: var(--space-2);',
      '}',
      '.history-empty__title {',
      '  font-size: var(--fs-headline); font-weight: 600;',
      '  letter-spacing: var(--tracking-display); color: var(--text-primary);',
      '}',
      '.history-empty__desc { font-size: var(--fs-body); color: var(--text-tertiary); max-width: 280px; }',
      '.history-empty__btn { margin-top: var(--space-2); min-width: 140px; }',
      '',
      '/* 详情抽屉内容 */',
      '.history-detail { display: flex; flex-direction: column; gap: var(--space-3); }',
      '.history-detail__meta {',
      '  padding: var(--space-3) var(--space-4);',
      '  background: rgba(60, 60, 67, 0.05); border-radius: var(--radius-md);',
      '}',
      '.history-detail__merchant {',
      '  font-size: var(--fs-title); font-weight: 600;',
      '  letter-spacing: var(--tracking-display); line-height: var(--leading-tight);',
      '  color: var(--text-primary); margin-bottom: var(--space-2);',
      '}',
      '.history-detail__row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }',
      '.history-detail__time { font-size: var(--fs-caption); color: var(--text-tertiary); margin-left: auto; }',
      '.history-detail__content {',
      '  min-height: 160px; line-height: var(--leading-body);',
      '  font-size: var(--fs-body);',
      '}',
      '.history-detail__feedback {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  gap: var(--space-3); padding: var(--space-3) var(--space-4);',
      '  background: rgba(60, 60, 67, 0.05); border-radius: var(--radius-md);',
      '}',
      '.history-detail__feedback-label { font-size: var(--fs-body); color: var(--text-secondary); }',
      '.history-detail__feedback-btns { display: flex; gap: var(--space-2); }',
      '.history-detail__actions {',
      '  display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2);',
      '  margin-top: var(--space-2);',
      '}',
      '.history-detail__actions .btn { width: 100%; }',
      '.history-detail__actions [data-action="save"] { grid-column: 1 / -1; }',
      '.history-detail__actions [data-action="delete"] { grid-column: 1 / -1; }',
      '',
      '/* reduced-motion：卡片入场变淡入，退出动画精简 */',
      '@media (prefers-reduced-motion: reduce) {',
      '  .history-card { animation: hist-card-in-reduced 200ms ease both !important; }',
      '  .history-card.is-leaving { animation: hist-card-out-reduced 150ms ease forwards !important; }',
      '  .history-card__fav.is-on { animation: none !important; }',
      '}',
      '@keyframes hist-card-in-reduced { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes hist-card-out-reduced { from { opacity: 1; } to { opacity: 0; max-height: 0; } }'
    ].join('\n');
    document.head.appendChild(styleEl);
  }

  /* ===================================================================
     二、状态
     =================================================================== */

  var state = {
    container: null,
    filterFavoriteOnly: false,
    filterCategory: 'all',
    drawerItem: null,
    drawerClose: null,
    drawerBody: null,
    listeners: [],
    suppressRefresh: false  // 删除动画期间抑制 refresh 全量重渲，避免竞态导致卡片乱跳
  };

  /* ===================================================================
     三、工具
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

  function tr(key, params) {
    var i = global.I18n;
    return (i && typeof i.t === 'function') ? i.t(key, params) : key;
  }

  var CATEGORY_KEYS = {
    '美食': 'history.catFood',
    '甜品饮品': 'history.catDessert',
    '美发': 'history.catHair',
    '酒店': 'history.catHotel',
    '休闲': 'history.catLeisure',
    '健身': 'history.catFitness',
    '电影': 'history.catMovie',
    '亲子': 'history.catParentChild',
    '购物': 'history.catShopping',
    '美甲美睫': 'history.catNails',
    'KTV': 'history.catKtv',
    '其他': 'history.catOther'
  };

  function categoryLabel(cat) {
    if (!cat) return '';
    var key = CATEGORY_KEYS[cat];
    return key ? tr(key) : cat;
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    var ts = new Date(iso).getTime();
    if (isNaN(ts)) return '';
    var diff = Date.now() - ts;
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return tr('history.timeJustNow');
    var min = Math.floor(sec / 60);
    if (min < 60) return tr('history.timeMinutesAgo', {0: min});
    var hr = Math.floor(min / 60);
    if (hr < 24) return tr('history.timeHoursAgo', {0: hr});
    var day = Math.floor(hr / 24);
    if (day < 30) return tr('history.timeDaysAgo', {0: day});
    var d = new Date(ts);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function previewContent(text) {
    text = text || '';
    if (text.length <= 100) return text;
    return text.slice(0, 100) + '…';
  }

  function renderStarsHtml(stars) {
    stars = stars || 0;
    var html = '<span class="stars" aria-label="' + escapeHtml(tr('history.starsAria', {0: stars})) + '">';
    for (var i = 1; i <= 5; i++) {
      html += '<span class="star' + (i <= stars ? ' is-on' : '') + '">★</span>';
    }
    html += '</span>';
    return html;
  }

  function favIconSvg(filled) {
    if (filled) {
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 14L2.5 8.5C0.8 6.8 0.8 4 2.5 2.3C4.2 0.6 7 0.6 8 2.3C9 0.6 11.8 0.6 13.5 2.3C15.2 4 15.2 6.8 13.5 8.5L8 14Z"/></svg>';
    }
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 14L2.5 8.5C0.8 6.8 0.8 4 2.5 2.3C4.2 0.6 7 0.6 8 2.3C9 0.6 11.8 0.6 13.5 2.3C15.2 4 15.2 6.8 13.5 8.5L8 14Z" stroke="currentColor" stroke-width="1.4"/></svg>';
  }

  function getCategories(history) {
    var set = {};
    var list = [];
    history.forEach(function (h) {
      if (h.category && !set[h.category]) {
        set[h.category] = true;
        list.push(h.category);
      }
    });
    return list;
  }

  function findHistory(id) {
    var list = global.Store ? global.Store.getHistory() : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function copyToClipboard(text) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  /* ===================================================================
     四、列表渲染
     =================================================================== */

  function getFilteredHistory() {
    var list = global.Store ? global.Store.getHistory() : [];
    if (state.filterFavoriteOnly) {
      list = list.filter(function (h) { return !!h.favorited; });
    }
    if (state.filterCategory !== 'all') {
      list = list.filter(function (h) { return h.category === state.filterCategory; });
    }
    list.sort(function (a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return list;
  }

  function renderEmptyState(container) {
    container.innerHTML =
      '<div class="history-empty">' +
        '<div class="history-empty__art" aria-hidden="true">' +
          '<svg width="96" height="96" viewBox="0 0 96 96" fill="none">' +
            '<circle cx="48" cy="48" r="40" fill="#FF9500" fill-opacity="0.12"/>' +
            '<path d="M30 40C30 36 33 33 37 33C41 33 44 36 44 40" stroke="#FF9500" stroke-width="2.4" stroke-linecap="round"/>' +
            '<path d="M52 40C52 36 55 33 59 33C63 33 66 36 66 40" stroke="#FF9500" stroke-width="2.4" stroke-linecap="round"/>' +
            '<path d="M32 56C36 62 42 65 48 65C54 65 60 62 64 56" stroke="#FF9500" stroke-width="2.4" stroke-linecap="round"/>' +
          '</svg>' +
        '</div>' +
        '<div class="history-empty__title">' + escapeHtml(tr('history.emptyTitle')) + '</div>' +
        '<div class="history-empty__desc">' + escapeHtml(tr('history.emptyDesc')) + '</div>' +
        '<button class="btn btn-primary pressable history-empty__btn" type="button" data-action="go-generate">' + escapeHtml(tr('history.emptyCta')) + '</button>' +
      '</div>';
  }

  function renderList(container) {
    var allHistory = global.Store ? global.Store.getHistory() : [];
    var list = getFilteredHistory();
    var categories = getCategories(allHistory);

    // 判断是否为刷新（容器已有 .history-view）：刷新时不重播入场动画，避免删除后卡片跳动
    var isRefresh = !!container.querySelector('.history-view');

    var html = '<div class="history-view">';

    // 筛选栏
    html += '<div class="history-filter">';
    html += '<button class="chip pressable' + (state.filterFavoriteOnly ? ' is-active' : '') + '" type="button" data-action="toggle-favorite">' +
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="' + (state.filterFavoriteOnly ? 'currentColor' : 'none') + '" aria-hidden="true">' +
        '<path d="M7 12L2.5 7.8C1 6.4 1 4.2 2.5 2.8C4 1.4 6.2 1.4 7 3C7.8 1.4 10 1.4 11.5 2.8C13 4.2 13 6.4 11.5 7.8L7 12Z" stroke="currentColor" stroke-width="1.4"/>' +
      '</svg>' +
      escapeHtml(tr('history.filterFavorite')) + '</button>';
    html += '<button class="chip pressable' + (state.filterCategory === 'all' ? ' is-active' : '') + '" type="button" data-action="filter-category" data-category="all">' + escapeHtml(tr('history.filterAll')) + '</button>';
    categories.forEach(function (cat) {
      html += '<button class="chip pressable' + (state.filterCategory === cat ? ' is-active' : '') + '" type="button" data-action="filter-category" data-category="' + escapeHtml(cat) + '">' + escapeHtml(categoryLabel(cat)) + '</button>';
    });
    html += '</div>';

    if (list.length === 0) {
      html += '<div class="history-empty history-empty--filtered">' +
        '<div class="history-empty__title">' + escapeHtml(tr('history.emptyFilteredTitle')) + '</div>' +
        '<div class="history-empty__desc">' + escapeHtml(tr('history.emptyFilteredDesc')) + '</div>' +
      '</div>';
    } else {
      // 刷新时给 .history-list 加 --refresh 修饰符，CSS 中禁用入场动画
      html += '<div class="history-list' + (isRefresh ? ' history-list--refresh' : '') + '">';
      list.forEach(function (item, idx) {
        html += renderCardHtml(item, idx);
      });
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  /**
   * 直接从 DOM 移除指定卡片（带退出动画），不触发全量重渲。
   * 用于删除时即时反馈，避免整列重建造成的卡顿与跳动。
   * 返回 true 表示找到并移除了卡片。
   */
  function removeCardFromDom(id) {
    if (!state.container) return false;
    var card = state.container.querySelector('.history-card[data-id="' + cssEscape(id) + '"]');
    if (!card) return false;

    // 抑制 Store.onChange 触发的 refresh 全量重渲，避免与退出动画竞态导致卡片乱跳
    state.suppressRefresh = true;

    // 退出动画结束后移除节点；若动画不支持则直接移除
    card.classList.add('is-leaving');
    var removed = false;
    function finalize() {
      if (removed) return;
      removed = true;
      if (card.parentNode) card.parentNode.removeChild(card);
      // 解除抑制
      state.suppressRefresh = false;
      // 若列表变空，重渲为空状态；否则刷新筛选栏（分类可能需要更新）
      var remaining = state.container.querySelectorAll('.history-card');
      if (remaining.length === 0) {
        renderList(state.container);
      } else {
        // 静默刷新筛选栏（不重渲卡片列表，避免跳动）
        refreshFilterBarOnly();
      }
    }
    // 监听动画结束
    if (typeof card.addEventListener === 'function') {
      card.addEventListener('animationend', finalize, { once: true });
      // 兜底：300ms 后强制移除（防止 animationend 不触发）
      setTimeout(finalize, 320);
    } else {
      finalize();
    }
    return true;
  }

  /**
   * 仅刷新筛选栏（分类 chips），不重渲卡片列表，避免删除后卡片跳动。
   * 用于删除动画结束后同步筛选栏状态。
   */
  function refreshFilterBarOnly() {
    if (!state.container) return;
    var filterBar = state.container.querySelector('.history-filter');
    if (!filterBar) return;
    var allHistory = global.Store ? global.Store.getHistory() : [];
    var categories = getCategories(allHistory);
    var html = '<button class="chip pressable' + (state.filterFavoriteOnly ? ' is-active' : '') + '" type="button" data-action="toggle-favorite">' +
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="' + (state.filterFavoriteOnly ? 'currentColor' : 'none') + '" aria-hidden="true">' +
        '<path d="M7 12L2.5 7.8C1 6.4 1 4.2 2.5 2.8C4 1.4 6.2 1.4 7 3C7.8 1.4 10 1.4 11.5 2.8C13 4.2 13 6.4 11.5 7.8L7 12Z" stroke="currentColor" stroke-width="1.4"/>' +
      '</svg>' +
      escapeHtml(tr('history.filterFavorite')) + '</button>';
    html += '<button class="chip pressable' + (state.filterCategory === 'all' ? ' is-active' : '') + '" type="button" data-action="filter-category" data-category="all">' + escapeHtml(tr('history.filterAll')) + '</button>';
    categories.forEach(function (cat) {
      html += '<button class="chip pressable' + (state.filterCategory === cat ? ' is-active' : '') + '" type="button" data-action="filter-category" data-category="' + escapeHtml(cat) + '">' + escapeHtml(categoryLabel(cat)) + '</button>';
    });
    filterBar.innerHTML = html;
  }

  /** CSS.escape 兜底实现（用于属性选择器安全转义） */
  function cssEscape(str) {
    if (typeof global.CSS !== 'undefined' && typeof global.CSS.escape === 'function') {
      return global.CSS.escape(str);
    }
    return String(str).replace(/[^a-zA-Z0-9_-]/g, function (ch) {
      return '\\' + ch;
    });
  }

  function renderCardHtml(item, idx) {
    var favHtml = '<div class="history-card__fav' + (item.favorited ? ' is-on' : '') + '">' + favIconSvg(item.favorited) + '</div>';

    var feedbackBadge = '';
    if (item.feedback === 'like') {
      feedbackBadge = '<span class="history-card__feedback" title="' + escapeHtml(tr('history.likedAria')) + '">👍</span>';
    } else if (item.feedback === 'dislike') {
      feedbackBadge = '<span class="history-card__feedback" title="' + escapeHtml(tr('history.dislikedAria')) + '">👎</span>';
    }

    return '<article class="card pressable history-card" data-id="' + escapeHtml(item.id) + '" style="animation-delay:' + (Math.min(idx, 12) * 28) + 'ms" tabindex="0">' +
      favHtml +
      '<div class="history-card__header">' +
        '<h3 class="history-card__merchant">' + escapeHtml(item.merchant || tr('history.unnamedMerchant')) + '</h3>' +
        '<div class="history-card__meta">' +
          renderStarsHtml(item.stars) +
          '<span class="history-card__time">' + escapeHtml(formatRelativeTime(item.createdAt)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="history-card__chips">' +
        (item.category ? '<span class="chip chip--readonly">' + escapeHtml(categoryLabel(item.category)) + '</span>' : '') +
        (item.length ? '<span class="chip chip--readonly">' + escapeHtml(item.length) + '</span>' : '') +
        feedbackBadge +
      '</div>' +
      '<p class="history-card__preview">' + escapeHtml(previewContent(item.content)) + '</p>' +
    '</article>';
  }

  /* ===================================================================
     五、详情抽屉
     =================================================================== */

  function openDrawer(itemId) {
    var item = findHistory(itemId);
    if (!item) return;
    state.drawerItem = item;

    var body = document.createElement('div');
    body.className = 'history-detail';
    state.drawerBody = body;
    renderDrawerContent(body, item);

    body.addEventListener('click', onDrawerClick);

    var close = global.App.showDrawer(body, {
      title: tr('history.detailTitle'),
      onClose: function () {
        state.drawerItem = null;
        state.drawerBody = null;
        state.drawerClose = null;
      }
    });
    state.drawerClose = close;
  }

  function renderDrawerContent(body, item) {
    var favText = item.favorited ? tr('history.unfavorite') : tr('history.favorite');
    var likeActive = item.feedback === 'like' ? ' is-active' : '';
    var dislikeActive = item.feedback === 'dislike' ? ' is-active' : '';

    var html = '<div class="history-detail__meta">' +
      '<div class="history-detail__merchant">' + escapeHtml(item.merchant || tr('history.unnamedMerchant')) + '</div>' +
      '<div class="history-detail__row">' +
        renderStarsHtml(item.stars) +
        (item.category ? '<span class="chip chip--readonly">' + escapeHtml(categoryLabel(item.category)) + '</span>' : '') +
        (item.length ? '<span class="chip chip--readonly">' + escapeHtml(item.length) + '</span>' : '') +
        '<span class="history-detail__time">' + escapeHtml(formatRelativeTime(item.createdAt)) + '</span>' +
      '</div>' +
    '</div>';

    html += '<textarea class="textarea history-detail__content" data-role="content-edit" rows="6" aria-label="' + escapeHtml(tr('history.contentEditAria')) + '">' + escapeHtml(item.content || '') + '</textarea>';

    html += '<div class="history-detail__feedback">' +
      '<span class="history-detail__feedback-label">' + escapeHtml(tr('history.feedbackQuestion')) + '</span>' +
      '<div class="history-detail__feedback-btns">' +
        '<button class="chip pressable' + likeActive + '" type="button" data-action="feedback" data-feedback="like" aria-label="' + escapeHtml(tr('history.likedAria')) + '">👍 ' + escapeHtml(tr('history.feedbackLike')) + '</button>' +
        '<button class="chip pressable' + dislikeActive + '" type="button" data-action="feedback" data-feedback="dislike" aria-label="' + escapeHtml(tr('history.dislikedAria')) + '">👎 ' + escapeHtml(tr('history.feedbackDislike')) + '</button>' +
      '</div>' +
    '</div>';

    html += '<div class="history-detail__actions">' +
      '<button class="btn pressable" type="button" data-action="copy">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3.5C11 2.7 10.3 2 9.5 2H3.5C2.7 2 2 2.7 2 3.5V9.5C2 10.3 2.7 11 3.5 11H5" stroke="currentColor" stroke-width="1.4"/></svg>' +
        escapeHtml(tr('history.copy')) + '</button>' +
      '<button class="btn pressable" type="button" data-action="favorite">' +
        favIconSvg(item.favorited) + escapeHtml(favText) +
      '</button>' +
      '<button class="btn btn-primary pressable" type="button" data-action="save">' + escapeHtml(tr('history.saveBtn')) + '</button>' +
      '<button class="btn btn-danger pressable" type="button" data-action="delete">' + escapeHtml(tr('history.deleteBtn')) + '</button>' +
    '</div>';

    body.innerHTML = html;
  }

  /** 刷新抽屉内容，但保留 textarea 草稿 */
  function refreshDrawerContent() {
    if (!state.drawerItem || !state.drawerBody) return;
    var id = state.drawerItem.id;
    var ta = state.drawerBody.querySelector('[data-role="content-edit"]');
    var draft = ta ? ta.value : null;
    var fresh = findHistory(id);
    if (!fresh) {
      if (state.drawerClose) { try { state.drawerClose(); } catch (e) {} }
      return;
    }
    state.drawerItem = fresh;
    renderDrawerContent(state.drawerBody, fresh);
    if (draft !== null) {
      var newTa = state.drawerBody.querySelector('[data-role="content-edit"]');
      if (newTa) newTa.value = draft;
    }
  }

  /* ===================================================================
     六、事件处理
     =================================================================== */

  function onContainerClick(e) {
    var goGen = e.target.closest('[data-action="go-generate"]');
    if (goGen) {
      global.App.navigate('generate');
      return;
    }

    var toggleFav = e.target.closest('[data-action="toggle-favorite"]');
    if (toggleFav) {
      state.filterFavoriteOnly = !state.filterFavoriteOnly;
      renderList(state.container);
      return;
    }

    var catChip = e.target.closest('[data-action="filter-category"]');
    if (catChip) {
      state.filterCategory = catChip.getAttribute('data-category') || 'all';
      renderList(state.container);
      return;
    }

    var card = e.target.closest('.history-card');
    if (card) {
      var id = card.getAttribute('data-id');
      if (id) openDrawer(id);
      return;
    }
  }

  function onDrawerClick(e) {
    if (!state.drawerItem || !state.drawerBody) return;
    var item = state.drawerItem;
    var id = item.id;

    // 复制
    if (e.target.closest('[data-action="copy"]')) {
      var ta = state.drawerBody.querySelector('[data-role="content-edit"]');
      var text = ta ? ta.value : (item.content || '');
      copyToClipboard(text).then(function () {
        global.Store.updateHistory(id, { copied: true });
        global.App.showToast(tr('history.toastCopied'), 'success');
      }).catch(function () {
        global.App.showToast(tr('history.toastCopyFailed'), 'error');
      });
      return;
    }

    // 收藏/取消收藏
    if (e.target.closest('[data-action="favorite"]')) {
      var newFav = !item.favorited;
      global.Store.updateHistory(id, { favorited: newFav });
      refreshDrawerContent();
      global.App.showToast(newFav ? tr('history.toastFavorited') : tr('history.toastUnfavorited'));
      return;
    }

    // 保存修改
    if (e.target.closest('[data-action="save"]')) {
      var ta2 = state.drawerBody.querySelector('[data-role="content-edit"]');
      var newText = ta2 ? ta2.value : '';
      if (newText === (item.content || '')) {
        global.App.showToast(tr('history.toastNoChange'));
        return;
      }
      global.Store.updateHistory(id, { content: newText });
      refreshDrawerContent();
      global.App.showToast(tr('history.toastSaved'), 'success');
      return;
    }

    // 删除
    if (e.target.closest('[data-action="delete"]')) {
      global.App.showConfirm(tr('history.deleteConfirmMsg'), { danger: true }).then(function (ok) {
        if (!ok) return;
        global.Store.deleteHistory(id);
        // 关闭抽屉
        if (state.drawerClose) {
          try { state.drawerClose(); } catch (err) {}
        }
        state.drawerItem = null;
        state.drawerBody = null;
        state.drawerClose = null;
        // 直接从 DOM 移除卡片（带退出动画），避免整列重渲造成的卡顿与跳动
        // Store.onChange 会触发 App.refresh → history.refresh，但因 --refresh 类禁用了入场动画，不会跳动
        removeCardFromDom(id);
        global.App.showToast(tr('history.toastDeleted'));
      });
      return;
    }

    // 点赞/点踩
    var fbBtn = e.target.closest('[data-action="feedback"]');
    if (fbBtn) {
      var fb = fbBtn.getAttribute('data-feedback');
      var next = item.feedback === fb ? null : fb;
      global.Store.updateHistory(id, { feedback: next });
      if (next === 'like') {
        global.App.showToast(tr('history.toastFeedbackLike'));
      } else if (next === 'dislike') {
        global.App.showToast(tr('history.toastFeedbackDislike'));
      } else {
        global.App.showToast(tr('history.toastFeedbackCancel'));
      }
      refreshDrawerContent();
      return;
    }
  }

  /* ===================================================================
     七、mount / unmount / refresh
     =================================================================== */

  function mount(container) {
    state.container = container;

    var history = global.Store ? global.Store.getHistory() : [];
    if (history.length === 0) {
      renderEmptyState(container);
    } else {
      renderList(container);
    }

    container.addEventListener('click', onContainerClick);
    state.listeners.push({ target: container, type: 'click', fn: onContainerClick });
  }

  function unmount() {
    // 关闭抽屉（跳过 onClose 回调，手动清理）
    if (state.drawerClose) {
      try { state.drawerClose(true); } catch (e) {}
    }
    state.drawerClose = null;
    state.drawerItem = null;
    state.drawerBody = null;

    // 移除事件监听
    state.listeners.forEach(function (l) {
      l.target.removeEventListener(l.type, l.fn);
    });
    state.listeners = [];
    state.container = null;
  }

  function refresh() {
    if (!state.container) return;
    // 删除动画期间抑制全量重渲，避免与退出动画竞态导致卡片乱跳
    if (state.suppressRefresh) return;
    // 抽屉中如果当前项已被外部删除，关闭抽屉
    if (state.drawerItem && !findHistory(state.drawerItem.id)) {
      if (state.drawerClose) { try { state.drawerClose(); } catch (e) {} }
    }
    // 重渲列表 / 空状态
    var history = global.Store ? global.Store.getHistory() : [];
    if (history.length === 0) {
      renderEmptyState(state.container);
    } else {
      renderList(state.container);
    }
  }

  /* ===================================================================
     八、注册（处理 App 加载时序：history.js 先于 app.js 执行）
     =================================================================== */

  function register() {
    if (global.App && typeof global.App.registerView === 'function') {
      global.App.registerView('history', {
        mount: mount,
        unmount: unmount,
        refresh: refresh
      });
    } else if (document.readyState !== 'complete') {
      // defer 脚本执行时 readyState 为 'interactive'，DOMContentLoaded 尚未触发
      // 必须监听 DOMContentLoaded 以确保在 app.js 的 start() 之前完成注册
      document.addEventListener('DOMContentLoaded', register);
    } else {
      setTimeout(register, 0);
    }
  }

  register();

})(typeof window !== 'undefined' ? window : this);
