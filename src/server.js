const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
