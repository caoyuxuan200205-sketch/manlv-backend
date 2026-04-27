<div align="center">

# 漫旅 ManLv · 后端服务

**The Wandering Scholar · Backend**

*AI Agent 驱动的保研行程管理后端服务*

[![Node.js](https://img.shields.io/badge/Node.js-Express-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?style=flat-square&logo=postgresql)](https://www.postgresql.org/)
[![AI](https://img.shields.io/badge/AI-Qwen%20%2F%20DashScope-FF6A00?style=flat-square)](https://dashscope.aliyuncs.com/)

[前端仓库](https://github.com/caoyuxuan200205-sketch/manlv-frontend) · [后端仓库](https://github.com/caoyuxuan200205-sketch/manlv-backend)

</div>

---

## 🎯 简介

漫旅后端基于 **Node.js + Express** 构建，提供用户认证、行程管理、邮件处理等 REST API，并内置 **AI Agent 循环**，通过 DashScope（兼容 OpenAI 格式）驱动 Qwen 大模型，支持工具调用与 SSE 流式输出。

---

## 🛠️ 技术栈

| 层次 | 技术方案 |
|------|----------|
| 运行时 | Node.js |
| Web 框架 | Express |
| ORM | Prisma |
| 数据库 | PostgreSQL |
| 认证 | JWT · bcryptjs |
| AI | Qwen-Plus / Qwen-Max（DashScope，兼容 OpenAI 格式）|
| 流式输出 | SSE（Server-Sent Events）|

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- PostgreSQL 数据库
- DashScope API Key（[申请地址](https://dashscope.aliyuncs.com)）

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/caoyuxuan200205-sketch/manlv-backend.git
cd manlv-backend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入配置（见下方说明）

# 初始化数据库
npx prisma migrate dev --name init

# 生成 Prisma 客户端
npx prisma generate

# 启动服务
node src/server.js
# 服务运行在 http://localhost:3001
```

### 环境变量配置（`.env`）

```env
# 数据库
DATABASE_URL="postgresql://用户名:密码@localhost:5432/manlv"

# JWT 密钥（自定义任意字符串）
JWT_SECRET=your_jwt_secret_here

# 服务端口
PORT=3001

# AI 配置（DashScope）
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_API_KEY=sk-xxxxxxxxxxxxxxxx
AI_MODEL=qwen-plus
AI_MAX_STEPS=6
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxx
MCP_SERVERS_JSON=[{"name":"filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","C:\\\\Users\\\\24203\\\\Desktop\\\\ManLv"]}]

# AI 系统提示词（可选，有默认值）
AI_SYSTEM_PROMPT=你是漫旅 AI 助手。你的目标是帮助用户完成保研行程管理、冲突分析、面试准备，并在需要时调用可用工具。请先思考，再给出简洁、可执行的建议。
```

`MCP_SERVERS_JSON` 为可选配置，用于挂载一个或多个 MCP Server。格式为 JSON 数组，每个元素支持以下字段：

```json
[
  {
    "name": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Users\\\\24203\\\\Desktop\\\\ManLv"],
    "cwd": "/optional/working/directory",
    "env": {
      "CUSTOM_ENV_VAR": "value"
    }
  }
]
```

---

## 📚 API 文档

### 认证相关

#### 用户注册
- **接口**: `POST /api/auth/register`
- **请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "用户名"
}
```
- **响应**: 用户信息（不含密码）

#### 用户登录
- **接口**: `POST /api/auth/login`
- **请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```
- **响应**:
```json
{
  "token": "jwt_token_here",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "用户名",
    "major": "专业"
  }
}
```

#### 重置密码
- **接口**: `POST /api/auth/reset-password`
- **请求体**:
```json
{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "newpassword123"
}
```

### 用户管理

#### 获取用户信息
- **接口**: `GET /api/user`
- **认证**: 需要 JWT Token
- **响应**: 用户详细信息

#### 更新用户信息
- **接口**: `PUT /api/user`
- **认证**: 需要 JWT Token
- **请求体**:
```json
{
  "name": "新用户名",
  "email": "newemail@example.com",
  "major": "新专业",
  "password": "新密码（可选）"
}
```

#### 获取用户记忆
- **接口**: `GET /api/user/memory`
- **认证**: 需要 JWT Token

#### 更新用户记忆
- **接口**: `PUT /api/user/memory`
- **认证**: 需要 JWT Token
- **请求体**:
```json
{
  "memorySummary": "记忆摘要",
  "memoryFacts": ["事实1", "事实2"]
}
```

### 邮件管理

#### 获取邮件列表
- **接口**: `GET /api/emails`
- **认证**: 需要 JWT Token
- **响应**: 用户的所有邮件

#### 创建邮件
- **接口**: `POST /api/emails`
- **认证**: 需要 JWT Token
- **请求体**:
```json
{
  "subject": "邮件主题",
  "body": "邮件内容",
  "sender": "发件人",
  "receivedAt": "2024-01-01T00:00:00Z",
  "parsedData": {}
}
```

#### 更新邮件
- **接口**: `PUT /api/emails/:id`
- **认证**: 需要 JWT Token

#### 删除邮件
- **接口**: `DELETE /api/emails/:id`
- **认证**: 需要 JWT Token

### 面试管理

#### 获取面试列表
- **接口**: `GET /api/interviews`
- **认证**: 需要 JWT Token
- **响应**: 用户的所有面试安排

#### 添加面试安排
- **接口**: `POST /api/interviews`
- **认证**: 需要 JWT Token
- **请求体**:
```json
{
  "school": "学校名称",
  "major": "专业",
  "date": "2024-01-01T00:00:00Z",
  "city": "城市",
  "type": "面试类型"
}
```

#### 删除面试
- **接口**: `DELETE /api/interviews/:id`
- **认证**: 需要 JWT Token

### AI 功能

#### AI 对话
- **接口**: `POST /api/ai/chat`
- **认证**: 需要 JWT Token
- **请求体**:
```json
{
  "messages": [
    {"role": "user", "content": "用户消息"}
  ],
  "mode": "advisor"
}
```
- **响应**: AI 回复（支持流式输出）

### 文件处理

#### 简历解析
- **接口**: `POST /api/parse-resume`
- **认证**: 需要 JWT Token
- **请求**: multipart/form-data，包含文件
- **支持格式**: PDF, Word (.docx), 图片
- **响应**: 解析后的文本和结构化数据

---

## 🚀 快速开始
  {
    "name": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\24203\\Desktop\\ManLv"],
    "cwd": "C:\\Users\\24203\\Desktop\\manlv-backend",
    "env": {
      "EXAMPLE_KEY": "example-value"
    }
  }
]
```

说明：
- `name`：MCP Server 的标识名，会用于生成工具前缀。
- `command` / `args`：启动 MCP Server 的命令。
- `cwd`：可选，MCP Server 的工作目录。
- `env`：可选，启动 MCP Server 时附加的环境变量。
- Windows 路径放进 JSON 时请使用双反斜杠，如 `C:\\Users\\...`。

**AI 模型选择参考：**

| 模型 | 支持 Function Calling | 速度 | 推荐场景 |
|------|----------------------|------|----------|
| `qwen-plus` | ✅ | 中 | 日常使用，推荐 |
| `qwen-max` | ✅ | 慢 | 复杂规划，效果更好 |
| `qwen-turbo` | ✅ | 快 | 简单问答，省额度 |

---

## 🔌 API 接口

所有需要认证的接口请在请求头中携带：
```
Authorization: Bearer <token>
```

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录，返回 JWT Token |
| POST | `/api/auth/reset-password` | 重置密码 |

### 用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/user` | 获取当前用户信息（需认证）|
| PUT | `/api/user` | 更新用户资料，支持 name / email / major / password（需认证）|

### 面试安排

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/interviews` | 获取面试列表，按日期升序（需认证）|
| POST | `/api/interviews` | 新增面试安排（需认证）|

### 邮件

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/emails` | 获取邮件列表（需认证）|
| POST | `/api/emails` | 新增邮件（需认证）|
| PUT | `/api/emails/:id` | 更新邮件（需认证）|
| DELETE | `/api/emails/:id` | 删除邮件（需认证）|

### AI 对话（核心）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/chat` | AI 对话，SSE 流式输出（需认证）|

---

## 🤖 AI Agent 架构

### 流式输出（SSE）

`POST /api/ai/chat` 返回 `Content-Type: text/event-stream`，客户端实时接收以下事件：

```json
{ "type": "thinking", "tool": "analyze_schedule_conflicts" }
{ "type": "text", "content": "根据你的面试安排..." }
{ "type": "done", "usedTools": [{ "name": "analyze_schedule_conflicts", "ok": true }] }
{ "type": "error", "message": "AI 服务不可用" }
```

### 请求格式

```json
{
  "message": "帮我分析7月20日的行程冲突",
  "messages": [
    { "role": "user", "content": "你好" },
    { "role": "assistant", "content": "你好！有什么可以帮你？" },
    { "role": "user", "content": "帮我分析7月20日的行程冲突" }
  ]
}
```

传入 `messages` 数组支持多轮对话；仅传 `message` 字符串则为单轮对话。

### 内置工具（Function Calling）

| 工具名 | 说明 |
|--------|------|
| `get_user_profile` | 获取当前用户基础资料 |
| `list_interviews` | 查询用户面试安排列表 |
| `create_interview` | 创建新的面试记录 |
| `analyze_schedule_conflicts` | 分析同日行程冲突 |
| `web_search` | 联网搜索最新保研资讯与动态 |

### MCP 扩展工具

后端现已支持通过 MCP 动态挂载外部工具：

- 启动时读取 `MCP_SERVERS_JSON`
- 通过 `stdio` 连接 MCP Server
- 自动发现该 Server 暴露的 tools

---

## 🚀 部署说明

### 开发环境部署

1. **安装依赖**
```bash
npm install
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入必要的配置
```

3. **数据库初始化**
```bash
# 初始化数据库
npx prisma migrate dev --name init

# 生成 Prisma 客户端
npx prisma generate
```

4. **启动服务**
```bash
# 开发模式
npm run dev

# 或生产模式
npm start
```

### 生产环境部署

1. **构建优化**
```bash
# 确保所有依赖正确安装
npm ci --production=false
```

2. **环境配置**
   - 设置生产数据库URL
   - 配置生产AI API密钥
   - 设置安全的JWT密钥

3. **使用进程管理器**
```bash
# 使用 PM2
npm install -g pm2
pm2 start src/server.js --name "manlv-backend"
```

4. **反向代理配置** (Nginx 示例)
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Docker 部署

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npx prisma generate

EXPOSE 3001

CMD ["node", "src/server.js"]
```

---

## 📝 更新日志

- **v1.0.0** (2024-04-27)
  - 初始版本发布
  - 支持用户认证、邮件管理、面试安排
  - 集成 AI 对话功能
  - 支持简历文件解析
  - MCP 工具扩展支持
- 将这些 tools 映射进现有的 AI Function Calling 流程

映射后的工具名会自动转换为类似 `mcp_filesystem_read_file` 的安全名称，供模型调用。

### Agent 工作流程

```
用户输入
  └→ 发送给 Qwen 模型
       ├→ 返回 tool_calls → 执行工具 → SSE 推送 thinking 事件 → 结果追加到对话 → 继续循环
       └→ 无 tool_calls  → 切换流式模式 → SSE 逐字推送 text 事件 → 推送 done 事件
```

最大工具调用轮次由 `AI_MAX_STEPS` 控制，默认 6 次。

---

## 📁 项目结构

```
manlv-backend/
├── src/
│   ├── server.js          # 主服务（所有路由 + AI Agent）
│   └── generated/         # Prisma 生成的客户端文件
├── prisma/
│   └── schema.prisma      # 数据库模型定义
├── .env                   # 环境变量（不提交 Git）
├── .env.example           # 环境变量模板
└── package.json
```

---

## 🗄️ 数据模型

```prisma
model User {
  id          String      @id @default(cuid())
  email       String      @unique
  password    String
  name        String?
  major       String?
  interviews  Interview[]
  emails      Email[]
}

model Interview {
  id      String   @id @default(cuid())
  userId  String
  school  String
  major   String
  date    DateTime
  city    String
  type    String
  user    User     @relation(fields: [userId], references: [id])
}

model Email {
  id          String   @id @default(cuid())
  userId      String
  subject     String
  body        String
  sender      String
  receivedAt  DateTime
  parsedData  Json?
  user        User     @relation(fields: [userId], references: [id])
}
```

---

## 🛣️ 后续规划

| 版本 | 计划功能 |
|------|----------|
| V1.x | 天气查询工具 · 多轮对话持久化 · 对话历史存储 |
| V2.0 | 邮箱 OAuth 授权 · NLP 邮件解析 · 票务酒店 API 接入 |
| V3.0 | 导师知识图谱 · 城市学习内容生成 · 情绪监测系统 |

---

## 📄 License

MIT © 2026 漫旅 ManLv
