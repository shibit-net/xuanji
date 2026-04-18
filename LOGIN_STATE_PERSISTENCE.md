# 登录状态保持机制说明

## 问题描述

用户登录后，重启应用需要重新登录。

## 根本原因

前端 `authStore` 使用了 zustand 的 `persist` 中间件，将认证状态保存在浏览器 localStorage 中，但后端已经实现了完整的 token 加密存储机制（`~/.xuanji/auth/current-auth.enc`），两者可能产生状态不一致。

## 解决方案

### 1. 移除前端 persist 中间件

**修改文件**: `desktop/renderer/stores/authStore.ts`

- 移除 `zustand/middleware` 的 `persist` 导入
- 移除 `persist()` 包装器
- 认证状态完全由后端 token 管理

### 2. 后端 Token 存储机制

**实现位置**: `desktop/main/config/auth.ts`

**存储位置**:
- 加密文件: `~/.xuanji/auth/current-auth.enc` (使用 Electron safeStorage)
- 备用文件: `~/.xuanji/auth/current-auth.json` (加密不可用时)

**存储内容**:
```typescript
{
  email: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  user: User;
}
```

**账号列表存储**:
- 加密文件: `~/.xuanji/auth/accounts.enc`
- 备用文件: `~/.xuanji/auth/accounts.json`

**存储内容**:
```typescript
{
  accounts: Array<{
    email: string;
    nickname?: string;
    avatar?: string;
    lastLogin: number;
  }>;
}
```

### 3. 登录状态保持流程

#### 用户登录时
1. 用户输入账号密码 → `authStore.login()`
2. 调用后端 API → `authService.login()`
3. 登录成功 → 后端返回 token (通过 Set-Cookie)
4. 同步 Cookie → `syncCookiesFromClient()`
5. 保存认证状态 → `saveAuthState()`
   - 加密保存 token 到 `current-auth.enc`
   - 更新账号列表到 `accounts.enc`
6. 初始化用户配置 → `initializeUserConfig()`
7. 触发启动消息 → `triggerStartup()`

#### 应用重启时
1. App 启动 → `App.tsx` useEffect 调用 `checkAuth()`
2. 前端调用 → `window.electron.authCheck()`
3. 后端处理 → `desktop/main/ipc/auth.ts`
   - 加载认证状态 → `getAuthState()`
   - 检查 token 是否存在
   - 验证 token 有效性 → `isTokenValid()`
4. **Token 有效**:
   - 刷新用户信息 → `refreshUserInfo()`
   - 初始化用户配置 → `initializeUserConfig()`
   - 触发启动消息 → `triggerStartup()`
   - 返回成功 + 用户信息
5. **Token 过期但有 refreshToken**:
   - 调用刷新接口 → `authService.refreshToken()`
   - 同步新 token → `syncCookiesFromClient()`
   - 刷新用户信息 → `refreshUserInfo()`
   - 保存新状态 → `saveAuthState()`
   - 返回成功 + 用户信息
6. **Token 无效且无法刷新**:
   - 清除认证状态 → `clearAuthState()`
   - 返回失败
7. 前端根据结果更新状态:
   - 成功 → 设置 `isAuthenticated = true`，显示主界面
   - 失败 → 设置 `isAuthenticated = false`，显示登录页面

### 4. Token 刷新机制

**Token 有效期判断**:
```typescript
function isTokenValid(): boolean {
  const { tokenExpiresAt } = authState;
  if (!tokenExpiresAt) return false;
  
  // 提前 5 分钟刷新
  const bufferTime = 5 * 60 * 1000;
  return Date.now() < tokenExpiresAt - bufferTime;
}
```

**自动刷新时机**:
- 应用启动时检查 token
- Token 即将过期（提前 5 分钟）
- 使用 refreshToken 调用后端刷新接口

### 5. 安全性

**加密存储**:
- 使用 Electron `safeStorage` API
- 基于操作系统的密钥链（macOS Keychain / Windows DPAPI / Linux libsecret）
- Token 以加密形式存储在本地文件

**Cookie 安全**:
- HttpOnly: 防止 XSS 攻击
- Secure: 仅通过 HTTPS 传输（生产环境）
- SameSite: 防止 CSRF 攻击
- Domain: 限制 Cookie 作用域

### 6. 多账号支持

**账号列表**:
- 记录最近登录的账号
- 按 lastLogin 时间排序
- 登录页面自动填充最后登录的账号

**账号切换**:
- 当前不支持无密码切换（需要重新输入密码）
- 可以删除保存的账号记录

## 测试验证

### 测试步骤
1. 启动应用，输入账号密码登录
2. 验证登录成功，进入主界面
3. 完全退出应用（Cmd+Q / Alt+F4）
4. 重新启动应用
5. **预期结果**: 应用自动验证 token，直接进入主界面，无需重新登录

### 调试日志

启动时会输出以下日志：
```
[main] 加载认证状态...
[main] Token 有效，用户: user@example.com
[main] 用户配置初始化完成: userId
[main] 触发启动消息
```

或者：
```
[main] 加载认证状态...
[main] Token 已过期，尝试刷新...
[main] Token 刷新成功
[main] 用户信息刷新成功: user@example.com
```

或者：
```
[main] 加载认证状态...
[main] Token 过期且无法刷新，退出登录
```

## 故障排查

### 问题：重启后仍需要登录

**可能原因**:
1. Token 已过期且 refreshToken 无效
2. 认证文件被删除或损坏
3. 后端 API 返回错误

**排查步骤**:
1. 检查文件是否存在: `ls -la ~/.xuanji/auth/`
2. 查看主进程日志（开发者工具 Console）
3. 检查后端 API 是否正常

### 问题：加密存储不可用

**现象**: 使用 JSON 明文存储

**原因**: 
- macOS: 未授权访问 Keychain
- Linux: 未安装 libsecret
- Windows: DPAPI 不可用

**解决**: 
- 应用会自动降级到 JSON 存储
- 建议安装对应的系统组件

## 相关文件

### 前端
- `desktop/renderer/stores/authStore.ts` - 认证状态管理
- `desktop/renderer/components/LoginPage.tsx` - 登录页面
- `desktop/renderer/App.tsx` - 应用入口，启动时检查认证

### 后端
- `desktop/main/config/auth.ts` - Token 存储和管理
- `desktop/main/ipc/auth.ts` - 认证 IPC 处理
- `desktop/main/services/auth.ts` - 认证服务（API 调用）
- `desktop/main/services/api-client.ts` - API 客户端（Cookie 管理）

## 总结

修复后的登录状态保持机制：
- ✅ Token 加密存储在本地
- ✅ 应用重启自动验证 token
- ✅ Token 过期自动刷新
- ✅ 多账号记录支持
- ✅ 安全性保障（加密 + HttpOnly Cookie）
- ✅ 降级方案（加密不可用时使用 JSON）

用户体验：
- 首次登录后，后续启动无需重新登录
- Token 有效期内自动保持登录状态
- Token 过期自动刷新，用户无感知
- 仅在 token 完全失效时才需要重新登录
