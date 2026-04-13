const express = require('express');
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
const AI_SYSTEM_PROMPT = process.env.AI_SYSTEM_PROMPT || '你是 ManLv AI 助手，帮助用户完成面试行程管理、冲突分析和准备建议，并在需要时调用可用工具。';

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

    const conversation = [
      { role: 'system', content: AI_SYSTEM_PROMPT },
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
              if (text) send({ type: 'text', content: text });
            } catch (e) {
              // 忽略解析失败的行
            }
          }
        }

        send({ type: 'done', usedTools: allUsedTools });
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

