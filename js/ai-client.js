/* =====================================================================
   大众点评 AI 评价生成器 · OpenAI 兼容 Chat Completions 客户端
   纯原生 JS · 全局对象 window.AIClient
   覆盖 DeepSeek / 智谱 GLM / Moonshot / 通义千问 / OpenAI 等主流模型
   ===================================================================== */
(function (global) {
  'use strict';

  var DEFAULT_TIMEOUT = 30000;       // 生成请求默认 30s
  var DEFAULT_TEST_TIMEOUT = 60000;  // 测试连接默认 60s（海外模型首包可能较慢）

  /* ---------- 内部工具 ---------- */

  /** 移除 baseURL 末尾的斜杠，便于拼接 `/chat/completions` */
  function normalizeBaseURL(url) {
    if (typeof url !== 'string') return '';
    return url.replace(/\/+$/, '');
  }

  /** 拼接 chat completions 端点 */
  function buildEndpoint(baseURL) {
    return normalizeBaseURL(baseURL) + '/chat/completions';
  }

  /** 构造通用请求头（不在任何日志中输出 apiKey） */
  function buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': 'Bearer ' + (apiKey || '')
    };
  }

  /**
   * 把用户传入的 AbortSignal 与超时计时器组合为一个新的 AbortSignal
   * - 任一触发则组合 signal abort
   * - 返回 {signal, timedOut, userAborted} 用于错误分类
   */
  function combineSignalWithTimeout(userSignal, timeoutMs) {
    var ctrl = new AbortController();
    var state = { timedOut: false, userAborted: false };
    var timer = null;

    function abortByTimeout() {
      state.timedOut = true;
      ctrl.abort(new Error('timeout'));
    }

    function abortByUser() {
      state.userAborted = true;
      ctrl.abort(userSignal && userSignal.reason ? userSignal.reason : new Error('aborted'));
    }

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(abortByTimeout, timeoutMs);
    }

    if (userSignal) {
      if (userSignal.aborted) {
        // 已中断：直接同步 abort
        if (timer) clearTimeout(timer);
        state.userAborted = true;
        ctrl.abort(userSignal.reason || new Error('aborted'));
      } else if (typeof userSignal.addEventListener === 'function') {
        userSignal.addEventListener('abort', abortByUser);
      }
    }

    // 组合 signal abort 时清理计时器
    if (typeof ctrl.signal.addEventListener === 'function') {
      ctrl.signal.addEventListener('abort', function () {
        if (timer) clearTimeout(timer);
      });
    }

    return { signal: ctrl.signal, state: state };
  }

  /** 根据 HTTP 状态码与异常信息分类错误 */
  function classifyError(status, fetchErr, state) {
    if (state && state.timedOut) {
      return { type: 'timeout', message: '请求超时' };
    }
    if (state && state.userAborted) {
      return { type: 'aborted', message: '请求已中断' };
    }
    if (status === 401) {
      return { type: 'auth', message: 'API Key 无效' };
    }
    if (status === 403 || status === 429) {
      return { type: 'rate_limit', message: '请求被拒绝或限流' };
    }
    if (status && status >= 400) {
      return { type: 'http', message: 'HTTP ' + status };
    }
    // 无 status → 视为网络错误
    return { type: 'network', message: '网络连接失败' };
  }

  /* ---------- 流式 SSE 解析 ---------- */

  /**
   * 解析 SSE 行：按 `data: ` 前缀读取，遇 `[DONE]` 结束
   * @returns {boolean} true 表示遇到 [DONE]
   */
  function processLine(line, onToken, fullRef) {
    var trimmed = line.replace(/^\uFEFF/, '').trim();
    if (!trimmed) return false;
    if (trimmed.indexOf('data:') !== 0) return false;
    var data = trimmed.slice(5).trim();
    if (data === '[DONE]') return true;
    if (!data) return false;
    try {
      var json = JSON.parse(data);
      var choices = json.choices || [];
      var choice = choices[0] || {};
      var delta = choice.delta || {};
      var content = delta.content;
      if (typeof content === 'string' && content.length > 0) {
        fullRef.text += content;
        if (typeof onToken === 'function') onToken(content);
      }
    } catch (e) {
      // 非 JSON 行（如注释、心跳），跳过
    }
    return false;
  }

  /* ---------- 公共 API ---------- */

  /**
   * 流式 Chat Completions
   * @param {Object} opts
   *   - messages: [{role, content}]
   *   - baseURL: string
   *   - apiKey: string
   *   - model: string
   *   - onToken: (chunk: string) => void
   *   - onDone: (fullText: string) => void
   *   - onError: (err: {type, message}) => void
   *   - signal: AbortSignal（用户中断）
   */
  function streamChat(opts) {
    opts = opts || {};
    var messages = opts.messages || [];
    var baseURL = opts.baseURL || '';
    var apiKey = opts.apiKey || '';
    var model = opts.model || '';
    var onToken = opts.onToken;
    var onDone = opts.onDone;
    var onError = opts.onError;
    var userSignal = opts.signal;

    if (!baseURL || !apiKey || !model) {
      if (typeof onError === 'function') {
        onError({ type: 'config', message: 'AI 配置不完整' });
      }
      return;
    }

    var combined = combineSignalWithTimeout(userSignal, DEFAULT_TIMEOUT);
    var endpoint = buildEndpoint(baseURL);
    var body = JSON.stringify({
      model: model,
      messages: messages,
      stream: true,
      temperature: 0.9,
      max_tokens: 800
    });

    var fullRef = { text: '' };
    var finished = false;

    function safeError(err) {
      if (finished) return;
      finished = true;
      if (typeof onError === 'function') onError(err);
    }
    function safeDone() {
      if (finished) return;
      finished = true;
      if (typeof onDone === 'function') onDone(fullRef.text);
    }

    global.fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: body,
      signal: combined.signal
    }).then(function (response) {
      if (!response.ok) {
        // 尝试读取响应体里的错误信息（不抛出，仅作日志参考）
        var status = response.status;
        // 不 await body，直接分类，避免中断回调链
        safeError(classifyError(status, null, combined.state));
        return null;
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        // 环境不支持流式读取，降级为整体 JSON
        return response.text().then(function (text) {
          // 整体响应解析为单次 SSE 流
          var lines = text.split('\n');
          for (var i = 0; i < lines.length; i++) {
            if (processLine(lines[i], onToken, fullRef)) break;
          }
          safeDone();
        });
      }
      var reader = response.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            // 处理残留 buffer
            if (buffer) {
              var remainLines = buffer.split('\n');
              for (var i = 0; i < remainLines.length; i++) {
                if (processLine(remainLines[i], onToken, fullRef)) {
                  safeDone();
                  return;
                }
              }
            }
            safeDone();
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          // 保留最后一段未结束的行
          buffer = lines.pop() || '';
          var done = false;
          for (var j = 0; j < lines.length; j++) {
            if (processLine(lines[j], onToken, fullRef)) {
              done = true;
              break;
            }
          }
          if (done) {
            safeDone();
            return;
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      // fetch reject：可能是网络错误、用户中断、超时
      safeError(classifyError(null, err, combined.state));
    });
  }

  /**
   * 非流式 Chat Completions（用于连接测试 / 调度层一次拿全文）
   * @param {Object} opts
   *   - messages
   *   - baseURL
   *   - apiKey
   *   - model
   *   - maxTokens: number (默认 5)
   *   - signal: AbortSignal（可选）
   * @returns {Promise<string>} 文本内容
   * @throws {Promise<{type, message}>} 失败时抛出结构化错误
   */
  function chat(opts) {
    opts = opts || {};
    var messages = opts.messages || [];
    var baseURL = opts.baseURL || '';
    var apiKey = opts.apiKey || '';
    var model = opts.model || '';
    var maxTokens = opts.maxTokens || 5;
    // 允许调用方自定义 temperature（深度分析需低温度 0.3-0.5，生成需高温度 0.8-1.0）
    var temperature = (typeof opts.temperature === 'number') ? opts.temperature : 0.9;
    var userSignal = opts.signal;
    // 允许调用方自定义超时（如测试连接需要更长），缺省回退 DEFAULT_TIMEOUT
    var timeoutMs = (typeof opts.timeout === 'number' && opts.timeout > 0) ? opts.timeout : DEFAULT_TIMEOUT;

    if (!baseURL || !apiKey || !model) {
      return Promise.reject({ type: 'config', message: 'AI 配置不完整' });
    }

    var combined = combineSignalWithTimeout(userSignal, timeoutMs);
    var endpoint = buildEndpoint(baseURL);
    var body = JSON.stringify({
      model: model,
      messages: messages,
      stream: false,
      temperature: temperature,
      max_tokens: maxTokens
    });

    return global.fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: body,
      signal: combined.signal
    }).then(function (response) {
      if (!response.ok) {
        var status = response.status;
        return Promise.reject(classifyError(status, null, combined.state));
      }
      return response.json();
    }).then(function (data) {
      var choices = (data && data.choices) || [];
      var choice = choices[0] || {};
      var message = choice.message || {};
      var content = message.content;
      return typeof content === 'string' ? content : '';
    }).catch(function (err) {
      // 已经是结构化错误（来自上面的 reject）
      if (err && err.type) throw err;
      // 网络错误 / 中断 / 超时
      throw classifyError(null, err, combined.state);
    });
  }

  /* ---------- Prompt 构造 ---------- */

  /** 把 tendency 转中文描述 */
  function describeTendency(tendency) {
    tendency = tendency || {};
    var styleMap = {
      casual: '口语化',
      literary: '文艺细腻',
      exaggerated: '夸张种草',
      restrained: '克制简洁'
    };
    var parts = [];
    if (tendency.style && styleMap[tendency.style]) {
      parts.push(styleMap[tendency.style]);
    }
    if (tendency.emoji === true) parts.push('适当使用 emoji');
    if (tendency.emoji === false) parts.push('不使用 emoji');
    return parts.length ? parts.join('、') : '自然真实';
  }

  /** 把 options 转中文描述 */
  function describeOptions(options) {
    options = options || {};
    var keys = Object.keys(options).filter(function (k) { return options[k]; });
    if (!keys.length) return '无特定要求，按真实体验自由发挥';
    return keys.join('、');
  }

  /** 把星级转中文基调描述 */
  function describeStarTone(stars) {
    if (stars <= 1.5) return '1-1.5 星：严重差评，明确指出问题';
    if (stars <= 2.5) return '2-2.5 星：吐槽避雷，点出主要问题';
    if (stars <= 3.5) return '3-3.5 星：中性偏客观，有亮点也有不足';
    if (stars <= 4.5) return '4-4.5 星：好评推荐，突出亮点';
    return '5 星：强烈推荐，全维度好评';
  }

  /** 把长度约束转中文描述（支持字数、auto 和预设） */
  function describeLengthConstraint(length) {
    if (length === 'auto' || !length) return '由你根据内容自动判断合适长度（通常 150-250 字）';
    if (typeof length === 'number') return length + ' 字左右（允许±15%）';
    if (typeof length === 'string' && /^\d+$/.test(length)) return length + ' 字左右（允许±15%）';
    if (length === '短') return '短：50-100 字';
    if (length === '长') return '长：300 字以上';
    return '中：150-250 字';
  }

  /**
   * 把深度风格特征转可读文本 —— 语言DNA描述
   * 不是简单罗列高频词，而是描述用户的写作规律，让AI理解"这个人怎么写"
   */
  function describeFeatures(features) {
    features = features || {};
    var parts = [];

    // ---- 深度分析：语言表达规律 ----
    var lp = features.languagePatterns;
    if (lp) {
      parts.push('【语言表达规律】');
      if (lp.sentenceStructures && lp.sentenceStructures.length) {
        parts.push('句式特征：' + lp.sentenceStructures.join('、'));
      }
      if (lp.vocabularyPreference && lp.vocabularyPreference.length) {
        parts.push('词汇偏好：' + lp.vocabularyPreference.join('、'));
      }
      if (lp.semanticRelations && lp.semanticRelations.length) {
        parts.push('语义逻辑：' + lp.semanticRelations.join('、'));
      }
    }

    // ---- 深度分析：文本格式特征 ----
    var ff = features.formatFeatures;
    if (ff) {
      parts.push('');
      parts.push('【文本格式特征】');
      if (ff.paragraphStructure) {
        parts.push('段落结构：' + ff.paragraphStructure);
      }
      if (ff.punctuationUsage && ff.punctuationUsage.length) {
        parts.push('标点习惯：' + ff.punctuationUsage.join('、'));
      }
      if (ff.specialMarkers && ff.specialMarkers.length) {
        parts.push('特殊标记：' + ff.specialMarkers.join('、'));
      }
    }

    // ---- 深度分析：内容风格特点 ----
    var st = features.styleTraits;
    if (st) {
      parts.push('');
      parts.push('【内容风格特点】');
      var formalityMap = { formal: '书面正式', informal: '口语非正式', mixed: '半正式半口语' };
      if (st.formality) parts.push('正式程度：' + (formalityMap[st.formality] || st.formality));
      if (st.domain) parts.push('领域特征：' + st.domain);
      if (st.emotionalTone) parts.push('情感倾向：' + st.emotionalTone);
    }

    // ---- 统计特征（辅助参考，非主导） ----
    var statParts = [];
    if (features.avgSentenceLength) {
      statParts.push('平均句长约' + features.avgSentenceLength + '字');
    }
    var openers = (features.sentenceOpeners || []).slice(0, 4);
    if (openers.length) statParts.push('常见句首：' + openers.join('、'));
    var emojis = (features.emojis || []).slice(0, 5).map(function (e) { return e.char; });
    if (emojis.length) statParts.push('常用emoji：' + emojis.join(' '));
    if (features.sentiment) {
      var sMap = { positive: '积极推荐', negative: '吐槽避雷', neutral: '中立陈述' };
      if (sMap[features.sentiment]) statParts.push('情绪基调：' + sMap[features.sentiment]);
    }
    if (statParts.length) {
      parts.push('');
      parts.push('【统计辅助】' + statParts.join('；'));
    }

    return parts.length ? parts.join('\n') : '（用户暂未训练语料，无明确风格画像，请用大众点评常见真实风格生成）';
  }

  /** 从 corpusList 选 2-3 条同品类语料作为 few-shot 示例 */
  function selectFewShot(corpusList, category) {
    if (!corpusList || !corpusList.length) return [];
    var same = [];
    var others = [];
    for (var i = 0; i < corpusList.length; i++) {
      var c = corpusList[i];
      if (!c || !c.text) continue;
      if (c.category === category) same.push(c);
      else others.push(c);
    }
    var result = same.slice(0, 3);
    if (result.length < 2) {
      for (var j = 0; j < others.length && result.length < 3; j++) {
        result.push(others[j]);
      }
    }
    return result.slice(0, 3);
  }

  /**
   * 从历史记录中提取可辅助 AI 生成的信号
   * - likedExamples: 用户点赞过的评价（作为正面风格参考）
   * - dislikedExamples: 用户点踩过的评价（作为反面示例，避免类似风格）
   * - preferenceHints: 用户偏好统计（常用长度、品类分布、星级倾向）
   * @param {Array} history Store.getHistory() 返回的历史记录数组
   * @returns {{likedExamples: Array, dislikedExamples: Array, preferenceHints: string}}
   */
  function extractHistorySignals(history) {
    var result = { likedExamples: [], dislikedExamples: [], preferenceHints: '' };
    if (!history || !history.length) return result;

    var liked = [];
    var disliked = [];
    var lengthCount = {};
    var categoryCount = {};
    var starsSum = 0;
    var starsCount = 0;

    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      if (!h) continue;
      // 点赞的评价：作为正面风格参考（取最近 3 条，且内容非空）
      if (h.feedback === 'like' && h.content && liked.length < 3) {
        liked.push({ text: h.content, category: h.category || '通用', merchant: h.merchant || '' });
      }
      // 点踩的评价：作为反面示例（取最近 2 条）
      if (h.feedback === 'dislike' && h.content && disliked.length < 2) {
        disliked.push({ text: h.content, category: h.category || '通用' });
      }
      // 统计偏好
      if (h.length) lengthCount[h.length] = (lengthCount[h.length] || 0) + 1;
      if (h.category) categoryCount[h.category] = (categoryCount[h.category] || 0) + 1;
      if (h.stars && h.stars > 0) { starsSum += h.stars; starsCount++; }
    }

    result.likedExamples = liked;
    result.dislikedExamples = disliked;

    // 生成偏好提示文本
    var hints = [];
    // 最常用长度
    var topLength = null, topLengthN = 0;
    for (var k in lengthCount) {
      if (lengthCount[k] > topLengthN) { topLengthN = lengthCount[k]; topLength = k; }
    }
    if (topLength) hints.push('用户历史偏好长度：' + topLength + '评（' + topLengthN + ' 次）');
    // 最常用品类
    var topCat = null, topCatN = 0;
    for (var kc in categoryCount) {
      if (categoryCount[kc] > topCatN) { topCatN = categoryCount[kc]; topCat = kc; }
    }
    if (topCat && topCatN >= 2) hints.push('最常评价品类：' + topCat + '（' + topCatN + ' 次）');
    // 平均星级
    if (starsCount > 0) {
      var avg = (starsSum / starsCount).toFixed(1);
      hints.push('历史平均星级：' + avg + ' 星');
    }
    if (liked.length) hints.push('用户已点赞 ' + liked.length + ' 条评价（可作为风格参考）');
    if (disliked.length) hints.push('用户已点踩 ' + disliked.length + ' 条评价（需避免类似风格）');

    result.preferenceHints = hints.join('；');
    return result;
  }

  /** 把历史信号渲染为 system prompt 片段 */
  function describeHistorySignals(signals) {
    if (!signals) return '';
    var parts = [];
    if (signals.preferenceHints) {
      parts.push('【用户历史偏好】');
      parts.push(signals.preferenceHints);
    }
    if (signals.dislikedExamples && signals.dislikedExamples.length) {
      parts.push('');
      parts.push('【需避免的风格】以下是用户明确点踩「不像自己风格」的评价，请避免类似写法：');
      signals.dislikedExamples.forEach(function (ex, idx) {
        parts.push('反例 ' + (idx + 1) + '：' + ex.text.slice(0, 80) + (ex.text.length > 80 ? '…' : ''));
      });
    }
    return parts.length ? parts.join('\n') : '';
  }

  /**
   * 构造生成评价的 messages 数组
   * @param {Object} p
   *   - merchant, category, stars, length, options, tendency, corpusList, features
   *   - historySignals: extractHistorySignals() 的返回值（可选，用于历史反馈辅助生成）
   * @returns {Array<{role, content}>}
   */
  function buildGeneratePrompt(p) {
    p = p || {};
    var merchant = p.merchant || '这家店';
    var category = p.category || '美食';
    var stars = p.stars || 5;
    var length = p.length || '中';
    var options = p.options || {};
    var tendency = p.tendency || {};
    var corpusList = p.corpusList || [];
    var features = p.features || {};
    var historySignals = p.historySignals || null;
    var aiMemory = p.aiMemory || null;

    var messages = [];

    // ---- system prompt：深度理解用户语言DNA ----
    var systemParts = [];
    systemParts.push('你是一个深度学习型大众点评评价生成助手。你不是在套用模板或堆砌高频词，而是在真正理解用户的写作习惯后，以用户的语言 DNA 为基础，写出有真实感受、有细节、有逻辑的评价。');
    systemParts.push('');
    systemParts.push('你需要先内化以下用户语言画像，然后在写作时自然地运用这些规律——不是机械地插入某些词，而是用用户的思维方式去组织语言。');
    systemParts.push('');

    // 核心改变：从"高频词汇列表"变为"语言DNA深度画像"
    if (corpusList && corpusList.length) {
      systemParts.push('【用户语言DNA · 深度画像】');
      systemParts.push('以下是从用户训练语料中逐条深度分析后归纳出的写作规律，你需要理解并内化：');
      systemParts.push('');
      systemParts.push(describeFeatures(features));
    } else {
      systemParts.push('【用户语言DNA】');
      systemParts.push('用户暂未训练语料，请用大众点评常见真实风格生成，保持自然口语化。');
    }

    // AI 记忆：从过往交互中积累的认知
    if (aiMemory && aiMemory.insights && aiMemory.insights.length) {
      systemParts.push('');
      systemParts.push('【你从过往交互中学到的认知】');
      systemParts.push('以下是你在之前帮用户生成评价后，通过用户反馈反思总结出的认知，请在本次生成中运用：');
      aiMemory.insights.forEach(function (insight, idx) {
        systemParts.push((idx + 1) + '. ' + insight);
      });
    }

    // 历史信号：偏好统计 + 反面示例
    var histDesc = describeHistorySignals(historySignals);
    if (histDesc) {
      systemParts.push('');
      systemParts.push(histDesc);
    }

    systemParts.push('');
    systemParts.push('【写作原则】');
    systemParts.push('1. 理解而非套用：上面的语言画像是让你理解用户的表达习惯，不是让你机械插入某些词汇');
    systemParts.push('2. 真实有细节：必须包含至少一个具体细节（菜品名、服务点、价格、环境特征等），禁止空泛套话');
    systemParts.push('3. 逻辑自洽：评价要有起因→体验→感受→结论的逻辑链，不是随机句子堆砌');
    systemParts.push('4. 情感连贯：星级评分与情感基调要一致，不要高星差评或低星好评的矛盾感');
    systemParts.push('5. 不要凭空捏造商家不存在的特征');
    systemParts.push('6. 【去AI味·最重要】必须写得像真人写的大众点评，而不是AI生成的文案：');
    systemParts.push('   - 避免格式化表达：不要用【】、◇、■等符号做小标题或分节，不要用"首先""其次""最后"等套路化连接词');
    systemParts.push('   - 减少emoji和特殊符号：除非用户语料风格强烈依赖emoji，否则尽量不用；即使要用也控制在1-2个以内');
    systemParts.push('   - 尽量写成一段话：不要刻意分段分点，让句子自然衔接，像朋友聊天一样娓娓道来');
    systemParts.push('   - 避免AI常见套路：不要"总体而言""综上所述""值得推荐"等总结性套话，不要对仗工整的排比句，不要过度修饰的形容词堆砌');
    systemParts.push('   - 句式要有真人感：长短句交错，偶尔口语化（"说实话""讲真""不过呢"），不要每句都完美无缺');

    systemParts.push('');
    systemParts.push('【长度约束】');
    systemParts.push(describeLengthConstraint(length));
    systemParts.push('');
    systemParts.push('【星级基调】');
    systemParts.push(describeStarTone(stars));
    systemParts.push('');
    systemParts.push('【输出要求】');
    systemParts.push('输出纯文本评价，不要 markdown 标题，不要解释说明，不要用引号包裹，不要输出多余前后缀。');
    systemParts.push('写成一段连贯的话，不要刻意分段。');

    messages.push({ role: 'system', content: systemParts.join('\n') });

    // ---- few-shot 示例：训练语料（让AI感受用户的真实写法） ----
    var examples = selectFewShot(corpusList, category);
    for (var i = 0; i < examples.length; i++) {
      var ex = examples[i];
      var exCategory = ex.category || '通用';
      messages.push({
        role: 'user',
        content: '以下是用户本人写的「' + exCategory + '」品类真实评价。请感受其语言节奏、句式习惯和表达方式，在后续生成中自然运用（不要照抄内容）：'
      });
      messages.push({
        role: 'assistant',
        content: '我已仔细阅读并内化了这段评价的语言风格。'
      });
      messages.push({ role: 'assistant', content: ex.text });
    }

    // ---- few-shot 示例：用户点赞过的历史评价 ----
    if (historySignals && historySignals.likedExamples && historySignals.likedExamples.length) {
      for (var li = 0; li < historySignals.likedExamples.length; li++) {
        var liked = historySignals.likedExamples[li];
        messages.push({
          role: 'user',
          content: '以下是用户点赞认可过的评价（说明这种写法符合用户偏好）：'
        });
        messages.push({ role: 'assistant', content: liked.text });
      }
    }

    // ---- user 任务描述 ----
    var userDesc = [];
    userDesc.push('请为「' + merchant + '」写一条「' + category + '」品类的点评评价。');
    userDesc.push('星级：' + stars + ' 星');
    userDesc.push('长度：' + describeLengthConstraint(length));
    userDesc.push('需要提到的点：' + describeOptions(options));
    userDesc.push('风格倾向：' + describeTendency(tendency));
    userDesc.push('');
    userDesc.push('请用你对用户语言DNA的理解，写出一条真实自然、有细节、有感受的评价。直接输出正文，不要任何解释。');

    messages.push({ role: 'user', content: userDesc.join('\n') });

    return messages;
  }

  /* ===================================================================
     提问模式 (Q&A Mode) · Prompt 构造
     =================================================================== */

  /**
   * 构造「AI 提问」的 messages 数组
   * @param {Object} p
   *   - merchant: 商家名
   *   - stars: 1-5
   *   - category: 品类（可选，未知则传空）
   *   - answeredQuestions: [{question, answer}] 已回答的问题（用于上下文 + 避免重复）
   *   - features: 用户风格特征
   * @returns {Array<{role, content}>} messages
   *   AI 应返回 JSON：{ "questions": [{"text": "...", "options": [...]}, {"text": "..."}] }
   *   选择题带 options，填空题不带 options（由 AI 自主决定题型）
   */
  function buildQuestionPrompt(p) {
    p = p || {};
    var merchant = p.merchant || '这家店';
    var stars = p.stars || 5;
    var category = p.category || '';
    var answered = p.answeredQuestions || [];
    var features = p.features || {};

    var messages = [];

    // ---- system prompt ----
    var sys = [];
    sys.push('你是大众点评评价生成助手，现在需要为用户写一条关于「' + merchant + '」的点评评价。');
    sys.push('为了写出更真实、更有个人特色的评价，你需要先向用户提问，收集关键信息。');
    sys.push('');
    sys.push('【提问要求】');
    sys.push('1. 提出足够多的问题，不限制数量——你掌握的信息越充分，写出的评价越真实。覆盖评价所需的全维度（包括但不限于：菜品/服务/环境/位置/价格/特色/排队/适合人群/时段/同行人/对比体验等）。');
    sys.push('2. 问题要具体、可回答，避免空泛（如不要问"环境怎么样"，而要问"装修风格是简约还是复古？座位间距舒适吗？"）。');
    sys.push('3. 问题要基于星级和品类智能调整：');
    sys.push('   - ' + describeStarTone(stars));
    if (category) sys.push('   - 品类：' + category + '，问题应聚焦该品类的核心体验维度');
    sys.push('4. 不要重复已回答的问题。');
    sys.push('5. 每个问题简短（15-30 字），便于用户快速回答。');
    sys.push('6. 由你判断每个问题适合"选择题"还是"填空题"：');
    sys.push('   - 选择题：选项明确且可穷举的问题（如装修风格、就餐场景、价格区间），提供 3-4 个选项（A/B/C/D），选项要具体且有区分度。选择题支持多选。');
    sys.push('   - 填空题：答案开放、个性化强的问题（如具体菜品名称、印象最深的细节、独特体验），不提供选项，让用户自由作答。');
    sys.push('   - 大部分问题适合选择题，但不必强求全部；填空题数量由你根据问题性质决定（通常 1-3 个填空题）。');
    sys.push('   - 选择题用户可选择多个选项或填写自定义答案。');
    sys.push('');
    sys.push('【用户风格特征（参考，问题不必围绕风格）】');
    sys.push(describeFeatures(features));
    sys.push('');
    sys.push('【输出格式】');
    sys.push('返回严格 JSON：');
    sys.push('{"questions": [{"text": "问题内容", "options": ["选项A", "选项B", "选项C", "选项D"]}, {"text": "填空题内容"}, ...]}');
    sys.push('选择题带 options 数组，填空题不带 options 字段。不要输出任何其他内容，不要 markdown 代码块标记。');
    messages.push({ role: 'system', content: sys.join('\n') });

    // ---- 已回答上下文 ----
    if (answered.length) {
      var ctx = [];
      ctx.push('已收集的信息：');
      answered.forEach(function (item, idx) {
        ctx.push((idx + 1) + '. 问：' + item.question);
        ctx.push('   答：' + (item.answer || '（用户跳过）'));
      });
      ctx.push('');
      ctx.push('请基于以上已收集信息，提出剩余还需要的问题（共 5-8 个，不重复已问过的）。');
      messages.push({ role: 'user', content: ctx.join('\n') });
    } else {
      var first = [];
      first.push('商家：' + merchant);
      if (category) first.push('品类：' + category);
      first.push('星级：' + stars + ' 星');
      first.push('请提出 5-8 个问题（每个问题带 3-4 个选项），帮助我写出更真实的评价。');
      messages.push({ role: 'user', content: first.join('\n') });
    }

    return messages;
  }

  /**
   * 构造「基于问答生成评价」的 messages 数组
   * @param {Object} p
   *   - merchant, stars, category, length, tendency, corpusList, features
   *   - answers: [{question, answer}] 用户回答
   *   - historySignals: extractHistorySignals() 的返回值（可选）
   * @returns {Array<{role, content}>}
   */
  function buildGenerateFromAnswersPrompt(p) {
    p = p || {};
    var merchant = p.merchant || '这家店';
    var category = p.category || '美食';
    var stars = p.stars || 5;
    var length = p.length || '中';
    var wordCount = p.wordCount; // 任务5：提问模式字数选择（'auto' | 数字字符串 | 数字）
    var tendency = p.tendency || {};
    var corpusList = p.corpusList || [];
    var features = p.features || {};
    var answers = p.answers || [];
    var additionalComment = p.additionalComment || ''; // 任务7：补充备注
    var historySignals = p.historySignals || null;

    // 字数选择优先于 length：若用户在提问模式选了具体字数，则以 wordCount 为准
    var effectiveLength = (wordCount && wordCount !== 'auto') ? wordCount : length;

    var messages = [];

    // ---- system prompt ----
    var sys = [];
    sys.push('你是大众点评评价生成助手，请根据用户回答的真实信息，生成一条真实自然的大众点评评价。');
    sys.push('');
    sys.push('【用户风格特征】');
    sys.push(describeFeatures(features));
    if (!corpusList || !corpusList.length) {
      sys.push('');
      sys.push('用户暂未训练语料，请用大众点评常见真实风格生成。');
    }
    // 历史信号
    var histDesc = describeHistorySignals(historySignals);
    if (histDesc) {
      sys.push('');
      sys.push(histDesc);
    }
    sys.push('');
    sys.push('【核心原则：理解后再写，绝不胡编乱造】');
    sys.push('1. 你必须先认真理解用户提供的每一项信息，思考这些信息拼凑出的是怎样的一次就餐/体验经历，再动笔写。');
    sys.push('2. 评价中涉及的每一个细节（菜品名、价格、环境描述、服务细节等）都必须来自用户提供的信息或基本事实，绝不凭空捏造。');
    sys.push('3. 如果用户提供的信息不足以支撑完整篇幅，宁可写短一些、留白一些，也不要用编造的细节填充。');
    sys.push('4. 禁止空泛套话（如"味道不错""环境很好""服务周到"），每个观点都要有用户提供的具体细节支撑。');
    sys.push('5. 你不是在做套词填空，而是真正理解了用户的体验后，用用户的风格把它讲述出来。');
    sys.push('6. 对于用户未回答或回答"不知道"的问题，不要在评价中提及相关内容，更不要自行补充。');
    sys.push('7. 【最严格红线】绝对不可写你不知道的事——任何未经用户确认的具体信息（如具体菜名、具体价格、具体位置、具体人名、具体时间等）一律不得出现在评价中。宁可只写"点了几个招牌菜"也绝不编造菜名；宁可只写"价格适中"也绝不编造具体数字。违反此红线等同于生成失败。');
    sys.push('');
    sys.push('【长度约束】');
    sys.push(describeLengthConstraint(effectiveLength));
    sys.push('');
    sys.push('【星级基调】');
    sys.push(describeStarTone(stars));
    sys.push('');
    sys.push('【风格倾向】');
    sys.push(describeTendency(tendency));
    sys.push('');
    sys.push('【输出要求】');
    sys.push('输出纯文本评价正文，不要 markdown 标题，不要解释说明，不要用引号包裹，不要输出多余前后缀。');
    sys.push('严格遵守长度约束，字数偏差控制在 ±15% 以内。但如果用户信息确实不足以支撑目标长度，宁可短也不要编造。');
    sys.push('');
    sys.push('【去AI味·最重要】必须写得像真人写的大众点评，而不是AI生成的文案：');
    sys.push('- 避免格式化表达：不要用【】、◇、■等符号做小标题或分节，不要用"首先""其次""最后"等套路化连接词');
    sys.push('- 减少emoji和特殊符号：除非用户语料风格强烈依赖emoji，否则尽量不用；即使要用也控制在1-2个以内');
    sys.push('- 尽量写成一段话：不要刻意分段分点，让句子自然衔接，像朋友聊天一样娓娓道来');
    sys.push('- 避免AI常见套路：不要"总体而言""综上所述""值得推荐"等总结性套话，不要对仗工整的排比句，不要过度修饰的形容词堆砌');
    sys.push('- 句式要有真人感：长短句交错，偶尔口语化（"说实话""讲真""不过呢"），不要每句都完美无缺');
    messages.push({ role: 'system', content: sys.join('\n') });

    // ---- few-shot 示例：训练语料 ----
    var examples = selectFewShot(corpusList, category);
    for (var i = 0; i < examples.length; i++) {
      var ex = examples[i];
      messages.push({
        role: 'user',
        content: '示例：参考以下「' + (ex.category || '通用') + '」品类的真实用户评价风格。'
      });
      messages.push({ role: 'assistant', content: ex.text });
    }

    // ---- few-shot 示例：用户点赞过的历史评价 ----
    if (historySignals && historySignals.likedExamples && historySignals.likedExamples.length) {
      for (var li = 0; li < historySignals.likedExamples.length; li++) {
        var liked = historySignals.likedExamples[li];
        messages.push({
          role: 'user',
          content: '以下是用户本人写过并点赞「认可此风格」的评价，请参考其表达方式（但不要照抄内容）：'
        });
        messages.push({ role: 'assistant', content: liked.text });
      }
    }

    // ---- 用户回答 ----
    var userMsg = [];
    userMsg.push('为「' + merchant + '」写一条「' + category + '」品类的点评评价。');
    userMsg.push('星级：' + stars + ' 星');
    userMsg.push('目标长度：' + describeLengthConstraint(effectiveLength));
    userMsg.push('');
    userMsg.push('以下是我提供的真实信息：');
    answers.forEach(function (item, idx) {
      userMsg.push((idx + 1) + '. ' + item.question);
      userMsg.push('   答：' + (item.answer || '（未提供）'));
    });
    // 任务7：补充备注（与问题同等权重传给 AI）
    if (additionalComment && additionalComment.trim()) {
      userMsg.push('');
      userMsg.push('【补充备注】（与上述问答同等重要，请一并参考）：');
      userMsg.push(additionalComment.trim());
    }
    userMsg.push('');
    userMsg.push('请基于以上信息生成评价正文，直接输出，不要解释。');
    messages.push({ role: 'user', content: userMsg.join('\n') });

    return messages;
  }

  /* ===================================================================
     润色模式 (Polish Mode) · Prompt 构造
     =================================================================== */

  /**
   * 构造「润色」的 messages 数组
   * @param {Object} p
   *   - rawText: 用户原始文本
   *   - features: 用户风格特征（用于个性化润色）
   *   - tendency: 风格倾向
   *   - stars: 目标星级（影响润色基调，可选）
   *   - merchant: 商家名（可选，用于上下文）
   *   - historySignals: extractHistorySignals() 的返回值（可选）
   * @returns {Array<{role, content}>}
   */
  function buildPolishPrompt(p) {
    p = p || {};
    var rawText = p.rawText || '';
    var features = p.features || {};
    var tendency = p.tendency || {};
    var stars = p.stars || 0;
    var merchant = p.merchant || '';
    var wordCount = p.wordCount; // 任务5：润色模式字数选择
    var historySignals = p.historySignals || null;

    var messages = [];

    // ---- system prompt ----
    var sys = [];
    sys.push('你是大众点评评价润色助手，请将用户提供的原始文本润色为更专业、更有感染力的大众点评评价。');
    sys.push('');
    sys.push('【润色原则】');
    sys.push('1. 保留用户原始体验的核心信息和真实感受，不得凭空添加未提及的细节。');
    sys.push('2. 优化语言表达：让句子更流畅、用词更精准、节奏更舒服。');
    sys.push('3. 增强可读性：合理分段、补充必要的过渡、强化重点表达。');
    sys.push('4. 融入用户个人风格特征（如有）：');
    sys.push(describeFeatures(features));
    sys.push('5. 风格倾向：' + describeTendency(tendency));
    if (stars) {
      sys.push('6. 目标星级基调：' + describeStarTone(stars));
    }
    // 任务5：润色模式字数约束
    if (wordCount && wordCount !== 'auto') {
      sys.push('7. 目标长度：' + describeLengthConstraint(wordCount) + '，可在原文字数基础上增删调整以符合约束。');
    }
    // 历史偏好信号
    var histDesc = describeHistorySignals(historySignals);
    if (histDesc) {
      sys.push('');
      sys.push(histDesc);
    }
    sys.push('');
    sys.push('【禁止事项】');
    sys.push('- 不要改变用户表达的核心观点（如好评不能改成差评）');
    sys.push('- 不要添加用户没提过的菜品名、价格、人物等具体信息');
    sys.push('- 不要输出 markdown 标题、解释说明、引号包裹');
    sys.push('- 不要输出"以下是润色后的评价"之类的前缀');
    sys.push('');
    sys.push('【去AI味·最重要】必须写得像真人写的大众点评，而不是AI生成的文案：');
    sys.push('- 避免格式化表达：不要用【】、◇、■等符号做小标题或分节，不要用"首先""其次""最后"等套路化连接词');
    sys.push('- 减少emoji和特殊符号：除非用户原文已有且必要，否则尽量不用；即使要用也控制在1-2个以内');
    sys.push('- 尽量写成一段话：不要刻意分段分点，让句子自然衔接，像朋友聊天一样娓娓道来');
    sys.push('- 避免AI常见套路：不要"总体而言""综上所述""值得推荐"等总结性套话，不要对仗工整的排比句，不要过度修饰的形容词堆砌');
    sys.push('- 句式要有真人感：长短句交错，偶尔口语化（"说实话""讲真""不过呢"），不要每句都完美无缺');
    sys.push('- 润色时如果原文有emoji或特殊符号，酌情保留或精简，但不要新增');
    sys.push('');
    sys.push('【输出要求】');
    sys.push('直接输出润色后的评价正文，纯文本，写成一段连贯的话。');
    if (wordCount && wordCount !== 'auto') {
      sys.push('严格遵守上述目标长度，字数偏差控制在 ±15% 以内。');
    }
    messages.push({ role: 'system', content: sys.join('\n') });

    // ---- few-shot 示例：用户点赞过的历史评价（作为风格参考） ----
    if (historySignals && historySignals.likedExamples && historySignals.likedExamples.length) {
      for (var li = 0; li < historySignals.likedExamples.length; li++) {
        var liked = historySignals.likedExamples[li];
        messages.push({
          role: 'user',
          content: '以下是用户本人写过并点赞「认可此风格」的评价，润色时请参考其表达节奏与用词偏好：'
        });
        messages.push({ role: 'assistant', content: liked.text });
      }
    } else if (features && features.topWords && features.topWords.length) {
      // 仅在有风格特征且无历史点赞示例时给一个简短示例
      messages.push({
        role: 'user',
        content: '示例风格参考：用户高频使用的词汇有 ' + features.topWords.slice(0, 5).map(function (w) { return w.word; }).join('、') + '。'
      });
      messages.push({
        role: 'assistant',
        content: '明白，我会在润色时自然地融入这些用户偏好的表达。'
      });
    }

    // ---- 用户原始文本 ----
    var userMsg = [];
    if (merchant) userMsg.push('商家：' + merchant);
    if (stars) userMsg.push('目标星级：' + stars + ' 星');
    if (wordCount && wordCount !== 'auto') {
      userMsg.push('目标长度：' + describeLengthConstraint(wordCount));
    }
    userMsg.push('');
    userMsg.push('原始文本：');
    userMsg.push(rawText);
    userMsg.push('');
    userMsg.push('请润色这段评价，直接输出润色后的正文。');
    messages.push({ role: 'user', content: userMsg.join('\n') });

    return messages;
  }

  /**
   * 连接测试：发一条最小请求，返回 {ok, type?, message?}
   * @param {Object} cfg {baseURL, apiKey, model, timeout?}
   *   - timeout: 自定义超时毫秒数，缺省 60s（海外模型首包可能较慢）
   */
  function testConnection(cfg) {
    cfg = cfg || {};
    var timeout = (typeof cfg.timeout === 'number' && cfg.timeout > 0) ? cfg.timeout : DEFAULT_TEST_TIMEOUT;
    return chat({
      messages: [{ role: 'user', content: '你好' }],
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: 5,
      timeout: timeout
    }).then(function () {
      return { ok: true };
    }).catch(function (err) {
      return {
        ok: false,
        type: (err && err.type) || 'unknown',
        message: (err && err.message) || '连接失败'
      };
    });
  }

  /* ---------- 深度分析 Prompt 构造 ---------- */

  /**
   * 构建逐条语料深度分析的 prompt
   * 让 AI 真正理解文本的语言规律、格式特征和风格特点
   * 返回 JSON 格式，可直接解析为 styleFeatures
   */
  function buildDeepAnalysisPrompt(text) {
    var systemContent = [
      '你是一位顶级的文本风格分析师与语言学家。请对以下用户评价文本进行极致深度分析，从八个维度提取写作规律，构建用户的"写作DNA图谱"。',
      '',
      '你需要像法医鉴定一样精确，像语言学家一样深入，理解文本的每一个表达选择背后的规律。',
      '',
      '【分析维度（共八维）】',
      '1. 语言表达规律 (languagePatterns)：',
      '   - sentenceStructures: 句式特征数组（如"多用短句""长句叙述""感叹句多""疑问句引导"等，3-5个标签）',
      '   - vocabularyPreference: 词汇偏好数组（如"口语化程度副词""品类专有名词""网络流行语""感官形容词"等，3-5个标签）',
      '   - semanticRelations: 语义逻辑数组（如"因果连词""转折对比""递进补充""条件假设"等，2-4个标签）',
      '   - syntacticHabits: 句法习惯数组（如"主谓宾完整""省略主语""倒装强调""把字句多"等，2-3个标签）',
      '2. 文本格式特征 (formatFeatures)：',
      '   - paragraphStructure: 段落结构描述（如"体验引入→细节展开→总结推荐"等单字符串，需具体）',
      '   - punctuationUsage: 标点习惯数组（如"逗号分句多""句末感叹号""省略号""破折号补充"等，2-4个标签）',
      '   - specialMarkers: 特殊标记数组（如"含emoji""含数字量化""含引号强调""含括号补充"等，可为空数组）',
      '   - lengthPattern: 长度模式（如"短小精悍200字内""中等篇幅300字""长篇详述500字+"等单字符串）',
      '3. 内容风格特点 (styleTraits)：',
      '   - formality: 正式程度，取值 "formal"(书面正式) / "informal"(口语非正式) / "mixed"(半正式半口语)',
      '   - domain: 领域特征（如"美食探店""酒店住宿""美发服务"等，需具体到子领域）',
      '   - emotionalTone: 情感倾向（如"积极推荐""客观陈述""吐槽避雷""矛盾纠结"等）',
      '   - emotionalIntensity: 情感强度，取值 "low"(克制内敛) / "medium"(适度表达) / "high"(强烈外放)',
      '4. 修辞手法 (rhetoricalDevices)：',
      '   - devices: 修辞手法数组（如"比喻""夸张""反问""排比""对比""拟人""通感"等，无则空数组）',
      '   - effectiveness: 修辞效果（如"增强画面感""制造悬念""强化情绪""提升说服力"等单字符串，无则空字符串）',
      '5. 叙事视角 (narrativePerspective)：',
      '   - person: 人称视角，取值 "first"(第一人称) / "second"(第二人称) / "third"(第三人称) / "mixed"(混合)',
      '   - standpoint: 立场（如"亲历者体验""旁观者评述""专家鉴赏""朋友推荐"等单字符串）',
      '   - temporalOrder: 时序（如"顺叙""倒叙""插叙""现在时为主"等单字符串）',
      '6. 信息密度 (informationDensity)：',
      '   - detailLevel: 细节丰富度，取值 "sparse"(稀疏简略) / "moderate"(适中) / "rich"(丰富具体)',
      '   - quantification: 数据使用（如"含价格""含分量""含时间""含人数""含评分"等数组，无则空数组）',
      '   - sceneDescription: 场景描写（如"环境氛围""人物互动""菜品呈现""服务过程"等数组，无则空数组）',
      '7. 说服策略 (persuasionStrategy)：',
      '   - strategies: 说服策略数组（如"情感诉求""逻辑论证""社会证明""权威引用""对比衬托""细节佐证"等，2-4个标签）',
      '   - evidenceType: 证据类型（如"个人体验""具体事例""数据支撑""对比参考"等单字符串）',
      '   - callToAction: 行动号召（如"强烈推荐""值得一试""谨慎避雷""看个人喜好"等单字符串）',
      '8. 感官语言 (sensoryLanguage)：',
      '   - senses: 感官维度数组（如"视觉""听觉""味觉""嗅觉""触觉""空间感"等，无则空数组）',
      '   - imagery: 意象描写（如"色彩鲜明""声音生动""气味浓郁""质感细腻"等单字符串，无则空字符串）',
      '',
      '【置信度自评】',
      '请对本次分析的整体置信度进行自评：',
      '   - confidence: 0-1 之间的数值（1=完全确定，0.5=一般，0=纯猜测）',
      '   - uncertainty: 不确定的地方描述（单字符串，无则空字符串）',
      '',
      '【输出要求】',
      '仅输出 JSON，不要 markdown 代码块标记，不要解释说明。格式如下：',
      '{"languagePatterns":{"sentenceStructures":[],"vocabularyPreference":[],"semanticRelations":[],"syntacticHabits":[]},"formatFeatures":{"paragraphStructure":"","punctuationUsage":[],"specialMarkers":[],"lengthPattern":""},"styleTraits":{"formality":"","domain":"","emotionalTone":"","emotionalIntensity":""},"rhetoricalDevices":{"devices":[],"effectiveness":""},"narrativePerspective":{"person":"","standpoint":"","temporalOrder":""},"informationDensity":{"detailLevel":"","quantification":[],"sceneDescription":[]},"persuasionStrategy":{"strategies":[],"evidenceType":"","callToAction":""},"sensoryLanguage":{"senses":[],"imagery":""},"confidence":0.8,"uncertainty":""}',
      '',
      '【待分析文本】',
      text
    ].join('\n');

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: '请像语言学家一样深度分析以上文本，输出完整 JSON。务必从八个维度全面提取，不要遗漏。' }
    ];
  }

  /* ---------- 导出 ---------- */

  global.AIClient = {
    streamChat: streamChat,
    chat: chat,
    buildGeneratePrompt: buildGeneratePrompt,
    buildQuestionPrompt: buildQuestionPrompt,
    buildGenerateFromAnswersPrompt: buildGenerateFromAnswersPrompt,
    buildDeepAnalysisPrompt: buildDeepAnalysisPrompt,
    buildPolishPrompt: buildPolishPrompt,
    testConnection: testConnection,
    extractHistorySignals: extractHistorySignals,
    // 暴露内部工具（供调试 / 测试）
    _internal: {
      normalizeBaseURL: normalizeBaseURL,
      buildEndpoint: buildEndpoint,
      classifyError: classifyError,
      describeTendency: describeTendency,
      describeOptions: describeOptions,
      describeStarTone: describeStarTone,
      describeLengthConstraint: describeLengthConstraint,
      describeFeatures: describeFeatures,
      selectFewShot: selectFewShot,
      extractHistorySignals: extractHistorySignals,
      describeHistorySignals: describeHistorySignals
    }
  };

})(typeof window !== 'undefined' ? window : this);
