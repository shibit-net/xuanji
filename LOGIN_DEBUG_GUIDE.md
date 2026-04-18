# 登录状态保存问题调试指南

## 问题现象

用户登录后，重启应用仍需要重新登录。检查发现 `~/.xuanji/auth/current-auth.enc` 文件不存在。

## 调试步骤

### 1. 启动应用并查看日志

启动应用后，打开开发者工具（View → Toggle Developer Tools），查看 Console 日志。

### 2. 执行登录操作

输入账号密码登录，观察控制台输出的日志：

#### 预期的日志流程

```
发送 API 请求: POST https://test.shibit.net/api/auth/login
收到响应，状态码: 200
收到 Set-Cookie 头: [...]
解析后的 Cookies: ['accessToken', 'refreshToken', 'tokenExpiresIn']
登录 API 响应: { success: true, message: '登录成功' }

登录成功，开始同步 Cookie...
[syncCookiesFromClient] 开始同步 Cookie...
[syncCookiesFromClient] 从 apiClient 获取的 Cookie: {
  hasAccessToken: true,
  hasRefreshToken: true,
  expiresInStr: '3600',
  accessTokenLength: 200+,
  refreshTokenLength: 200+
}
[syncCookiesFromClient] 同步后的 authState: {
  hasAccessToken: true,
  hasRefreshToken: true,
  tokenExpiresAt: 1745123456789,
  expiresIn: 3600
}

Cookie 同步完成，当前 authState: {
  hasAccessToken: true,
  hasRefreshToken: true,
  tokenExpiresAt: 1745123456789
}

开始保存认证状态...
[saveAuthState] 开始保存认证状态...
[saveAuthState] 当前 authState: {
  hasUser: true,
  userEmail: 'user@example.com',
  hasAccessToken: true,
  hasRefreshToken: true,
  tokenExpiresAt: 1745123456789,
  accessTokenLength: 200+,
  refreshTokenLength: 200+
}

[saveAuthState] 调用 saveCurrentAuth...
[saveCurrentAuth] 准备保存: {
  email: 'user@example.com',
  hasAccessToken: true,
  hasRefreshToken: true,
  tokenExpiresAt: 1745123456789,
  accessTokenLength: 200+
}
[saveCurrentAuth] 序列化后的数据长度: 500+
[saveCurrentAuth] 使用加密存储
[saveCurrentAuth] 加密文件已写入: /Users/xxx/.xuanji/auth/current-auth.enc
[saveCurrentAuth] 保存当前登录状态成功: user@example.com

[saveAuthState] saveCurrentAuth 完成
[saveAuthState] 认证状态保存完成
认证状态保存完成
```

### 3. 检查可能的问题点

#### 问题 A: Cookie 未正确解析

**症状**:
```
[syncCookiesFromClient] 从 apiClient 获取的 Cookie: {
  hasAccessToken: false,  // ❌ 应该是 true
  hasRefreshToken: false,
  ...
}
```

**原因**: 
- 后端未返回 Set-Cookie 头
- Cookie 解析逻辑有问题

**排查**:
1. 检查 API 响应头是否包含 Set-Cookie
2. 检查 `apiClient.parseAndStoreCookies()` 的解析逻辑

#### 问题 B: authState 未正确更新

**症状**:
```
[saveAuthState] 当前 authState: {
  hasUser: true,
  userEmail: 'user@example.com',
  hasAccessToken: false,  // ❌ 应该是 true
  ...
}
```

**原因**: 
- `syncCookiesFromClient()` 调用时机不对
- `setAuthState()` 覆盖了 token

**排查**:
1. 确认 `syncCookiesFromClient()` 在 `setAuthState({ user })` 之前调用
2. 检查 `setAuthState()` 是否意外清空了 token

#### 问题 C: 文件写入失败

**症状**:
```
[saveCurrentAuth] 保存当前登录状态失败: Error: ...
```

**原因**: 
- 目录权限问题
- 磁盘空间不足
- safeStorage 不可用

**排查**:
1. 检查 `~/.xuanji/auth/` 目录权限
2. 检查磁盘空间
3. 如果加密不可用，应该看到 "使用 JSON 存储" 的日志

### 4. 验证文件是否生成

```bash
ls -la ~/.xuanji/auth/
```

**预期输出**:
```
-rw-r--r--  1 user  staff  500+ Apr 19 12:00 current-auth.enc
-rw-r--r--  1 user  staff  200  Apr 19 12:00 accounts.enc
```

如果只有 `accounts.enc` 而没有 `current-auth.enc`，说明 `saveCurrentAuth()` 失败。

### 5. 测试重启后自动登录

1. 完全退出应用（Cmd+Q / Alt+F4）
2. 重新启动应用
3. 观察控制台日志：

**预期日志**:
```
加载认证状态成功: { user: 'user@example.com' }
收到认证检查请求
Token 有效，用户: user@example.com
用户配置初始化完成: userId
触发启动消息
```

如果看到 "未找到当前登录状态"，说明文件未成功保存或加载失败。

## 常见问题和解决方案

### 问题 1: 后端未返回 Set-Cookie

**检查**: 查看 API 响应头

**解决**: 
- 确认后端 API 正确设置了 Cookie
- 检查 CORS 配置是否允许 credentials

### 问题 2: Cookie 解析失败

**检查**: `apiClient.parseAndStoreCookies()` 的正则表达式

**解决**: 
- 更新正则表达式以匹配实际的 Set-Cookie 格式
- 添加更多调试日志

### 问题 3: 加密存储不可用

**检查**: 日志中是否显示 "使用 JSON 存储"

**解决**: 
- macOS: 授权访问 Keychain
- Linux: 安装 libsecret
- Windows: 检查 DPAPI

### 问题 4: 文件权限问题

**检查**: 
```bash
ls -ld ~/.xuanji/auth/
```

**解决**: 
```bash
chmod 755 ~/.xuanji/auth/
```

## 下一步

根据日志输出，确定具体是哪个环节出了问题，然后针对性修复。

如果所有日志都正常，但文件仍未生成，可能是：
1. 异步操作未等待完成
2. 异常被静默捕获
3. 文件路径错误

请将完整的登录日志发送给我，我会帮你分析具体问题。
