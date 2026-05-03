const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const execFileAsync = promisify(execFile);

const FEISHU_CLIENT_ID = (process.env.FEISHU_CLIENT_ID || '').trim();
const FEISHU_CLIENT_SECRET = (process.env.FEISHU_CLIENT_SECRET || '').trim();
const FEISHU_REDIRECT_URI = (process.env.FEISHU_REDIRECT_URI || '').trim();
const FEISHU_OAUTH_SCOPES = (process.env.FEISHU_OAUTH_SCOPES || 'auth:user.id:read user_profile offline_access').trim();
const FEISHU_OAUTH_PROMPT = (process.env.FEISHU_OAUTH_PROMPT || 'consent').trim();
const FEISHU_OAUTH_SUCCESS_REDIRECT = (process.env.FEISHU_OAUTH_SUCCESS_REDIRECT || '').trim();
const FEISHU_AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const FEISHU_STATE_TTL_SECONDS = 10 * 60;
const FEISHU_TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const TENCENT_NEWS_API_KEY_URL = 'https://news.qq.com/exchange?scene=appkey';
const TENCENT_NEWS_WINDOWS_INSTALL_URL = 'https://mat1.gtimg.com/qqcdn/qqnews/cli/hub/tencent-news/setup.ps1';
const TENCENT_NEWS_UNIX_INSTALL_URL = 'https://mat1.gtimg.com/qqcdn/qqnews/cli/hub/tencent-news/setup.sh';
const TENCENT_NEWS_API_KEY_MISSING_PATTERN = /未设置\s*API\s*Key|api key.*not set|apikey.*not set|not set/i;
const TENCENT_NEWS_DEFAULT_TIMEOUT_MS = 15000;
const TENCENT_NEWS_MAX_LIMIT = 20;

const FEISHU_BINDING_SELECT = {
  id: true,
  feishuOpenId: true,
  feishuUnionId: true,
  feishuUserId: true,
  feishuTenantKey: true,
  feishuName: true,
  feishuEmail: true,
  feishuAvatarUrl: true,
  feishuScope: true,
  feishuAccessToken: true,
  feishuRefreshToken: true,
  feishuAccessTokenExpiresAt: true,
  feishuRefreshTokenExpiresAt: true,
  feishuConnectedAt: true
};

const parseFeishuScopeList = (scopeValue) => String(scopeValue || '')
  .split(/\s+/)
  .map((item) => item.trim())
  .filter(Boolean);

const normalizeOptionalUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return new URL(value.trim()).toString();
  } catch (error) {
    return '';
  }
};

const toIsoStringOrNull = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const isDateExpired = (value, skewMs = 0) => {
  if (!value) return true;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.getTime() <= Date.now() + skewMs;
};

const isFeishuOAuthConfigured = () => Boolean(
  FEISHU_CLIENT_ID && FEISHU_CLIENT_SECRET && FEISHU_REDIRECT_URI && process.env.JWT_SECRET
);

const buildFeishuBindingStatus = (user, extras = {}) => {
  const accessTokenExpiresAt = user?.feishuAccessTokenExpiresAt || null;
  const refreshTokenExpiresAt = user?.feishuRefreshTokenExpiresAt || null;
  const tokenValid = Boolean(user?.feishuAccessToken) && !isDateExpired(accessTokenExpiresAt, FEISHU_TOKEN_REFRESH_SKEW_MS);
  const refreshTokenValid = Boolean(user?.feishuRefreshToken) && !isDateExpired(refreshTokenExpiresAt);

  return {
    provider: 'feishu_oauth',
    configured: isFeishuOAuthConfigured(),
    connected: Boolean(user?.feishuOpenId),
    tokenValid,
    refreshTokenValid,
    needsAuthorization: !user?.feishuOpenId,
    needsReauth: Boolean(user?.feishuOpenId) && !tokenValid && !refreshTokenValid,
    accessTokenExpiresAt: toIsoStringOrNull(accessTokenExpiresAt),
    refreshTokenExpiresAt: toIsoStringOrNull(refreshTokenExpiresAt),
    connectedAt: toIsoStringOrNull(user?.feishuConnectedAt),
    scope: parseFeishuScopeList(user?.feishuScope),
    profile: user?.feishuOpenId ? {
      openId: user.feishuOpenId,
      unionId: user.feishuUnionId || null,
      userId: user.feishuUserId || null,
      tenantKey: user.feishuTenantKey || null,
      name: user.feishuName || null,
      email: user.feishuEmail || null,
      avatarUrl: user.feishuAvatarUrl || null
    } : null,
    ...extras
  };
};

const buildFeishuStateToken = ({ userId, clientRedirectUri }) => jwt.sign(
  {
    type: 'feishu_oauth_state',
    userId,
    clientRedirectUri: clientRedirectUri || '',
    nonce: crypto.randomBytes(16).toString('hex')
  },
  process.env.JWT_SECRET,
  { expiresIn: FEISHU_STATE_TTL_SECONDS }
);

const buildFeishuAuthorizeUrl = ({ state }) => {
  const url = new URL(FEISHU_AUTHORIZE_URL);
  url.searchParams.set('client_id', FEISHU_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', FEISHU_REDIRECT_URI);
  if (FEISHU_OAUTH_SCOPES) {
    url.searchParams.set('scope', FEISHU_OAUTH_SCOPES);
  }
  if (FEISHU_OAUTH_PROMPT) {
    url.searchParams.set('prompt', FEISHU_OAUTH_PROMPT);
  }
  url.searchParams.set('state', state);
  return url.toString();
};

const createToolRuntime = ({
  prisma,
  amapApiKey,
  tavilyApiKey,
  getDynamicAiTools,
  runMcpTool,
  larkApiRuntime,
  refreshFeishuAccessTokenForUser
}) => {
  const baseAiTools = [
    {
      type: 'function',
      function: {
        name: 'get_user_profile',
        description: '获取当前登录用户的基础资料',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_interviews',
        description: '获取当前用户的面试安排列表',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_interview',
        description: '创建新的面试安排，date 需为可解析日期字符串',
        parameters: {
          type: 'object',
          properties: {
            school: { type: 'string' },
            major: { type: 'string' },
            date: { type: 'string' },
            city: { type: 'string' },
            type: { type: 'string' }
          },
          required: ['school', 'major', 'date', 'city', 'type'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'analyze_schedule_conflicts',
        description: '分析用户面试安排中同一天是否存在冲突并返回冲突清单',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: '查询指定城市的天气信息，支持实时天气或未来预报',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: '城市名、adcode 或 citycode，例如 北京、上海、110000' },
            mode: { type: 'string', enum: ['current', 'forecast'], description: 'current=实时天气, forecast=天气预报' }
          },
          required: ['city'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_hotels',
        description: '搜索指定城市或地点周边的酒店信息',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: '城市名，例如 北京' },
            keywords: { type: 'string', description: '搜索关键词，例如 同济大学周边酒店' }
          },
          required: ['city', 'keywords'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索最新的保研资讯、院校动态、导师信息或实时新闻',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词，例如 2024清华计算机夏令营通知' }
          },
          required: ['query'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'tencent_news_search',
        description: '通过腾讯新闻官方 CLI 搜索新闻。适合查询热点事件、时政、科技、教育或指定关键词新闻。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '新闻搜索关键词，例如 保研 政策、人工智能、教育部' },
            limit: { type: 'integer', description: '返回条数，建议 1-10，最大 20' }
          },
          required: ['query'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'tencent_news_hot',
        description: '通过腾讯新闻官方 CLI 获取当前热点新闻榜单。',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', description: '返回条数，建议 1-10，最大 20' }
          },
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'tencent_news_briefing',
        description: '通过腾讯新闻官方 CLI 获取今日早报或晚报。',
        parameters: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: ['morning', 'evening'],
              description: 'morning=早报，evening=晚报'
            }
          },
          required: ['period'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'bazi_reading',
        description: '传统文化陪伴型八字信息整理工具。仅当用户明确提出“算八字”“看八字”“四柱”“命盘”“传统命理陪伴”等请求时调用。支持部分参数缺失，工具会返回缺失项、后续提问建议与陪伴式解读边界。结果仅供传统文化学习与娱乐参考，不构成现实决策建议。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '用户称呼，可选' },
            calendarType: {
              type: 'string',
              enum: ['solar', 'lunar', 'unknown'],
              description: '出生日期是公历还是农历；未知时传 unknown'
            },
            birthDate: { type: 'string', description: '出生日期，建议 YYYY-MM-DD，也可传中文日期文本' },
            birthTime: { type: 'string', description: '出生时间，例如 09:30、上午9点、子时' },
            gender: { type: 'string', description: '性别，用于传统命理语境，可留空' },
            birthPlace: { type: 'string', description: '出生地，例如 江苏南京、湖北武汉' },
            questionFocus: { type: 'string', description: '最想聚焦的方向，例如 情绪、关系、学业、事业' }
          },
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_auth_status',
        description: '检查当前漫旅用户是否已绑定自己的飞书账号，并返回 OAuth 授权状态、token 状态和已授权 scope。适用于手机端和 H5。',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_auth_login_start',
        description: '为当前漫旅用户生成飞书 OAuth 授权链接。用户可在手机浏览器中直接打开完成授权，禁止提示用户运行 lark-cli 或 config init。',
        parameters: {
          type: 'object',
          properties: {
            redirectUri: { type: 'string', description: '授权成功后前端希望回跳的地址，可选；适合 H5 页面或 App 深链' }
          },
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_docs_search',
        description: '通过飞书官方 lark-cli 搜索云文档、知识库和表格文件',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词，可留空用于宽泛浏览' },
            pageSize: { type: 'integer', description: '返回条数，建议 5-20' }
          },
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_docs_fetch',
        description: '通过飞书官方 lark-cli 读取指定飞书文档内容，doc 可传 URL 或 token',
        parameters: {
          type: 'object',
          properties: {
            doc: { type: 'string', description: '飞书文档 URL 或 token' },
            apiVersion: { type: 'string', description: '默认 v2' },
            limit: { type: 'integer' },
            offset: { type: 'integer' }
          },
          required: ['doc'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_docs_create',
        description: '通过飞书官方 lark-cli 创建飞书文档。默认使用 XML 格式；若用户明确要求 Markdown，可传 docFormat=markdown。content 需要传完整文档内容，XML 建议包含 <title> 标题</title>。',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '文档内容。XML 示例：<title>标题</title><p>正文</p>' },
            docFormat: { type: 'string', enum: ['xml', 'markdown'], description: '内容格式，默认 xml' },
            apiVersion: { type: 'string', description: '默认 v2' },
            parentToken: { type: 'string', description: '父文件夹或知识库节点 token' },
            parentPosition: { type: 'string', description: '父节点位置，如 my_library；与 parentToken 二选一' }
          },
          required: ['content'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_docs_update',
        description: '通过飞书官方 lark-cli 更新已有飞书文档。支持 append、overwrite、str_replace、block_insert_after、block_replace、block_delete、block_copy_insert_after、block_move_after。',
        parameters: {
          type: 'object',
          properties: {
            doc: { type: 'string', description: '飞书文档 URL 或 token' },
            command: {
              type: 'string',
              enum: ['append', 'overwrite', 'str_replace', 'block_insert_after', 'block_replace', 'block_delete', 'block_copy_insert_after', 'block_move_after'],
              description: '更新指令'
            },
            content: { type: 'string', description: '新内容。append/overwrite/replace 等命令常用' },
            docFormat: { type: 'string', enum: ['xml', 'markdown'], description: '内容格式，默认 xml' },
            apiVersion: { type: 'string', description: '默认 v2' },
            pattern: { type: 'string', description: 'str_replace 时使用的匹配文本或模式' },
            blockId: { type: 'string', description: 'block 级操作使用的目标 block id；传 -1 表示文末' },
            srcBlockIds: { type: 'string', description: 'block_copy_insert_after / block_move_after 时使用，多个 block id 用逗号分隔' },
            revisionId: { type: 'integer', description: '基准 revision，默认最新' }
          },
          required: ['doc', 'command'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_calendar_agenda',
        description: '通过飞书官方 lark-cli 查询日程安排。适合查询今天、明天、本周或给定时间范围内的飞书日程。',
        parameters: {
          type: 'object',
          properties: {
            start: { type: 'string', description: '开始时间，支持 ISO 8601 或仅日期，如 2026-04-28 或 2026-04-28T09:00:00+08:00' },
            end: { type: 'string', description: '结束时间，支持 ISO 8601 或仅日期；不传时默认与 start 同一天结束' },
            calendarId: { type: 'string', description: '日历 ID，默认 primary' },
            format: { type: 'string', enum: ['json', 'pretty', 'table', 'ndjson', 'csv'], description: '默认 json' }
          },
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_calendar_create',
        description: '通过飞书官方 lark-cli 创建飞书日程。仅在用户明确要求创建/预约日程时使用；start 和 end 必须是明确时间，建议使用 ISO 8601。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '日程标题，尽量只保留主题，不要混入时间地点人物' },
            start: { type: 'string', description: '开始时间，必须为明确时间，推荐 ISO 8601，如 2026-04-28T14:00:00+08:00' },
            end: { type: 'string', description: '结束时间，必须为明确时间，推荐 ISO 8601' },
            description: { type: 'string', description: '日程说明、议程或备注' },
            attendeeIds: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } }
              ],
              description: '参与人 ID，可传逗号分隔字符串或数组；支持用户 ou_、群 oc_、会议室 omm_'
            },
            calendarId: { type: 'string', description: '日历 ID，默认 primary' },
            rrule: { type: 'string', description: '重复规则，遵循 RFC5545；不要使用 COUNT' },
            dryRun: { type: 'boolean', description: '仅预览请求，不实际创建' }
          },
          required: ['start', 'end'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'lark_drive_list_files',
        description: '通过飞书官方 lark-cli 列出云空间文件。folderToken 为空时列出根目录。',
        parameters: {
          type: 'object',
          properties: {
            folderToken: { type: 'string', description: '文件夹 token，留空表示根目录' },
            orderBy: { type: 'string', description: 'EditedTime 或 CreatedTime' },
            direction: { type: 'string', description: 'ASC 或 DESC' },
            pageSize: { type: 'integer', description: '返回条数' },
            pageAll: { type: 'boolean', description: '是否自动翻页' },
            pageLimit: { type: 'integer', description: '自动翻页页数上限' }
          },
          additionalProperties: false
        }
      }
    }
  ];

  const toDayKey = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  };

  const fetchAmapJson = async (url) => {
    const response = await fetch(url);
    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`高德接口返回非 JSON: ${text.slice(0, 120)}`);
    }

    if (!response.ok) {
      const message = data?.info || text || `HTTP ${response.status}`;
      throw new Error(`高德接口请求失败: ${message}`);
    }
    if (data?.status !== '1') {
      throw new Error(`高德接口业务失败: ${data?.info || 'unknown error'}`);
    }
    return data;
  };

  const resolveAmapCityCode = async (cityInput) => {
    const raw = (cityInput || '').trim();
    if (!raw) throw new Error('城市参数不能为空');

    if (/^\d{6}$/.test(raw)) {
      return { cityCode: raw, cityName: raw };
    }

    const params = new URLSearchParams({
      key: amapApiKey,
      keywords: raw,
      subdistrict: '0',
      extensions: 'base'
    });
    const url = `https://restapi.amap.com/v3/config/district?${params.toString()}`;
    const data = await fetchAmapJson(url);
    const first = Array.isArray(data?.districts) ? data.districts[0] : null;
    if (!first?.adcode) {
      throw new Error(`未找到城市: ${raw}`);
    }
    return { cityCode: first.adcode, cityName: first.name || raw };
  };

  const getAmapWeather = async ({ city, mode = 'current' }) => {
    if (!amapApiKey) {
      throw new Error('缺少 AMAP_API_KEY 配置');
    }

    const weatherMode = mode === 'forecast' ? 'all' : 'base';
    const { cityCode, cityName } = await resolveAmapCityCode(city);
    const params = new URLSearchParams({
      key: amapApiKey,
      city: cityCode,
      extensions: weatherMode
    });
    const url = `https://restapi.amap.com/v3/weather/weatherInfo?${params.toString()}`;
    const data = await fetchAmapJson(url);

    if (weatherMode === 'base') {
      const live = Array.isArray(data?.lives) ? data.lives[0] : null;
      if (!live) throw new Error('未获取到实时天气');
      return {
        type: 'current',
        city: live.city || cityName,
        adcode: live.adcode || cityCode,
        weather: live.weather,
        temperature: live.temperature,
        windDirection: live.winddirection,
        windPower: live.windpower,
        humidity: live.humidity,
        reportTime: live.reporttime
      };
    }

    const forecast = Array.isArray(data?.forecasts) ? data.forecasts[0] : null;
    if (!forecast) throw new Error('未获取到天气预报');
    return {
      type: 'forecast',
      city: forecast.city || cityName,
      adcode: forecast.adcode || cityCode,
      reportTime: forecast.reporttime,
      casts: Array.isArray(forecast.casts)
        ? forecast.casts.map((item) => ({
            date: item.date,
            week: item.week,
            dayWeather: item.dayweather,
            nightWeather: item.nightweather,
            dayTemp: item.daytemp,
            nightTemp: item.nighttemp,
            dayWind: item.daywind,
            nightWind: item.nightwind,
            dayPower: item.daypower,
            nightPower: item.nightpower
          }))
        : []
    };
  };

  const searchAmapPoi = async ({ city, keywords, types = '100100|100101|100200' }) => {
    if (!amapApiKey) {
      throw new Error('缺少 AMAP_API_KEY 配置');
    }

    const { cityCode } = await resolveAmapCityCode(city);
    const params = new URLSearchParams({
      key: amapApiKey,
      keywords,
      city: cityCode,
      types,
      offset: '5',
      page: '1',
      extensions: 'all'
    });
    const url = `https://restapi.amap.com/v3/place/text?${params.toString()}`;
    const data = await fetchAmapJson(url);

    if (!Array.isArray(data?.pois)) return [];
    return data.pois.map((poi) => ({
      name: poi.name,
      type: poi.type,
      address: poi.address,
      distance: poi.distance,
      tel: poi.tel,
      rating: poi.biz_ext?.rating,
      cost: poi.biz_ext?.cost
    }));
  };

  const searchTavily = async ({ query }) => {
    if (!tavilyApiKey) {
      throw new Error('缺少 TAVILY_API_KEY 配置');
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 5
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tavily 搜索失败: ${response.status} ${text}`);
    }

    const data = await response.json();
    return {
      answer: data.answer,
      results: data.results.map((item) => ({
        title: item.title,
        url: item.url,
        content: item.content,
        score: item.score
      }))
    };
  };

  const tencentNewsCliPathFromEnv = String(process.env.TENCENT_NEWS_CLI_PATH || '').trim();
  const tencentNewsApiKey = String(process.env.TENCENT_NEWS_API_KEY || '').trim();
  const tencentNewsCaller = String(process.env.TENCENT_NEWS_CALLER || 'manlv-backend').trim() || 'manlv-backend';
  const parsedTencentNewsTimeoutMs = Number(process.env.TENCENT_NEWS_TIMEOUT_MS);
  const tencentNewsTimeoutMs = Number.isFinite(parsedTencentNewsTimeoutMs) && parsedTencentNewsTimeoutMs >= 3000
    ? parsedTencentNewsTimeoutMs
    : TENCENT_NEWS_DEFAULT_TIMEOUT_MS;

  let cachedTencentNewsCliPath = '';
  let cachedTencentNewsApiKeyConfigured = false;

  const clampTencentNewsLimit = (value, defaultValue = 10) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return defaultValue;
    return Math.max(1, Math.min(TENCENT_NEWS_MAX_LIMIT, Math.floor(parsed)));
  };

  const getTencentNewsInstallHint = () => (
    process.platform === 'win32'
      ? `请先在 PowerShell 中执行: irm ${TENCENT_NEWS_WINDOWS_INSTALL_URL} | iex`
      : `请先执行: curl -fsSL ${TENCENT_NEWS_UNIX_INSTALL_URL} | sh`
  );

  const getTencentNewsConfiguredInstallRoot = () => {
    const configuredRoot = String(process.env.TENCENT_NEWS_INSTALL || '').trim();
    if (configuredRoot) return configuredRoot;
    return `${os.homedir()}/.tencent-news-cli`;
  };

  const getTencentNewsCliCandidates = () => {
    const installRoot = getTencentNewsConfiguredInstallRoot().replace(/\\/g, '/');
    const defaultCliPath = process.platform === 'win32'
      ? `${installRoot}/bin/tencent-news-cli.exe`
      : `${installRoot}/bin/tencent-news-cli`;

    const candidates = [
      tencentNewsCliPathFromEnv,
      defaultCliPath,
      process.platform === 'win32' ? 'tencent-news-cli.exe' : 'tencent-news-cli'
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean);

    return [...new Set(candidates)];
  };

  const formatTencentNewsCliFailure = (result, cliPath) => {
    const output = String(result?.output || '').trim();
    if (result?.notFound) {
      return `未找到腾讯新闻 CLI。${getTencentNewsInstallHint()}`;
    }
    if (TENCENT_NEWS_API_KEY_MISSING_PATTERN.test(output)) {
      return `腾讯新闻 API Key 未配置。请先访问 ${TENCENT_NEWS_API_KEY_URL} 获取 API Key，并在服务端配置 TENCENT_NEWS_API_KEY。`;
    }
    if (result?.timedOut) {
      return `腾讯新闻 CLI 调用超时（>${tencentNewsTimeoutMs}ms），请稍后重试。`;
    }
    return output || `腾讯新闻 CLI 调用失败: ${cliPath}`;
  };

  const runTencentNewsCli = async (cliPath, args, { allowFailure = false } = {}) => {
    try {
      const { stdout, stderr } = await execFileAsync(cliPath, args, {
        timeout: tencentNewsTimeoutMs,
        maxBuffer: 1024 * 1024 * 5,
        windowsHide: true
      });

      const combinedOutput = [stdout, stderr]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();

      return {
        ok: true,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        output: combinedOutput
      };
    } catch (error) {
      const stdout = String(error?.stdout || '');
      const stderr = String(error?.stderr || '');
      const combinedOutput = [stdout, stderr, error?.message]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();

      const result = {
        ok: false,
        stdout,
        stderr,
        output: combinedOutput,
        exitCode: typeof error?.code === 'number' ? error.code : null,
        notFound: error?.code === 'ENOENT',
        timedOut: error?.killed === true && error?.signal === 'SIGTERM'
      };

      if (allowFailure) {
        return result;
      }

      throw new Error(formatTencentNewsCliFailure(result, cliPath));
    }
  };

  const resolveTencentNewsCliPath = async () => {
    if (cachedTencentNewsCliPath) return cachedTencentNewsCliPath;

    const candidates = getTencentNewsCliCandidates();
    let lastFailure = null;

    for (const candidate of candidates) {
      const result = await runTencentNewsCli(candidate, ['help'], { allowFailure: true });
      if (result.ok) {
        cachedTencentNewsCliPath = candidate;
        return candidate;
      }
      lastFailure = { candidate, result };
      if (!result.notFound) {
        throw new Error(formatTencentNewsCliFailure(result, candidate));
      }
    }

    if (lastFailure) {
      throw new Error(formatTencentNewsCliFailure(lastFailure.result, lastFailure.candidate));
    }

    throw new Error(`未找到腾讯新闻 CLI。${getTencentNewsInstallHint()}`);
  };

  const ensureTencentNewsApiKeyConfigured = async (cliPath) => {
    if (cachedTencentNewsApiKeyConfigured) return;

    if (!tencentNewsApiKey) {
      throw new Error(`缺少 TENCENT_NEWS_API_KEY 配置。请先访问 ${TENCENT_NEWS_API_KEY_URL} 获取 API Key。`);
    }

    const keyState = await runTencentNewsCli(cliPath, ['apikey-get'], { allowFailure: true });
    if (keyState.ok && !TENCENT_NEWS_API_KEY_MISSING_PATTERN.test(keyState.output)) {
      cachedTencentNewsApiKeyConfigured = true;
      return;
    }

    if (!keyState.ok && !TENCENT_NEWS_API_KEY_MISSING_PATTERN.test(keyState.output)) {
      throw new Error(formatTencentNewsCliFailure(keyState, cliPath));
    }

    const setResult = await runTencentNewsCli(cliPath, ['apikey-set', tencentNewsApiKey], { allowFailure: true });
    if (!setResult.ok) {
      throw new Error(formatTencentNewsCliFailure(setResult, cliPath));
    }

    cachedTencentNewsApiKeyConfigured = true;
  };

  const executeTencentNewsCommand = async (subcommand, commandArgs = []) => {
    const cliPath = await resolveTencentNewsCliPath();
    await ensureTencentNewsApiKeyConfigured(cliPath);

    const args = [subcommand, ...commandArgs, '--caller', tencentNewsCaller];
    const result = await runTencentNewsCli(cliPath, args, { allowFailure: true });
    if (!result.ok) {
      throw new Error(formatTencentNewsCliFailure(result, cliPath));
    }

    return {
      provider: 'tencent-news-cli',
      subcommand,
      caller: tencentNewsCaller,
      text: result.output || result.stdout || ''
    };
  };

  const BAZI_DISCLAIMER =
    '仅供传统文化学习与娱乐参考，不构成医疗、法律、财务、升学或人生决策建议。';

  const normalizeCalendarType = (value) => {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 'unknown';
    if (['solar', 'gregorian', '公历', '阳历'].includes(text)) return 'solar';
    if (['lunar', '农历', '阴历'].includes(text)) return 'lunar';
    return 'unknown';
  };

  const pad2 = (value) => String(value).padStart(2, '0');

  const normalizeBirthDate = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';

    const slashMatch = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
    if (slashMatch) {
      const [, year, month, day] = slashMatch;
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    return text.replace(/\s+/g, '');
  };

  const extractHour = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;

    const hhmmMatch = text.match(/(\d{1,2})(?::|点|时)(\d{1,2})?/);
    if (hhmmMatch) {
      let hour = Number(hhmmMatch[1]);
      if (Number.isNaN(hour) || hour < 0 || hour > 23) return null;
      if (/下午|晚上|傍晚/.test(text) && hour < 12) hour += 12;
      if (/中午/.test(text) && hour < 11) hour += 12;
      if (/凌晨/.test(text) && hour === 12) hour = 0;
      return hour;
    }

    const hourOnlyMatch = text.match(/(\d{1,2})/);
    if (hourOnlyMatch) {
      let hour = Number(hourOnlyMatch[1]);
      if (Number.isNaN(hour) || hour < 0 || hour > 23) return null;
      if (/下午|晚上|傍晚/.test(text) && hour < 12) hour += 12;
      if (/中午/.test(text) && hour < 11) hour += 12;
      if (/凌晨/.test(text) && hour === 12) hour = 0;
      return hour;
    }

    const shichenMap = [
      ['子', 23],
      ['丑', 1],
      ['寅', 3],
      ['卯', 5],
      ['辰', 7],
      ['巳', 9],
      ['午', 11],
      ['未', 13],
      ['申', 15],
      ['酉', 17],
      ['戌', 19],
      ['亥', 21]
    ];

    for (const [label, hour] of shichenMap) {
      if (text.includes(`${label}时`)) {
        return hour;
      }
    }

    return null;
  };

  const getShichenLabel = (hour) => {
    if (hour === null || hour === undefined) return '';
    if (hour >= 23 || hour < 1) return '子时';
    if (hour < 3) return '丑时';
    if (hour < 5) return '寅时';
    if (hour < 7) return '卯时';
    if (hour < 9) return '辰时';
    if (hour < 11) return '巳时';
    if (hour < 13) return '午时';
    if (hour < 15) return '未时';
    if (hour < 17) return '申时';
    if (hour < 19) return '酉时';
    if (hour < 21) return '戌时';
    return '亥时';
  };

  const getChineseZodiac = (year) => {
    if (!Number.isInteger(year)) return '';
    const animals = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
    return animals[((year - 4) % 12 + 12) % 12];
  };

  const getSeasonLabel = (month) => {
    if (!Number.isInteger(month)) return '';
    if (month >= 3 && month <= 5) return '春';
    if (month >= 6 && month <= 8) return '夏';
    if (month >= 9 && month <= 11) return '秋';
    return '冬';
  };

  const buildFocusAdvice = (focus) => {
    const text = String(focus || '').trim();
    if (!text) {
      return [
        '优先把解读落到近期状态观察，而不是做命运定论。',
        '建议输出可执行的小行动，例如作息、复盘、沟通与节奏调整。'
      ];
    }

    if (/情绪|焦虑|压力|疲惫|状态/.test(text)) {
      return [
        '先做情绪安顿和节律梳理，再谈传统文化视角下的提醒。',
        '避免宿命化表述，重点落在本周可执行的恢复动作。'
      ];
    }

    if (/学业|保研|面试|升学|事业|工作/.test(text)) {
      return [
        '把解读落在阶段节奏、精力分配和准备顺序上。',
        '遇到重大选择时，明确提醒用户仍要以现实信息和机会成本为准。'
      ];
    }

    if (/感情|关系|相处/.test(text)) {
      return [
        '重点观察沟通节奏与边界感，不做结果预言。',
        '建议给出更稳妥的表达和自我照顾方式。'
      ];
    }

    return [
      '保持陪伴式、非决定式表达。',
      '先讲观察角度，再给轻量建议。'
    ];
  };

  const buildFollowupQuestions = (missingFields) => {
    const mapping = {
      calendarType: '你的生日是公历还是农历？如果不确定，也可以直接说“我不确定”。',
      birthDate: '你的出生日期是几几年几月几日？',
      birthTime: '你的出生时间或时辰是什么？如果只记得大概上午/下午，也可以先告诉我。',
      gender: '你的性别是？这只用于传统命理语境下的表述。',
      birthPlace: '你的出生地是哪里？城市级别即可。'
    };

    return missingFields
      .map((field) => mapping[field])
      .filter(Boolean)
      .slice(0, 5);
  };

  const buildBaziReading = (args = {}) => {
    const normalizedInput = {
      name: String(args.name || '').trim(),
      calendarType: normalizeCalendarType(args.calendarType),
      birthDate: normalizeBirthDate(args.birthDate),
      birthTime: String(args.birthTime || '').trim(),
      gender: String(args.gender || '').trim(),
      birthPlace: String(args.birthPlace || '').trim(),
      questionFocus: String(args.questionFocus || '').trim()
    };

    const missingFields = [];
    if (normalizedInput.calendarType === 'unknown') missingFields.push('calendarType');
    if (!normalizedInput.birthDate) missingFields.push('birthDate');
    if (!normalizedInput.birthTime) missingFields.push('birthTime');
    if (!normalizedInput.gender) missingFields.push('gender');
    if (!normalizedInput.birthPlace) missingFields.push('birthPlace');

    const birthDateMatch = normalizedInput.birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const birthYear = birthDateMatch ? Number(birthDateMatch[1]) : null;
    const birthMonth = birthDateMatch ? Number(birthDateMatch[2]) : null;
    const birthHour = extractHour(normalizedInput.birthTime);

    const status = missingFields.length > 0 ? 'needs_more_info' : 'ready';

    return {
      ok: true,
      data: {
        status,
        mode: 'traditional_culture_companion',
        disclaimer: BAZI_DISCLAIMER,
        normalizedInput,
        missingFields,
        followupQuestions: buildFollowupQuestions(missingFields),
        supportingSignals: {
          zodiac: birthYear ? getChineseZodiac(birthYear) : '',
          season: birthMonth ? getSeasonLabel(birthMonth) : '',
          shichen: birthHour === null ? '' : getShichenLabel(birthHour)
        },
        responseRules: [
          '仅在用户明确要求时继续本话题，不主动扩展到普通情绪支持场景。',
          '若信息未补全，优先向用户补齐资料，不提前下判断。',
          '即使信息齐全，也使用陪伴式、非决定式表达，避免“注定”“必然”等措辞。',
          '涉及升学、感情、健康、财务等现实选择时，必须提醒用户回到现实信息与专业建议。'
        ],
        focusAdvice: buildFocusAdvice(normalizedInput.questionFocus),
        summaryHints: status === 'ready'
          ? [
              '可结合出生季节、生肖意象、时辰节律和用户关注方向做轻量陪伴式解读。',
              '优先输出状态观察、风险提醒和可执行建议，不给绝对结论。'
            ]
          : [
              '当前信息不足，先补全资料后再进入传统文化陪伴式解读。'
            ]
      }
    };
  };

  const getAiTools = async (userId = null) => {
    const mcpTools = await getDynamicAiTools(userId);
    return [...baseAiTools, ...mcpTools];
  };

  const getFeishuUserBinding = async (userId) => prisma.user.findUnique({
    where: { id: userId },
    select: FEISHU_BINDING_SELECT
  });

  const ensureFeishuToken = async (userId) => {
    if (!userId) throw new Error('缺少用户身份');
    let user = await getFeishuUserBinding(userId);
    if (!user || !user.feishuOpenId) {
      throw new Error('当前账号未绑定飞书，请先完成授权');
    }
    
    if (isDateExpired(user.feishuAccessTokenExpiresAt, FEISHU_TOKEN_REFRESH_SKEW_MS)) {
      if (!user.feishuRefreshToken || isDateExpired(user.feishuRefreshTokenExpiresAt)) {
         throw new Error('飞书授权已过期，请重新发起授权绑定');
      }
      try {
         user = await refreshFeishuAccessTokenForUser(user);
      } catch (err) {
         throw new Error('飞书授权刷新失败，请重新发起授权绑定');
      }
    }
    return user.feishuAccessToken;
  };

  const runAiTool = async (name, args, userId) => {
    if (name === 'get_user_profile') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, major: true }
      });
      return { ok: true, data: user };
    }

    if (name === 'list_interviews') {
      const interviews = await prisma.interview.findMany({
        where: { userId },
        orderBy: { date: 'asc' }
      });
      return { ok: true, data: interviews };
    }

    if (name === 'create_interview') {
      const { school, major, date, city, type } = args || {};
      const parsedDate = new Date(date);
      if (!school || !major || !city || !type || Number.isNaN(parsedDate.getTime())) {
        return { ok: false, error: '参数不完整或日期格式错误' };
      }
      const created = await prisma.interview.create({
        data: { userId, school, major, city, type, date: parsedDate }
      });
      return { ok: true, data: created };
    }

    if (name === 'analyze_schedule_conflicts') {
      const interviews = await prisma.interview.findMany({
        where: { userId },
        orderBy: { date: 'asc' }
      });
      const grouped = interviews.reduce((acc, item) => {
        const key = toDayKey(item.date);
        if (!key) return acc;
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      }, {});
      const conflicts = Object.entries(grouped)
        .filter(([, items]) => items.length > 1)
        .map(([day, items]) => ({
          day,
          items: items.map((it) => ({
            id: it.id,
            school: it.school,
            major: it.major,
            city: it.city,
            type: it.type,
            date: it.date
          }))
        }));
      return { ok: true, data: { totalInterviews: interviews.length, conflicts } };
    }

    if (name === 'get_weather') {
      const { city, mode } = args || {};
      if (!city || typeof city !== 'string') {
        return { ok: false, error: 'city 参数缺失或格式错误' };
      }
      try {
        const weather = await getAmapWeather({ city, mode });
        return { ok: true, data: weather };
      } catch (error) {
        return { ok: false, error: error.message || '天气查询失败' };
      }
    }

    if (name === 'search_hotels') {
      const { city, keywords } = args || {};
      if (!city || !keywords) {
        return { ok: false, error: 'city 或 keywords 参数缺失' };
      }
      try {
        const hotels = await searchAmapPoi({ city, keywords });
        return { ok: true, data: hotels };
      } catch (error) {
        return { ok: false, error: error.message || '酒店查询失败' };
      }
    }

    if (name === 'web_search') {
      const { query } = args || {};
      if (!query) {
        return { ok: false, error: 'query 参数缺失' };
      }
      try {
        const searchResults = await searchTavily({ query });
        return { ok: true, data: searchResults };
      } catch (error) {
        return { ok: false, error: error.message || '联网搜索失败' };
      }
    }

    if (name === 'tencent_news_search') {
      const { query, limit } = args || {};
      if (!query || typeof query !== 'string') {
        return { ok: false, error: 'query 参数缺失或格式错误' };
      }
      try {
        const result = await executeTencentNewsCommand('search', [
          query.trim(),
          '--limit',
          String(clampTencentNewsLimit(limit))
        ]);
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: error.message || '腾讯新闻搜索失败' };
      }
    }

    if (name === 'tencent_news_hot') {
      const { limit } = args || {};
      try {
        const result = await executeTencentNewsCommand('hot', [
          '--limit',
          String(clampTencentNewsLimit(limit))
        ]);
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: error.message || '腾讯新闻热点获取失败' };
      }
    }

    if (name === 'tencent_news_briefing') {
      const period = String(args?.period || '').trim().toLowerCase();
      if (!['morning', 'evening'].includes(period)) {
        return { ok: false, error: 'period 参数必须为 morning 或 evening' };
      }
      try {
        const result = await executeTencentNewsCommand(period, []);
        return { ok: true, data: result };
      } catch (error) {
        return { ok: false, error: error.message || '腾讯新闻简报获取失败' };
      }
    }

    if (name === 'bazi_reading') {
      return buildBaziReading(args);
    }

    if (name === 'lark_auth_status') {
      if (!userId) {
        return { ok: false, error: '当前缺少用户身份，无法检查飞书绑定状态' };
      }

      const user = await getFeishuUserBinding(userId);
      if (!user) {
        return { ok: false, error: '用户不存在，无法检查飞书绑定状态' };
      }

      const status = buildFeishuBindingStatus(user, {
        message: isFeishuOAuthConfigured()
          ? (user.feishuOpenId
            ? '当前漫旅账号已绑定飞书账号'
            : '当前漫旅账号尚未绑定飞书账号')
          : '服务端尚未完成飞书 OAuth 配置'
      });
      return { ok: true, data: status };
    }

    if (name === 'lark_auth_login_start') {
      if (!userId) {
        return { ok: false, error: '当前缺少用户身份，无法生成飞书授权链接' };
      }
      if (!isFeishuOAuthConfigured()) {
        return {
          ok: false,
          error: '当前飞书 OAuth 尚未配置完成，请联系管理员检查服务端环境变量与回调地址配置'
        };
      }

      const user = await getFeishuUserBinding(userId);
      if (!user) {
        return { ok: false, error: '用户不存在，无法生成飞书授权链接' };
      }

      const redirectUri = normalizeOptionalUrl(args?.redirectUri) || normalizeOptionalUrl(FEISHU_OAUTH_SUCCESS_REDIRECT);
      const state = buildFeishuStateToken({
        userId,
        clientRedirectUri: redirectUri
      });

      return {
        ok: true,
        data: {
          provider: 'feishu_oauth',
          mobileSupported: true,
          alreadyConnected: Boolean(user.feishuOpenId),
          authorizeUrl: buildFeishuAuthorizeUrl({ state }),
          callbackUri: FEISHU_REDIRECT_URI,
          clientRedirectUri: redirectUri || null,
          expiresIn: FEISHU_STATE_TTL_SECONDS,
          scope: parseFeishuScopeList(FEISHU_OAUTH_SCOPES),
          prompt: FEISHU_OAUTH_PROMPT || null,
          message: '请直接打开 authorizeUrl 完成飞书授权，完成后返回漫旅即可。'
        }
      };
    }

    if (name === 'lark_docs_search') {
      const { query = '', pageSize = 10 } = args || {};
      try {
        const token = await ensureFeishuToken(userId);
        return larkApiRuntime.searchDocs(token, { query, pageSize });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    if (name === 'lark_docs_fetch') {
      const { doc, apiVersion = 'v2', limit, offset } = args || {};
      try {
        const token = await ensureFeishuToken(userId);
        return larkApiRuntime.fetchDoc(token, { doc, apiVersion, limit, offset });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    if (name === 'lark_docs_create') {
      const {
        content,
        docFormat = 'xml',
        apiVersion = 'v2',
        parentToken,
        parentPosition
      } = args || {};
      try {
        const token = await ensureFeishuToken(userId);
        return larkApiRuntime.createDoc(token, {
          content,
          docFormat,
          apiVersion,
          parentToken,
          parentPosition
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    if (name === 'lark_docs_update') {
      const {
        doc,
        command,
        content,
        docFormat = 'xml',
        apiVersion = 'v2',
        pattern,
        blockId,
        srcBlockIds,
        revisionId
      } = args || {};
      try {
        const token = await ensureFeishuToken(userId);
        return larkApiRuntime.updateDoc(token, {
          doc,
          command,
          content,
          docFormat,
          apiVersion,
          pattern,
          blockId,
          srcBlockIds,
          revisionId
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    if (name === 'lark_calendar_agenda') {
      const {
        start,
        end,
        calendarId = 'primary',
        format = 'json'
      } = args || {};
      try {
        const token = await ensureFeishuToken(userId);
        return larkApiRuntime.getCalendarAgenda(token, {
          start,
          end,
          calendarId,
          format
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    if (name === 'lark_calendar_create') {
      const {
        summary,
        start,
        end,
        description,
        attendeeIds,
        calendarId = 'primary',
        rrule,
        dryRun = false
      } = args || {};
      try {
        const token = await ensureFeishuToken(userId);
        return larkApiRuntime.createCalendarEvent(token, {
          summary,
          start,
          end,
          description,
          attendeeIds,
          calendarId,
          rrule,
          dryRun
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    if (name === 'lark_drive_list_files') {
      const {
        folderToken = '',
        orderBy = 'EditedTime',
        direction = 'DESC',
        pageSize = 20,
        pageAll = false,
        pageLimit = 3
      } = args || {};
      try {
        const token = await ensureFeishuToken(userId);
        return larkApiRuntime.listDriveFiles(token, {
          folderToken,
          orderBy,
          direction,
          pageSize,
          pageAll,
          pageLimit
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    const mcpResult = await runMcpTool(name, args, userId);
    if (mcpResult) {
      return mcpResult;
    }

    return { ok: false, error: `不支持的工具: ${name}` };
  };

  return {
    getAiTools,
    runAiTool
  };
};

module.exports = {
  createToolRuntime
};
