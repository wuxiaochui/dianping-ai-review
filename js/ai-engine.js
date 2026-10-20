/* =====================================================================
   大众点评 AI 评价生成器 · 模拟 AI 引擎
   纯原生 JS · 全局对象 window.AIEngine
   客户端模拟：风格分析 + 检索式生成
   ===================================================================== */
(function (global) {
  'use strict';

  /* ===================================================================
     一、词表与预置语料
     =================================================================== */

  // 中文停用词（高频但无意义的字 / 词）
  var STOP_WORDS = {
    '的': 1, '了': 1, '是': 1, '在': 1, '我': 1, '也': 1, '都': 1, '就': 1,
    '和': 1, '与': 1, '或': 1, '但': 1, '还': 1, '又': 1, '不': 1, '没': 1,
    '有': 1, '这': 1, '那': 1, '个': 1, '们': 1, '上': 1, '下': 1, '到': 1,
    '去': 1, '来': 1, '把': 1, '被': 1, '让': 1, '给': 1, '对': 1, '为': 1,
    '一': 1, '二': 1, '三': 1, '四': 1, '五': 1, '六': 1, '七': 1, '八': 1,
    '九': 1, '十': 1, '很': 1, '太': 1, '真': 1, '超': 1, '挺': 1, '比较': 1,
    '什么': 1, '怎么': 1, '为什么': 1, '可以': 1, '应该': 1, '需要': 1, '觉得': 1,
    '感觉': 1, '认为': 1, '因为': 1, '所以': 1, '如果': 1, '虽然': 1, '不过': 1,
    '然后': 1, '其实': 1, '我们': 1, '你们': 1, '他们': 1, '自己': 1, '一些': 1,
    '一个': 1, '这种': 1, '那种': 1, '这样': 1, '那样': 1, '这里': 1, '那里': 1,
    '哪里': 1, '时候': 1, '现在': 1, '以前': 1, '以后': 1, '今天': 1, '昨天': 1,
    '明天': 1, '已经': 1, '正在': 1, '马上': 1, '一直': 1, '还是': 1, '或者': 1,
    '以及': 1, '并且': 1, '而是': 1, '不是': 1, '不能': 1, '不要': 1, '不会': 1,
    '没有': 1, '只会': 1, '只要': 1, '只有': 1, '而是': 1, '即': 1, '就是': 1,
    '这样': 1, '的话': 1, '之类': 1, '等等': 1, '不过': 1, '比如': 1, '例如': 1,
    '有些': 1, '一些': 1, '一下': 1, '一定': 1, '一般': 1, '原来': 1, '后来': 1
  };

  // 情绪词表
  var POSITIVE_WORDS = ['好吃', '赞', '绝', '爱', '推荐', '满意', '惊喜', '不错', '喜欢', '棒', '香', '鲜', '嫩', '脆', '滑', '入味', '地道', '正宗', '舒服', '贴心', '热情', '周到', '干净', '整洁', '超值', '划算', '物超所值', '神级', '封神', 'yyds', 'YYDS', '绝绝子', '宝藏', '回购'];
  var NEGATIVE_WORDS = ['难吃', '差', '坑', '失望', '踩雷', '避雷', '贵', '咸', '淡', '老', '柴', '腥', '油腻', '脏', '乱', '吵', '慢', '冷', '凉', '硬', '服务差', '态度差', '排队久', '不新鲜', '不推荐'];

  // 品类相关词尾（用于细节关键词识别）
  var DETAIL_SUFFIXES = ['菜', '锅', '面', '饭', '汤', '肉', '鱼', '虾', '茶', '咖啡', '糕', '饼', '串', '卷', '饺', '包', '丸', '排', '腿', '翅', '豆腐', '沙拉', '披萨', '寿司', '刺身', '甜品', '奶茶', '果汁', '酒', '蛋糕', '面包', '汉堡', '三明治'];
  // 服务/环境相关细节词
  var DETAIL_KEYWORDS_POOL = ['环境', '服务', '排队', '人均', '位置', '停车', '卫生', '设施', '隔音', '早餐', '发型师', '效果', '办卡', '等待', '拍照', '出片', '氛围', '装修', '灯光', '音乐', '包间', '卡座', '窗外', '夜景', '夜景', '口味', '分量', '颜值', '摆盘', '火候', '调料', '蘸料', '底料', '汤底', '食材', '新鲜度'];

  // 品类识别关键词表（用于 detectCategory，加权打分）
  // 与 train.js 中的 CATEGORIES 保持一致（'美甲美睫' 对应 PRESET_CORPUS 中的 '美业'，二者在识别后归一化）
  var CATEGORY_KEYWORDS = {
    '美食': ['菜', '餐厅', '馆', '火锅', '咖啡', '奶茶', '烤鱼', '招牌菜', '上菜', '点菜', '菜单', '蘸料', '底料', '汤底', '汤', '饭', '面', '肉', '鱼', '虾', '蟹', '甜品', '蛋糕', '面包', '甜品', '果汁', '酒', '人均', '味道', '好吃', '难吃', '口味', '分量', '火候', '食材', '摆盘', '餐厅', '店', '烘焙', '烤', '煮', '蒸', '炒', '炸', '煎', '排队等菜', '毛肚', '虾滑', '蘸料台', '咖啡', '茶', '饮料', '菜馆', '私房菜', '日料', '寿司', '刺身', '披萨', '汉堡', '三明治', '串串', '烧烤', '烤肉', '日式', '韩式', '中餐', '西餐', '粤菜', '川菜', '湘菜', '鲁菜', '江浙菜', '本帮菜', '甜品店', '饮品店', '咖啡馆', '面包店', '烘焙店'],
    '美发': ['发型', '发型师', '剪头发', '理发', '烫染', '理发店', '头发', '剪发', '染发', '烫发', '造型', '毛寸', '刘海', '剪刀', '吹风', 'tony', 'Tony', '理发师', '洗发', '护发', '发质', '脸型', '层次感', '剪完', '染完', '烫完', '发色', '挑染', '理发', '美发店', '发型屋', '造型师', '剪短', '留长', '剪齐', '打薄'],
    '酒店': ['房间', '住', '民宿', '酒店', '床品', '早餐', '前台', '入住', '退房', '隔音', '空调', '卫生', '卫生间', '浴室', '枕头', '被子', '床', '套房', '标间', '大床房', '双床房', '观景', '山景', '海景', '夜景', '老板娘', '老板', '客栈', '旅馆', '住宿', '停车', '地铁口', '位置', '市中心', '欢迎水果', '现煮', '度假', '度假村', '客栈', '青旅', '汽车旅馆'],
    '休闲': ['按摩', 'SPA', 'spa', '足疗', '洗浴', '汗蒸', '采耳', '推油', '精油', '技师', '按摩师', '理疗', '推拿', '艾灸', '拔罐', '刮痧', '泡汤', '温泉', '汤泉', '桑拿', '会所', '养生', '放松', '舒压', '经络', '穴位'],
    '健身': ['健身', '教练', '私教', '跑步', '器材', '瑜伽', '动感单车', '游泳池', '健身房', '训练', '增肌', '减脂', '塑形', '体态', '体测', 'inbody', 'InBody', '团课', '操课', '杠铃', '哑铃', '深蹲', '硬拉', '卧推', '普拉提', '莱美'],
    '电影': ['电影', '影院', 'IMAX', 'imax', '3D', '爆米花', '观影', '影片', '排片', '场次', '影厅', '影城', '售票', '选座', '贺岁', '首映', '导演', '演员', '演技', '剧情', '特效', '字幕', '配音', '原声', '巨幕', '杜比', 'LUXE', 'CGS'],
    '亲子': ['孩子', '宝宝', '亲子', '儿童', '游乐场', '玩具', '绘本', '早教', '游乐', '游乐园', '亲子餐厅', '亲子酒店', '婴儿', '幼儿', '小孩', '宝妈', '宝爸', '带娃', '溜娃', '亲子互动', '母婴', '儿童乐园', '室内乐园', '海洋球', '滑梯', '蹦床'],
    '购物': ['商场', '超市', '购物', '逛街', '店铺', '专柜', '商品', '买', '卖', '价格', '折扣', '打折', '促销', '优惠', '满减', '优惠券', '专柜', '超市', '便利店', '商场', '购物中心', 'shopping', 'Shopping', '商品', '店员', '导购', '收银', '试衣间', '尺码', '款式', '上新', '断货', '补货', '专柜价'],
    '美甲美睫': ['美甲', '美睫', '指甲', '睫毛', '指甲油', '甲油', '延长甲', '光疗甲', '嫁接睫毛', '美甲师', '美睫师', '甲油胶', '卸甲', '补色', '甲型', '上色', '美甲店', '美睫店', '美业', '做指甲', '做美甲', '做睫毛', '甲片', '法式', '渐变', '猫眼', '手绘', '雕花'],
    'KTV': ['KTV', 'ktv', '唱歌', '包间', '麦霸', '话筒', '点歌', '音响', '点歌机', '麦克风', '包厢', '欢唱', 'K歌', 'K房', '量贩', '夜总会', '包夜', '小包', '中包', '大包', '嗨歌', '抢麦', '切歌']
  };

  // 品类归一化映射（PRESET_CORPUS 中的别名 → 标准品类名）
  var CATEGORY_ALIASES = {
    '美业': '美甲美睫'
  };

  // 内置「大众点评通用真实风格」预置语料（空语料兜底）
  var PRESET_CORPUS = [
    { text: '今天和朋友来打卡这家店，整体体验还不错。招牌菜确实有亮点，火候掌握得好，外焦里嫩，吃起来很有层次感。服务员态度也热情，会主动推荐菜品和提醒分量。人均价格适中，环境干净整洁，适合朋友小聚。下次还会再来，推荐给大家。', category: '美食', styleFeatures: { sentiment: 'positive' } },
    { text: '周末来这家吃火锅，点了一个鸳鸯锅，辣锅够味但不燥，番茄锅酸甜适中。毛肚新鲜下锅七上八下就熟了，口感脆嫩。虾滑也是店里现做的，能吃到虾肉的颗粒感。蘸料台种类很多，自己调的小料很合口味。排队大概半小时，但值得等待。', category: '美食', styleFeatures: { sentiment: 'positive' } },
    { text: '这家咖啡馆藏在巷子里，环境很安静，适合带电脑来办公。手冲咖啡老板现做，会介绍豆子的风味，我选的耶加雪菲有花香和柑橘酸，喝起来很干净。点了一份巴斯克蛋糕，外层焦香内里绵软，搭配咖啡刚刚好。人均五十左右，性价比不错。', category: '美食', styleFeatures: { sentiment: 'positive' } },
    { text: '去剪了个新发型，发型师很耐心地听了我想要的效果，先分析了脸型和发质再动手。剪完之后整体气质都不一样了，层次感出来了，回家自己也好打理。店里环境干净，没有推销办卡，体验很舒服。下次还来找这位发型师。', category: '美发', styleFeatures: { sentiment: 'positive' } },
    { text: '住了两晚，房间面积不算大但布局合理，床品很舒服，枕头有两种硬度可选。位置在市中心，地铁口出来走五分钟就到，周边吃饭购物都方便。早餐种类不算多但够吃，现煮的面条和现榨果汁加分。隔音一般，临街房间有点吵，建议预订内侧的。', category: '酒店', styleFeatures: { sentiment: 'neutral' } },
    { text: '这家店排队两小时才吃上，期待值拉满了。结果招牌菜味道中规中矩，没有惊艳的感觉，分量也偏少。服务员忙得顾不上，叫了好几次才加水。环境倒是挺有特色的，适合拍照打卡。但单纯从口味来说，性价比不高，应该不会再来第二次。', category: '美食', styleFeatures: { sentiment: 'negative' } },
    { text: '晚饭点了招牌的烤鱼，鱼肉嫩滑入味，配菜的土豆和藕片吸满了汤汁，越吃越香。店里生意很好，等了二十分钟才上菜，不过服务员态度不错，主动送了一份小菜。两个人吃刚好，剩了一点打包带走。整体推荐，下次想试试其他口味。', category: '美食', styleFeatures: { sentiment: 'positive' } },
    { text: '来做美甲，选的颜色上色很均匀，美甲师手法熟练，操作过程也很细心，会反复确认形状和长度。店里装修风格清新，等候区还有茶水和小零食。价格透明，没有隐形消费，做完的效果比预期还好，已经预约了下一次补色。', category: '美业', styleFeatures: { sentiment: 'positive' } },
    { text: '这家店真的绝绝子！招牌菜一口下去直接封神，yyds！环境超级出片，每个角落都能拍出大片感。服务员小姐姐人超好，全程贴心推荐。人均一百出头，这个品质真的物超所值，已经加入我的回购清单，强烈安利给所有姐妹！', category: '美食', styleFeatures: { sentiment: 'positive' } },
    { text: '民宿位置有点偏，打车不太好找。但到了之后发现环境超出预期，院子里能看到山景，晚上很安静。房间干净，老板提前开了空调，还准备了欢迎水果。早餐是老板娘现做的，米线很地道。整体适合想躲清静的人，自驾的话更方便。', category: '酒店', styleFeatures: { sentiment: 'positive' } }
  ];

  /* ===================================================================
     二、工具函数
     =================================================================== */

  /** 取 [min, max) 之间的随机整数 */
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
  }

  /** 从数组随机取一项 */
  function pick(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** 从数组随机取 n 项（不重复） */
  function pickN(arr, n) {
    if (!arr || !arr.length) return [];
    var copy = arr.slice();
    var result = [];
    var count = Math.min(n, copy.length);
    for (var i = 0; i < count; i++) {
      var idx = Math.floor(Math.random() * copy.length);
      result.push(copy[idx]);
      copy.splice(idx, 1);
    }
    return result;
  }

  /** 数组打乱 */
  function shuffle(arr) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /** 判断是否为 emoji 字符（含组合字符序列，简易版） */
  function isEmojiChar(ch) {
    // 覆盖常见 emoji 范围：表情符号、修饰符、旗帜等
    var cp = ch.codePointAt(0);
    return (
      (cp >= 0x1F300 && cp <= 0x1FAFF) ||  // 符号与象形文字
      (cp >= 0x1F600 && cp <= 0x1F64F) ||  // 表情
      (cp >= 0x1F680 && cp <= 0x1F6FF) ||  // 交通与地图
      (cp >= 0x2600 && cp <= 0x27BF) ||    // 杂项符号与装饰
      (cp >= 0xFE00 && cp <= 0xFE0F) ||    // 变体选择符
      (cp >= 0x1F900 && cp <= 0x1F9FF) ||  // 补充符号与象形
      (cp >= 0x2300 && cp <= 0x23FF)       // 杂项技术符号（含 ⌨ ☔ 等）
    );
  }

  /** 提取字符串中所有 emoji（按字符遍历，处理代理对） */
  function extractEmojis(text) {
    var result = [];
    if (!text) return result;
    // 用 Array.from 正确处理 Unicode 码点
    var chars = Array.from(text);
    for (var i = 0; i < chars.length; i++) {
      if (isEmojiChar(chars[i])) {
        // 合并连续的变体选择符和修饰符
        var emoji = chars[i];
        while (i + 1 < chars.length && (isEmojiChar(chars[i + 1]) || chars[i + 1].codePointAt(0) === 0x200D)) {
          emoji += chars[i + 1];
          i++;
        }
        result.push(emoji);
      }
    }
    return result;
  }

  /** 按句切分（中文标点 . ! ? 与换行） */
  function splitSentences(text) {
    if (!text) return [];
    return text.split(/[。！？!?\n]+/).map(function (s) {
      return s.trim();
    }).filter(function (s) {
      return s.length > 0;
    });
  }

  /** 中文简易分词：2-4 字滑窗 + 停用词过滤 */
  function tokenize(text) {
    if (!text) return [];
    var tokens = [];
    // 先按标点与空白切成短语段
    var segments = text.split(/[，,。！？!?\s、；;：:（）()【】《》""''""''\-—·.]+/);
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      if (!seg) continue;
      // 2-4 字滑窗
      for (var size = 2; size <= 4; size++) {
        for (var i = 0; i + size <= seg.length; i++) {
          var word = seg.substr(i, size);
          if (STOP_WORDS[word]) continue;
          // 过滤纯数字 / 纯英文标点
          if (/^[\d\s]+$/.test(word)) continue;
          tokens.push(word);
        }
      }
      // 单字（仅当是品类相关字时保留，避免噪声）
      if (seg.length === 1 && DETAIL_SUFFIXES.indexOf(seg) !== -1) {
        tokens.push(seg);
      }
    }
    return tokens;
  }

  /** 计算词频，返回 top N 的 {word, count} 数组 */
  function topWords(tokens, n) {
    n = n || 10;
    var freq = {};
    tokens.forEach(function (w) {
      freq[w] = (freq[w] || 0) + 1;
    });
    var arr = Object.keys(freq).map(function (w) {
      return { word: w, count: freq[w] };
    });
    arr.sort(function (a, b) { return b.count - a.count; });
    return arr.slice(0, n);
  }

  /** 计算词频（返回 {word: count} 形式，用于聚合） */
  function wordFreq(tokens) {
    var freq = {};
    tokens.forEach(function (w) {
      freq[w] = (freq[w] || 0) + 1;
    });
    return freq;
  }

  /** 统计情绪倾向 */
  function detectSentiment(text) {
    if (!text) return 'neutral';
    var pos = 0, neg = 0;
    POSITIVE_WORDS.forEach(function (w) {
      var idx = text.indexOf(w);
      while (idx !== -1) { pos++; idx = text.indexOf(w, idx + 1); }
    });
    NEGATIVE_WORDS.forEach(function (w) {
      var idx = text.indexOf(w);
      while (idx !== -1) { neg++; idx = text.indexOf(w, idx + 1); }
    });
    if (pos > neg + 1) return 'positive';
    if (neg > pos + 1) return 'negative';
    return 'neutral';
  }

  /** 提取细节关键词：从文本中找出含品类相关词尾的词 */
  function extractDetailKeywords(text) {
    if (!text) return [];
    var found = {};
    // 直接匹配预定义细节词
    DETAIL_KEYWORDS_POOL.forEach(function (kw) {
      if (text.indexOf(kw) !== -1) found[kw] = true;
    });
    // 提取「以品类词尾结尾」的词
    var segments = text.split(/[，,。！？!?\s、；;：:（）()【】《》""''""''\-—·.]+/);
    segments.forEach(function (seg) {
      if (!seg || seg.length < 2 || seg.length > 6) return;
      for (var i = 0; i < DETAIL_SUFFIXES.length; i++) {
        if (seg.endsWith(DETAIL_SUFFIXES[i])) {
          found[seg] = true;
          break;
        }
      }
    });
    return Object.keys(found).slice(0, 12);
  }

  /* ===================================================================
     三、风格分析
     =================================================================== */

  /* ---------- 三维度深度分析：语言规律 / 格式特征 / 风格特点 ---------- */

  // 口语化词汇表
  var COLLOQUIAL_WORDS = ['真的', '超级', '特别', '贼', '巨', '超级', '超', '太', '好', '真的太', '简直', '直接', '一下', '就是', '那种', '这个', '那个', '反正', '不过', '其实', '感觉', '觉得', '好像', '应该', '一下', '有点', '一些', '差不多', '还可以', '还行', '蛮', '挺'];
  // 书面语词汇表
  var FORMAL_WORDS = ['此外', '然而', '因此', '综上', '整体', '总体', '环境', '氛围', '体验', '推荐', '建议', '值得', '符合', '预期', '位于', '提供', '设有', '具备', '较为', '颇', '甚', '予以', '较为'];
  // 网络流行语
  var INTERNET_SLANG = ['yyds', 'YYDS', '绝绝子', '封神', '种草', '拔草', '避雷', '踩雷', '宝藏', '回购', '安利', '出片', '打卡', '氛围感', '松弛感', '性价比', '物超所值', '神仙', '宝藏店铺'];
  // 程度副词
  var DEGREE_ADVERBS = ['很', '非常', '特别', '十分', '相当', '极其', '格外', '分外', '尤为', '尤为', '挺', '蛮', '比较', '稍微', '略', '颇'];
  // 因果连词
  var CAUSAL_CONJ = ['因为', '所以', '由于', '因此', '于是', '既然', '之所以', '导致'];
  // 转折连词
  var TRANSITION_CONJ = ['但是', '不过', '然而', '可是', '虽然', '尽管', '只是', '倒是'];
  // 递进连词
  var PROGRESSIVE_CONJ = ['而且', '并且', '此外', '另外', '还有', '同时', '不仅', '甚至', '更'];

  /**
   * 维度一：语言表达规律分析
   * 识别语法结构、词汇选择偏好、语义逻辑关系
   */
  function analyzeLanguagePatterns(text, sentences, tokens) {
    text = text || '';
    // 1. 语法结构特征
    var structures = [];
    var hasExclamation = /[！!]/.test(text);
    var hasQuestion = /[？?]/.test(text);
    var shortSentCount = 0;
    var longSentCount = 0;
    sentences.forEach(function (s) {
      if (s.length <= 8) shortSentCount++;
      if (s.length >= 25) longSentCount++;
    });
    if (shortSentCount > sentences.length * 0.4) structures.push('多用短句');
    if (longSentCount > sentences.length * 0.3) structures.push('长句叙述');
    if (hasExclamation) structures.push('感叹句式');
    if (hasQuestion) structures.push('设问句式');
    // 判断句（"是..."、"算..."）
    if (/(?:是|算是|算是|属于)/.test(text)) structures.push('判断句式');
    // 被动句
    if (/[被让]/.test(text)) structures.push('被动句式');
    if (!structures.length) structures.push('陈述句为主');

    // 2. 词汇选择偏好
    var vocabPref = [];
    var colloquialCount = countKeywordMatches(text, COLLOQUIAL_WORDS);
    var formalCount = countKeywordMatches(text, FORMAL_WORDS);
    var slangCount = countKeywordMatches(text, INTERNET_SLANG);
    var degreeCount = countKeywordMatches(text, DEGREE_ADVERBS);
    if (colloquialCount >= 2) vocabPref.push('口语化词汇');
    if (formalCount >= 2) vocabPref.push('书面语');
    if (slangCount >= 1) vocabPref.push('网络流行语');
    if (degreeCount >= 2) vocabPref.push('程度副词丰富');
    if (!vocabPref.length) vocabPref.push('通用词汇');

    // 3. 语义逻辑关系
    var semanticRel = [];
    var causalCount = countKeywordMatches(text, CAUSAL_CONJ);
    var transitionCount = countKeywordMatches(text, TRANSITION_CONJ);
    var progressiveCount = countKeywordMatches(text, PROGRESSIVE_CONJ);
    if (causalCount >= 1) semanticRel.push('因果推导');
    if (transitionCount >= 1) semanticRel.push('转折对比');
    if (progressiveCount >= 1) semanticRel.push('递进补充');
    // 并列（顿号、分号）
    if (/[、；;]/.test(text)) semanticRel.push('并列枚举');
    if (!semanticRel.length) semanticRel.push('平铺直叙');

    return {
      sentenceStructures: structures,
      vocabularyPreference: vocabPref,
      semanticRelations: semanticRel
    };
  }

  /** 统计文本中匹配关键词表中词的总次数 */
  function countKeywordMatches(text, words) {
    var count = 0;
    for (var i = 0; i < words.length; i++) {
      var idx = text.indexOf(words[i]);
      while (idx !== -1) { count++; idx = text.indexOf(words[i], idx + 1); }
    }
    return count;
  }

  /**
   * 维度二：文本格式特征分析
   * 段落结构、标点符号使用规范、特殊标记格式
   */
  function analyzeFormatFeatures(text, sentences) {
    text = text || '';
    // 1. 段落结构
    var paragraphStructure = '单段';
    var newlines = (text.match(/\n/g) || []).length;
    if (newlines >= 3) paragraphStructure = '多段分层';
    else if (newlines >= 1) paragraphStructure = '分段叙述';

    // 2. 标点符号使用
    var punctUsage = [];
    var commaCount = (text.match(/[，,]/g) || []).length;
    var periodCount = (text.match(/[。]/g) || []).length;
    var exclaimCount = (text.match(/[！!]/g) || []).length;
    var ellipsisCount = (text.match(/[…\.]{2,}|……/g) || []).length;
    var dashCount = (text.match(/[—–-]{1,}/g) || []).length;
    var totalPunct = commaCount + periodCount + exclaimCount + ellipsisCount + dashCount;
    if (totalPunct === 0) {
      punctUsage.push('标点稀少');
    } else {
      if (commaCount / Math.max(totalPunct, 1) > 0.45) punctUsage.push('逗号为主');
      if (exclaimCount >= 2) punctUsage.push('感叹号密集');
      if (ellipsisCount >= 1) punctUsage.push('省略号点缀');
      if (dashCount >= 1) punctUsage.push('破折号补充');
      if (periodCount / Math.max(totalPunct, 1) > 0.35) punctUsage.push('句号收束');
    }

    // 3. 特殊标记格式
    var specialMarkers = [];
    if (extractEmojis(text).length > 0) specialMarkers.push('emoji 穿插');
    if (/\d+[、.．]/.test(text)) specialMarkers.push('数字列举');
    if (/[（(]/.test(text)) specialMarkers.push('括号补充');
    if (/[《【\[「""]/.test(text)) specialMarkers.push('书名/引号标记');
    if (/[～~]/.test(text)) specialMarkers.push('波浪号语气');
    if (!specialMarkers.length) specialMarkers.push('无特殊标记');

    return {
      paragraphStructure: paragraphStructure,
      punctuationUsage: punctUsage,
      specialMarkers: specialMarkers
    };
  }

  /**
   * 维度三：内容风格特点分析
   * 正式/非正式程度、专业领域特征、情感表达倾向
   */
  function analyzeStyleTraits(text, sentiment, detailKeywords) {
    text = text || '';
    // 1. 正式程度
    var formalScore = countKeywordMatches(text, FORMAL_WORDS);
    var colloquialScore = countKeywordMatches(text, COLLOQUIAL_WORDS) + countKeywordMatches(text, INTERNET_SLANG);
    var formality = 'mixed';
    if (formalScore > colloquialScore + 1) formality = 'formal';
    else if (colloquialScore > formalScore + 1) formality = 'informal';

    // 2. 专业领域（基于细节关键词和品类词）
    var domain = '通用';
    if (detailKeywords && detailKeywords.length) {
      var dk = detailKeywords.join('');
      if (/菜|味|好吃|口味|分量|火候|食材|摆盘|餐厅|馆/.test(dk)) domain = '美食';
      else if (/发型|剪|烫|染|头发|造型/.test(dk)) domain = '美发';
      else if (/房间|住|床|前台|入住|退房/.test(dk)) domain = '酒店';
      else if (/甲|睫毛|美甲|美睫/.test(dk)) domain = '美甲美睫';
      else if (/健身|教练|器材|瑜伽/.test(dk)) domain = '健身';
      else if (/电影|影院|IMAX/.test(dk)) domain = '电影';
    }

    // 3. 情感表达倾向
    var emotionalTone = '客观陈述';
    if (sentiment === 'positive') {
      if (countKeywordMatches(text, INTERNET_SLANG) >= 2) emotionalTone = '惊喜种草';
      else if (countKeywordMatches(text, ['推荐', '满意', '喜欢', '回购', '下次']) >= 1) emotionalTone = '热情推荐';
      else emotionalTone = '温和好评';
    } else if (sentiment === 'negative') {
      if (countKeywordMatches(text, ['避雷', '踩雷', '失望', '不推荐', '不会再来']) >= 1) emotionalTone = '吐槽避雷';
      else emotionalTone = '克制差评';
    } else {
      if (countKeywordMatches(text, ['不过', '但是', '唯一']) >= 1) emotionalTone = '中立有保留';
    }

    return {
      formality: formality,
      domain: domain,
      emotionalTone: emotionalTone
    };
  }

  /**
   * 分析文本风格
   * @param {string} text
   * @returns {Object} styleFeatures
   *   - topWords: [{word, count}]
   *   - emojis: [{char, count}]
   *   - avgSentenceLength: number
   *   - sentenceOpeners: [string]  句首 2-4 字短语
   *   - sentiment: 'positive'|'neutral'|'negative'
   *   - detailKeywords: [string]
   *   - languagePatterns: {sentenceStructures, vocabularyPreference, semanticRelations}  语言规律
   *   - formatFeatures: {paragraphStructure, punctuationUsage, specialMarkers}           格式特征
   *   - styleTraits: {formality, domain, emotionalTone}                                  风格特点
   */
  function analyzeStyle(text) {
    text = text || '';
    var sentences = splitSentences(text);
    var tokens = tokenize(text);
    var topW = topWords(tokens, 10);

    // emoji 提取与计数
    var emojis = extractEmojis(text);
    var emojiFreq = {};
    emojis.forEach(function (e) { emojiFreq[e] = (emojiFreq[e] || 0) + 1; });
    var emojiList = Object.keys(emojiFreq).map(function (e) {
      return { char: e, count: emojiFreq[e] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 8);

    // 平均句长
    var totalLen = 0;
    sentences.forEach(function (s) { totalLen += s.length; });
    var avgLen = sentences.length ? Math.round(totalLen / sentences.length) : 0;

    // 句首词（每句前 2-3 字，确定性提取，避免随机扰动）
    var openers = {};
    sentences.forEach(function (s) {
      [2, 3].forEach(function (n) {
        if (s.length >= n) {
          var op = s.substr(0, n);
          if (!STOP_WORDS[op]) openers[op] = (openers[op] || 0) + 1;
        }
      });
    });
    var openerList = Object.keys(openers).map(function (k) {
      return { opener: k, count: openers[k] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 6).map(function (x) {
      return x.opener;
    });

    var sentiment = detectSentiment(text);
    var detailKw = extractDetailKeywords(text);

    // 三维度深度分析：逐条精细化识别语言规律、格式特征、风格特点
    var languagePatterns = analyzeLanguagePatterns(text, sentences, tokens);
    var formatFeatures = analyzeFormatFeatures(text, sentences);
    var styleTraits = analyzeStyleTraits(text, sentiment, detailKw);

    return {
      topWords: topW,
      emojis: emojiList,
      avgSentenceLength: avgLen,
      sentenceOpeners: openerList,
      sentiment: sentiment,
      detailKeywords: detailKw,
      languagePatterns: languagePatterns,
      formatFeatures: formatFeatures,
      styleTraits: styleTraits
    };
  }

  /* ===================================================================
     三-B、AI 驱动的深度分析（调用真实 AI API）
     =================================================================== */

  /**
   * 用 AI API 深度分析单条语料
   * - 必须配置 AI API，否则 reject（不再提供本地兜底）
   * - AI 调用失败 → reject，由调用方决定跳过或重试
   * @param {string} text 待分析文本
   * @returns {Promise<Object>} 分析结果（含 languagePatterns 等八维度）
   */
  function deepAnalyzeStyle(text) {
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;

    // 未配置 AI → 直接拒绝（不再回退本地分析）
    if (!isRealAIEnabled(cfg) || !global.AIClient || typeof global.AIClient.chat !== 'function') {
      return Promise.reject(new Error('AI 未配置，无法进行深度分析'));
    }

    // 配置了 AI → 调用 AI 做八维度深度分析
    var messages = global.AIClient.buildDeepAnalysisPrompt(text);
    var startTime = Date.now();
    var textPreview = (text || '').slice(0, 30) + '…';
    // 深度分析需要：低温度（严谨稳定）+ 高 maxTokens（八维度 JSON 完整输出）
    return global.AIClient.chat({
      messages: messages,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: 3000,        // 八维度完整 JSON 需 1500-2500 tokens，留足空间避免截断
      temperature: 0.4,       // 深度分析需严谨，降低随机性（原 0.9 过高）
      timeout: 60000          // 深度分析耗时较长，延长到 60s
    }).then(function (content) {
      var elapsed = Date.now() - startTime;
      // 调试日志：让用户能在控制台确认 AI 确实被调用
      console.log('[deepAnalyzeStyle] AI 分析完成 | 耗时 ' + elapsed + 'ms | 返回 ' + (content ? content.length : 0) + ' 字符 | 文本: "' + textPreview + '"');
      // 解析 AI 返回的 JSON
      var parsed = parseDeepAnalysisJSON(content);
      if (!parsed) {
        // JSON 解析失败 → reject，由调用方跳过
        console.warn('[deepAnalyzeStyle] JSON 解析失败，原始返回前 200 字: ' + (content || '').slice(0, 200));
        throw new Error('AI 返回内容解析失败');
      }
      // 合并：以本地统计特征为基底，叠加 AI 八维度深度分析
      var local = analyzeStyle(text);
      local.languagePatterns = parsed.languagePatterns || local.languagePatterns;
      local.formatFeatures = parsed.formatFeatures || local.formatFeatures;
      local.styleTraits = parsed.styleTraits || local.styleTraits;
      // 新增五维度（AI 独有，本地无法提取）
      local.rhetoricalDevices = parsed.rhetoricalDevices || { devices: [], effectiveness: '' };
      local.narrativePerspective = parsed.narrativePerspective || { person: 'first', standpoint: '亲历者体验', temporalOrder: '顺叙' };
      local.informationDensity = parsed.informationDensity || { detailLevel: 'moderate', quantification: [], sceneDescription: [] };
      local.persuasionStrategy = parsed.persuasionStrategy || { strategies: [], evidenceType: '个人体验', callToAction: '' };
      local.sensoryLanguage = parsed.sensoryLanguage || { senses: [], imagery: '' };
      // 置信度自评
      local.confidence = parsed.confidence || 0.7;
      local.uncertainty = parsed.uncertainty || '';
      // 标记：本次分析确实由 AI 完成（供 UI / 日志验证）
      local._analyzedByAI = true;
      local._analysisDuration = elapsed;
      return local;
    });
    // 不再 .catch：让错误传播，由 runAnalysis 处理（已改为串行逐条分析）
  }

  /** 解析 AI 返回的深度分析 JSON（容错：去 markdown 标记、找 JSON 边界、修复常见格式问题） */
  function parseDeepAnalysisJSON(content) {
    if (!content || typeof content !== 'string') return null;
    var str = content.trim();
    // 去除可能的 markdown 代码块标记
    str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    // 找到第一个 { 和最后一个 } 之间的内容
    var start = str.indexOf('{');
    var end = str.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    str = str.substring(start, end + 1);

    // 容错 1：去除单行注释（// ...）和多行注释（/* ... */）
    str = str.replace(/\/\/[^\n\r]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // 容错 2：去除尾随逗号（JSON.parse 不允许 ,] 或 ,}）
    str = str.replace(/,\s*([\]}])/g, '$1');

    // 容错 3：将单引号字符串转为双引号（AI 偶尔会用单引号）
    str = str.replace(/'([^']*)'/g, function (match, inner) {
      return '"' + inner.replace(/"/g, '\\"') + '"';
    });

    // 第一次尝试：直接解析
    var parseError = null;
    try {
      var obj = JSON.parse(str);
      if (validateAnalysisObject(obj)) return obj;
    } catch (e) {
      parseError = e;
    }

    // 第二次尝试：如果 JSON 被截断，尝试补全缺失的闭合括号
    if (parseError) {
      var repaired = repairTruncatedJSON(str);
      if (repaired !== str) {
        try {
          var obj2 = JSON.parse(repaired);
          if (validateAnalysisObject(obj2)) {
            console.warn('[parseDeepAnalysisJSON] JSON 截断，已自动修复补全括号');
            return obj2;
          }
        } catch (e2) {
          parseError = e2;
        }
      }
    }

    // 第三次尝试：逐层提取可用的维度数据（即使整体 JSON 不完整，也尽量抢救已解析的部分）
    var partial = extractPartialAnalysis(str);
    if (partial) {
      console.warn('[parseDeepAnalysisJSON] JSON 不完整，已提取部分维度数据');
      return partial;
    }

    console.error('[parseDeepAnalysisJSON] 解析失败:', parseError && parseError.message, '| 原始前 300 字:', str.slice(0, 300));
    return null;
  }

  /** 校验分析对象是否包含至少一个有效维度 */
  function validateAnalysisObject(obj) {
    if (!obj) return false;
    var hasDim = (obj.languagePatterns || obj.formatFeatures || obj.styleTraits ||
                  obj.rhetoricalDevices || obj.narrativePerspective ||
                  obj.informationDensity || obj.persuasionStrategy || obj.sensoryLanguage);
    if (!hasDim) return false;
    // 规范化置信度
    if (typeof obj.confidence !== 'number') {
      obj.confidence = 0.7;
    } else {
      obj.confidence = Math.max(0, Math.min(1, obj.confidence));
    }
    return true;
  }

  /** 修复被截断的 JSON：补全缺失的 ] 和 } */
  function repairTruncatedJSON(str) {
    // 统计未闭合的 [ 和 {
    var stack = [];
    var inString = false;
    var escape = false;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '[' || ch === '{') stack.push(ch);
      else if (ch === ']') { if (stack[stack.length - 1] === '[') stack.pop(); }
      else if (ch === '}') { if (stack[stack.length - 1] === '{') stack.pop(); }
    }
    // 去除可能的尾随逗号
    var trimmed = str.replace(/[,\s]+$/, '');
    // 按栈逆序补全
    for (var j = stack.length - 1; j >= 0; j--) {
      if (stack[j] === '[') trimmed += ']';
      else if (stack[j] === '{') trimmed += '}';
    }
    return trimmed;
  }

  /** 从不完整的 JSON 中提取部分维度数据（尽量抢救） */
  function extractPartialAnalysis(str) {
    var dims = ['languagePatterns', 'formatFeatures', 'styleTraits',
                'rhetoricalDevices', 'narrativePerspective',
                'informationDensity', 'persuasionStrategy', 'sensoryLanguage'];
    var result = {};
    var found = 0;

    dims.forEach(function (dim) {
      // 尝试匹配 "dim": { ... } 或 "dim": {...}
      var patterns = [
        new RegExp('"' + dim + '"\\s*:\\s*\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}', 'g'),
        new RegExp('"' + dim + '"\\s*:\\s*\\{([\\s\\S]*?)\\}', 'g')
      ];
      for (var p = 0; p < patterns.length; p++) {
        var match = patterns[p].exec(str);
        if (match) {
          var inner = '{' + match[1] + '}';
          // 去除尾随逗号
          inner = inner.replace(/,\s*([\]}])/g, '$1');
          try {
            result[dim] = JSON.parse(inner);
            found++;
            break;
          } catch (e) {
            // 尝试提取数组字段
            var arrays = inner.match(/"(\w+)"\s*:\s*\[([^\]]*)\]/g);
            if (arrays) {
              result[dim] = result[dim] || {};
              arrays.forEach(function (arr) {
                var arrMatch = arr.match(/"(\w+)"\s*:\s*\[([^\]]*)\]/);
                if (arrMatch) {
                  var key = arrMatch[1];
                  var vals = arrMatch[2]
                    .split(',')
                    .map(function (v) { return v.trim().replace(/^"|"$/g, ''); })
                    .filter(function (v) { return v; });
                  result[dim][key] = vals;
                  found++;
                }
              });
            }
          }
        }
      }
    });

    // 提取置信度
    var confMatch = str.match(/"confidence"\s*:\s*([0-9.]+)/);
    if (confMatch) result.confidence = Math.max(0, Math.min(1, parseFloat(confMatch[1])));

    return found > 0 ? result : null;
  }

  /* ===================================================================
     四、特征融合 / 聚合
     =================================================================== */

  /**
   * 融合新旧风格特征（增量）
   * 用于：训练时把本次新语料特征与已有库特征累加
   * @param {Object} oldFeatures 已有特征
   * @param {Object} newFeatures 新特征
   * @returns {Object} 融合后的特征
   */
  function mergeFeatures(oldFeatures, newFeatures) {
    oldFeatures = oldFeatures || {};
    newFeatures = newFeatures || {};

    // 词频累加
    var oldWords = {};
    (oldFeatures.topWords || []).forEach(function (w) { oldWords[w.word] = w.count; });
    (newFeatures.topWords || []).forEach(function (w) {
      oldWords[w.word] = (oldWords[w.word] || 0) + w.count;
    });
    var mergedWords = Object.keys(oldWords).map(function (w) {
      return { word: w, count: oldWords[w] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 15);

    // emoji 累加
    var oldEmojis = {};
    (oldFeatures.emojis || []).forEach(function (e) { oldEmojis[e.char] = e.count; });
    (newFeatures.emojis || []).forEach(function (e) {
      oldEmojis[e.char] = (oldEmojis[e.char] || 0) + e.count;
    });
    var mergedEmojis = Object.keys(oldEmojis).map(function (e) {
      return { char: e, count: oldEmojis[e] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

    // 句长加权平均
    var oldAvg = oldFeatures.avgSentenceLength || 0;
    var newAvg = newFeatures.avgSentenceLength || 0;
    var mergedAvg = oldAvg ? Math.round((oldAvg + newAvg) / 2) : newAvg;

    // 句首词合并去重
    var openerSet = {};
    (oldFeatures.sentenceOpeners || []).concat(newFeatures.sentenceOpeners || []).forEach(function (o) {
      openerSet[o] = true;
    });

    // 细节关键词合并
    var detailSet = {};
    (oldFeatures.detailKeywords || []).concat(newFeatures.detailKeywords || []).forEach(function (d) {
      detailSet[d] = true;
    });

    // 情绪：以本次新特征为主，若冲突则保留双方（这里简化为「新优先」）
    var sentiment = newFeatures.sentiment || oldFeatures.sentiment || 'neutral';

    // ---- 深度分析聚合：语言规律 / 格式特征 / 风格特点 ----
    var mergedLP = mergeDeepAnalysis(
      oldFeatures.languagePatterns, newFeatures.languagePatterns,
      ['sentenceStructures', 'vocabularyPreference', 'semanticRelations', 'syntacticHabits']
    );
    var mergedFF = mergeDeepAnalysis(
      oldFeatures.formatFeatures, newFeatures.formatFeatures,
      ['punctuationUsage', 'specialMarkers']
    );
    // 格式特征中的 paragraphStructure / lengthPattern 是字符串，取众数
    var mergedParagraph = mergeParagraphStructure(
      oldFeatures.formatFeatures && oldFeatures.formatFeatures.paragraphStructure,
      newFeatures.formatFeatures && newFeatures.formatFeatures.paragraphStructure
    );
    var mergedLengthPattern = mergeParagraphStructure(
      oldFeatures.formatFeatures && oldFeatures.formatFeatures.lengthPattern,
      newFeatures.formatFeatures && newFeatures.formatFeatures.lengthPattern
    );
    if (mergedFF) {
      mergedFF.paragraphStructure = mergedParagraph;
      mergedFF.lengthPattern = mergedLengthPattern;
    }

    var mergedST = mergeStyleTraits(
      oldFeatures.styleTraits, newFeatures.styleTraits
    );

    // ---- 新增五维度聚合 ----
    var mergedRD = mergeRhetoricalDevices(
      oldFeatures.rhetoricalDevices, newFeatures.rhetoricalDevices
    );
    var mergedNP = mergeNarrativePerspective(
      oldFeatures.narrativePerspective, newFeatures.narrativePerspective
    );
    var mergedID = mergeInformationDensity(
      oldFeatures.informationDensity, newFeatures.informationDensity
    );
    var mergedPS = mergePersuasionStrategy(
      oldFeatures.persuasionStrategy, newFeatures.persuasionStrategy
    );
    var mergedSL = mergeSensoryLanguage(
      oldFeatures.sensoryLanguage, newFeatures.sensoryLanguage
    );

    // 置信度取平均
    var oldConf = typeof oldFeatures.confidence === 'number' ? oldFeatures.confidence : 0.7;
    var newConf = typeof newFeatures.confidence === 'number' ? newFeatures.confidence : 0.7;
    var mergedConfidence = (oldConf + newConf) / 2;

    return {
      topWords: mergedWords,
      emojis: mergedEmojis,
      avgSentenceLength: mergedAvg,
      sentenceOpeners: Object.keys(openerSet).slice(0, 8),
      sentiment: sentiment,
      detailKeywords: Object.keys(detailSet).slice(0, 15),
      languagePatterns: mergedLP,
      formatFeatures: mergedFF,
      styleTraits: mergedST,
      rhetoricalDevices: mergedRD,
      narrativePerspective: mergedNP,
      informationDensity: mergedID,
      persuasionStrategy: mergedPS,
      sensoryLanguage: mergedSL,
      confidence: mergedConfidence
    };
  }

  /** 合并修辞手法（devices 数组频次聚合 + effectiveness 取众数） */
  function mergeRhetoricalDevices(oldRD, newRD) {
    if (!oldRD && !newRD) return { devices: [], effectiveness: '' };
    if (!oldRD) return JSON.parse(JSON.stringify(newRD));
    if (!newRD) return JSON.parse(JSON.stringify(oldRD));
    var set = {};
    (oldRD.devices || []).forEach(function (d) { set[d] = (set[d] || 0) + 1; });
    (newRD.devices || []).forEach(function (d) { set[d] = (set[d] || 0) + 1; });
    var devices = Object.keys(set).sort(function (a, b) { return set[b] - set[a]; }).slice(0, 6);
    return {
      devices: devices,
      effectiveness: newRD.effectiveness || oldRD.effectiveness || ''
    };
  }

  /** 合并叙事视角（多数表决） */
  function mergeNarrativePerspective(oldNP, newNP) {
    if (!oldNP && !newNP) return { person: 'first', standpoint: '亲历者体验', temporalOrder: '顺叙' };
    if (!oldNP) return JSON.parse(JSON.stringify(newNP));
    if (!newNP) return JSON.parse(JSON.stringify(oldNP));
    return {
      person: newNP.person || oldNP.person || 'first',
      standpoint: newNP.standpoint || oldNP.standpoint || '亲历者体验',
      temporalOrder: newNP.temporalOrder || oldNP.temporalOrder || '顺叙'
    };
  }

  /** 合并信息密度（数组频次聚合 + detailLevel 取众数） */
  function mergeInformationDensity(oldID, newID) {
    if (!oldID && !newID) return { detailLevel: 'moderate', quantification: [], sceneDescription: [] };
    if (!oldID) return JSON.parse(JSON.stringify(newID));
    if (!newID) return JSON.parse(JSON.stringify(oldID));
    var quantSet = {};
    (oldID.quantification || []).concat(newID.quantification || []).forEach(function (q) {
      quantSet[q] = (quantSet[q] || 0) + 1;
    });
    var sceneSet = {};
    (oldID.sceneDescription || []).concat(newID.sceneDescription || []).forEach(function (s) {
      sceneSet[s] = (sceneSet[s] || 0) + 1;
    });
    return {
      detailLevel: newID.detailLevel || oldID.detailLevel || 'moderate',
      quantification: Object.keys(quantSet).sort(function (a, b) { return quantSet[b] - quantSet[a]; }).slice(0, 6),
      sceneDescription: Object.keys(sceneSet).sort(function (a, b) { return sceneSet[b] - sceneSet[a]; }).slice(0, 6)
    };
  }

  /** 合并说服策略（strategies 频次聚合 + 字符串取众数） */
  function mergePersuasionStrategy(oldPS, newPS) {
    if (!oldPS && !newPS) return { strategies: [], evidenceType: '个人体验', callToAction: '' };
    if (!oldPS) return JSON.parse(JSON.stringify(newPS));
    if (!newPS) return JSON.parse(JSON.stringify(oldPS));
    var set = {};
    (oldPS.strategies || []).concat(newPS.strategies || []).forEach(function (s) {
      set[s] = (set[s] || 0) + 1;
    });
    return {
      strategies: Object.keys(set).sort(function (a, b) { return set[b] - set[a]; }).slice(0, 6),
      evidenceType: newPS.evidenceType || oldPS.evidenceType || '个人体验',
      callToAction: newPS.callToAction || oldPS.callToAction || ''
    };
  }

  /** 合并感官语言（senses 频次聚合 + imagery 取众数） */
  function mergeSensoryLanguage(oldSL, newSL) {
    if (!oldSL && !newSL) return { senses: [], imagery: '' };
    if (!oldSL) return JSON.parse(JSON.stringify(newSL));
    if (!newSL) return JSON.parse(JSON.stringify(oldSL));
    var set = {};
    (oldSL.senses || []).concat(newSL.senses || []).forEach(function (s) {
      set[s] = (set[s] || 0) + 1;
    });
    return {
      senses: Object.keys(set).sort(function (a, b) { return set[b] - set[a]; }).slice(0, 6),
      imagery: newSL.imagery || oldSL.imagery || ''
    };
  }

  /** 合并深度分析的数组字段（标签去重 + 频次加权保留前 N） */
  function mergeDeepAnalysis(oldDim, newDim, keys) {
    if (!oldDim && !newDim) return null;
    if (!oldDim) return JSON.parse(JSON.stringify(newDim));
    if (!newDim) return JSON.parse(JSON.stringify(oldDim));
    var result = {};
    keys.forEach(function (k) {
      var set = {};
      (oldDim[k] || []).forEach(function (t) { set[t] = (set[t] || 0) + 1; });
      (newDim[k] || []).forEach(function (t) { set[t] = (set[t] || 0) + 1; });
      // 按频次排序，取前 6
      result[k] = Object.keys(set).sort(function (a, b) { return set[b] - set[a]; }).slice(0, 6);
    });
    return result;
  }

  /** 合并段落结构（字符串取众数） */
  function mergeParagraphStructure(oldP, newP) {
    if (!oldP) return newP || '';
    if (!newP) return oldP;
    return oldP; // 简化：保留旧的，新值只在无旧值时采用
  }

  /** 合并风格特点（formality/domain/emotionalTone） */
  function mergeStyleTraits(oldST, newST) {
    if (!oldST && !newST) return null;
    if (!oldST) return JSON.parse(JSON.stringify(newST));
    if (!newST) return JSON.parse(JSON.stringify(oldST));
    return {
      formality: newST.formality || oldST.formality || 'mixed',
      domain: newST.domain || oldST.domain || '通用',
      emotionalTone: newST.emotionalTone || oldST.emotionalTone || '客观陈述'
    };
  }

  /**
   * 把多条语料的 styleFeatures 聚合成一个风格画像
   * 用于：生成时检索同品类语料后聚合参考
   * @param {Array} corpusList 语料数组
   * @returns {Object} 聚合后的风格画像
   */
  function aggregateStyle(corpusList) {
    if (!corpusList || !corpusList.length) return analyzeStyle('');
    var merged = null;
    corpusList.forEach(function (c) {
      var feat = c.styleFeatures || analyzeStyle(c.text);
      merged = merged ? mergeFeatures(merged, feat) : feat;
    });
    return merged || analyzeStyle('');
  }

  /**
   * 品类识别：基于关键词加权打分，从文本中推断所属品类
   * @param {string} text 评价文本
   * @returns {{category: string, scores: Object}} 识别结果
   *   - category: 识别到的品类名（命中为 0 时返回 '其他'）
   *   - scores: 各品类得分明细，便于调试 / UI 展示置信度
   */
  function detectCategory(text) {
    text = text || '';
    var scores = {};
    var categories = Object.keys(CATEGORY_KEYWORDS);

    categories.forEach(function (cat) {
      var kwList = CATEGORY_KEYWORDS[cat];
      var score = 0;
      // 用 indexOf 统计每个关键词出现次数（多关键词命中加权）
      for (var i = 0; i < kwList.length; i++) {
        var kw = kwList[i];
        if (!kw) continue;
        // 统计出现次数（避免无限循环）
        var idx = text.indexOf(kw);
        var count = 0;
        while (idx !== -1 && count < 10) {
          score += 1;
          count++;
          idx = text.indexOf(kw, idx + kw.length);
        }
      }
      scores[cat] = score;
    });

    // 选最高分
    var bestCat = '其他';
    var bestScore = 0;
    categories.forEach(function (cat) {
      if (scores[cat] > bestScore) {
        bestScore = scores[cat];
        bestCat = cat;
      }
    });

    // 得分为 0 → 无法识别 → '其他'
    if (bestScore === 0) bestCat = '其他';

    return { category: bestCat, scores: scores };
  }

  /**
   * 多条语料的品类识别（多数表决）
   * @param {Array<string>} texts 文本数组
   * @returns {{category: string, perItem: Array}} 识别结果
   *   - category: 投票胜出的品类
   *   - perItem: 每条文本的识别结果 [{text, category, score}]
   */
  function detectCategoryFromTexts(texts) {
    texts = texts || [];
    var tally = {};
    var perItem = [];
    texts.forEach(function (t) {
      var r = detectCategory(t);
      var cat = r.category;
      // 累加该品类的总得分（用作置信度权重）
      var totalScore = 0;
      Object.keys(r.scores).forEach(function (k) { totalScore += r.scores[k]; });
      tally[cat] = (tally[cat] || 0) + (totalScore || 1);
      perItem.push({ text: t, category: cat, score: totalScore });
    });

    // 取累计得分最高的品类
    var bestCat = '其他';
    var bestScore = 0;
    Object.keys(tally).forEach(function (cat) {
      if (tally[cat] > bestScore) {
        bestScore = tally[cat];
        bestCat = cat;
      }
    });

    return { category: bestCat, perItem: perItem };
  }

  /**
   * 品类归一化：将 PRESET_CORPUS 中的别名（如 '美业'）映射到标准品类名
   * @param {string} category
   * @returns {string}
   */
  function normalizeCategory(category) {
    if (!category) return '其他';
    return CATEGORY_ALIASES[category] || category;
  }

  /* ===================================================================
     五、风格更新摘要
     =================================================================== */

  /**
   * 生成训练后的中文摘要文案
   * @param {Object} newFeatures 本次新学到的特征
   * @param {Array} prevTopWords 之前已有的 topWords [{word, count}]
   * @returns {string} 中文摘要
   */
  function generateSummary(newFeatures, prevTopWords) {
    newFeatures = newFeatures || {};
    prevTopWords = prevTopWords || [];

    var prevSet = {};
    prevTopWords.forEach(function (w) { prevSet[w.word] = true; });

    // 找出本次新增的词
    var addedWords = (newFeatures.topWords || []).filter(function (w) {
      return !prevSet[w.word];
    }).map(function (w) { return w.word; }).slice(0, 4);

    // 找出本次学到的 emoji
    var addedEmojis = (newFeatures.emojis || []).slice(0, 3).map(function (e) { return e.char; });

    // 句式开头
    var openers = (newFeatures.sentenceOpeners || []).slice(0, 2);

    var sentimentText = '';
    if (newFeatures.sentiment === 'positive') sentimentText = '偏积极推荐';
    else if (newFeatures.sentiment === 'negative') sentimentText = '偏吐槽避雷';
    else sentimentText = '中立陈述';

    var parts = [];
    parts.push('通过本次训练，AI 学到了「' + sentimentText + '」的表达倾向');

    if (addedWords.length) {
      parts.push('掌握了『' + addedWords.join('』『') + '』等高频词汇');
    }
    if (addedEmojis.length) {
      parts.push('学会了使用 ' + addedEmojis.join(' ') + ' 等表情符号');
    }
    if (openers.length) {
      parts.push('以及『' + openers.join('』『') + '』等典型开头');
    }

    if (parts.length === 1) {
      // 没有具体特征时，给出通用提示
      parts.push('下次可以尝试粘贴更具体、更带细节的评价，AI 会学得更准');
    }

    return parts.join('，') + '。';
  }

  /* ===================================================================
     六、评价生成
     =================================================================== */

  /**
   * 按星级映射褒贬基调
   */
  function sentimentByStars(stars) {
    if (stars >= 3.5) return 'positive';
    if (stars >= 2.5 && stars < 3.5) return 'neutral';
    return 'negative';
  }

  /** 按长度映射字数范围（支持精确字数和预设） */
  function lengthRange(length) {
    if (typeof length === 'number') return [Math.round(length * 0.85), Math.round(length * 1.15)];
    if (typeof length === 'string' && /^\d+$/.test(length)) {
      var n = parseInt(length, 10);
      return [Math.round(n * 0.85), Math.round(n * 1.15)];
    }
    if (length === '短') return [50, 100];
    if (length === '长') return [300, 420];
    return [150, 250]; // 中
  }

  // 句式模板（按段落用途分组）
  var TEMPLATES = {
    positive: {
      opener: [
        '今天去了{merchant}，体验真的不错',
        '打卡了{merchant}，整体很满意',
        '朋友推荐来的{merchant}，果然没让我失望',
        '终于来试了{merchant}，值得这趟',
        '{merchant}这趟没白来，超出预期',
        '一直想来{merchant}，今天如愿以偿'
      ],
      detail: [
        '{detail}是这次最大的亮点，值得专门提一句',
        '尤其想夸一下{detail}，真的有用心',
        '{detail}做得尤其好，看得出来老板下了功夫',
        '从{detail}就能感受到这家店的诚意',
        '最惊喜的是{detail}，比想象中更好'
      ],
      closing: [
        '下次还会再来，推荐给想来的朋友',
        '整体值得这个价，会回购',
        '已经加入我的回购清单，强烈推荐',
        '这个品质值得专程来一趟',
        '下次想试试其他菜品，期待'
      ]
    },
    neutral: {
      opener: [
        '今天来了{merchant}，整体中规中矩',
        '打卡{merchant}，有些亮点也有不足',
        '试了{merchant}，说说我自己的感受',
        '来{merchant}吃了一顿，分享下体验'
      ],
      detail: [
        '{detail}算是一个亮点',
        '{detail}方面做得还可以',
        '{detail}表现中规中矩',
        '从{detail}来看，平均水平'
      ],
      closing: [
        '整体凑合，看个人口味',
        '不会特别推荐，但也不算踩雷',
        '可以来试一次，值不值看你自己',
        '如果顺路可以来，专程就不必了'
      ]
    },
    negative: {
      opener: [
        '今天去了{merchant}，体验比较一般',
        '满怀期待来{merchant}，结果有点失望',
        '{merchant}这趟算是踩雷了',
        '试了{merchant}，必须来吐槽一下'
      ],
      detail: [
        '{detail}真的需要改进',
        '{detail}方面不太满意',
        '{detail}让人有点失望',
        '尤其是{detail}，问题比较明显'
      ],
      closing: [
        '应该不会再来第二次了',
        '建议大家慎重考虑',
        '性价比不高，不推荐',
        '希望老板能改进，毕竟位置不错'
      ]
    }
  };

  // 风格倾向修饰词 / 句尾
  var STYLE_MODIFIERS = {
    casual: ['啊', '呢', '真的', '反正', '说实话', '就是那种感觉'], // 口语化
    literary: ['一如往常', '恰好', '悄然而至', '余韵悠长', '别有洞天', '恰到好处'], // 文艺
    exaggerated: ['YYDS', '绝绝子', '封神', '直接炸裂', '上头', '原地升华'], // 夸张
    restrained: [] // 克制：不加修饰词
  };

  /**
   * 从语料库检索同品类语料作为风格参考
   * @param {Array} corpusList 用户语料
   * @param {string} category 目标品类
   * @returns {Array} 匹配的语料（最多 5 条）
   */
  function retrieveByCategory(corpusList, category) {
    if (!corpusList || !corpusList.length) return [];
    var matched = corpusList.filter(function (c) {
      return c.category === category;
    });
    if (matched.length >= 5) return pickN(matched, 5);
    // 不够则补足其他品类
    var others = corpusList.filter(function (c) {
      return c.category !== category;
    });
    return matched.concat(pickN(others, 5 - matched.length));
  }

  /**
   * 从风格语料借用的句式片段（取一些半句作为素材）
   */
  function borrowPhrases(corpusList, n) {
    n = n || 3;
    var phrases = [];
    corpusList.forEach(function (c) {
      var sentences = splitSentences(c.text);
      sentences.forEach(function (s) {
        // 取句中片段（10-25 字之间，避免过短过长）
        if (s.length >= 10 && s.length <= 25) {
          phrases.push(s);
        }
      });
    });
    return pickN(phrases, n);
  }

  /**
   * 应用风格倾向到文本
   * @param {string} text 原始文本
   * @param {Object} tendency {style: 'casual'|'literary'|'exaggerated'|'restrained', emoji: boolean}
   * @param {Array} styleEmojis 风格画像中的 emoji
   */
  function applyTendency(text, tendency, styleEmojis) {
    tendency = tendency || {};
    var result = text;

    if (tendency.style === 'exaggerated') {
      // 在句尾随机加夸张词
      var exWords = STYLE_MODIFIERS.exaggerated;
      var sentences = result.split(/([。！？!?\n])/);
      for (var i = 0; i < sentences.length; i += 2) {
        if (sentences[i] && Math.random() < 0.4 && exWords.length) {
          var w = pick(exWords);
          sentences[i] = sentences[i].replace(/(好|不错|赞|棒|满意)$/, w + '$1');
          if (sentences[i].indexOf(w) === -1 && sentences[i].length > 5) {
            sentences[i] = sentences[i] + '，' + w;
          }
        }
      }
      result = sentences.join('');
    } else if (tendency.style === 'literary') {
      // 加意境词：在句首随机加
      var liWords = STYLE_MODIFIERS.literary;
      var sents = result.split(/([。！？!?\n])/);
      for (var j = 0; j < sents.length; j += 2) {
        if (sents[j] && Math.random() < 0.3 && liWords.length) {
          sents[j] = pick(liWords) + '的' + sents[j];
        }
      }
      result = sents.join('');
    } else if (tendency.style === 'casual') {
      // 口语化：在句尾加语气词
      var caWords = STYLE_MODIFIERS.casual;
      var ss = result.split(/([。！？!?\n])/);
      for (var k = 0; k < ss.length; k += 2) {
        if (ss[k] && Math.random() < 0.4 && caWords.length) {
          ss[k] = ss[k] + pick(caWords);
        }
      }
      result = ss.join('');
    }
    // restrained: 不加任何修饰

    // emoji 处理
    if (tendency.emoji && styleEmojis && styleEmojis.length) {
      var emojiPool = styleEmojis.slice(0, 3);
      // 在句尾随机加 1-2 个 emoji
      var parts = result.split(/([。！？!?\n])/);
      for (var m = 0; m < parts.length; m += 2) {
        if (parts[m] && Math.random() < 0.35) {
          parts[m] = parts[m] + ' ' + pick(emojiPool);
        }
      }
      result = parts.join('');
    } else if (tendency.emoji === false) {
      // 明确不加：移除已有 emoji
      result = result.replace(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}]/gu, '');
    }

    return result;
  }

  /**
   * 把商家名 + 勾选项 + 风格短语组装成具体细节
   * @param {Object} params {merchant, category, options, detailKeywords}
   * @returns {string} 一个具体细节短语
   */
  function buildDetail(params) {
    params = params || {};
    var options = params.options || {};
    var optionKeys = Object.keys(options).filter(function (k) { return options[k]; });
    var merchant = params.merchant || '这家店';

    // 优先从勾选项构造
    if (optionKeys.length) {
      var key = pick(optionKeys);
      return merchant + '的' + key;
    }

    // 其次从风格画像的细节关键词
    if (params.detailKeywords && params.detailKeywords.length) {
      return pick(params.detailKeywords);
    }

    // 兜底：用品类常用词
    var fallback = ['招牌菜', '服务态度', '环境卫生', '上菜速度', '性价比'];
    return pick(fallback);
  }

  /**
   * 评价生成（模拟引擎，同步）
   * @param {Object} params
   *   - merchant: 商家名
   *   - category: 品类
   *   - stars: 1-5
   *   - length: '短'|'中'|'长'
   *   - options: {菜品推荐: true, 排队: true, ...}
   *   - styleSource: 'all'|tagId|tagId[]
   *   - tendency: {style: 'casual'|'literary'|'exaggerated'|'restrained', emoji: boolean}
   *   - corpusList: 用户语料数组
   *   - history: 历史记录（用于多样性检查 / 权重调整）
   * @returns {string} 完整评价文本
   */
  function generateReviewMock(params) {
    params = params || {};
    var merchant = params.merchant || '这家店';
    var category = params.category || '美食';
    var stars = params.stars || 5;
    var length = params.length || '中';
    var options = params.options || {};
    var tendency = params.tendency || {};
    var corpusList = params.corpusList || [];

    // 1. 检索风格语料
    var matched = retrieveByCategory(corpusList, category);
    var usePreset = matched.length === 0;
    if (usePreset) {
      // 空语料兜底
      matched = retrieveByCategory(PRESET_CORPUS, category);
      if (!matched.length) matched = pickN(PRESET_CORPUS, 3);
    }

    // 2. 聚合风格画像
    var styleProfile = aggregateStyle(matched);

    // 3. 决定基调
    var sentiment = sentimentByStars(stars);
    var templates = TEMPLATES[sentiment] || TEMPLATES.neutral;

    // 4. 借用风格语料片段
    var borrowed = borrowPhrases(matched, 2);

    // 5. 组装段落
    var range = lengthRange(length);
    var targetLen = randInt(range[0], range[1] + 1);

    var details = [];
    // 至少一个具体细节（真实性要求）
    var detail1 = buildDetail({
      merchant: merchant,
      options: options,
      detailKeywords: styleProfile.detailKeywords
    });
    details.push(detail1);

    // 长版本多加一两个细节
    var numericLength = typeof length === 'number' ? length : (typeof length === 'string' && /^\d+$/.test(length) ? parseInt(length, 10) : (length === '短' ? 80 : length === '长' ? 350 : 220));
    var isLong = numericLength >= 300;
    var isMedium = numericLength >= 150 && numericLength < 300;
    if (isLong || (isMedium && Math.random() < 0.5)) {
      var detail2 = buildDetail({
        merchant: merchant,
        options: options,
        detailKeywords: styleProfile.detailKeywords
      });
      if (detail2 !== detail1) details.push(detail2);
    }
    if (isLong) {
      var detail3 = buildDetail({
        merchant: merchant,
        options: options,
        detailKeywords: styleProfile.detailKeywords
      });
      if (details.indexOf(detail3) === -1) details.push(detail3);
    }

    // 组装段落顺序随机化
    var opener = pick(templates.opener).replace('{merchant}', merchant);
    var detailParts = details.map(function (d, i) {
      var tpl = pick(templates.detail);
      return tpl.replace('{detail}', d);
    });
    var closing = pick(templates.closing);

    // 把借用片段也插入（在 detail 部分之间）
    var parts = [opener];
    if (borrowed.length && numericLength >= 100) {
      parts.push(borrowed[0]);
    }
    parts = parts.concat(detailParts);
    if (borrowed.length > 1 && isLong) {
      parts.push(borrowed[1]);
    }
    parts.push(closing);

    // 长度不够时补充（从借用片段或重复细节）
    var text = parts.join('。') + '。';
    var tries = 0;
    while (text.length < targetLen && tries < 3 && borrowed.length) {
      var extra = pick(borrowed);
      // 插入到倒数第二句之前
      var allParts = text.split('。').filter(function (s) { return s.trim(); });
      allParts.splice(allParts.length - 1, 0, extra);
      text = allParts.join('。') + '。';
      tries++;
    }

    // 长度超出时裁剪（保留开头 + 一个细节 + 结尾）
    if (text.length > targetLen + 60) {
      var sents = text.split('。').filter(function (s) { return s.trim(); });
      if (sents.length > 3) {
        sents = [sents[0], sents[1], sents[sents.length - 1]];
        text = sents.join('。') + '。';
      }
    }

    // 6. 应用风格倾向
    text = applyTendency(text, tendency, styleProfile.emojis);

    // 7. 真实性兜底：确保包含商家名
    if (merchant && text.indexOf(merchant) === -1) {
      text = merchant + '，' + text;
    }

    return text;
  }

  /**
   * 重新生成（模拟引擎，同步）
   * 内部多次调用 generateReviewMock，与上次结果相似度 > 0.6 则重试
   */
  function regenerateMock(params) {
    var prev = params && params.prevText;
    var best = generateReviewMock(params);
    if (!prev) return best;

    // 最多重试 3 次以降低相似度
    for (var i = 0; i < 3; i++) {
      var sim = similarity(prev, best);
      if (sim < 0.6) break;
      best = generateReviewMock(params);
    }
    return best;
  }

  /* ===================================================================
     六-2、调度层：真实 API 优先，回落模拟引擎
     =================================================================== */

  /** 判断当前是否启用真实 AI（配置完整且开关打开） */
  function isRealAIEnabled(cfg) {
    if (!cfg) return false;
    return !!(cfg.enabled && cfg.baseURL && cfg.apiKey && cfg.model);
  }

  /** 从 params 提取 buildGeneratePrompt 所需的入参，并补 features */
  function buildPromptParams(params) {
    params = params || {};
    var corpusList = params.corpusList || [];
    var features = corpusList.length ? aggregateStyle(corpusList) : analyzeStyle('');
    // 加载 AI 记忆（跨会话学习积累）
    var aiMemory = null;
    if (global.Store && typeof global.Store.getAIMemory === 'function') {
      aiMemory = global.Store.getAIMemory();
    }
    return {
      merchant: params.merchant,
      category: params.category,
      stars: params.stars,
      length: params.length,
      options: params.options,
      tendency: params.tendency,
      corpusList: corpusList,
      features: features,
      aiMemory: aiMemory
    };
  }

  /**
   * 评价生成（调度层，async）
   * - 真实 API 启用且配置完整 → 调用 AIClient.chat（非流式，一次拿全文）
   * - 否则 → 返回 generateReviewMock(params)
   * - 真实 API 失败时自动回落模拟引擎
   * @returns {Promise<string>}
   */
  function generateReview(params) {
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;
    if (isRealAIEnabled(cfg) && global.AIClient && typeof global.AIClient.chat === 'function') {
      var messages = global.AIClient.buildGeneratePrompt(buildPromptParams(params));
      return global.AIClient.chat({
        messages: messages,
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model
      }).then(function (text) {
        return text || generateReviewMock(params);
      }).catch(function () {
        // 失败回落模拟引擎
        return generateReviewMock(params);
      });
    }
    return Promise.resolve(generateReviewMock(params));
  }

  /**
   * 重新生成（调度层，async）
   * - 真实模式：调用 AIClient.chat（temperature 0.9 自带多样性）
   * - 模拟模式：regenerateMock(params)
   * @returns {Promise<string>}
   */
  function regenerate(params) {
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;
    if (isRealAIEnabled(cfg) && global.AIClient && typeof global.AIClient.chat === 'function') {
      var messages = global.AIClient.buildGeneratePrompt(buildPromptParams(params));
      return global.AIClient.chat({
        messages: messages,
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model
      }).then(function (text) {
        return text || regenerateMock(params);
      }).catch(function () {
        return regenerateMock(params);
      });
    }
    return Promise.resolve(regenerateMock(params));
  }

  /**
   * 把整段文本用 setInterval 模拟流式推送
   * @param {string} text 完整文本
   * @param {Object} callbacks {onToken, onDone, signal}
   * @param {Object} fallbackErr 若因 API 失败回落，则先调 onFallback
   * @param {Object} options {interval, onFallback}
   */
  function streamTextSimulated(text, callbacks, fallbackErr, options) {
    callbacks = callbacks || {};
    options = options || {};
    var interval = options.interval || 20;
    var onFallback = options.onFallback;

    if (fallbackErr && typeof onFallback === 'function') {
      try { onFallback(fallbackErr); } catch (e) { /* ignore */ }
    }

    var chars = Array.from(text || ''); // 正确处理 Unicode 代理对 / emoji
    var pos = 0;
    var aborted = false;

    var timer = setInterval(function () {
      if (aborted) return;
      if (pos >= chars.length) {
        clearInterval(timer);
        if (typeof callbacks.onDone === 'function') callbacks.onDone(text);
        return;
      }
      // 每次推 1-2 个字符
      var step = Math.random() < 0.5 ? 1 : 2;
      var chunk = chars.slice(pos, pos + step).join('');
      pos += step;
      if (typeof callbacks.onToken === 'function') {
        try { callbacks.onToken(chunk); } catch (e) { /* ignore */ }
      }
    }, interval);

    // 支持外部 signal 中断
    var signal = callbacks.signal;
    if (signal) {
      if (signal.aborted) {
        aborted = true;
        clearInterval(timer);
        return;
      }
      if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', function () {
          aborted = true;
          clearInterval(timer);
        });
      }
    }
  }

  /**
   * 流式生成评价（调度层）
   * @param {Object} params 生成参数（同 generateReview）
   * @param {Object} callbacks {onToken, onDone, onError, signal}
   *   - onToken(chunk: string)
   *   - onDone(fullText: string)
   *   - onError(err: {type, message}) 失败时触发（不回落本地）
   *   - signal: AbortSignal
   * 永不回落本地：AI 未配置或失败 → 直接 onError
   */
  function generateReviewStream(params, callbacks) {
    callbacks = callbacks || {};
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;

    // AI 未配置 → 直接报错（不回落本地）
    if (!isRealAIEnabled(cfg) || !global.AIClient || typeof global.AIClient.streamChat !== 'function') {
      if (typeof callbacks.onError === 'function') {
        try { callbacks.onError({ type: 'config', message: 'AI 未配置，无法生成评价。请先在设置中配置 AI API' }); } catch (e) {}
      }
      return;
    }

    var messages;
    try {
      messages = global.AIClient.buildGeneratePrompt(buildPromptParams(params));
    } catch (e) {
      if (typeof callbacks.onError === 'function') {
        try { callbacks.onError({ type: 'build_error', message: '构造生成请求失败：' + (e.message || e) }); } catch (e2) {}
      }
      return;
    }

    var errored = false;

    global.AIClient.streamChat({
      messages: messages,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      signal: callbacks.signal,
      onToken: function (chunk) {
        if (errored) return;
        if (typeof callbacks.onToken === 'function') {
          try { callbacks.onToken(chunk); } catch (e) { /* ignore */ }
        }
      },
      onDone: function (fullText) {
        if (errored) return;
        if (typeof callbacks.onDone === 'function') {
          try { callbacks.onDone(fullText); } catch (e) { /* ignore */ }
        }
      },
      onError: function (err) {
        if (errored) return;
        errored = true;
        // 不回落本地，直接报错
        if (typeof callbacks.onError === 'function') {
          try {
            var msg = (err && err.message) ? err.message : 'AI 生成失败';
            callbacks.onError({ type: (err && err.type) || 'unknown', message: msg });
          } catch (e) {}
        }
      }
    });
  }

  /* ===================================================================
     六-3、提问模式 / 润色模式调度
     =================================================================== */

  /**
   * 预置问题列表（mock 模式兜底，覆盖菜品/服务/环境/位置/价格/特色等维度）
   * 按星级生成不同侧重的问题
   */
  function getPresetQuestions(merchant, stars, category) {
    var common = [
      { text: '这次去「' + merchant + '」体验如何？最满意的一点是什么？', options: ['整体超出预期，多个亮点', '基本满意，个别亮点', '一般般，没特别感觉', '低于预期，有踩雷点'] },
      { text: '招牌推荐是什么？有没有踩雷的菜品/项目？', options: ['招牌好吃，无踩雷', '招牌不错，但有踩雷', '招牌一般，其他菜更好', '没点招牌菜'] },
      { text: '服务态度怎么样？有没有特别让你印象深刻的服务细节？', options: ['热情周到，有细节', '正常服务，无功无过', '响应较慢，需主动找', '态度冷漠或推销多'] },
      { text: '环境装修风格如何？座位舒适度、灯光、音乐呢？', options: ['风格独特，舒适有氛围', '简约干净，舒适度ok', '装修普通，座位偏挤', '环境嘈杂，灯光/音乐不适'] },
      { text: '位置好找吗？交通便利度如何？停车方便吗？', options: ['交通便利，停车方便', '地铁直达，无停车需求', '位置好找但停车难', '偏僻难找，交通不便'] },
      { text: '人均消费多少？性价比如何？', options: ['人均低，性价比高', '人均适中，物有所值', '人均偏高，但值得', '人均贵，性价比低'] },
      { text: '排队等候时间长吗？高峰期需要提前预约吗？', options: ['基本不排队/已预约', '排队短，可接受', '排队较长，值得等', '排队太久，影响体验'] },
      { text: '适合什么场景？情侣约会、朋友聚餐、家庭聚会还是商务？', options: ['朋友聚餐首选', '情侣约会氛围好', '家庭聚会适合', '商务宴请得体'] },
      { text: '有没有适合拍照打卡的点？出片效果如何？', options: ['多个打卡点，很出片', '有个别角落可拍', '普通环境，不适合拍照', '没留意拍照'] },
      { text: '下次还会再来吗？会推荐给什么类型的朋友？', options: ['会回购，推荐所有人', '会回购，推荐特定人群', '看情况，有优惠再去', '不会再来'] }
    ];
    // 低星偏向问题反馈
    if (stars <= 2.5) {
      return [
        { text: '这次体验最不满意的地方是什么？', options: ['菜品口味/质量', '服务态度/效率', '环境卫生/设施', '价格/性价比'] },
        { text: '具体是哪个环节出了问题（菜品/服务/环境/价格）？', options: ['上菜慢/漏单', '服务员态度差', '环境吵/脏/设施坏', '隐形消费/价格虚高'] },
        { text: '有没有具体的踩雷细节可以分享？', options: ['食材不新鲜', '分量严重不足', '与宣传严重不符', '卫生问题明显'] },
        { text: '和服务员沟通过吗？对方处理态度如何？', options: ['沟通过，积极解决', '沟通过，敷衍了事', '沟通过，态度恶劣', '没找到人沟通'] },
        { text: '下次还会来吗？会建议朋友避雷吗？', options: ['不会再来，建议避雷', '不会再来，但不劝阻', '看情况，给老板改进机会', '换个时间/分店可能再去'] },
        { text: '位置和环境怎么样？是不是也影响了体验？', options: ['位置偏，交通不便', '环境嘈杂，影响心情', '设施旧/脏，体验差', '位置环境ok，纯菜品问题'] },
        { text: '人均消费多少？觉得不值的地方在哪？', options: ['人均高，分量少', '人均高，口味差', '人均适中，但服务质量差', '隐性消费多，被坑'] }
      ];
    }
    // 高星偏向推荐亮点
    if (stars >= 3.5) {
      return [common[1], common[0], common[2], common[3], common[4], common[5], common[8]];
    }
    return common;
  }

  /**
   * 提问模式：让 AI 生成问题列表
   * @param {Object} params {merchant, stars, category, answeredQuestions, corpusList}
   * @param {Object} callbacks {onQuestions(questions[]), onError(err), signal}
   *   - onQuestions: 拿到问题数组后回调
   *   - onError: 失败时回调（不回落本地）
   *   - signal: AbortSignal
   * 永不回落本地：AI 未配置或失败 → 直接 onError
   */
  function generateQuestions(params, callbacks) {
    callbacks = callbacks || {};
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;
    var merchant = (params && params.merchant) || '这家店';
    var stars = (params && params.stars) || 5;
    var category = (params && params.category) || '';

    // AI 未配置 → 直接报错（不回落本地）
    if (!isRealAIEnabled(cfg) || !global.AIClient || typeof global.AIClient.chat !== 'function') {
      if (typeof callbacks.onError === 'function') {
        try { callbacks.onError({ type: 'config', message: 'AI 未配置，无法生成问题。请先在设置中配置 AI API' }); } catch (e) {}
      }
      return;
    }

    var features = (params && params.corpusList && params.corpusList.length)
      ? aggregateStyle(params.corpusList)
      : analyzeStyle('');
    var messages;
    try {
      messages = global.AIClient.buildQuestionPrompt({
        merchant: merchant,
        stars: stars,
        category: category,
        answeredQuestions: params.answeredQuestions || [],
        features: features
      });
    } catch (e) {
      if (typeof callbacks.onError === 'function') {
        try { callbacks.onError({ type: 'build_error', message: '构造提问请求失败：' + (e.message || e) }); } catch (e2) {}
      }
      return;
    }

    global.AIClient.chat({
      messages: messages,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: 2500,   // 问题数量不限，需足够空间
      temperature: 0.6,  // 提问需要一定创造性，但不要太随机
      signal: callbacks.signal
    }).then(function (text) {
      var questions = parseQuestionsFromText(text);
      if (!questions || !questions.length) {
        if (typeof callbacks.onError === 'function') {
          try { callbacks.onError({ type: 'parse_error', message: 'AI 返回格式异常，无法解析问题列表' }); } catch (e) {}
        }
        return;
      }
      if (typeof callbacks.onQuestions === 'function') {
        try { callbacks.onQuestions(questions); } catch (e) {}
      }
    }).catch(function (err) {
      if (typeof callbacks.onError === 'function') {
        try {
          var msg = (err && err.message) ? err.message : 'AI 提问失败';
          callbacks.onError({ type: (err && err.type) || 'unknown', message: msg });
        } catch (e2) {}
      }
    });
  }

  /** 从 AI 返回的文本中解析问题列表（容错：处理 markdown 代码块、纯文本等情况） */
  function parseQuestionsFromText(text) {
    if (!text || typeof text !== 'string') return [];
    var cleaned = text.trim();
    // 去除 markdown 代码块标记
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    // 尝试 JSON 解析（支持带选项的对象格式）
    try {
      var obj = JSON.parse(cleaned);
      var rawQuestions = null;
      if (obj && Array.isArray(obj.questions)) rawQuestions = obj.questions;
      else if (Array.isArray(obj)) rawQuestions = obj;
      if (rawQuestions) {
        return rawQuestions.map(function (q) {
          // 兼容字符串和对象两种格式
          if (typeof q === 'string') return { text: q.trim(), options: [] };
          if (q && typeof q === 'object' && typeof q.text === 'string') {
            var opts = Array.isArray(q.options) ? q.options.filter(function (o) {
              return typeof o === 'string' && o.trim();
            }).slice(0, 4) : [];
            return { text: q.text.trim(), options: opts };
          }
          return null;
        }).filter(function (q) { return q && q.text; }).slice(0, 10);
      }
    } catch (e) {}
    // 退化：按行解析，去除数字前缀（兼容旧格式纯字符串问题）
    var lines = cleaned.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l; });
    var qs = [];
    for (var i = 0; i < lines.length && qs.length < 10; i++) {
      var l = lines[i];
      // 去除 "1. " / "1、" / "- " / "* " 前缀
      l = l.replace(/^\d+[\.\、\)\s]+/, '').replace(/^[\-\*\•]\s*/, '').trim();
      if (l && l.length >= 5 && l.length <= 100) qs.push({ text: l, options: [] });
    }
    return qs;
  }

  /**
   * 提问模式：基于问答流式生成评价
   * @param {Object} params {merchant, stars, category, length, tendency, corpusList, answers}
   * @param {Object} callbacks {onToken, onDone, onError, signal}
   * 永不回落本地：AI 未配置或失败 → 直接 onError
   */
  function generateFromAnswersStream(params, callbacks) {
    callbacks = callbacks || {};
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;

    // AI 未配置 → 直接报错（不回落本地）
    if (!isRealAIEnabled(cfg) || !global.AIClient || typeof global.AIClient.streamChat !== 'function') {
      if (typeof callbacks.onError === 'function') {
        try { callbacks.onError({ type: 'config', message: 'AI 未配置，无法生成评价。请先在设置中配置 AI API' }); } catch (e) {}
      }
      return;
    }

    var corpusList = params.corpusList || [];
    var features = corpusList.length ? aggregateStyle(corpusList) : analyzeStyle('');
    var messages;
    try {
      messages = global.AIClient.buildGenerateFromAnswersPrompt({
        merchant: params.merchant,
        category: params.category,
        stars: params.stars,
        length: params.length,
        wordCount: params.wordCount,
        tendency: params.tendency,
        corpusList: corpusList,
        features: features,
        answers: params.answers || [],
        additionalComment: params.additionalComment || ''
      });
    } catch (e) {
      if (typeof callbacks.onError === 'function') {
        try { callbacks.onError({ type: 'build_error', message: '构造生成请求失败：' + (e.message || e) }); } catch (e2) {}
      }
      return;
    }

    var errored = false;
    global.AIClient.streamChat({
      messages: messages,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      signal: callbacks.signal,
      onToken: function (chunk) {
        if (errored) return;
        if (typeof callbacks.onToken === 'function') {
          try { callbacks.onToken(chunk); } catch (e) {}
        }
      },
      onDone: function (fullText) {
        if (errored) return;
        if (typeof callbacks.onDone === 'function') {
          try { callbacks.onDone(fullText); } catch (e) {}
        }
      },
      onError: function (err) {
        if (errored) return;
        errored = true;
        // 不回落本地，直接报错
        if (typeof callbacks.onError === 'function') {
          try {
            var msg = (err && err.message) ? err.message : 'AI 生成失败';
            callbacks.onError({ type: (err && err.type) || 'unknown', message: msg });
          } catch (e) {}
        }
      }
    });
  }

  /**
   * 润色模式：流式润色
   * @param {Object} params {rawText, features, tendency, stars, merchant, corpusList}
   * @param {Object} callbacks {onToken, onDone, onError, signal}
   * 永不回落本地：AI 未配置或失败 → 直接 onError
   */
  function polishStream(params, callbacks) {
    callbacks = callbacks || {};
    var cfg = (global.Store && typeof global.Store.getAIConfig === 'function') ? global.Store.getAIConfig() : null;

    // AI 未配置 → 直接报错（不回落本地）
    if (!isRealAIEnabled(cfg) || !global.AIClient || typeof global.AIClient.streamChat !== 'function') {
      if (typeof callbacks.onError === 'function') {
        try { callbacks.onError({ type: 'config', message: 'AI 未配置，无法润色。请先在设置中配置 AI API' }); } catch (e) {}
      }
      return;
    }

    var corpusList = params.corpusList || [];
    var features = params.features;
    if (!features) {
      features = corpusList.length ? aggregateStyle(corpusList) : analyzeStyle('');
    }
    var messages;
    try {
      messages = global.AIClient.buildPolishPrompt({
        rawText: params.rawText,
        features: features,
        tendency: params.tendency,
        stars: params.stars || 0,
        merchant: params.merchant || '',
        wordCount: params.wordCount
      });
    } catch (e) {
      if (typeof callbacks.onError === 'function') {
        try { callbacks.onError({ type: 'build_error', message: '构造润色请求失败：' + (e.message || e) }); } catch (e2) {}
      }
      return;
    }

    var errored = false;
    global.AIClient.streamChat({
      messages: messages,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      signal: callbacks.signal,
      onToken: function (chunk) {
        if (errored) return;
        if (typeof callbacks.onToken === 'function') {
          try { callbacks.onToken(chunk); } catch (e) {}
        }
      },
      onDone: function (fullText) {
        if (errored) return;
        if (typeof callbacks.onDone === 'function') {
          try { callbacks.onDone(fullText); } catch (e) {}
        }
      },
      onError: function (err) {
        if (errored) return;
        errored = true;
        // 不回落本地，直接报错
        if (typeof callbacks.onError === 'function') {
          try {
            var msg = (err && err.message) ? err.message : 'AI 润色失败';
            callbacks.onError({ type: (err && err.type) || 'unknown', message: msg });
          } catch (e) {}
        }
      }
    });
  }

  /** 轻量润色（mock 兜底）：去多余空白、补句末标点、合并多余换行 */
  function lightPolish(text) {
    if (!text) return '';
    var t = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
    // 多个换行合并为一个
    t = t.replace(/\n{2,}/g, '\n');
    // 句末补句号（如果末尾没有标点）
    t = t.trim();
    if (t && !/[。！？.!?]$/.test(t)) t += '。';
    return t;
  }

  /* ===================================================================
     七、加长 / 缩短
     =================================================================== */

  /** 加长：增加细节 / 感受句 */
  function expand(text) {
    if (!text) return text;
    var additions = [
      '整体氛围很舒服，能感觉到老板的用心',
      '从进门到离开，每个环节都很顺畅',
      '细节见真章，确实值得专程来一趟',
      '这一趟体验让我对这家店有了新的认识',
      '会一直记得这次用餐的感受',
      '身边的同伴也都很满意，没有人踩雷'
    ];
    var sents = text.split('。').filter(function (s) { return s.trim(); });
    // 在中间位置插入 1-2 句
    var insertAt = Math.max(1, Math.floor(sents.length / 2));
    sents.splice(insertAt, 0, pick(additions));
    if (sents.length < 8) {
      sents.splice(insertAt + 2, 0, pick(additions));
    }
    return sents.join('。') + '。';
  }

  /** 缩短：保留核心信息点 */
  function shorten(text) {
    if (!text) return text;
    var sents = text.split('。').filter(function (s) { return s.trim(); });
    if (sents.length <= 2) return text;
    // 保留首句（总评）+ 一句细节 + 末句（结尾）
    var keep = [sents[0]];
    if (sents.length >= 3) {
      // 取中间一句作为细节
      keep.push(sents[Math.floor(sents.length / 2)]);
    }
    keep.push(sents[sents.length - 1]);
    return keep.join('。') + '。';
  }

  /* ===================================================================
     八、相似度 / 校验
     =================================================================== */

  /**
   * 文本相似度（基于字符级 Jaccard，0-1）
   * 用 2-gram 集合的交集 / 并集
   */
  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var bigA = bigrams(a);
    var bigB = bigrams(b);
    if (!bigA.size || !bigB.size) return 0;

    var inter = 0;
    bigA.forEach(function (g) {
      if (bigB.has(g)) inter++;
    });
    var union = bigA.size + bigB.size - inter;
    return union ? inter / union : 0;
  }

  function bigrams(text) {
    var set = new Set();
    for (var i = 0; i < text.length - 1; i++) {
      set.add(text.substr(i, 2));
    }
    return set;
  }

  /**
   * 真实性校验：检查是否含具体细节
   * @param {string} text
   * @returns {{valid: boolean, reason: string}}
   */
  function validateReview(text) {
    if (!text || text.length < 15) {
      return { valid: false, reason: '内容过短，缺少具体描述' };
    }

    // 1. 检查是否包含品类相关细节词
    var detailKw = extractDetailKeywords(text);
    if (detailKw.length === 0) {
      return { valid: false, reason: '缺少具体细节（如菜品名、服务点、环境描述）' };
    }

    // 2. 检查是否全是空泛套话
    var emptyPhrases = ['好吃', '不错', '推荐', '满意', '赞'];
    var onlyEmpty = true;
    var hasConcrete = false;
    emptyPhrases.forEach(function (p) {
      if (text.indexOf(p) !== -1) hasConcrete = true;
    });
    // 长度足够且含细节词则通过
    if (detailKw.length >= 1 && text.length >= 30) {
      return { valid: true, reason: 'ok' };
    }

    return { valid: false, reason: '内容过于空泛，建议补充具体体验细节' };
  }

  /* ===================================================================
     八-B、系统性深度优化：并行分析 / 跨语料挖掘 / AI品类检测 / 质量评估
     =================================================================== */

  /**
   * 并行深度分析：受控并发批处理（性能优化）
   * - 将串行的逐条分析改为分批并发，每批 concurrency 条同时进行
   * - 单条失败不阻塞批次，记录错误后跳过该条（不再使用本地兜底）
   * - 提供进度回调，UI 可实时反馈
   * @param {Array<string>} texts 待分析文本数组
   * @param {Object} opts { concurrency?: 3, onProgress?: (done, total) => void, signal?: {cancelled: boolean} }
   * @returns {Promise<Array<Object>>} 分析结果数组（顺序与 texts 一致）
   */
  function parallelDeepAnalyze(texts, opts) {
    texts = texts || [];
    opts = opts || {};
    var concurrency = Math.max(1, Math.min(opts.concurrency || 3, 5));
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var signal = opts.signal || null;

    if (!texts.length) return Promise.resolve([]);

    // 单条分析包装：失败时返回 null（由调用方过滤）
    function analyzeOne(text) {
      if (signal && signal.cancelled) return Promise.resolve(null);
      return deepAnalyzeStyle(text).then(function (feat) {
        feat._sourceText = text;
        feat._analyzedAt = Date.now();
        return feat;
      }).catch(function () {
        // AI 调用失败 → 跳过该条（不再使用本地兜底）
        return null;
      });
    }

    // 分批处理
    var results = new Array(texts.length);
    var completed = 0;
    var batches = [];
    for (var i = 0; i < texts.length; i += concurrency) {
      batches.push(texts.slice(i, i + concurrency));
    }

    var chain = Promise.resolve();
    batches.forEach(function (batch, batchIdx) {
      chain = chain.then(function () {
        if (signal && signal.cancelled) return;
        var startIdx = batchIdx * concurrency;
        var promises = batch.map(function (text, j) {
          var idx = startIdx + j;
          return analyzeOne(text).then(function (feat) {
            if (feat) results[idx] = feat;
            completed++;
            if (onProgress) {
              try { onProgress(completed, texts.length); } catch (e) {}
            }
          });
        });
        return Promise.all(promises);
      });
    });

    return chain.then(function () {
      // 过滤可能的 null（被取消的）
      return results.filter(function (r) { return r; });
    });
  }

  /**
   * 跨语料模式挖掘：从多条分析结果中提取用户独特的"写作DNA签名"
   * - 识别跨语料重复出现的模式（高频句式、叙事模板、词汇组合）
   * - 提取用户的"风格指纹"
   * - 检测常见结构模板
   * @param {Array<Object>} analyses 多条语料的深度分析结果
   * @returns {Object} 跨语料模式 { styleSignature, recurringPatterns, structuralTemplates, vocabularyProfile }
   */
  function mineCrossCorpusPatterns(analyses) {
    analyses = (analyses || []).filter(function (a) { return a && a._sourceText; });
    if (!analyses.length) {
      return { styleSignature: '', recurringPatterns: [], structuralTemplates: [], vocabularyProfile: {} };
    }

    // 1. 统计所有维度的标签频次
    var allTags = {};
    function collectTags(dim, keys) {
      if (!dim) return;
      keys.forEach(function (k) {
        var arr = dim[k];
        if (Array.isArray(arr)) {
          arr.forEach(function (t) {
            if (t && typeof t === 'string') {
              allTags[t] = (allTags[t] || 0) + 1;
            }
          });
        }
      });
    }
    analyses.forEach(function (a) {
      collectTags(a.languagePatterns, ['sentenceStructures', 'vocabularyPreference', 'semanticRelations', 'syntacticHabits']);
      collectTags(a.formatFeatures, ['punctuationUsage', 'specialMarkers']);
      collectTags(a.rhetoricalDevices, ['devices']);
      collectTags(a.informationDensity, ['quantification', 'sceneDescription']);
      collectTags(a.persuasionStrategy, ['strategies']);
      collectTags(a.sensoryLanguage, ['senses']);
    });

    // 2. 提取高频模式（出现 >= 2 次的标签）
    var recurringPatterns = Object.keys(allTags)
      .filter(function (t) { return allTags[t] >= 2; })
      .sort(function (a, b) { return allTags[b] - allTags[a]; })
      .slice(0, 12)
      .map(function (t) { return { pattern: t, frequency: allTags[t] }; });

    // 3. 提取结构模板（段落结构）
    var structureCounts = {};
    analyses.forEach(function (a) {
      var ff = a.formatFeatures || {};
      if (ff.paragraphStructure) {
        structureCounts[ff.paragraphStructure] = (structureCounts[ff.paragraphStructure] || 0) + 1;
      }
    });
    var structuralTemplates = Object.keys(structureCounts)
      .sort(function (a, b) { return structureCounts[b] - structureCounts[a]; })
      .slice(0, 3)
      .map(function (s) { return { template: s, count: structureCounts[s] }; });

    // 4. 词汇分布画像
    var vocabularyProfile = {};
    analyses.forEach(function (a) {
      (a.topWords || []).forEach(function (w) {
        vocabularyProfile[w.word] = (vocabularyProfile[w.word] || 0) + (w.count || 1);
      });
    });
    vocabularyProfile = Object.keys(vocabularyProfile)
      .sort(function (a, b) { return vocabularyProfile[b] - vocabularyProfile[a]; })
      .slice(0, 15)
      .reduce(function (acc, w) {
        acc[w] = vocabularyProfile[w];
        return acc;
      }, {});

    // 5. 生成风格签名（一句话概括用户的写作DNA）
    var signatureParts = [];
    var topPattern = recurringPatterns[0];
    if (topPattern) signatureParts.push(topPattern.pattern);

    // 情感倾向
    var sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    analyses.forEach(function (a) {
      if (a.sentiment) sentimentCounts[a.sentiment] = (sentimentCounts[a.sentiment] || 0) + 1;
    });
    var dominantSentiment = Object.keys(sentimentCounts)
      .sort(function (a, b) { return sentimentCounts[b] - sentimentCounts[a]; })[0];
    if (dominantSentiment === 'positive') signatureParts.push('积极推荐');
    else if (dominantSentiment === 'negative') signatureParts.push('吐槽避雷');
    else signatureParts.push('客观陈述');

    // 正式程度
    var formalityCounts = {};
    analyses.forEach(function (a) {
      var st = a.styleTraits || {};
      if (st.formality) formalityCounts[st.formality] = (formalityCounts[st.formality] || 0) + 1;
    });
    var dominantFormality = Object.keys(formalityCounts)
      .sort(function (a, b) { return formalityCounts[b] - formalityCounts[a]; })[0];
    if (dominantFormality === 'formal') signatureParts.push('书面正式');
    else if (dominantFormality === 'informal') signatureParts.push('口语非正式');
    else signatureParts.push('半正式半口语');

    // 平均句长
    var avgLen = 0;
    var lenCount = 0;
    analyses.forEach(function (a) {
      if (a.avgSentenceLength) {
        avgLen += a.avgSentenceLength;
        lenCount++;
      }
    });
    if (lenCount) {
      avgLen = Math.round(avgLen / lenCount);
      signatureParts.push('平均句长' + avgLen + '字');
    }

    var styleSignature = signatureParts.join(' · ');

    return {
      styleSignature: styleSignature,
      recurringPatterns: recurringPatterns,
      structuralTemplates: structuralTemplates,
      vocabularyProfile: vocabularyProfile,
      dominantSentiment: dominantSentiment,
      dominantFormality: dominantFormality,
      avgSentenceLength: avgLen,
      corpusCount: analyses.length
    };
  }

  /**
   * AI 驱动品类检测：用 AI 语义理解替代关键词匹配
   * - 必须配置 AI API，否则 reject（不再提供本地兜底）
   * - AI 调用失败 → reject，由调用方处理
   * @param {Array<string>} texts 语料文本数组
   * @param {Object} cfg AI 配置
   * @returns {Promise<{category: string, perItem: Array, source: 'ai'}>}
   */
  function aiDetectCategory(texts, cfg) {
    texts = texts || [];
    if (!texts.length) {
      return Promise.reject(new Error('无语料可识别品类'));
    }

    // 未配置 AI → reject
    if (!isRealAIEnabled(cfg) || !global.AIClient || typeof global.AIClient.chat !== 'function') {
      return Promise.reject(new Error('AI 未配置，无法进行品类识别'));
    }

    var systemContent = [
      '你是一位专业的本地生活品类识别专家。请分析以下多条用户评价，判断它们共同所属的品类。',
      '',
      '【可选品类】',
      '美食、甜品饮品、美发、酒店、休闲、健身、电影、亲子、购物、美甲美睫、KTV、其他',
      '',
      '【品类判断规则】',
      '1. 基于关键词（菜品名、服务项、设施等）和语义内容综合判断',
      '2. 多条语料以多数表决为准，但需考虑语义一致性',
      '3. 如果跨品类明显，选择最主要的一个；实在无法判断则返回"其他"',
      '4. 返回每个品类的置信度得分（0-100）',
      '',
      '【输出格式】',
      '仅输出 JSON：',
      '{"category":"品类名","confidence":85,"scores":{"美食":80,"酒店":20,...}}',
      '不要 markdown 标记，不要解释。'
    ].join('\n');

    var userContent = '请分析以下 ' + texts.length + ' 条评价的共同品类：\n\n' +
      texts.slice(0, 10).map(function (t, i) {
        return (i + 1) + '. ' + t.slice(0, 120);
      }).join('\n');

    return global.AIClient.chat({
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ],
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: 300,
      timeout: 20000
    }).then(function (content) {
      if (!content) throw new Error('AI 返回为空');
      var str = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      var start = str.indexOf('{');
      var end = str.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('AI 返回非 JSON');
      var obj = JSON.parse(str.substring(start, end + 1));
      var category = obj.category || '其他';
      // 归一化品类名
      category = normalizeCategory(category);
      // 校验是否在标准品类列表中
      var validCategories = ['美食', '甜品饮品', '美发', '酒店', '休闲', '健身', '电影', '亲子', '购物', '美甲美睫', 'KTV', '其他'];
      if (validCategories.indexOf(category) === -1) category = '其他';

      // 构造 perItem
      var perItem = texts.map(function (t) {
        return { text: t, category: category, score: obj.confidence || 80 };
      });

      return {
        category: category,
        perItem: perItem,
        source: 'ai',
        confidence: obj.confidence || 80,
        scores: obj.scores || {}
      };
    });
    // 不再 .catch：让错误传播，由 finishAnalysis 处理
  }

  /**
   * 语料质量评估：多样性 / 覆盖度 / 异常检测 / 改进建议
   * @param {Array<Object>} analyses 多条语料的深度分析结果
   * @returns {Object} 质量评估 { score, diversity, coverage, outliers, suggestions }
   */
  function assessCorpusQuality(analyses) {
    analyses = (analyses || []).filter(function (a) { return a; });
    var count = analyses.length;
    if (!count) {
      return { score: 0, diversity: 0, coverage: 0, outliers: [], suggestions: ['请先添加训练语料'] };
    }

    // 1. 多样性评估：基于标签种类数
    var uniqueTags = {};
    analyses.forEach(function (a) {
      function collect(dim, keys) {
        if (!dim) return;
        keys.forEach(function (k) {
          if (Array.isArray(dim[k])) {
            dim[k].forEach(function (t) { if (t) uniqueTags[t] = true; });
          }
        });
      }
      collect(a.languagePatterns, ['sentenceStructures', 'vocabularyPreference', 'semanticRelations', 'syntacticHabits']);
      collect(a.formatFeatures, ['punctuationUsage', 'specialMarkers']);
      collect(a.rhetoricalDevices, ['devices']);
      collect(a.persuasionStrategy, ['strategies']);
      collect(a.sensoryLanguage, ['senses']);
    });
    var tagCount = Object.keys(uniqueTags).length;
    var diversity = Math.min(100, Math.round(tagCount * 3.5)); // 28+ tags = 100%

    // 2. 覆盖度评估：八维度是否有数据
    var dimensionsCovered = 0;
    var dimensions = ['languagePatterns', 'formatFeatures', 'styleTraits', 'rhetoricalDevices', 'narrativePerspective', 'informationDensity', 'persuasionStrategy', 'sensoryLanguage'];
    dimensions.forEach(function (dim) {
      var hasData = analyses.some(function (a) {
        return a[dim] && Object.keys(a[dim]).length > 0;
      });
      if (hasData) dimensionsCovered++;
    });
    var coverage = Math.round((dimensionsCovered / 8) * 100);

    // 3. 异常检测：置信度低 / 过短
    var outliers = [];

    analyses.forEach(function (a, idx) {
      var issues = [];
      // 置信度低
      if (typeof a.confidence === 'number' && a.confidence < 0.5) {
        issues.push('分析置信度低(' + a.confidence.toFixed(2) + ')');
      }
      // 过短
      var srcText = a._sourceText || '';
      if (srcText.length < 30) {
        issues.push('语料过短(' + srcText.length + '字)');
      }
      if (issues.length) {
        outliers.push({ index: idx, issues: issues, preview: srcText.slice(0, 40) });
      }
    });

    // 4. 综合评分
    var lengthScore = Math.min(100, count * 12.5); // 8条+ = 100%
    var outlierPenalty = Math.min(30, outliers.length * 8);
    var score = Math.max(0, Math.round((diversity * 0.3 + coverage * 0.3 + lengthScore * 0.4) - outlierPenalty));

    // 5. 改进建议（已移除本地模式相关提示：训练必须配置 AI API）
    var suggestions = [];
    if (count < 5) suggestions.push('语料数量较少（' + count + '条），建议补充至5条以上以提升学习效果');
    if (diversity < 50) suggestions.push('风格多样性不足，建议补充不同句式、不同情感倾向的语料');
    if (coverage < 75) {
      suggestions.push('部分分析维度未覆盖，建议补充含修辞手法、感官描写等内容');
    }
    if (outliers.length > 0) suggestions.push('检测到 ' + outliers.length + ' 条异常语料，建议检查或替换');
    if (!suggestions.length) suggestions.push('语料质量良好，可以开始生成评价');

    return {
      score: score,
      diversity: diversity,
      coverage: coverage,
      corpusCount: count,
      dimensionsCovered: dimensionsCovered,
      outliers: outliers,
      suggestions: suggestions
    };
  }

  /**
   * 增强摘要生成：多维度风格画像 + 具体范例 + 质量评估
   * @param {Object} features 聚合后的风格特征
   * @param {Array} analyses 所有分析结果
   * @param {Object} quality assessCorpusQuality 返回值
   * @param {Array} prevTopWords 之前已有的 topWords
   * @param {Object} [precomputedPatterns] 预计算的跨语料模式（避免重复计算）
   * @returns {string} 增强版中文摘要
   */
  function generateEnhancedSummary(features, analyses, quality, prevTopWords, precomputedPatterns) {
    features = features || {};
    quality = quality || {};
    prevTopWords = prevTopWords || [];
    analyses = analyses || [];

    var prevSet = {};
    prevTopWords.forEach(function (w) { prevSet[w.word] = true; });

    var parts = [];

    // 1. 质量总评
    if (quality.score !== undefined) {
      var qualityLabel = quality.score >= 80 ? '优秀' : quality.score >= 60 ? '良好' : quality.score >= 40 ? '一般' : '待提升';
      parts.push('训练质量：' + qualityLabel + '（' + quality.score + '分）');
    }

    // 2. 风格签名（优先复用预计算结果，避免重复计算）
    if (analyses.length) {
      var patterns = precomputedPatterns || mineCrossCorpusPatterns(analyses);
      if (patterns && patterns.styleSignature) {
        parts.push('写作DNA：' + patterns.styleSignature);
      }
    }

    // 3. 情感与基调
    var sentimentText = '';
    if (features.sentiment === 'positive') sentimentText = '积极推荐';
    else if (features.sentiment === 'negative') sentimentText = '吐槽避雷';
    else sentimentText = '中立陈述';
    parts.push('情感倾向：' + sentimentText);

    // 4. 高频词
    var addedWords = (features.topWords || []).filter(function (w) {
      return !prevSet[w.word];
    }).map(function (w) { return w.word; }).slice(0, 5);
    if (addedWords.length) {
      parts.push('高频词汇：『' + addedWords.join('』『') + '』');
    }

    // 5. 修辞与感官（新增维度）
    var rd = features.rhetoricalDevices || {};
    if (rd.devices && rd.devices.length) {
      parts.push('常用修辞：' + rd.devices.slice(0, 3).join('、'));
    }
    var sl = features.sensoryLanguage || {};
    if (sl.senses && sl.senses.length) {
      parts.push('感官维度：' + sl.senses.slice(0, 3).join('、'));
    }
    var ps = features.persuasionStrategy || {};
    if (ps.strategies && ps.strategies.length) {
      parts.push('说服策略：' + ps.strategies.slice(0, 2).join('、'));
    }

    // 6. 改进建议（取质量评估的第一条）
    if (quality.suggestions && quality.suggestions.length) {
      parts.push('建议：' + quality.suggestions[0]);
    }

    return parts.join('；') + '。';
  }

  /* ===================================================================
     九、导出
     =================================================================== */

  global.AIEngine = {
    // 风格分析
    analyzeStyle: analyzeStyle,
    deepAnalyzeStyle: deepAnalyzeStyle,
    // 系统性深度优化：并行分析 / 跨语料挖掘 / AI品类检测 / 质量评估
    parallelDeepAnalyze: parallelDeepAnalyze,
    mineCrossCorpusPatterns: mineCrossCorpusPatterns,
    aiDetectCategory: aiDetectCategory,
    assessCorpusQuality: assessCorpusQuality,
    generateEnhancedSummary: generateEnhancedSummary,
    // 特征融合 / 聚合
    mergeFeatures: mergeFeatures,
    aggregateStyle: aggregateStyle,
    // 品类识别（基于关键词加权打分）
    detectCategory: detectCategory,
    detectCategoryFromTexts: detectCategoryFromTexts,
    normalizeCategory: normalizeCategory,
    // 摘要
    generateSummary: generateSummary,
    // 生成（调度层，async；真实 API 优先，回落模拟引擎）
    generateReview: generateReview,
    regenerate: regenerate,
    generateReviewStream: generateReviewStream,
    // 提问模式 / 润色模式调度
    generateQuestions: generateQuestions,
    generateFromAnswersStream: generateFromAnswersStream,
    polishStream: polishStream,
    lightPolish: lightPolish,
    // 模拟引擎（同步，供生成页改造时直接复用 / 测试）
    generateReviewMock: generateReviewMock,
    regenerateMock: regenerateMock,
    expand: expand,
    shorten: shorten,
    // 工具
    similarity: similarity,
    validateReview: validateReview,
    // 预置语料（供视图层展示「使用通用风格」提示时引用）
    _presetCorpus: PRESET_CORPUS,
    // 内部工具暴露（供测试 / 视图调试）
    _utils: {
      tokenize: tokenize,
      splitSentences: splitSentences,
      extractEmojis: extractEmojis,
      detectSentiment: detectSentiment,
      extractDetailKeywords: extractDetailKeywords,
      sentimentByStars: sentimentByStars,
      lengthRange: lengthRange
    }
  };

})(typeof window !== 'undefined' ? window : this);
