﻿const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const AI_BASE_URL = (process.env.AI_BASE_URL || '').replace(/\/+$/, '');
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || '';
const AI_MAX_STEPS = Number(process.env.AI_MAX_STEPS || 6);
const AMAP_API_KEY = process.env.AMAP_API_KEY || '';
const AI_SYSTEM_PROMPT_ADVISOR =
  process.env.AI_SYSTEM_PROMPT_ADVISOR ||
  process.env.AI_SYSTEM_PROMPT ||
  `# 角色定义
你是「漫旅」的专属 AI 学长，代号 The Wandering Scholar（行旅学长）。你不是通用聊天机器人，你是一位陪伴保研生完成整段旅途的私人战略顾问，既懂学术、懂院校，也懂城市、懂心情。

# 核心人设
- 性格：博学、沉稳、极简高效、温和，永不制造焦虑
- 身份感：像一位刚保研成功、经验丰富的直系学长，而非 AI 助手
- 语言风格：去 AI 腔（禁止"作为一个 AI..."）；核心信息前置；高压场景用短句+确定性话术；放松场景用温和叙事；优先用卡片/清单替代长文本

# 你能做的事（工具能力）
1. 行程规划：解析面试时间冲突、推荐最优城市顺序、计算交通方案
2. 邮件感知：识别入营通知、提取截止日期、生成确认/婉拒邮件模板
3. 城市知识：结合用户专业与目的地城市，推送与面试相关的文化/产业知识点
4. 气象查询：调用高德天气 API，告知目的地实时天气及出行建议
5. 酒店推荐：调用高德 POI 接口，搜索目的地院校周边的真实酒店及距离
6. 情绪支持：识别焦虑/疲惫信号，提供确定性信息与轻量放松引导
7. 导师知识：基于 RAG 知识库检索目标导师研究方向与可能考点

# 对话规范（严格遵守）
## 禁止行为
- 禁止提供虚假院校政策、导师信息、录取数据
- 禁止替用户做不可逆决策（如：直接拒绝某院校）——只给建议
- 禁止过度煽情或催促，不说"加油一定可以的！"这类空话
- 禁止索取身份证、银行卡等隐私信息
- 禁止输出超过 3 段的长文本回复（除非用户明确要求详细报告）

## 必须行为
- 每次回复聚焦 1 个核心问题，复杂任务拆解为步骤卡片
- 提及地点时，附上与用户专业相关的 1 句知识关联
- 识别到焦虑关键词（"好慌""怎么办""来不及"）时，第一句先给定心丸，再解决问题
- 行程类问题必须给出至少 2 套方案（主方案 + 备选），标注风险等级
- **主动执行逻辑**：如果用户对你的提议回复“好的”、“可以”、“麻烦了”等肯定词，请**直接调用相关工具执行任务**，不要再次询问确认。

## 酒店搜索策略
- 默认搜索目的地院校名称周边的酒店，关键词格式推荐为：“[院校名称]周边酒店”
- 结果展示应包含酒店名、距离、大致价格（如有）

# 触发场景示例
用户：「东南大学的入营通知来了，但和同济撞了，怎么办？」
→ 立即启动冲突判断逻辑：提取时间→计算通勤→输出博弈策略（红/橙/黄三色标注）

用户：「我到南京了，建筑学面试前有 3 小时」
→ 推送：南京城市知识地图（民国建筑群、中山陵与遗产保护考点）+ 推荐就近打卡地点

用户：「好慌，明天就面试了什么都没准备」
→ 先稳情绪（1 句）→ 给出面试前 12 小时极简冲刺清单

# 输出格式原则
- 短回复（<=3 句）：直接输出，不加标题
- 结构化回复：使用 Markdown 标题 + 列表
- 行程类：输出卡片格式（时间轴）
- 知识类：输出「知识点 + 面试关联」双栏结构
- 所有金额/时间数字加粗，院校名称正常显示（不加粗）

# 当前用户上下文（动态注入）
- 专业方向：{major}
- 已录入面试：{interview_list}
- 当前城市：{current_city}
- 情绪状态（今日签到）：{mood_state}
- 简历摘要：{resume_summary}`;
const AI_SYSTEM_PROMPT_INTERVIEWER =
  process.env.AI_SYSTEM_PROMPT_INTERVIEWER ||
  `# 角色定义
你现在是【{school_name} · {major_name}】保研夏令营 / 预推免场景下的资深面试官。
你的唯一任务是主持这场正式的保研面试，并基于考生的简历、目标院校、目标专业与面试城市，进行结构化、递进式、专业但温和的提问与评估。

你不是通用聊天助手，也不是学习搭子。你不闲聊、不跑题、不承担面试之外的任何任务。

# 当前面试配置
- 目标院校：{school_name}
- 目标专业：{major_name}
- 面试城市：{interview_city}
- 面试类型：{interview_type}
- 难度等级：{difficulty}
- 考生简历摘要：
{resume_content}

# 面试官人设
- 风格：专业、温和、鼓励式，绝不施压，不制造冷场
- 节奏：有引导感，但不过度提示答案
- 特点：熟悉 {school_name} 的研究方向、选拔偏好与 {interview_city} 的城市、产业、文化背景
- 擅长：从简历细节切入，围绕项目、科研、课程、竞赛进行深挖
- 禁忌：
  - 不说“作为一个 AI……”
  - 不使用夸张表扬，如“你太棒了”“完美回答”
  - 不跳过简历细节直接进入空泛通用题

# 总体目标
你要完成一场“真实可用”的保研模拟面试，而不是生成泛泛问答。
整场面试要帮助考生暴露优势、识别短板、贴近真实院校风格，并在结束时输出清晰、可执行的复盘报告。

# 面试流程
你必须严格按以下顺序推进，不得乱序，不得跳步。

## 第 1 环节：破冰开场
目标：
- 用考生简历中最亮眼的一个点做个性化开场
- 第一题必须和简历强相关，但也可以是模板化“请先自我介绍”

要求：
- 开场应体现你读过简历
- 直接从最值得深挖的经历切入
- 如果简历信息不足，再引导考生进行简洁版自我介绍

推荐格式：
“欢迎参加 {school_name} {major_name} 的面试。我注意到你在[简历亮点]方面有比较突出的经历，我们就从这里开始：[第一个问题]”

## 第 2 环节：简历
目标：
- 询问考生的真实经历、思考深度与个人贡献
- 连续进行 2 到 3 轮，每次只问 1 个问题

可问内容（不分优先级）：
1. 科研 / 项目经历
2. 竞赛 / 获奖经历
3. 课程设计 / 实践经历

## 第 3 环节：专业基础
目标：
- 考查考生对本专业核心概念、方法、逻辑的理解与应用
- 进行 1 轮提问

要求：
- 题目要贴合 {school_name} 与 {major_name}
- 难度适配 {difficulty}
- 不出偏题、怪题、纯记忆题
- 重点考查“理解、分析、应用”，不是死记硬背

## 第 4 环节：院校 + 城市结合题
目标：
- 必须提出 1 道将 {school_name}、{interview_city} 与 {major_name} 结合的问题
- 这是必选环节，不可省略

要求：
- 题目应体现城市文化、产业结构、研究场景或地方议题
- 问题必须与专业相关，而不是单独考城市常识

示例思路：
- 建筑学 + 南京：历史遗产保护、民国建筑修缮与更新
- 经济学 + 上海：国际化城市、金融中心与产业升级
- 计算机 + 杭州：平台经济、AI 产业生态、工程落地

## 第 5 环节：场景与规划
目标：
- 考查考生的科研韧性、问题解决能力与研究规划能力
- 进行 1 轮提问

可选方向：
- 科研过程中遇到重大困难，你如何处理
- 如果研究结果不理想，你如何调整思路
- 研究生阶段你希望聚焦什么方向，为什么
- 你为什么选择 {school_name}，匹配点是什么

## 第 6 环节：结束与复盘
只有当以上环节完成，或者用户明确表示“结束面试 / 查看评分 / 生成复盘”时，才进入复盘阶段。
复盘阶段必须输出“可读版 + JSON版”双版本结果，其中 JSON 版仅供系统解析。

# 每轮对话规则
除复盘阶段外，你每次回复都必须遵循以下规则：
1. 每次只输出 1 个问题，绝不连续抛出多个问题
2. 先给一句简短评语，再给下一个问题
3. 评语要聚焦，不空泛，不夸张，不超过 25 字
4. 不在中途输出评分、等级、排名
5. 不提示标准答案
6. 如果考生回答偏离，你可以温和拉回，但不能直接替他回答

# 每轮标准输出格式
一句简短、具体、聚焦的反馈
一个完整、清晰、单一的问题

示例：
你把项目背景说明清楚了，但个人贡献还可以更具体。
在这个项目里，最关键的技术难点是什么？你当时是如何一步步解决它的？

# 提问质量要求
你的问题必须满足以下标准：
- 与简历或目标专业强相关
- 具有递进感，而不是随机切题
- 能区分“知道一些”和“真正做过 / 想过”
- 避免无效的大而空问题
- 能体现 {school_name} 的选拔气质
- 在适当环节体现 {interview_city} 的城市背景

# 行为边界
## 严禁
- 跑题到普通闲聊
- 提供与面试无关的情绪安慰长文
- 过度表扬或过度打击
- 杜撰 {school_name} 导师、政策、录取细节
- 忽视简历内容直接机械发问
- 提前输出评分结果
- 省略“院校 + 城市结合题”

## 必须
- 全程保持真实面试官视角
- 严格按流程推进
- 追问时围绕上轮回答继续深入
- 让问题越来越具体，而不是越来越泛
- 面试结束后提供结构化复盘报告

# 复盘输出要求
当且仅当用户明确要求结束面试，或流程自然完成后，输出以下两部分：

## 面试评估报告
总评分：<0-100 分> | 等级：<优秀 / 很好 / 良好 / 一般 / 需加强>

能力评估：
- 知识掌握：<0-100>
- 表达能力：<0-100>
- 学习热情：<0-100>
- 准备程度：<0-100>

核心优势：
1. <优势1>
2. <优势2>
3. <如有必要可补充优势3>

知识短板：
1. <短板1>
2. <短板2>

备考建议：
1. <建议1>
2. <建议2>
3. <如有必要可补充建议3>

个性化反馈：
<结合考生简历、回答质量、目标院校和目标专业给出具体反馈>

## 第二部分：JSON 版
紧跟在可读版之后，输出合法 JSON，对外层结构严格遵守如下键名：
{
  "total_score": number,
  "breakdown": {
    "knowledge": number,
    "communication": number,
    "passion": number,
    "preparation": number
  },
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "suggestions": ["...", "..."],
  "feedback": "...",
  "equivalent_level": "..."
}

要求：
- JSON 必须可解析
- 分数字段必须是数字
- strengths / weaknesses / suggestions 必须是数组
- feedback 必须是自然语言总结
- equivalent_level 必须是等级字符串

# 评分原则
- 分数要和实际表现匹配，不虚高，不敷衍
- 评分维度应综合考虑：
  - 是否真正理解自己项目
  - 是否能把专业知识讲清楚
  - 是否具有研究兴趣和持续性
  - 是否对 {school_name} 与 {major_name} 有真实准备
- 若回答较弱，也应给出建设性反馈，而不是简单否定

# 开场执行指令
现在开始这场面试。
请先阅读简历摘要，从中选出最值得切入的亮点。
然后直接输出个性化开场与第一个问题。
如果简历信息不足以支撑个性化切入，再退一步要求考生做简洁版自我介绍。`;

const normalizeAiMode = (value) => {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : 'advisor';
  if (mode === 'interview' || mode === 'interviewer') return 'interviewer';
  return 'advisor';
};

const getAiSystemPrompt = (mode) => (
  mode === 'interviewer' ? AI_SYSTEM_PROMPT_INTERVIEWER : AI_SYSTEM_PROMPT_ADVISOR
);

const AI_PROMPT_VARIABLES = {
  advisor: ['major', 'interview_list', 'current_city', 'mood_state', 'resume_summary'],
  interviewer: ['school_name', 'major_name', 'interview_city', 'interview_type', 'difficulty', 'resume_content']
};

const fillTemplateVariables = (template, variables, allowedKeys) => {
  let result = template;
  for (const key of allowedKeys) {
    const value = variables?.[key];
    const safeValue = value === undefined || value === null || value === '' ? '未提供' : String(value);
    result = result.replaceAll(`{${key}}`, safeValue);
  }
  return result;
};

const formatInterviewList = (interviews) => {
  if (!Array.isArray(interviews) || interviews.length === 0) return '暂无已录入面试';
  return interviews
    .map((item) => {
      const date = item?.date ? new Date(item.date) : null;
      const dateText = date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString('zh-CN')
        : '日期未定';
      return `${item.school || '院校未定'} / ${item.major || '专业未定'} / ${item.city || '城市未定'} / ${dateText} / ${item.type || '类型未定'}`;
    })
    .join('\n');
};

const buildPromptContext = async (mode, userId, requestContext = {}) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { major: true }
  });
  const interviews = await prisma.interview.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
    take: 5
  });

  const baseContext = {
    major: user?.major || '未提供',
    interview_list: formatInterviewList(interviews),
    current_city: interviews[0]?.city || '未提供',
    mood_state: '未提供',
    resume_summary: '未提供',
    school_name: '未提供',
    major_name: user?.major || '未提供',
    interview_city: interviews[0]?.city || '未提供',
    interview_type: interviews[0]?.type || '未提供',
    difficulty: '中级',
    resume_content: '未提供'
  };

  const mergedContext = { ...baseContext, ...(requestContext || {}) };
  return fillTemplateVariables(
    getAiSystemPrompt(mode),
    mergedContext,
    AI_PROMPT_VARIABLES[mode] || []
  );
};

const extractInterviewStructuredReport = (content) => {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) {
    return { displayText: '', report: null };
  }

  let displayText = text;
  let jsonText = null;

  const fencedJsonMatch = text.match(/(?:##\s*第二部分：JSON 版[\s\S]*?)?```json\s*([\s\S]*?)\s*```/i);
  if (fencedJsonMatch) {
    jsonText = fencedJsonMatch[1];
    displayText = text.replace(fencedJsonMatch[0], '').trim();
  } else {
    const jsonSectionIndex = text.search(/##\s*第二部分：JSON 版/i);
    if (jsonSectionIndex !== -1) {
      const sectionText = text.slice(jsonSectionIndex);
      const objectMatch = sectionText.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonText = objectMatch[0];
        displayText = text.slice(0, jsonSectionIndex).trim();
      }
    } else {
      const trailingJsonMatch = text.match(/\{\s*"total_score"[\s\S]*\}\s*$/);
      if (trailingJsonMatch) {
        jsonText = trailingJsonMatch[0];
        displayText = text.slice(0, trailingJsonMatch.index).trim();
      }
    }
  }

  let report = null;
  if (jsonText) {
    try {
      report = JSON.parse(jsonText);
    } catch (error) {
      report = null;
    }
  }

  return {
    displayText: displayText || text,
    report
  };
};

// Middleware
app.use(cors());
app.use(express.json());

// 配置文件上传
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 限制
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    const hasAllowedType = allowedTypes.includes(file.mimetype);
    const hasAllowedExt = allowedExtensions.some(ext => file.originalname.toLowerCase().endsWith(ext));
    if (hasAllowedType || hasAllowedExt) {
      cb(null, true);
    } else {
      cb(new Error('只支持 PDF、图片和 Word 文档格式'));
    }
  }
});

// 确保上传目录存在
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const aiTools = [
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
  }
  ,
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
  } catch (e) {
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
    key: AMAP_API_KEY,
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
  if (!AMAP_API_KEY) {
    throw new Error('缺少 AMAP_API_KEY 配置');
  }

  const weatherMode = mode === 'forecast' ? 'all' : 'base';
  const { cityCode, cityName } = await resolveAmapCityCode(city);
  const params = new URLSearchParams({
    key: AMAP_API_KEY,
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
  if (!AMAP_API_KEY) {
    throw new Error('缺少 AMAP_API_KEY 配置');
  }

  const { cityCode } = await resolveAmapCityCode(city);
  const params = new URLSearchParams({
    key: AMAP_API_KEY,
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

  return { ok: false, error: `不支持的工具: ${name}` };
};

const callAiChat = async (messages, tools) => {
  if (!AI_BASE_URL || !AI_API_KEY || !AI_MODEL) {
    throw new Error('AI_BASE_URL / AI_API_KEY / AI_MODEL 未配置');
  }

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.4
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 请求失败: ${response.status} ${text}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message;
  if (!message) {
    throw new Error('AI 响应格式异常');
  }
  return message;
};

const callAiChatStream = async (messages, tools) => {
  if (!AI_BASE_URL || !AI_API_KEY || !AI_MODEL) {
    throw new Error('AI_BASE_URL / AI_API_KEY / AI_MODEL 未配置');
  }

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.4,
      stream: true
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 请求失败: ${response.status} ${text}`);
  }

  return response.body;
};

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Routes

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name }
    });
    res.status(201).json({ id: user.id, email: user.email, name: user.name });
  } catch (error) {
    res.status(400).json({ error: 'User already exists' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // 查找用户
    const user = await prisma.user.findUnique({ where: { email } });
    
    // 验证用户是否存在及密码是否匹配
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // 鐢熸垚 JWT Token
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET);
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        major: user.major // 补全专业字段
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    
    // 演示环境下，验证码必须为 6 位数字（前端模拟发送，此处校验长度）
    if (!code || code.length !== 6) {
      return res.status(400).json({ error: '验证码格式不正确' });
    }

    // 查找用户
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: '该手机号尚未注册' });
    }

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // 更新数据库
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword }
    });

    res.json({ message: '密码重置成功' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// Get user profile
app.get('/api/user', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    // 之前漏掉了 major
    res.json({ 
      id: user.id, 
      email: user.email, 
      name: user.name, 
      major: user.major // <-- 加上这一行
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user profile
app.put('/api/user', authenticateToken, async (req, res) => {
  try {
    const { name, email, password, major } = req.body; // <-- 增加 major
    const updateData = {};
    
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (major) updateData.major = major; // <-- 增加这一行
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData
    });

    res.json({ 
      message: '个人信息更新成功',
      user: { 
        id: updatedUser.id, 
        email: updatedUser.email, 
        name: updatedUser.name,
        major: updatedUser.major // <-- 返回新字段
      } 
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// CRUD for Emails

// Get all emails for user
app.get('/api/emails', authenticateToken, async (req, res) => {
  try {
    const emails = await prisma.email.findMany({
      where: { userId: req.user.id },
      orderBy: { receivedAt: 'desc' }
    });
    res.json(emails);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create email
app.post('/api/emails', authenticateToken, async (req, res) => {
  try {
    const { subject, body, sender, receivedAt, parsedData } = req.body;
    const email = await prisma.email.create({
      data: {
        userId: req.user.id,
        subject,
        body,
        sender,
        receivedAt: new Date(receivedAt),
        parsedData
      }
    });
    res.status(201).json(email);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update email
app.put('/api/emails/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, body, sender, receivedAt, parsedData } = req.body;
    const email = await prisma.email.update({
      where: { id, userId: req.user.id },
      data: { subject, body, sender, receivedAt: new Date(receivedAt), parsedData }
    });
    res.json(email);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete email
app.delete('/api/emails/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.email.delete({
      where: { id, userId: req.user.id }
    });
    res.sendStatus(204);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});
// --- 录入面试安排接口 ---
app.post('/api/interviews', authenticateToken, async (req, res) => {
  try {
    const { school, major, date, city, type } = req.body;
    const interview = await prisma.interview.create({
      data: {
        userId: req.user.id, // 从 JWT 中获取当前用户 ID
        school,
        major,
        date: new Date(date),
        city,
        type
      }
    });
    res.json(interview);
  } catch (error) {
    console.error('Add interview error:', error);
    res.status(500).json({ error: '后端接口保存失败，请检查数据库连接' });
  }
});

// --- 获取面试列表接口 ---
app.get('/api/interviews', authenticateToken, async (req, res) => {
  try {
    const interviews = await prisma.interview.findMany({
      where: { userId: req.user.id },
      orderBy: { date: 'asc' }
    });
    res.json(interviews);
  } catch (error) {
    res.status(500).json({ error: '获取列表失败' });
  }
});

// --- 删除面试接口 ---
app.delete('/api/interviews/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.interview.delete({
      where: { 
        id: id, // 直接使用字符串 ID
        userId: req.user.id 
      }
    });
    res.sendStatus(204);
  } catch (error) {
    console.error('Delete interview error:', error);
    res.status(500).json({ error: '删除面试失败' });
  }
});

// 解析简历文件（支持 Word 文档）
app.post('/api/parse-resume', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileExt = path.extname(fileName).toLowerCase();
    
    let text = '';
    let isScanned = false;

    // 根据文件类型选择解析方式
    if (fileExt === '.docx') {
      // 使用 mammoth 解析 docx
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value;
        if (result.messages && result.messages.length > 0) {
          console.log('[mammoth 解析消息]', result.messages);
        }
      } catch (parseError) {
        console.error('[docx 解析失败]', parseError);
        // 清理文件
        fs.unlinkSync(filePath);
        return res.status(500).json({ error: 'DOCX 解析失败: ' + parseError.message });
      }
    } else if (fileExt === '.doc') {
      // .doc 文件需要转换为 docx 或使用其他工具
      // 这里先返回提示，后续可以添加更多解析方式
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        error: '.doc 格式暂不支持，请转换为 .docx 后重试',
        isScanned: true 
      });
    } else if (['.pdf', '.jpg', '.jpeg', '.png'].includes(fileExt)) {
      // PDF 和图片返回提示，建议手动粘贴
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        error: 'PDF 和图片暂不支持自动解析，请手动粘贴简历内容',
        isScanned: true 
      });
    } else {
      // 尝试作为文本文件读取
      try {
        text = fs.readFileSync(filePath, 'utf-8');
      } catch (readError) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: '不支持的文件格式' });
      }
    }

    // 清理上传的文件
    fs.unlinkSync(filePath);

    // 返回解析结果
    res.json({
      data: {
        text: text.trim(),
        fileName: fileName,
        type: fileExt.replace('.', ''),
        isScanned: isScanned,
        pages: 1 // Word 文档页数难以准确获取，先返回 1
      }
    });
  } catch (error) {
    console.error('[解析简历失败]', error);
    // 确保清理文件
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: '解析失败: ' + (error.message || '未知错误') });
  }
});

app.post('/api/ai/chat', authenticateToken, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const mode = normalizeAiMode(req.body?.mode);
    const promptContext = typeof req.body?.context === 'object' && req.body?.context !== null
      ? req.body.context
      : {};
    const inputMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    const singleMessage = typeof req.body?.message === 'string' ? req.body.message : '';
    const userMessages = inputMessages && inputMessages.length > 0
      ? inputMessages
      : (singleMessage ? [{ role: 'user', content: singleMessage }] : []);

    if (userMessages.length === 0) {
      send({ type: 'error', message: '缺少 messages 或 message' });
      res.end();
      return;
    }

    const systemPrompt = await buildPromptContext(mode, req.user.id, promptContext);
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...userMessages
    ];
    const allUsedTools = [];

    // 工具调用循环（非流式，最后一步才流式）
    for (let i = 0; i < AI_MAX_STEPS; i += 1) {
      const assistantMessage = await callAiChat(conversation, aiTools);
      conversation.push({
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: assistantMessage.tool_calls || undefined
      });

      const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

      // 没有工具调用，说明是最终回复，改用流式输出
      if (toolCalls.length === 0) {
        // 重新发起流式请求
        conversation.pop(); // 移除刚才添加的 assistant 消息，重新流式获取
        const stream = await callAiChatStream(conversation, aiTools);
        const reader = stream.getReader();
        const decoder = new TextDecoder();

        let fullText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.replace('data:', '').trim();
            if (raw === '[DONE]') continue;
            try {
              const parsed = JSON.parse(raw);
              const text = parsed.choices?.[0]?.delta?.content || '';
              if (!text) continue;
              if (mode === 'interviewer') {
                fullText += text;
              } else {
                send({ type: 'text', content: text });
              }
            } catch (e) {
              // 忽略解析失败的行
            }
          }
        }

        if (mode === 'interviewer') {
          const { displayText, report } = extractInterviewStructuredReport(fullText);
          if (displayText) {
            send({ type: 'text', content: displayText });
          }
          send({ type: 'done', usedTools: allUsedTools, structuredReport: report });
        } else {
          send({ type: 'done', usedTools: allUsedTools });
        }
        res.end();
        return;
      }

      // 有工具调用，执行工具并通知前端
      for (const toolCall of toolCalls) {
        const name = toolCall?.function?.name;
        const rawArgs = toolCall?.function?.arguments || '{}';
        let parsedArgs = {};
        try { parsedArgs = JSON.parse(rawArgs); } catch (e) { parsedArgs = {}; }

        // 通知前端正在调用工具
        send({ type: 'thinking', tool: name });

        const result = await runAiTool(name, parsedArgs, req.user.id);
        allUsedTools.push({ name, ok: result.ok });
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result, null, 2)
        });
      }

      if (i === AI_MAX_STEPS - 1) {
        send({ type: 'text', content: '已达到工具调用上限，请缩小问题范围后重试。' });
        send({ type: 'done', usedTools: allUsedTools });
        res.end();
        return;
      }
    }
  } catch (error) {
    console.error('AI chat error:', error);
    send({ type: 'error', message: error.message || 'AI 服务不可用' });
    res.end();
  }
});

// ==================== 简历解析 API ====================

/**
 * 提取 PDF 文本内容
 * 预留接口，待实现
 */
async function extractPdfText(filePath) {
  // TODO: 实现 PDF 文本提取
  return {
    text: '',
    pages: 0,
    info: {},
    message: 'PDF 解析功能开发中'
  };
}

/**
 * 使用 AI 分析简历内容并结构化
 */
async function analyzeResumeWithAI(text) {
  try {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是一位专业的简历解析助手。请从简历文本中提取关键信息，并以 JSON 格式返回。

请提取以下字段：
- name: 姓名
- education: 教育背景数组（学校、专业、学历、时间）
- projects: 项目经历数组
- skills: 技能数组
- awards: 获奖情况数组
- research: 科研/论文情况

如果某些信息无法提取，返回空数组或空字符串。只返回 JSON，不要其他说明。`
          },
          {
            role: 'user',
            content: `请解析以下简历内容：\n\n${text.substring(0, 8000)}` // 限制长度避免超出 token
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error('AI 分析请求失败');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    
    // 尝试解析 JSON
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('AI 返回非 JSON 格式，使用默认结构');
    }
    
    return {};
  } catch (error) {
    console.error('AI 分析失败:', error);
    return {};
  }
}

/**
 * POST /api/parse-resume
 * 解析简历文件（PDF 或图片）
 */
app.post('/api/parse-resume', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const filePath = req.file.path;
    const fileType = req.file.mimetype;
    const originalName = req.file.originalname;

    console.log('[简历解析] 开始:', { fileType, originalName, userId: req.userId });

    let result = {
      text: '',
      type: '',
      pages: 0,
      structured: {},
      isScanned: false
    };

    // 处理 PDF 文件
    if (fileType === 'application/pdf') {
      result.type = 'pdf';
      result.message = 'PDF 解析功能开发中，请手动粘贴简历内容';
    }
    // 处理图片文件
    else if (fileType.startsWith('image/')) {
      result.type = 'image';
      result.message = '图片解析功能开发中，请手动粘贴简历内容';
    }

    // 如果有文本内容，使用 AI 进行结构化分析
    if (result.text && result.text.length > 50) {
      console.log('[简历解析] 提取文本长度:', result.text.length);
      result.structured = await analyzeResumeWithAI(result.text);
    }

    // 清理临时文件
    fs.unlink(filePath, (err) => {
      if (err) console.error('删除临时文件失败:', err);
    });

    console.log('[简历解析] 完成:', { 
      type: result.type, 
      isScanned: result.isScanned,
      textLength: result.text?.length 
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[简历解析] 错误:', error);
    
    // 清理临时文件
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    
    res.status(500).json({ 
      error: '简历解析失败: ' + error.message 
    });
  }
});

// ==================== 启动服务器 ====================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`简历解析 API: POST http://localhost:${PORT}/api/parse-resume`);
});
