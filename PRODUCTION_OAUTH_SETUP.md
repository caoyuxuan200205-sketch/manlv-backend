# `www.manlvai.site` 生产环境配置

本文用于把当前飞书 OAuth 接入整理成可上线版本，目标是让用户在自己的手机上授权自己的飞书账号。

## 目标域名

- 前端站点：`https://www.manlvai.site`
- 飞书 OAuth 结果页：`https://www.manlvai.site/oauth/feishu/result`
- 后端回调接口：`https://www.manlvai.site/api/auth/feishu/callback`

## 前提条件

要使用同一个域名，必须满足下面这点：

- 浏览器访问 `https://www.manlvai.site/api/*` 时，最终能到达你的 Node/Express 后端

常见实现方式：

- Nginx 反向代理：`/` 指向前端静态资源，`/api` 转发到后端服务
- 平台网关转发：例如托管平台把 `/api` 代理到独立后端服务
- Vercel 外部重写：前端域名保留为 `www.manlvai.site`，再把 `/api/*` 反代到你的真实后端地址

如果 `www.manlvai.site` 只是纯静态站点、没有 `/api` 转发能力，那么飞书回调不会成功。

## 后端环境变量

生产环境建议至少配置以下变量：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/manlv_db?schema=public"
JWT_SECRET="replace_with_a_strong_random_secret"

PORT="3001"

AI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
AI_API_KEY="sk-xxxxxxxxxxxxxxxx"
AI_MODEL="qwen-plus"
AI_MAX_STEPS="6"

AMAP_API_KEY="your_amap_api_key"
TAVILY_API_KEY="tvly-xxxxxxxxxxxxxxxx"

FEISHU_CLIENT_ID="cli_xxxxxxxxxxxxxxxx"
FEISHU_CLIENT_SECRET="xxxxxxxxxxxxxxxx"
FEISHU_REDIRECT_URI="https://www.manlvai.site/api/auth/feishu/callback"
FEISHU_OAUTH_SCOPES="auth:user.id:read user_profile offline_access"
FEISHU_OAUTH_PROMPT="consent"
FEISHU_OAUTH_SUCCESS_REDIRECT="https://www.manlvai.site/oauth/feishu/result"
FEISHU_OAUTH_FAILURE_REDIRECT="https://www.manlvai.site/oauth/feishu/result"
FEISHU_ALLOWED_REDIRECT_ORIGINS="https://www.manlvai.site"
```

说明：

- `FEISHU_REDIRECT_URI` 必须配置到飞书开放平台回调地址白名单
- `FEISHU_OAUTH_SUCCESS_REDIRECT` 和 `FEISHU_OAUTH_FAILURE_REDIRECT` 都指向前端结果页
- `FEISHU_ALLOWED_REDIRECT_ORIGINS` 用于限制允许回跳的前端来源，生产环境建议只保留正式域名

## 前端环境变量

如果前后端同域部署，可直接使用：

```env
REACT_APP_API_BASE_URL="https://www.manlvai.site"
```

当前前端代码也支持在生产环境默认回退到当前站点同源地址，因此：

- 同域部署时，可以显式填 `https://www.manlvai.site`
- 也可以不填，让前端自动使用 `window.location.origin`

## 飞书开放平台配置

在飞书开放平台中，需要完成下面几项：

1. 打开你的应用
2. 找到 OAuth 或安全设置相关页面
3. 将回调地址加入白名单：

```text
https://www.manlvai.site/api/auth/feishu/callback
```

4. 确认应用使用的 `App ID` 与 `App Secret` 和后端环境变量一致
5. 确认 scope 至少包含：

```text
auth:user.id:read user_profile offline_access
```

## Nginx 同域部署示例

```nginx
server {
    listen 443 ssl http2;
    server_name www.manlvai.site;

    root /var/www/manlv-frontend/build;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 如果前端在 Vercel、后端在其他平台

如果 `www.manlvai.site` 绑定在 Vercel，而后端部署在 Railway/Render/云服务器，也可以保留同一个前端域名，但你需要在前端项目的 `vercel.json` 中把 `/api/*` 代理到真实后端公网地址。

示例：

```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "https://your-backend-host.example.com/api/$1"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

注意：

- 这里的 `destination` 不能写 `www.manlvai.site` 自己，否则会造成循环代理
- 你仍然可以把飞书回调地址填成 `https://www.manlvai.site/api/auth/feishu/callback`
- Vercel 会先接住这个请求，再把它转发到真实后端

## 联调检查清单

上线前请至少检查：

1. 打开 `https://www.manlvai.site/api/auth/feishu/status` 能命中后端而不是返回前端 HTML
2. 聊天页点击“连接飞书”后能跳转到飞书授权页
3. 手机授权完成后能回到 `https://www.manlvai.site/oauth/feishu/result`
4. 页面能自动返回聊天页或个人中心
5. 聊天页显示“已连接”，并且授权前缓存的提问会自动继续执行
