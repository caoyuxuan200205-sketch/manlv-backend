const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const AI_BASE_URL = (process.env.AI_BASE_URL || '').replace(/\/+$/, '');
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || '';
const AI_MAX_STEPS = Number(process.env.AI_MAX_STEPS || 6);
const AI_SYSTEM_PROMPT = process.env.AI_SYSTEM_PROMPT || '你是漫旅 AI 助手。你的目标是帮助用户完成保研行程管理、冲突分析、面试准备，并在需要时调用可用工具。请先思考，再给出简洁、可执行的建议。';

// Middleware
app.use(cors());
app.use(express.json());

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
];

const toDayKey = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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
    
    // 生成 JWT Token
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
        conversation.pop(); // 移除刚才加的 assistant 消息，重新流式获取
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
