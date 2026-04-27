const createToolRuntime = ({
  prisma,
  amapApiKey,
  tavilyApiKey,
  getDynamicAiTools,
  runMcpTool,
  larkCliRuntime
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
        name: 'lark_auth_status',
        description: '检查飞书官方 lark-cli 当前登录状态、token 状态和已授权 scope',
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
        description: '启动飞书官方 lark-cli 登录流程，返回用户需要打开的授权信息。适用于 token 过期或未登录时。',
        parameters: {
          type: 'object',
          properties: {
            recommend: { type: 'boolean', description: '是否使用官方推荐 scopes' },
            domains: {
              type: 'array',
              items: { type: 'string' },
              description: '需要授权的业务域，例如 docs,drive'
            }
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

  const getAiTools = async (userId = null) => {
    const mcpTools = await getDynamicAiTools(userId);
    return [...baseAiTools, ...mcpTools];
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

    if (name === 'lark_auth_status') {
      return larkCliRuntime.getAuthStatus();
    }

    if (name === 'lark_auth_login_start') {
      const { recommend = true, domains = ['docs', 'drive'] } = args || {};
      return larkCliRuntime.startAuthLogin({ recommend, domains });
    }

    if (name === 'lark_docs_search') {
      const { query = '', pageSize = 10 } = args || {};
      return larkCliRuntime.searchDocs({ query, pageSize });
    }

    if (name === 'lark_docs_fetch') {
      const { doc, apiVersion = 'v2', limit, offset } = args || {};
      return larkCliRuntime.fetchDoc({ doc, apiVersion, limit, offset });
    }

    if (name === 'lark_docs_create') {
      const {
        content,
        docFormat = 'xml',
        apiVersion = 'v2',
        parentToken,
        parentPosition
      } = args || {};
      return larkCliRuntime.createDoc({
        content,
        docFormat,
        apiVersion,
        parentToken,
        parentPosition
      });
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
      return larkCliRuntime.updateDoc({
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
    }

    if (name === 'lark_calendar_agenda') {
      const {
        start,
        end,
        calendarId = 'primary',
        format = 'json'
      } = args || {};
      return larkCliRuntime.getCalendarAgenda({
        start,
        end,
        calendarId,
        format
      });
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
      return larkCliRuntime.createCalendarEvent({
        summary,
        start,
        end,
        description,
        attendeeIds,
        calendarId,
        rrule,
        dryRun
      });
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
      return larkCliRuntime.listDriveFiles({
        folderToken,
        orderBy,
        direction,
        pageSize,
        pageAll,
        pageLimit
      });
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
