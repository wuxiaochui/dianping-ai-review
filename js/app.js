/* =====================================================================
   点评 AI 评价生成器 · 应用入口与路由
   纯原生 JS · 全局对象 window.App
   视图契约：每个视图模块挂载到 App.views[name]，形如：
     App.views.dashboard = {
       mount(container) { /* container 是对应 section.view 元素 *\/ },
       unmount() { /* 清理监听 *\/ },
       refresh() { /* 数据变化时重渲 *\/ }
     }
   ===================================================================== */
(function (global) {
  'use strict';

  /* ===================================================================
     一、常量与状态
     =================================================================== */

  var VIEW_NAMES = ['dashboard', 'library', 'train', 'generate', 'history', 'settings'];

  // 视图标题映射 → I18n key（用于顶部 app-bar）
  var VIEW_TITLES = {
    dashboard: 'app.title.dashboard',
    library: 'app.title.library',
    train: 'app.title.train',
    generate: 'app.title.generate',
    history: 'app.title.history',
    settings: 'app.title.settings'
  };
  function viewTitleKey(name) {
    return VIEW_TITLES[name] || 'app.title.dashboard';
  }
  function I18n() { return global.I18n || null; }
  function tr(key, params) {
    var i = global.I18n;
    return (i && typeof i.t === 'function') ? i.t(key, params) : key;
  }

  // Tab 顺序索引（用于判断向前 / 向后方向）
  var TAB_ORDER = {
    dashboard: 0,
    library: 1,
    train: 2,
    generate: 3,
    history: 4
  };

  var state = {
    currentView: 'dashboard',
    historyStack: [],     // 视图访问历史，用于判断方向
    isAnimating: false,   // 当前是否在切换动画中
    routeListeners: []
  };

  /* ===================================================================
     二、视图注册机制
     =================================================================== */

  // 视图模块注册表：每个视图模块 {mount, unmount, refresh}
  var views = {};

  /** 注册视图模块 */
  function registerView(name, module) {
    if (VIEW_NAMES.indexOf(name) === -1) {
      console.warn('[App] 未知视图名:', name);
      return;
    }
    views[name] = module;
  }

  /** 取消注册视图 */
  function unregisterView(name) {
    delete views[name];
  }

  /* ===================================================================
     三、DOM 引用
     =================================================================== */

  var dom = {};
  function cacheDom() {
    dom.viewContainer = document.getElementById('view-container');
    dom.appBar = document.getElementById('app-bar');
    dom.appBarTitle = document.getElementById('app-bar-title');
    dom.appBarRight = document.getElementById('app-bar-right');
    dom.backBtn = document.getElementById('back-btn');
    dom.settingsBtn = document.getElementById('app-bar-settings');
    dom.tabBar = document.getElementById('tab-bar');
    dom.toastHost = document.getElementById('toast-host');
    dom.drawerHost = document.getElementById('drawer-host');
    dom.onboardingHost = document.getElementById('onboarding-host');
    // 视图容器缓存
    dom.views = {};
    VIEW_NAMES.forEach(function (name) {
      dom.views[name] = dom.viewContainer.querySelector('.view[data-view="' + name + '"]');
    });
  }

  /* ===================================================================
     四、路由 / 视图切换
     =================================================================== */

  /**
   * 切换视图（弹簧动画 + 方向对称）
   * @param {string} viewName 目标视图名
   * @param {Object} opts {direction: 'forward'|'backward'|'auto', silent: bool}
   */
  function navigate(viewName, opts) {
    opts = opts || {};
    if (VIEW_NAMES.indexOf(viewName) === -1) {
      console.warn('[App] 未知视图名:', viewName);
      return;
    }
    if (state.isAnimating && viewName === state.currentView) return;
    if (viewName === state.currentView && !opts.force) return;

    var direction = opts.direction || detectDirection(viewName);
    var fromView = state.currentView;
    var toView = viewName;

    // 记录历史栈
    if (direction === 'forward') {
      state.historyStack.push(fromView);
    } else if (direction === 'backward' && state.historyStack.length) {
      state.historyStack.pop();
    } else {
      // auto：直接重置栈到当前
      // 不改动栈
    }
    // 栈过大时裁剪
    if (state.historyStack.length > 20) {
      state.historyStack = state.historyStack.slice(-20);
    }

    performSwitch(fromView, toView, direction, function () {
      // 切换完成后
      state.currentView = toView;
      updateAppBar(toView);
      updateTabBar(toView);
      // 持久化最近视图
      if (global.Store) {
        try { global.Store.setPreferences({ lastView: toView }); } catch (e) {}
      }
      // 通知路由监听器
      state.routeListeners.forEach(function (cb) {
        try { cb(toView, fromView, direction); } catch (e) {}
      });
    });
  }

  /** 根据目标视图与当前栈判断方向 */
  function detectDirection(viewName) {
    // 如果目标视图在历史栈中（即「返回」），则 backward
    var idx = state.historyStack.indexOf(viewName);
    if (idx !== -1) return 'backward';
    // 否则按 Tab 顺序：往右为 forward，往左为 backward
    var cur = TAB_ORDER[state.currentView];
    var next = TAB_ORDER[viewName];
    if (next === undefined || cur === undefined) return 'forward';
    return next > cur ? 'forward' : 'backward';
  }

  /**
   * 执行视图切换动画（中断友好：从当前呈现值开始）
   */
  function performSwitch(fromView, toView, direction, done) {
    var fromEl = dom.views[fromView];
    var toEl = dom.views[toView];
    if (!fromEl || !toEl) {
      // 异常兜底：直接显示目标
      if (fromEl) fromEl.classList.remove('is-active');
      if (toEl) toEl.classList.add('is-active');
      done && done();
      return;
    }

    state.isAnimating = true;

    // 中断友好：清理可能残留的过渡类
    cleanupTransitionClasses(fromEl);
    cleanupTransitionClasses(toEl);

    // 卸载旧视图模块
    if (views[fromView] && typeof views[fromView].unmount === 'function') {
      try { views[fromView].unmount(); } catch (e) { console.warn('[App] unmount ' + fromView + ' 出错:', e); }
    }

    // 准备新视图：先挂载内容，再触发入场动画
    // 注意：不再在 mount 之前调用 ensurePlaceholder，避免「此模块正在打磨中」错误闪现。
    // mount() 内部会同步填充 innerHTML；仅在 mount 抛错或视图未注册时才显示占位。
    if (views[toView] && typeof views[toView].mount === 'function') {
      try {
        views[toView].mount(toEl);
      } catch (e) {
        console.warn('[App] mount ' + toView + ' 出错:', e);
        ensurePlaceholder(toEl, toView);
      }
    } else {
      // 视图未注册：显示「即将上线」占位
      ensurePlaceholder(toEl, toView);
    }

    // 给新视图加入场前的初始位置类（在 is-active 之前）
    var enterClass = direction === 'backward' ? 'is-entering-backward' : 'is-entering-forward';
    toEl.classList.add(enterClass);

    // 强制 reflow 让初始状态生效
    void toEl.offsetWidth;

    // 旧视图离开
    var leaveClass = direction === 'backward' ? 'is-leaving-backward' : 'is-leaving-forward';
    fromEl.classList.remove('is-active');
    fromEl.classList.add(leaveClass);

    // 新视图入场：去掉 enter 类，加 is-active
    toEl.classList.remove(enterClass);
    toEl.classList.add('is-active');

    // 动画结束清理
    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      cleanupTransitionClasses(fromEl);
      cleanupTransitionClasses(toEl);
      // 确保最终状态正确
      fromEl.classList.remove('is-active');
      toEl.classList.add('is-active');
      state.isAnimating = false;
      done && done();
    }

    // 监听 transitionend（容错 + 超时兜底）
    var cleanupTimer = setTimeout(cleanup, 480);
    var onEnd = function (e) {
      // 只关心 transform 或 opacity
      if (e.target !== toEl) return;
      if (e.propertyName !== 'transform' && e.propertyName !== 'opacity') return;
      toEl.removeEventListener('transitionend', onEnd);
      clearTimeout(cleanupTimer);
      cleanup();
    };
    toEl.addEventListener('transitionend', onEnd);
  }

  function cleanupTransitionClasses(el) {
    if (!el) return;
    el.classList.remove('is-entering-forward');
    el.classList.remove('is-entering-backward');
    el.classList.remove('is-leaving-forward');
    el.classList.remove('is-leaving-backward');
  }

  /** 确保占位内容存在（视图未注册或未渲染时） */
  function ensurePlaceholder(el, viewName) {
    if (!el) return;
    // 若已有内容（且不是占位），跳过
    if (el.children.length > 0 && !el.querySelector('.view-placeholder')) return;
    var title = tr(viewTitleKey(viewName));
    var desc = tr('app.placeholder');
    el.innerHTML =
      '<div class="view-placeholder">' +
        '<div class="view-placeholder__icon">' +
          '<svg width="28" height="28" viewBox="0 0 28 28" fill="none">' +
            '<path d="M14 4V24M4 14H24" stroke="#8e8e93" stroke-width="2" stroke-linecap="round"/>' +
          '</svg>' +
        '</div>' +
        '<div class="view-placeholder__title">' + title + '</div>' +
        '<div class="view-placeholder__desc">' + desc + '</div>' +
      '</div>';
  }

  function getCurrentView() {
    return state.currentView;
  }

  /** 返回上一视图 */
  function back(opts) {
    if (state.historyStack.length === 0) return false;
    var prev = state.historyStack[state.historyStack.length - 1];
    navigate(prev, Object.assign({ direction: 'backward' }, opts || {}));
    return true;
  }

  /** 是否可以返回 */
  function canBack() {
    return state.historyStack.length > 0;
  }

  /* ===================================================================
     五、UI 更新（顶部栏、底部 Tab）
     =================================================================== */

  function updateAppBar(viewName) {
    if (!dom.appBarTitle) return;
    dom.appBarTitle.textContent = tr(viewTitleKey(viewName));
    // 返回按钮：栈非空时显示
    if (dom.backBtn) {
      if (state.historyStack.length > 0) {
        dom.backBtn.hidden = false;
      } else {
        dom.backBtn.hidden = true;
      }
    }
    if (dom.backBtn) dom.backBtn.setAttribute('aria-label', tr('app.back'));
    // 齿轮按钮：settings 视图时隐藏（避免重复进入），其他普通视图显示
    updateSettingsButtonVisibility(viewName);
  }

  /** 更新底部 Tab 栏文案（多语言） */
  function updateTabLabels() {
    if (!dom.tabBar) return;
    var items = dom.tabBar.querySelectorAll('.tab-item');
    items.forEach(function (item) {
      var tab = item.getAttribute('data-tab');
      var label = item.querySelector('.tab-item__label');
      if (label && tab) {
        // data-tab="dashboard" 对应字典键 app.tab.home
        var key = tab === 'dashboard' ? 'app.tab.home' : 'app.tab.' + tab;
        label.textContent = tr(key);
      }
    });
  }

  /** 更新齿轮按钮可见性：settings 视图隐藏，其他视图显示 */
  function updateSettingsButtonVisibility(viewName) {
    if (!dom.settingsBtn) return;
    if (viewName === 'settings') {
      dom.settingsBtn.style.display = 'none';
    } else {
      dom.settingsBtn.style.display = '';
    }
  }

  function updateTabBar(viewName) {
    if (!dom.tabBar) return;
    var items = dom.tabBar.querySelectorAll('.tab-item');
    items.forEach(function (item) {
      var tab = item.getAttribute('data-tab');
      if (tab === viewName) {
        item.classList.add('is-active');
      } else {
        item.classList.remove('is-active');
      }
    });
  }

  /* ===================================================================
     六、Toast
     =================================================================== */

  /**
   * 显示 Toast（弹簧从底部弹入）
   * @param {string} message
   * @param {string} type 'default'|'success'|'error'
   * @param {number} duration ms，默认 2400
   */
  function showToast(message, type, duration) {
    if (!dom.toastHost) return;
    type = type || 'default';
    duration = duration || 2400;

    var toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'success') toast.classList.add('toast--success');
    if (type === 'error') toast.classList.add('toast--error');
    if (type === 'warn') toast.classList.add('toast--warn');
    toast.textContent = message;
    dom.toastHost.appendChild(toast);

    // reduced-motion 下动画变淡入，时长也按 200ms
    var reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var stay = reduceMotion ? Math.min(duration, 1800) : duration;

    setTimeout(function () {
      toast.classList.add('is-leaving');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 260);
    }, stay);
  }

  /* ===================================================================
     七、Drawer（抽屉 / 模态）
     =================================================================== */

  /**
   * 显示抽屉
   * @param {Node} contentNode DOM 节点
   * @param {Object} opts {title, onClose}
   */
  function showDrawer(contentNode, opts) {
    opts = opts || {};
    if (!dom.drawerHost) return function () {};

    // 同步清理已有抽屉（避免 closeDrawer 的异步 timeout 与新抽屉的 aria-hidden 竞态）
    var oldScrim = dom.drawerHost.querySelector('.scrim');
    var oldDrawer = dom.drawerHost.querySelector('.drawer');
    if (oldScrim) { if (oldScrim.parentNode) oldScrim.parentNode.removeChild(oldScrim); }
    if (oldDrawer) { if (oldDrawer.parentNode) oldDrawer.parentNode.removeChild(oldDrawer); }

    var scrim = document.createElement('div');
    scrim.className = 'scrim';

    var drawer = document.createElement('div');
    drawer.className = 'drawer';
    var html = '<div class="drawer__grip"></div>';
    if (opts.title) {
      html += '<div class="drawer__title">' + escapeHtml(opts.title) + '</div>';
    }
    html += '<div class="drawer__body"></div>';
    drawer.innerHTML = html;
    var body = drawer.querySelector('.drawer__body');
    if (contentNode) body.appendChild(contentNode);

    dom.drawerHost.appendChild(scrim);
    dom.drawerHost.appendChild(drawer);
    dom.drawerHost.setAttribute('aria-hidden', 'false');

    // 触发入场动画
    void scrim.offsetWidth;
    scrim.classList.add('is-visible');
    requestAnimationFrame(function () {
      drawer.classList.add('is-visible');
    });

    // 点击 scrim 关闭
    var onClose = opts.onClose;
    var closed = false;
    function close(skipCallback) {
      if (closed) return;
      closed = true;
      scrim.classList.remove('is-visible');
      drawer.classList.remove('is-visible');
      setTimeout(function () {
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (drawer.parentNode) drawer.parentNode.removeChild(drawer);
        // 仅当移除的是当前抽屉（没有新抽屉接替）时才设 aria-hidden=true
        if (!dom.drawerHost.querySelector('.drawer')) {
          dom.drawerHost.setAttribute('aria-hidden', 'true');
        }
        if (!skipCallback && typeof onClose === 'function') {
          try { onClose(); } catch (e) {}
        }
      }, 380);
    }

    scrim.addEventListener('click', function () { close(); });

    return close;
  }

  /** 主动关闭当前抽屉 */
  function closeDrawer(skipCallback) {
    if (!dom.drawerHost) return;
    var scrim = dom.drawerHost.querySelector('.scrim');
    var drawer = dom.drawerHost.querySelector('.drawer');
    if (!scrim || !drawer) return;
    scrim.classList.remove('is-visible');
    drawer.classList.remove('is-visible');
    setTimeout(function () {
      if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      if (drawer.parentNode) drawer.parentNode.removeChild(drawer);
      // 仅当没有新抽屉接替时才设 aria-hidden=true
      if (!dom.drawerHost.querySelector('.drawer')) {
        dom.drawerHost.setAttribute('aria-hidden', 'true');
      }
    }, 380);
  }

  /* ===================================================================
     八、Confirm（基于 Drawer 实现的 Promise 风格）
     =================================================================== */

  /**
   * 显示确认弹窗，返回 Promise<boolean>
   * @param {string} message
   * @param {Object} opts {title, confirmText, cancelText, danger}
   */
  function showConfirm(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '12px';

      var msg = document.createElement('div');
      msg.textContent = message;
      msg.style.fontSize = 'var(--fs-body)';
      msg.style.lineHeight = '1.5';
      msg.style.color = 'var(--text-primary)';
      msg.style.padding = '4px 0 8px';
      wrap.appendChild(msg);

      var btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '8px';

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn pressable';
      cancelBtn.style.flex = '1';
      cancelBtn.textContent = opts.cancelText || tr('app.cancel');
      cancelBtn.addEventListener('click', function () {
        close();
        resolve(false);
      });

      var confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn pressable ' + (opts.danger ? 'btn-danger' : 'btn-primary');
      confirmBtn.style.flex = '1';
      confirmBtn.textContent = opts.confirmText || tr('app.confirm');
      confirmBtn.addEventListener('click', function () {
        close();
        resolve(true);
      });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(confirmBtn);
      wrap.appendChild(btnRow);

      var close = showDrawer(wrap, {
        title: opts.title || '请确认',
        onClose: function () { resolve(false); }
      });
    });
  }

  /* ===================================================================
     九、引导层
     =================================================================== */

  /**
   * 启动新用户引导（默认空实现，由 onboarding.js 视图覆盖）
   */
  function startOnboarding() {
    // onboarding 覆盖层期间隐藏齿轮按钮
    if (dom.settingsBtn) dom.settingsBtn.style.display = 'none';
    // 占位：若 onboarding 视图未注册，直接标记完成避免阻塞
    if (views.onboarding && typeof views.onboarding.start === 'function') {
      try { views.onboarding.start(); } catch (e) {
        console.warn('[App] onboarding 出错:', e);
        markOnboarded();
      }
    } else {
      // 视图未注册，先标记完成（后续 onboarding.js 实现后会被覆盖）
      // 这里仅作占位，不强制标记，让用户后续可手动触发
      console.log('[App] onboarding 视图未注册，跳过引导');
    }
  }

  function markOnboarded() {
    if (global.Store) {
      try { global.Store.setPreferences({ onboarded: true }); } catch (e) {}
    }
    // 引导结束：按当前视图恢复齿轮可见性
    updateSettingsButtonVisibility(state.currentView);
  }

  /* ===================================================================
     十、路由监听与刷新
     =================================================================== */

  function onRouteChange(callback) {
    if (typeof callback !== 'function') return function () {};
    state.routeListeners.push(callback);
    return function unsubscribe() {
      var idx = state.routeListeners.indexOf(callback);
      if (idx !== -1) state.routeListeners.splice(idx, 1);
    };
  }

  /** 通知当前视图数据变化时刷新 */
  function refresh() {
    var cur = state.currentView;
    if (views[cur] && typeof views[cur].refresh === 'function') {
      try { views[cur].refresh(); } catch (e) { console.warn('[App] refresh ' + cur + ' 出错:', e); }
    }
  }

  /* ===================================================================
     十一、全局按压反馈（pointer-down 即时响应）
     =================================================================== */

  function setupPressable() {
    // 事件委托：监听 pointerdown，对 .pressable 加 is-pressed 类
    document.addEventListener('pointerdown', function (e) {
      var target = e.target.closest('.pressable');
      if (!target) return;
      target.classList.add('is-pressed');
    }, { passive: true, capture: true });

    var release = function (e) {
      var target = e.target.closest && e.target.closest('.pressable');
      if (target) target.classList.remove('is-pressed');
      // 兜底：清理所有残留的 is-pressed（避免异常情况下未清除）
      var pressed = document.querySelectorAll('.pressable.is-pressed');
      pressed.forEach(function (el) {
        if (el !== target) el.classList.remove('is-pressed');
      });
    };
    document.addEventListener('pointerup', release, { passive: true });
    document.addEventListener('pointerleave', release, { passive: true });
    document.addEventListener('pointercancel', release, { passive: true });

    // 兜底：滚动 / 失焦时清理
    window.addEventListener('scroll', function () {
      var pressed = document.querySelectorAll('.pressable.is-pressed');
      pressed.forEach(function (el) { el.classList.remove('is-pressed'); });
    }, { passive: true, capture: true });
  }

  /* ===================================================================
     十二、Tab 栏与返回按钮事件绑定
     =================================================================== */

  function setupTabs() {
    if (!dom.tabBar) return;
    dom.tabBar.addEventListener('click', function (e) {
      var item = e.target.closest('.tab-item');
      if (!item) return;
      var tab = item.getAttribute('data-tab');
      if (!tab) return;
      navigate(tab);
    });
  }

  function setupBackButton() {
    if (!dom.backBtn) return;
    dom.backBtn.addEventListener('click', function () {
      back();
    });
  }

  function setupSettingsButton() {
    if (!dom.settingsBtn) return;
    dom.settingsBtn.addEventListener('click', function () {
      navigate('settings');
    });
  }

  /* ===================================================================
     十三、Store 数据变化监听（通知当前视图刷新）
     =================================================================== */

  function setupStoreListener() {
    if (!global.Store || typeof global.Store.onChange !== 'function') return;
    global.Store.onChange(function () {
      refresh();
    });
  }

  /* ===================================================================
     十四、工具
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

  /* ===================================================================
     十五、启动入口
     =================================================================== */

  function start() {
    cacheDom();

    // 初始化 Store（确保预置标签组就位）
    if (global.Store && typeof global.Store._init === 'function') {
      try { global.Store._init(); } catch (e) {}
    }

    // 初始化 i18n（读取持久化的语言/主题）并应用到界面
    if (global.I18n && typeof global.I18n._init === 'function') {
      try { global.I18n._init(); } catch (e) {}
    }
    updateTabLabels();
    // 合并 i18n 的 settings 到 preferences（兼容旧数据缺省）
    try {
      var pref = global.I18n && global.Store ? global.Store.getPreferences() : null;
      if (pref && (pref.language == null || pref.theme == null)) {
        var patch = {};
        if (pref.language == null) patch.language = global.I18n.getLang();
        if (pref.theme == null) patch.theme = global.I18n.getTheme();
        global.Store.setPreferences(patch);
      }
    } catch (e) {}

    // 监听语言 / 主题变化 → 更新外壳 + 重渲染当前视图
    if (global.I18n && typeof global.I18n.onChange === 'function') {
      global.I18n.onChange(function () {
        updateTabLabels();
        updateAppBar(state.currentView);
        refresh();
      });
    }

    // 初始视图：从偏好读取 lastView（兜底 dashboard）
    var initialView = 'dashboard';
    if (global.Store) {
      try {
        var pref = global.Store.getPreferences();
        if (pref && pref.lastView && VIEW_NAMES.indexOf(pref.lastView) !== -1) {
          initialView = pref.lastView;
        }
      } catch (e) {}
    }

    // 初始挂载：把当前视图内容渲染好（避免首屏空白）
    state.currentView = initialView;
    // 修正 DOM：初始默认 dashboard 带 is-active，若 initialView 不同则调整
    VIEW_NAMES.forEach(function (name) {
      var el = dom.views[name];
      if (!el) return;
      if (name === initialView) {
        el.classList.add('is-active');
      } else {
        el.classList.remove('is-active');
      }
    });

    // 挂载初始视图模块
    // 注意：视图脚本通过 DOMContentLoaded 注册，若 start() 在 DOMContentLoaded
    // 监听器触发前调用（readyState 已为 'complete' 的边界场景），视图可能尚未注册。
    // 此时短暂重试，等待视图注册完成后再挂载，避免误显占位内容。
    if (views[initialView] && typeof views[initialView].mount === 'function') {
      try {
        views[initialView].mount(dom.views[initialView]);
      } catch (e) {
        console.warn('[App] 初始视图 mount 出错:', e);
        ensurePlaceholder(dom.views[initialView], initialView);
      }
    } else {
      // 视图尚未注册：重试等待（最多 500ms，每 50ms 检查一次）
      var retryCount = 0;
      var maxRetries = 10;
      var retryId = setInterval(function () {
        retryCount++;
        if (views[initialView] && typeof views[initialView].mount === 'function') {
          clearInterval(retryId);
          try {
            views[initialView].mount(dom.views[initialView]);
          } catch (e) {
            console.warn('[App] 初始视图 mount 出错(重试):', e);
            ensurePlaceholder(dom.views[initialView], initialView);
          }
        } else if (retryCount >= maxRetries) {
          clearInterval(retryId);
          ensurePlaceholder(dom.views[initialView], initialView);
        }
      }, 50);
    }

    updateAppBar(initialView);
    updateTabBar(initialView);

    // 绑定全局事件
    setupPressable();
    setupTabs();
    setupBackButton();
    setupSettingsButton();
    setupStoreListener();

    // 检测引导
    var onboarded = false;
    if (global.Store) {
      try { onboarded = !!global.Store.getPreferences().onboarded; } catch (e) {}
    }
    if (!onboarded) {
      // 延迟触发，让首屏先呈现
      setTimeout(function () {
        startOnboarding();
      }, 300);
    }

    console.log('[App] 启动完成，初始视图:', initialView);
  }

  /* ===================================================================
     十六、导出
     =================================================================== */

  global.App = {
    // 启动
    start: start,
    // 路由
    navigate: navigate,
    back: back,
    canBack: canBack,
    getCurrentView: getCurrentView,
    onRouteChange: onRouteChange,
    refresh: refresh,
    // 视图注册
    views: views,
    registerView: registerView,
    unregisterView: unregisterView,
    // UI
    showToast: showToast,
    showDrawer: showDrawer,
    closeDrawer: closeDrawer,
    showConfirm: showConfirm,
    // 引导
    startOnboarding: startOnboarding,
    markOnboarded: markOnboarded,
    // 常量（供视图层引用）
    VIEW_NAMES: VIEW_NAMES,
    VIEW_TITLES: VIEW_TITLES
  };

  // 启动时机：
  // - app.js 作为最后一个 defer 脚本，执行时 readyState 为 'interactive'（defer 在解析完
  //   后、DOMContentLoaded 前执行）。此时视图脚本（也是 defer）已执行完毕，但它们注册
  //   视图用的是 DOMContentLoaded 监听（因执行时 App 尚未定义），尚未触发。
  // - 因此 app.js 必须也等待 DOMContentLoaded，且其监听器最后添加 → 最后触发，
  //   确保所有视图已注册后再 start()，避免 startOnboarding() 找不到 views.onboarding。
  // - 仅当 readyState 已是 'complete'（页面完全加载后才加载的脚本）才直接启动。
  if (document.readyState === 'complete') {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }

})(typeof window !== 'undefined' ? window : this);
