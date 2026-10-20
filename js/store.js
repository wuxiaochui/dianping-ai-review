/* =====================================================================
   大众点评 AI 评价生成器 · 数据持久化层
   纯原生 JS · LocalStorage · 全局对象 window.Store
   LocalStorage key 前缀: dpr_ (dianping review)
   ===================================================================== */
(function (global) {
  'use strict';

  var PREFIX = 'dpr_';
  var KEYS = {
    corpus: PREFIX + 'corpus',
    tagGroups: PREFIX + 'tag_groups',
    history: PREFIX + 'history',
    trainingHistory: PREFIX + 'training_history',
    preferences: PREFIX + 'preferences',
    aiProviders: PREFIX + 'ai_providers',
    aiMemory: PREFIX + 'ai_memory',
    operationLogs: PREFIX + 'operation_logs'
  };

  // 预置标签组（首次初始化创建）
  var PRESET_TAG_GROUPS = [
    { name: '真实日常风', description: '像本人随口说出的真实评价，不夸张不造作', color: '#FF9500' },
    { name: '夸张种草风', description: '安利种草语气，YYDS/绝绝子/封神等网络用语', color: '#FF2D55' },
    { name: '文艺细腻风', description: '细腻描写氛围与情感，带意境词与画面感', color: '#5856D6' },
    { name: '吐槽避雷风', description: '点出问题与踩雷点，提醒他人避坑', color: '#34C759' }
  ];

  var listeners = [];
  var initialized = false;

  /* ---------- 内部工具 ---------- */

  /** 生成唯一 id（时间戳 + 随机后缀） */
  function genId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** 安全读取 LocalStorage（带 JSON 解析与兜底） */
  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      // 数据损坏时回退到默认值，避免整应用崩
      return fallback;
    }
  }

  /** 安全写入 LocalStorage（序列化 + 异常吞并） */
  function write(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // 容量超限或隐私模式，静默失败
      return false;
    }
  }

  /** 通知所有数据变化监听器 */
  function notify(change) {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](change || {});
      } catch (e) { /* 单个监听器异常不影响其他 */ }
    }
  }

  /** 深拷贝（用于返回值隔离，避免外部直接修改内部引用） */
  function clone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return obj;
    }
  }

  /* ---------- 集合初始化 ---------- */

  function ensureInit() {
    if (initialized) return;
    initialized = true;

    // 语料
    if (global.localStorage.getItem(KEYS.corpus) === null) {
      write(KEYS.corpus, []);
    }
    // 历史
    if (global.localStorage.getItem(KEYS.history) === null) {
      write(KEYS.history, []);
    }
    // 训练历史
    if (global.localStorage.getItem(KEYS.trainingHistory) === null) {
      write(KEYS.trainingHistory, []);
    }
    // 偏好
    if (global.localStorage.getItem(KEYS.preferences) === null) {
      write(KEYS.preferences, {
        onboarded: false,
        lastView: 'dashboard',
        aiConfig: { enabled: false, baseURL: '', apiKey: '', model: '', testTimeout: 60000, activeProviderId: null }
      });
    }
    // AI 服务商列表（用户可添加多个，如 DeepSeek、智谱 GLM、自定义等）
    if (global.localStorage.getItem(KEYS.aiProviders) === null) {
      write(KEYS.aiProviders, []);
    }
    // AI 记忆（跨会话学习积累）
    if (global.localStorage.getItem(KEYS.aiMemory) === null) {
      write(KEYS.aiMemory, { insights: [], generationCount: 0, lastReflection: '' });
    }
    // 操作日志（失败操作记录，用于非回滚机制的错误追踪）
    if (global.localStorage.getItem(KEYS.operationLogs) === null) {
      write(KEYS.operationLogs, []);
    }
    // 标签组（首次创建 4 个预置）
    if (global.localStorage.getItem(KEYS.tagGroups) === null) {
      var groups = PRESET_TAG_GROUPS.map(function (g) {
        return {
          id: genId('tg'),
          name: g.name,
          description: g.description,
          color: g.color,
          isPreset: true,
          createdAt: new Date().toISOString()
        };
      });
      write(KEYS.tagGroups, groups);
    }
  }

  /* ---------- 语料 API ---------- */

  function getCorpus() {
    ensureInit();
    return clone(read(KEYS.corpus, []));
  }

  function getCorpusById(id) {
    ensureInit();
    var list = read(KEYS.corpus, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return clone(list[i]);
    }
    return null;
  }

  function addCorpus(data) {
    ensureInit();
    var list = read(KEYS.corpus, []);
    var now = new Date().toISOString();
    var item = {
      id: genId('corpus'),
      text: (data && data.text) || '',
      category: (data && data.category) || '',
      tagIds: Array.isArray(data && data.tagIds) ? data.tagIds.slice() : [],
      source: (data && data.source) || 'manual',
      createdAt: now,
      styleFeatures: (data && data.styleFeatures) || {}
    };
    list.push(item);
    var ok = write(KEYS.corpus, list);
    if (!ok) return null; // 写入失败（容量超限/隐私模式），返回 null 以便上层检测
    notify({ type: 'corpus:add', id: item.id });
    return clone(item);
  }

  function updateCorpus(id, patch) {
    ensureInit();
    var list = read(KEYS.corpus, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        Object.assign(list[i], clone(patch));
        // tagIds 单独保证数组拷贝
        if (Array.isArray(patch.tagIds)) {
          list[i].tagIds = patch.tagIds.slice();
        }
        write(KEYS.corpus, list);
        notify({ type: 'corpus:update', id: id });
        return clone(list[i]);
      }
    }
    return null;
  }

  function deleteCorpus(id) {
    ensureInit();
    var list = read(KEYS.corpus, []);
    var next = list.filter(function (c) { return c.id !== id; });
    if (next.length !== list.length) {
      write(KEYS.corpus, next);
      notify({ type: 'corpus:delete', id: id });
      return true;
    }
    return false;
  }

  function deleteCorpusBatch(ids) {
    ensureInit();
    var idSet = {};
    (ids || []).forEach(function (id) { idSet[id] = true; });
    var list = read(KEYS.corpus, []);
    var next = list.filter(function (c) { return !idSet[c.id]; });
    var removed = list.length - next.length;
    if (removed > 0) {
      write(KEYS.corpus, next);
      notify({ type: 'corpus:deleteBatch', ids: ids });
    }
    return removed;
  }

  /* ---------- 标签组 API ---------- */

  function getTagGroups() {
    ensureInit();
    return clone(read(KEYS.tagGroups, []));
  }

  function getTagGroupById(id) {
    ensureInit();
    var list = read(KEYS.tagGroups, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return clone(list[i]);
    }
    return null;
  }

  function addTagGroup(data) {
    ensureInit();
    var list = read(KEYS.tagGroups, []);
    var item = {
      id: genId('tg'),
      name: (data && data.name) || '未命名标签',
      description: (data && data.description) || '',
      color: (data && data.color) || '#8E8E93',
      isPreset: false,
      createdAt: new Date().toISOString()
    };
    list.push(item);
    write(KEYS.tagGroups, list);
    notify({ type: 'tagGroup:add', id: item.id });
    return clone(item);
  }

  function updateTagGroup(id, patch) {
    ensureInit();
    var list = read(KEYS.tagGroups, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        Object.assign(list[i], clone(patch));
        write(KEYS.tagGroups, list);
        notify({ type: 'tagGroup:update', id: id });
        return clone(list[i]);
      }
    }
    return null;
  }

  function deleteTagGroup(id) {
    ensureInit();
    var list = read(KEYS.tagGroups, []);
    var next = list.filter(function (g) { return g.id !== id; });
    if (next.length === list.length) return false;
    write(KEYS.tagGroups, next);

    // 同时从所有语料的 tagIds 中移除该 id
    var corpus = read(KEYS.corpus, []);
    var dirty = false;
    corpus.forEach(function (c) {
      if (Array.isArray(c.tagIds) && c.tagIds.indexOf(id) !== -1) {
        c.tagIds = c.tagIds.filter(function (t) { return t !== id; });
        dirty = true;
      }
    });
    if (dirty) write(KEYS.corpus, corpus);

    notify({ type: 'tagGroup:delete', id: id });
    return true;
  }

  /* ---------- 历史记录 API ---------- */

  function getHistory() {
    ensureInit();
    return clone(read(KEYS.history, []));
  }

  function addHistory(data) {
    ensureInit();
    var list = read(KEYS.history, []);
    var item = {
      id: genId('hist'),
      merchant: (data && data.merchant) || '',
      category: (data && data.category) || '',
      stars: (data && data.stars) || 5,
      length: (data && data.length) || '中',
      content: (data && data.content) || '',
      styleSource: (data && data.styleSource) || null,
      options: (data && data.options) || {},
      feedback: (data && data.feedback) || null, // 'like' | 'dislike' | null
      favorited: !!(data && data.favorited),
      createdAt: new Date().toISOString()
    };
    list.push(item);
    write(KEYS.history, list);
    notify({ type: 'history:add', id: item.id });
    return clone(item);
  }

  function updateHistory(id, patch) {
    ensureInit();
    var list = read(KEYS.history, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        Object.assign(list[i], clone(patch));
        write(KEYS.history, list);
        notify({ type: 'history:update', id: id });
        return clone(list[i]);
      }
    }
    return null;
  }

  function deleteHistory(id) {
    ensureInit();
    var list = read(KEYS.history, []);
    var next = list.filter(function (h) { return h.id !== id; });
    if (next.length !== list.length) {
      write(KEYS.history, next);
      notify({ type: 'history:delete', id: id });
      return true;
    }
    return false;
  }

  /* ---------- 训练历史 API ---------- */

  function getTrainingHistory() {
    ensureInit();
    return clone(read(KEYS.trainingHistory, []));
  }

  function addTrainingHistory(data) {
    ensureInit();
    var list = read(KEYS.trainingHistory, []);
    var item = {
      id: genId('train'),
      corpusIds: Array.isArray(data && data.corpusIds) ? data.corpusIds.slice() : [],
      summary: (data && data.summary) || '',
      featuresAdded: Array.isArray(data && data.featuresAdded) ? data.featuresAdded.slice() : [],
      modified: !!(data && data.modified),
      createdAt: new Date().toISOString()
    };
    list.push(item);
    write(KEYS.trainingHistory, list);
    notify({ type: 'trainingHistory:add', id: item.id });
    return clone(item);
  }

  /**
   * 回滚某次训练：移除该次训练引入的语料（按 corpusIds）
   * 但若语料被后续编辑过（updateCorpus 改过 text 等），则保留
   * 简化策略：直接按 corpusIds 删除对应语料，同时移除该次训练历史记录
   */
  function deleteTrainingHistory(id) {
    ensureInit();
    var trainList = read(KEYS.trainingHistory, []);
    var target = null;
    var nextTrain = trainList.filter(function (t) {
      if (t.id === id) { target = t; return false; }
      return true;
    });
    if (!target) return false;

    // 删除该次训练新增的语料
    if (Array.isArray(target.corpusIds) && target.corpusIds.length) {
      var corpus = read(KEYS.corpus, []);
      var idSet = {};
      target.corpusIds.forEach(function (cid) { idSet[cid] = true; });
      var nextCorpus = corpus.filter(function (c) { return !idSet[c.id]; });
      write(KEYS.corpus, nextCorpus);
    }

    write(KEYS.trainingHistory, nextTrain);
    notify({ type: 'trainingHistory:delete', id: id, removedCorpusIds: target.corpusIds });
    return true;
  }

  /* ---------- 偏好 API ---------- */

  function getPreferences() {
    ensureInit();
    return clone(read(KEYS.preferences, { onboarded: false, lastView: 'dashboard' }));
  }

  function setPreferences(patch) {
    ensureInit();
    var pref = read(KEYS.preferences, { onboarded: false, lastView: 'dashboard' });
    Object.assign(pref, clone(patch));
    write(KEYS.preferences, pref);
    notify({ type: 'preferences:update' });
    return clone(pref);
  }

  /* ---------- AI 配置 API ---------- */

  // 默认 AI 配置（OpenAI 兼容 Chat Completions 接口）
  var DEFAULT_AI_CONFIG = {
    enabled: false,
    baseURL: '',
    apiKey: '',
    model: '',
    testTimeout: 60000,   // 测试连接超时毫秒数（默认 60s，海外模型首包可能较慢）
    activeProviderId: null // 当前激活的服务商 id（来自 aiProviders 列表）
  };

  /**
   * 旧版本数据迁移：若 aiProviders 为空但 aiConfig 中存有 baseURL/apiKey/model，
   * 自动迁移成一条默认服务商并设为激活，保持向后兼容。
   */
  function migrateLegacyAIConfig() {
    var pref = read(KEYS.preferences, {});
    var ai = (pref && pref.aiConfig) || {};
    var providers = read(KEYS.aiProviders, []);
    if (providers.length === 0 && (ai.baseURL || ai.apiKey || ai.model)) {
      var legacy = {
        id: genId('ap'),
        name: '默认服务商',
        baseURL: ai.baseURL || '',
        apiKey: ai.apiKey || '',
        model: ai.model || '',
        createdAt: new Date().toISOString()
      };
      providers.push(legacy);
      write(KEYS.aiProviders, providers);
      ai.activeProviderId = legacy.id;
      pref.aiConfig = ai;
      write(KEYS.preferences, pref);
    }
  }

  /** 从 aiProviders 列表中按 id 查找 */
  function findAIProvider(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /**
   * 读取 AI 配置（向后兼容旧调用方）
   * - 若设置了 activeProviderId 且对应 provider 存在：返回 enabled + 该 provider 的字段 + testTimeout
   * - 否则：返回空配置（enabled=false，其余字段为空字符串）
   * @returns {{enabled:boolean, baseURL:string, apiKey:string, model:string, testTimeout:number, activeProviderId:string|null}}
   */
  function getAIConfig() {
    ensureInit();
    migrateLegacyAIConfig();
    var pref = read(KEYS.preferences, {});
    var ai = (pref && pref.aiConfig) || {};
    var timeout = typeof ai.testTimeout === 'number' ? ai.testTimeout : DEFAULT_AI_CONFIG.testTimeout;
    if (!isFinite(timeout) || timeout <= 0) timeout = DEFAULT_AI_CONFIG.testTimeout;

    var providers = read(KEYS.aiProviders, []);
    var activeId = ai.activeProviderId || null;
    var provider = activeId ? findAIProvider(providers, activeId) : null;

    // 兜底：activeId 失效时若仍有 provider，自动选中第一个并提示
    if (!provider && providers.length > 0) {
      provider = providers[0];
      activeId = provider.id;
      ai.activeProviderId = activeId;
      pref.aiConfig = ai;
      write(KEYS.preferences, pref);
    }

    return {
      enabled: ai.enabled === true,
      baseURL: provider ? (provider.baseURL || '') : '',
      apiKey: provider ? (provider.apiKey || '') : '',
      model: provider ? (provider.model || '') : '',
      testTimeout: timeout,
      activeProviderId: activeId
    };
  }

  /**
   * 更新 AI 配置（仅限 enabled / testTimeout / activeProviderId 三个全局字段）
   * 注意：baseURL / apiKey / model 不再从这里写入，请使用 AI 服务商 CRUD API。
   * 为兼容旧调用，若 patch 含 baseURL/apiKey/model，将写入到当前激活的 provider（若有）。
   * @param {Object} patch {enabled?, testTimeout?, activeProviderId?, baseURL?, apiKey?, model?}
   * @returns {Object} 写入后的 aiConfig（仅含全局字段，不含 provider 字段）
   */
  function setAIConfig(patch) {
    ensureInit();
    patch = patch || {};
    var pref = read(KEYS.preferences, { onboarded: false, lastView: 'dashboard' });
    var ai = (pref.aiConfig && typeof pref.aiConfig === 'object') ? pref.aiConfig : {};
    if (patch.enabled !== undefined) ai.enabled = !!patch.enabled;
    if (patch.testTimeout !== undefined) {
      var t = parseInt(patch.testTimeout, 10);
      ai.testTimeout = (isFinite(t) && t >= 5000 && t <= 180000) ? t : DEFAULT_AI_CONFIG.testTimeout;
    }
    if (typeof patch.activeProviderId === 'string') {
      ai.activeProviderId = patch.activeProviderId || null;
    }

    // 兼容旧调用：若传入 baseURL/apiKey/model，写入到激活 provider（若存在）
    if (patch.baseURL !== undefined || patch.apiKey !== undefined || patch.model !== undefined) {
      var providers = read(KEYS.aiProviders, []);
      var activeId = ai.activeProviderId;
      var p = activeId ? findAIProvider(providers, activeId) : null;
      if (p) {
        if (typeof patch.baseURL === 'string') p.baseURL = patch.baseURL;
        if (typeof patch.apiKey === 'string') p.apiKey = patch.apiKey;
        if (typeof patch.model === 'string') p.model = patch.model;
        write(KEYS.aiProviders, providers);
        notify({ type: 'aiProviders:update' });
      }
    }

    pref.aiConfig = ai;
    write(KEYS.preferences, pref);
    notify({ type: 'preferences:update' });
    return clone(ai);
  }

  /* ---------- AI 服务商 API ---------- */

  /**
   * 获取所有 AI 服务商
   * @returns {Array<{id, name, baseURL, apiKey, model, createdAt}>}
   */
  function getAIProviders() {
    ensureInit();
    migrateLegacyAIConfig();
    return clone(read(KEYS.aiProviders, []));
  }

  /** 按 id 获取单个服务商 */
  function getAIProviderById(id) {
    ensureInit();
    migrateLegacyAIConfig();
    var list = read(KEYS.aiProviders, []);
    var p = findAIProvider(list, id);
    return p ? clone(p) : null;
  }

  /**
   * 新增服务商
   * @param {Object} data {name, baseURL, apiKey, model}
   * @returns {Object} 新建的服务商
   */
  function addAIProvider(data) {
    ensureInit();
    data = data || {};
    var list = read(KEYS.aiProviders, []);
    var item = {
      id: genId('ap'),
      name: (data.name && String(data.name).trim()) || '未命名服务商',
      baseURL: typeof data.baseURL === 'string' ? data.baseURL.trim() : '',
      apiKey: typeof data.apiKey === 'string' ? data.apiKey.trim() : '',
      model: typeof data.model === 'string' ? data.model.trim() : '',
      createdAt: new Date().toISOString()
    };
    list.push(item);
    write(KEYS.aiProviders, list);
    // 若尚无激活 provider，自动激活新增的
    var pref = read(KEYS.preferences, {});
    var ai = (pref && pref.aiConfig) || {};
    if (!ai.activeProviderId) {
      ai.activeProviderId = item.id;
      pref.aiConfig = ai;
      write(KEYS.preferences, pref);
    }
    notify({ type: 'aiProviders:add', id: item.id });
    return clone(item);
  }

  /**
   * 更新服务商字段
   * @param {string} id 服务商 id
   * @param {Object} patch {name?, baseURL?, apiKey?, model?}
   * @returns {Object|null} 更新后的服务商
   */
  function updateAIProvider(id, patch) {
    ensureInit();
    patch = patch || {};
    var list = read(KEYS.aiProviders, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        if (typeof patch.name === 'string') list[i].name = patch.name.trim() || list[i].name;
        if (typeof patch.baseURL === 'string') list[i].baseURL = patch.baseURL.trim();
        if (typeof patch.apiKey === 'string') list[i].apiKey = patch.apiKey.trim();
        if (typeof patch.model === 'string') list[i].model = patch.model.trim();
        write(KEYS.aiProviders, list);
        notify({ type: 'aiProviders:update', id: id });
        return clone(list[i]);
      }
    }
    return null;
  }

  /**
   * 删除服务商
   * - 若删除的是激活 provider，则 activeProviderId 置空（或回退到第一个）
   * @param {string} id
   * @returns {boolean} 是否删除成功
   */
  function deleteAIProvider(id) {
    ensureInit();
    var list = read(KEYS.aiProviders, []);
    var next = list.filter(function (p) { return p.id !== id; });
    if (next.length === list.length) return false;
    write(KEYS.aiProviders, next);

    // 处理 activeProviderId
    var pref = read(KEYS.preferences, {});
    var ai = (pref && pref.aiConfig) || {};
    if (ai.activeProviderId === id) {
      ai.activeProviderId = next.length ? next[0].id : null;
      pref.aiConfig = ai;
      write(KEYS.preferences, pref);
    }
    notify({ type: 'aiProviders:delete', id: id });
    return true;
  }

  /**
   * 设置激活的服务商
   * @param {string} id 服务商 id
   * @returns {boolean} 是否设置成功
   */
  function setActiveAIProvider(id) {
    ensureInit();
    var list = read(KEYS.aiProviders, []);
    if (!findAIProvider(list, id)) return false;
    var pref = read(KEYS.preferences, {});
    var ai = (pref && pref.aiConfig) || {};
    ai.activeProviderId = id;
    pref.aiConfig = ai;
    write(KEYS.preferences, pref);
    notify({ type: 'aiProviders:active', id: id });
    return true;
  }

  /* ---------- 统计 API ---------- */

  function getStats() {
    ensureInit();
    var corpus = read(KEYS.corpus, []);
    var tagGroups = read(KEYS.tagGroups, []);
    var history = read(KEYS.history, []);
    var training = read(KEYS.trainingHistory, []);

    var categorySet = {};
    corpus.forEach(function (c) {
      if (c.category) categorySet[c.category] = true;
    });

    var now = Date.now();
    var weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    var weekTrainCount = 0;
    var lastTrainAt = null;
    training.forEach(function (t) {
      var ts = new Date(t.createdAt).getTime();
      if (ts > weekAgo) weekTrainCount++;
      if (!lastTrainAt || ts > lastTrainAt) lastTrainAt = ts;
    });

    var weekGenCount = 0;
    history.forEach(function (h) {
      if (new Date(h.createdAt).getTime() > weekAgo) weekGenCount++;
    });

    // 复制率：有 feedback='like' 的历史占比
    var likeCount = 0;
    history.forEach(function (h) {
      if (h.feedback === 'like') likeCount++;
    });
    var copyRate = history.length ? Math.round((likeCount / history.length) * 100) : 0;

    return {
      totalCorpus: corpus.length,
      categoryCount: Object.keys(categorySet).length,
      tagGroupCount: tagGroups.length,
      lastTrainAt: lastTrainAt,
      weekTrainCount: weekTrainCount,
      weekGenCount: weekGenCount,
      copyRate: copyRate
    };
  }

  /* ---------- AI 记忆机制（跨会话学习积累 + 自主反思） ---------- */

  /**
   * 获取 AI 记忆
   * @returns {{insights: string[], generationCount: number, lastReflection: string}}
   */
  function getAIMemory() {
    ensureInit();
    return clone(read(KEYS.aiMemory, { insights: [], generationCount: 0, lastReflection: '' }));
  }

  /**
   * 保存 AI 记忆
   */
  function saveAIMemory(memory) {
    ensureInit();
    write(KEYS.aiMemory, memory);
    notify({ type: 'aiMemory:update' });
  }

  /**
   * 添加一条 AI 洞察（从用户反馈中学习）
   * @param {string} insight 洞察文案
   */
  function addAIInsight(insight) {
    if (!insight || typeof insight !== 'string') return;
    ensureInit();
    var memory = read(KEYS.aiMemory, { insights: [], generationCount: 0, lastReflection: '' });
    // 去重：避免相同洞察反复堆积
    if (memory.insights.indexOf(insight) === -1) {
      memory.insights.unshift(insight);
      // 最多保留 20 条，防止 prompt 过长
      memory.insights = memory.insights.slice(0, 20);
      write(KEYS.aiMemory, memory);
      notify({ type: 'aiMemory:update' });
    }
  }

  /**
   * 记录一次生成，并触发反思
   * @param {Object} ctx 生成上下文 { merchant, stars, feedback, text }
   *   - feedback: 'like' | 'dislike' | null
   */
  function recordGenerationAndReflect(ctx) {
    ensureInit();
    ctx = ctx || {};
    var memory = read(KEYS.aiMemory, { insights: [], generationCount: 0, lastReflection: '' });
    memory.generationCount = (memory.generationCount || 0) + 1;

    // 根据用户反馈生成反思洞察
    if (ctx.feedback === 'like' && ctx.text) {
      // 用户认可 → 提取正面洞察
      var textLen = ctx.text.length;
      var hasEmoji = /[\u{1F300}-\u{1FAFF}]|[\u{1F600}-\u{1F64F}]/u.test(ctx.text);
      var insight = '用户认可了第' + memory.generationCount + '次生成（' +
        (ctx.stars ? ctx.stars + '星、' : '') +
        textLen + '字' + (hasEmoji ? '、含emoji' : '') + '），说明此长度和风格受用户偏好';
      memory.insights.unshift(insight);
      memory.lastReflection = insight;
    } else if (ctx.feedback === 'dislike' && ctx.text) {
      // 用户不认可 → 提取反面洞察
      var dLen = ctx.text.length;
      var dInsight = '用户不认可第' + memory.generationCount + '次生成（' + dLen + '字），需避免类似表达密度和节奏';
      memory.insights.unshift(dInsight);
      memory.lastReflection = dInsight;
    } else {
      memory.lastReflection = '第' + memory.generationCount + '次生成，用户未给出反馈';
    }

    // 最多保留 20 条
    memory.insights = memory.insights.slice(0, 20);
    write(KEYS.aiMemory, memory);
    notify({ type: 'aiMemory:update' });
  }

  /* ---------- 操作日志 API（非回滚机制错误追踪） ---------- */

  /**
   * 获取操作日志
   * @param {Object} opts { limit?: number, type?: string }
   * @returns {Array} 日志条目（最新在前）
   */
  function getOperationLogs(opts) {
    ensureInit();
    var logs = read(KEYS.operationLogs, []);
    if (opts && opts.type) {
      logs = logs.filter(function (l) { return l.type === opts.type; });
    }
    if (opts && typeof opts.limit === 'number') {
      logs = logs.slice(0, opts.limit);
    }
    return clone(logs);
  }

  /**
   * 记录一条操作日志（失败操作的错误追踪）
   * @param {Object} entry { type, op, error, context }
   */
  function addOperationLog(entry) {
    if (!entry || typeof entry !== 'object') return;
    ensureInit();
    var logs = read(KEYS.operationLogs, []);
    var item = {
      id: genId('log'),
      type: entry.type || 'unknown',        // 'corpus_save' | 'ai_analysis' | 'delete_batch' ...
      op: entry.op || '',                    // 操作描述
      error: entry.error || '',              // 错误信息
      context: entry.context || null,        // 上下文（如语料预览、索引等）
      timestamp: new Date().toISOString()
    };
    logs.unshift(item);
    // 最多保留 100 条，防止 localStorage 膨胀
    logs = logs.slice(0, 100);
    write(KEYS.operationLogs, logs);
    notify({ type: 'operationLogs:update' });
  }

  /** 清空操作日志 */
  function clearOperationLogs() {
    ensureInit();
    write(KEYS.operationLogs, []);
    notify({ type: 'operationLogs:update' });
  }

  /**
   * 批量执行工具：非回滚机制
   * - 逐项执行 op(item, index)，捕获异常
   * - 单项失败不中断后续操作
   * - 失败项记录到操作日志，成功项保留
   * - 全部尝试完毕后返回汇总结果
   * @param {Array} items 待处理项数组
   * @param {Function} op 操作函数 (item, index) => result | throws
   * @param {Object} meta { type: string, opName: string } 用于日志
   * @returns {{ succeeded: Array, failed: Array, total: number }}
   */
  function batchExecuteNoRollback(items, op, meta) {
    var results = { succeeded: [], failed: [], total: (items || []).length };
    if (!Array.isArray(items) || typeof op !== 'function') return results;
    var type = (meta && meta.type) || 'batch';
    var opName = (meta && meta.opName) || 'operation';

    items.forEach(function (item, idx) {
      try {
        var result = op(item, idx);
        results.succeeded.push({ item: item, result: result, index: idx });
      } catch (e) {
        var errMsg = (e && e.message) ? e.message : String(e);
        results.failed.push({ item: item, error: errMsg, index: idx });
        // 记录错误日志（不抛出，继续后续操作）
        addOperationLog({
          type: type,
          op: opName + ' #' + idx,
          error: errMsg,
          context: {
            preview: typeof item === 'string' ? item.slice(0, 60) : null,
            index: idx
          }
        });
      }
    });
    return results;
  }

  /* ---------- 事件机制 ---------- */

  /**
   * 导出全部数据为标准化格式（用于跨设备迁移）
   * 安全：敏感字段（apiKey）会从导出中剥离，需在新设备重新配置
   * @returns {Object} 标准化数据包 { version, exportedAt, data: {...} }
   */
  function exportAllData() {
    ensureInit();
    // 深拷贝 preferences 并剥离敏感字段（apiKey），防止凭据泄漏到导出文件
    var preferences = read(KEYS.preferences, {});
    var safePreferences = clone(preferences);
    if (safePreferences && safePreferences.aiConfig && typeof safePreferences.aiConfig === 'object') {
      // 保留结构但清空 apiKey，新设备导入后需重新填写
      safePreferences.aiConfig = {
        enabled: !!safePreferences.aiConfig.enabled,
        baseURL: safePreferences.aiConfig.baseURL || '',
        apiKey: '', // 剥离：不导出 API Key
        model: safePreferences.aiConfig.model || '',
        testTimeout: safePreferences.aiConfig.testTimeout || 0,
        activeProviderId: safePreferences.aiConfig.activeProviderId || null
      };
    }
    // 剥离每个服务商的 apiKey
    var providers = read(KEYS.aiProviders, []);
    var safeProviders = providers.map(function (p) {
      var c = clone(p);
      c.apiKey = '';
      return c;
    });
    return {
      version: 1,
      app: 'dianping-ai-review-generator',
      exportedAt: new Date().toISOString(),
      data: {
        corpus: read(KEYS.corpus, []),
        tagGroups: read(KEYS.tagGroups, []),
        history: read(KEYS.history, []),
        trainingHistory: read(KEYS.trainingHistory, []),
        preferences: safePreferences,
        aiProviders: safeProviders,
        aiMemory: read(KEYS.aiMemory, { insights: [], generationCount: 0, lastReflection: '' }),
        operationLogs: read(KEYS.operationLogs, [])
      }
    };
  }

  /**
   * 导入标准化数据包
   * @param {Object} pkg exportAllData 返回的格式
   * @param {Object} opts { mode: 'merge'|'replace' } merge=合并（同 id 跳过），replace=完全替换
   * @returns {{ success: boolean, imported: Object, errors: Array }}
   */
  function importAllData(pkg, opts) {
    opts = opts || {};
    var mode = opts.mode === 'replace' ? 'replace' : 'merge';
    var result = { success: true, imported: {}, errors: [] };

    if (!pkg || typeof pkg !== 'object') {
      result.success = false;
      result.errors.push('数据包格式无效');
      return result;
    }
    var data = pkg.data || pkg; // 兼容直接传 data 的情况
    if (!data || typeof data !== 'object') {
      result.success = false;
      result.errors.push('数据包缺少 data 字段');
      return result;
    }

    ensureInit();

    // 非回滚导入：每类数据独立处理，单类失败不影响其他类
    var sections = [
      { key: 'corpus', storeKey: KEYS.corpus, label: '语料' },
      { key: 'tagGroups', storeKey: KEYS.tagGroups, label: '标签组' },
      { key: 'history', storeKey: KEYS.history, label: '历史记录' },
      { key: 'trainingHistory', storeKey: KEYS.trainingHistory, label: '训练历史' },
      { key: 'preferences', storeKey: KEYS.preferences, label: '偏好设置' },
      { key: 'aiProviders', storeKey: KEYS.aiProviders, label: 'AI 服务商' },
      { key: 'aiMemory', storeKey: KEYS.aiMemory, label: 'AI 记忆' },
      { key: 'operationLogs', storeKey: KEYS.operationLogs, label: '操作日志' }
    ];

    sections.forEach(function (sec) {
      try {
        var incoming = data[sec.key];
        if (incoming === undefined || incoming === null) {
          result.imported[sec.key] = 0;
          return;
        }

        if (mode === 'replace') {
          // 替换模式：直接覆盖
          write(sec.storeKey, incoming);
          result.imported[sec.key] = Array.isArray(incoming) ? incoming.length : 1;
        } else {
          // 合并模式：数组按 id 去重合并；对象则合并字段
          var existing = read(sec.storeKey, Array.isArray(incoming) ? [] : {});
          if (Array.isArray(incoming)) {
            var idSet = {};
            existing.forEach(function (it) { if (it && it.id) idSet[it.id] = true; });
            var added = 0;
            incoming.forEach(function (it) {
              if (it && it.id && !idSet[it.id]) {
                existing.push(it);
                idSet[it.id] = true;
                added++;
              } else if (!it || !it.id) {
                // 无 id 项直接追加
                existing.push(it);
                added++;
              }
            });
            write(sec.storeKey, existing);
            result.imported[sec.key] = added;
          } else if (typeof incoming === 'object') {
            // 对象合并：浅合并，incoming 覆盖 existing
            var merged = Object.assign({}, existing, incoming);
            write(sec.storeKey, merged);
            result.imported[sec.key] = Object.keys(incoming).length;
          }
        }
      } catch (e) {
        result.errors.push(sec.label + '导入失败: ' + ((e && e.message) ? e.message : String(e)));
      }
    });

    // 通知所有监听器
    notify({ type: 'import' });

    return result;
  }

  /* ---------- 事件机制 ---------- */

  function onChange(callback) {
    if (typeof callback !== 'function') return function () {};
    listeners.push(callback);
    return function unsubscribe() {
      var idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  /* ---------- 调试/维护 API ---------- */

  function _init() {
    initialized = false;
    ensureInit();
  }

  /** 清空所有数据（仅用于调试/重置） */
  function _reset() {
    Object.keys(KEYS).forEach(function (k) {
      global.localStorage.removeItem(KEYS[k]);
    });
    initialized = false;
    ensureInit();
    notify({ type: 'reset' });
  }

  /* ---------- 导出 ---------- */
  global.Store = {
    // 语料
    getCorpus: getCorpus,
    getCorpusById: getCorpusById,
    addCorpus: addCorpus,
    updateCorpus: updateCorpus,
    deleteCorpus: deleteCorpus,
    deleteCorpusBatch: deleteCorpusBatch,
    // 标签组
    getTagGroups: getTagGroups,
    getTagGroupById: getTagGroupById,
    addTagGroup: addTagGroup,
    updateTagGroup: updateTagGroup,
    deleteTagGroup: deleteTagGroup,
    // 历史
    getHistory: getHistory,
    addHistory: addHistory,
    updateHistory: updateHistory,
    deleteHistory: deleteHistory,
    // 训练历史
    getTrainingHistory: getTrainingHistory,
    addTrainingHistory: addTrainingHistory,
    deleteTrainingHistory: deleteTrainingHistory,
    // 偏好
    getPreferences: getPreferences,
    setPreferences: setPreferences,
    // AI 配置
    getAIConfig: getAIConfig,
    setAIConfig: setAIConfig,
    // AI 服务商
    getAIProviders: getAIProviders,
    getAIProviderById: getAIProviderById,
    addAIProvider: addAIProvider,
    updateAIProvider: updateAIProvider,
    deleteAIProvider: deleteAIProvider,
    setActiveAIProvider: setActiveAIProvider,
    // AI 记忆
    getAIMemory: getAIMemory,
    saveAIMemory: saveAIMemory,
    addAIInsight: addAIInsight,
    recordGenerationAndReflect: recordGenerationAndReflect,
    // 操作日志（非回滚机制）
    getOperationLogs: getOperationLogs,
    addOperationLog: addOperationLog,
    clearOperationLogs: clearOperationLogs,
    batchExecuteNoRollback: batchExecuteNoRollback,
    // 导出/导入（跨设备迁移）
    exportAllData: exportAllData,
    importAllData: importAllData,
    // 统计
    getStats: getStats,
    // 事件
    onChange: onChange,
    // 维护
    _init: _init,
    _reset: _reset,
    _keys: KEYS
  };

  // 模块加载即触发一次初始化（确保首次访问就有预置数据）
  ensureInit();

})(typeof window !== 'undefined' ? window : this);
