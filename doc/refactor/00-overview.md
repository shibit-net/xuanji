# Xuanji 重构方案总览

## 一、核心问题

### 1. 职责不清
- **ChatSession**：初始化、编排、路由、生命周期管理混在一起
- **MemoryManager**：13+ 个子组件，成为"上帝类"
- **PermissionController**：业务逻辑和基础设施混杂

### 2. 耦合严重
- 循环依赖风险：ChatSession ↔ MemoryManager ↔ SubAgentFactory
- 依赖注入不统一：构造函数、setter、全局变量混用
- 缺乏清晰的分层架构

### 3. 接口不统一
- 存储接口：MemoryStore、SessionStorage、DecisionStore 各自为政
- 配置管理：ConfigLoader、EnvConfig、GlobalConfig 分散
- 工具注册：静态、动态、JSON5 三种方式混乱

### 4. 代码重复
- 消息管理：MessageManager、SessionManager、ShortTermMemory
- 权限检查：ToolRegistry、各个 Tool 中重复实现

---

## 二、重构原则

### SOLID 原则
1. **单一职责**：每个类只做一件事
2. **开闭原则**：对扩展开放，对修改关闭
3. **里氏替换**：子类可以替换父类
4. **接口隔离**：接口应该小而专注
5. **依赖倒置**：依赖接口而非实现

### 分层架构
```
Adapters Layer    → CLI/IM/Electron/API
Application Layer → ChatSession/Skills
Domain Layer      → Agent/Memory/Permission
Infrastructure    → Storage/Logger/Config
```

**依赖规则**：上层依赖下层，下层不依赖上层

---

## 三、重构优先级

### P0：核心解耦（2 周）
1. 拆分 ChatSession → SessionOrchestrator + DependencyContainer
2. 重构 MemoryManager → 按职责拆分为独立服务
3. 简化 PermissionController → 分离业务和基础设施

### P1：接口统一（1 周）
4. 统一存储接口 → IStorage<T>
5. 统一配置管理 → ConfigService
6. 统一工具注册 → ToolRegistry 重构

### P2：代码复用（1 周）
7. 抽象消息管理 → MessageBus
8. 抽象权限检查 → PermissionMiddleware
9. 引入事件总线 → EventBus

---

## 四、预期收益

| 指标 | 当前 | 目标 | 提升 |
|------|------|------|------|
| 代码行数 | 35,000 | 28,000 | -20% |
| 圈复杂度 | 8.5 | 5.0 | -41% |
| 代码重复率 | 15% | 5% | -67% |
| 测试覆盖率 | 45% | 80% | +78% |
| 新功能开发 | 4h | 1h | -75% |
| Bug 修复 | 3h | 1h | -67% |

---

## 五、文档结构

```
doc/refactor/
├── 00-overview.md           # 本文档
├── 01-chat-session.md       # ChatSession 重构
├── 02-memory-manager.md     # MemoryManager 重构
├── 03-permission.md         # Permission 重构
├── 04-storage.md            # 存储接口统一
├── 05-config.md             # 配置管理统一
└── 06-common-modules.md     # 公共模块抽象
```

---

## 六、实施计划

### 第 1 周：ChatSession 重构
- Day 1-2: 设计新架构
- Day 3-4: 实现 SessionOrchestrator
- Day 5: 实现 DependencyContainer
- Day 6-7: 迁移测试 + 文档

### 第 2 周：MemoryManager 重构
- Day 1-2: 拆分存储、检索、维护服务
- Day 3-4: 实现新接口
- Day 5-7: 迁移 + 测试

### 第 3 周：PermissionController + 接口统一
- Day 1-3: Permission 重构
- Day 4-5: 统一存储接口
- Day 6-7: 统一配置管理

### 第 4 周：代码复用 + 收尾
- Day 1-3: 抽象公共模块
- Day 4-5: 全面测试
- Day 6-7: 文档完善 + Code Review

---

## 七、风险控制

### 风险 1：功能回归
**缓解**：
- 每个模块重构前先补充单元测试
- 使用 Feature Flag 控制新旧实现切换
- 保留旧代码 2 个版本周期

### 风险 2：性能下降
**缓解**：
- 重构前后进行性能基准测试
- 使用 Profiler 分析瓶颈
- 关键路径保持性能优先

### 风险 3：学习成本
**缓解**：
- 编写详细的迁移指南
- 提供代码示例
- 组织 Code Review 和分享会
