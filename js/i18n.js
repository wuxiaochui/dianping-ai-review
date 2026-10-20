/* =====================================================================
   大众点评 AI 评价生成器 · 国际化与主题 (i18n)
   纯原生 JS · 全局对象 window.I18n
   职责：
   1) 多语言：简体中文 / 英语 / 韩语 / 法语 / 繁体中文
   2) 主题：浅色 / 深色 / 跟随系统
   说明：
   - 各视图通过 I18n.t('key', {0: val}) 取文本
   - 语言与主题持久化到 Store.preferences（theme / language）
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- 支持的语言 ---------- */
  var LANGS = [
    { code: 'zh',     label: '简体中文' },
    { code: 'zh-Hant', label: '繁體中文' },
    { code: 'en',     label: 'English' },
    { code: 'ko',     label: '한국어' },
    { code: 'fr',     label: 'Français' }
  ];

  var THEMES = ['light', 'dark', 'system'];

  var DEFAULT_LANG = 'zh';

  /* ---------- 状态 ---------- */
  var currentLang = DEFAULT_LANG;
  var currentTheme = 'system';
  var changeListeners = [];

  /* ---------- Store 访问 ---------- */
  function store() { return global.Store || null; }

  /* ---------- 字典 ---------- */
  var DICT = {};

  /**
   * 注册语言字典
   * I18n.registerDict('en', { 'key': 'text', ... })
   */
  function registerDict(code, dict) {
    DICT[code] = DICT[code] || {};
    Object.keys(dict || {}).forEach(function (k) {
      DICT[code][k] = dict[k];
    });
  }

  /**
   * 取文本。找不到时依次回退：目标语言 → 中文 → key。
   * @param {string} key
   * @param {Object} params 占位符 {0: 'xx', name: 'xx'}，支持 {0} 或 {name}
   */
  function t(key, params) {
    if (key == null) return '';
    var entry = (DICT[currentLang] && DICT[currentLang][key]);
    if (entry == null && DICT.zh) entry = DICT.zh[key];
    if (entry == null) entry = key;
    return interpolate(String(entry), params);
  }

  function interpolate(str, params) {
    if (!params) return str;
    Object.keys(params).forEach(function (k) {
      // 支持 {name} 与 {0}
      str = str.split('{' + k + '}').join(String(params[k]));
    });
    return str;
  }

  /** 当前语言码 */
  function getLang() { return currentLang; }

  /** 当前语言显示名（用当前语言显示） */
  function getLangLabel(code) {
    code = code || currentLang;
    if (code === currentLang) {
      var cur = currentLang;
      var find = LANGS.filter(function (l) { return l.code === cur; })[0];
      return find ? find.label : code;
    }
    // 用目标语言自身显示
    var labels = {
      'zh': '简体中文',
      'zh-Hant': '繁體中文',
      'en': 'English',
      'ko': '한국어',
      'fr': 'Français'
    };
    return labels[code] || code;
  }

  /** 设置语言并持久化 + 应用 */
  function setLang(code) {
    var ok = LANGS.some(function (l) { return l.code === code; });
    if (!ok) return false;
    currentLang = code;
    applyLang();
    var s = store();
    if (s && typeof s.setPreferences === 'function') {
      try { s.setPreferences({ language: code }); } catch (e) {}
    }
    notify();
    return true;
  }

  /** 把当前语言应用到 html lang 属性 */
  function applyLang() {
    if (global.document && global.document.documentElement) {
      global.document.documentElement.setAttribute('lang', langToHtml(currentLang));
    }
  }

  function langToHtml(code) {
    if (code === 'zh-Hant') return 'zh-Hant';
    if (code === 'en') return 'en';
    if (code === 'ko') return 'ko';
    if (code === 'fr') return 'fr';
    return 'zh-CN';
  }

  /* ---------- 主题 ---------- */
  function getTheme() { return currentTheme; }

  function setTheme(theme) {
    if (THEMES.indexOf(theme) === -1) theme = 'system';
    currentTheme = theme;
    applyTheme();
    var s = store();
    if (s && typeof s.setPreferences === 'function') {
      try { s.setPreferences({ theme: theme }); } catch (e) {}
    }
    notify();
    return true;
  }

  /**
   * 应用主题到 html[data-theme]。
   * data-theme : 'light' | 'dark' | 'system'
   * main.css 的 override 规则据 data-theme 强制浅/深；system 靠 prefers-color-scheme。
   */
  function applyTheme() {
    if (!global.document || !global.document.documentElement) return;
    var el = global.document.documentElement;
    if (currentTheme === 'system') {
      el.removeAttribute('data-theme');
    } else {
      el.setAttribute('data-theme', currentTheme);
    }
  }

  /* ---------- 初始化（读取 Store 持久化值） ---------- */
  function _init() {
    var pref = null;
    var s = store();
    if (s && typeof s.getPreferences === 'function') {
      try { pref = s.getPreferences(); } catch (e) {}
    }
    if (pref) {
      if (pref.theme && THEMES.indexOf(pref.theme) !== -1) currentTheme = pref.theme;
      if (pref.language && LANGS.some(function (l) { return l.code === pref.language; })) {
        currentLang = pref.language;
      }
    }
    applyTheme();
    applyLang();
  }

  /* ---------- 变更订阅（用于整体重渲染） ---------- */
  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    changeListeners.push(cb);
    return function unsubscribe() {
      var i = changeListeners.indexOf(cb);
      if (i !== -1) changeListeners.splice(i, 1);
    };
  }

  function notify() {
    changeListeners.forEach(function (cb) {
      try { cb({ lang: currentLang, theme: currentTheme }); } catch (e) {}
    });
    // 通知 Store（触发 App.refresh 重渲染当前视图）
    var s = store();
    if (s && typeof s.notify === 'function') {
      try { s.notify({ type: 'i18n:apply' }); } catch (e) {}
    }
  }

  /* ---------- 导出 ---------- */
  global.I18n = {
    t: t,
    getLang: getLang,
    setLang: setLang,
    getLangLabel: getLangLabel,
    getTheme: getTheme,
    setTheme: setTheme,
    applyTheme: applyTheme,
    applyLang: applyLang,
    registerDict: registerDict,
    onChange: onChange,
    _init: _init,
    LANGS: LANGS,
    THEMES: THEMES
  };

})(typeof window !== 'undefined' ? window : this);