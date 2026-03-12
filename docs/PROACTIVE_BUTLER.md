# 智能管家 (ProactiveButler) 使用指南

## 概述

**智能管家** 是 Xuanji 的 LLM 驱动主动推送服务，能够：
- 🤖 **自主决策**：基于记忆、提醒、时间上下文，LLM 自动判断是否需要推送
- 🎯 **智能推送**：主动通知重要事项（过期提醒、生日、关系维护）
- 🚫 **防骚扰**：合并低优先级事项，静默时段仅推送紧急事项
- 📊 **学习反馈**：记录用户响应（dismiss/snooze/complete），优化推送策略

## 核心理念

**传统提醒系统** vs **智能管家**：

| 维度 | 传统提醒 | 智能管家 |
|------|---------|---------|
| 触发方式 | 定时轮询（固定间隔） | LLM 决策 + 事件触发 |
| 推送时机 | 到期时间点 | 智能分析上下文后决定 |
| 推送内容 | 预设文案 | LLM 生成友好、可操作的文案 |
| 推送频率 | 无限制（可能骚扰） | 防骚扰策略 + 优先级合并 |
| 适应性 | 固定规则 | 学习用户反馈，自适应调整 |

**示例对比**：

```
传统提醒：
  [09:00] ⏰ 提醒：Alice 的生日
  [09:00] ⏰ 提醒：提交周报

智能管家：
  [09:00] 🎂 你好！有几件事想提醒你：
          • Alice 的生日是后天（3月8号），要不要帮你挑个礼物？我记得她喜欢日料和文艺片
          • 周报今天截止，记得提交哦
```

## 使用方法

### 1. 启用智能管家

在配置文件 `.xuanji.yaml` 中启用：

```yaml
features:
  proactiveButler: true  # 启用智能管家

butler:
  enabled: true
  decisionModel: null  # 使用默认轻量模型（推荐）
  decisionTemperature: 0.3  # 决策保守度（0.3 偏保守）
  
  antiBother:
    minIntervalMinutes: 60  # 同类推送最小间隔（分钟）
    quietHours: ["22:00", "08:00"]  # 静默时段（晚10点-早8点）
    dailySummaryTime: "09:00"  # 每日摘要时间
  
  checkSchedule:  # 定时检查时间点
    - "09:00"  # 早晨
    - "20:00"  # 晚上
  
  fallbackIntervalMinutes: 60  # 兜底轮询间隔（小时）
  
  defaultChannels:
    - system  # 系统通知
    # - feishu  # 飞书（需配置）
```

### 2. 启动管家服务

在 Xuanji 会话中执行：

```
启动智能管家服务
```

或者直接调用工具：

```
使用 butler_daemon 工具，action 为 start
```

管家将在以下时机进行决策：
- 每天 09:00 和 20:00（定时检查）
- 每小时兜底检查一次
- 新增重要记忆时（未来支持）

### 3. 手动触发检查

```
让管家检查一下是否有需要推送的事项
```

或：

```
使用 butler_daemon 工具，action 为 check
```

### 4. 停止管家服务

```
停止智能管家服务
```

## 决策机制

智能管家的决策流程：

```
1. 收集上下文
   ├─ 当前时间（工作日/周末、早晚）
   ├─ 用户状态（在线/离线、最后活跃时间）
   ├─ 提醒上下文（到期/即将到来/关系维护）
   └─ 最近记忆（24小时内）

2. 快速筛选
   ├─ 无待处理事项 → 跳过
   ├─ 静默时段 + 无紧急事项 → 跳过
   └─ 最近1小时内已推送 → 跳过

3. LLM 决策
   ├─ 输入：上下文 + 决策原则
   ├─ 输出：是否推送 + 推送内容 + 优先级
   └─ 降级：LLM 失败时，OVERDUE 强制推送

4. 执行推送
   ├─ 系统通知（macOS/Windows）
   ├─ IM 推送（飞书/钉钉/企微，可选）
   └─ 记录推送历史
```

## 推送策略

### 优先级分类

| 优先级 | 说明 | 示例 |
|--------|------|------|
| `urgent` | 必须立即推送（忽略静默时段） | OVERDUE 提醒、紧急截止 |
| `high` | 重要但可等到非静默时段 | 今日截止、重要生日 |
| `normal` | 一般事项 | 即将到来的提醒 |
| `low` | 可合并到每日摘要 | 关系维护建议 |

### 防骚扰策略

1. **频率限制**：同类型推送间隔至少 1 小时（urgent 除外）
2. **智能合并**：多个低优先级事项合并为一条摘要
3. **静默时段**：22:00-08:00 仅推送 urgent 级别
4. **用户反馈学习**（未来）：根据用户 dismiss/snooze 行为调整频率

## 推送内容示例

### 示例 1: 过期提醒

```json
{
  "shouldPush": true,
  "reason": "检测到 2 条过期提醒",
  "notification": {
    "title": "⚠️ 过期提醒",
    "body": "你有 2 条过期提醒:\n• Alice 的生日 (已过 2 天)\n• 提交周报 (已过 1 天)\n\n要不要帮你处理？",
    "priority": "high",
    "channel": "system"
  }
}
```

### 示例 2: 关系维护

```json
{
  "shouldPush": true,
  "reason": "Alice 已 65 天未联系，建议维护关系",
  "notification": {
    "title": "👤 关系维护建议",
    "body": "你已经 65 天没联系 Alice 了。我记得她喜欢日料和文艺片，要不要帮你安排个约会？",
    "priority": "normal",
    "channel": "system"
  }
}
```

### 示例 3: 每日摘要

```json
{
  "shouldPush": true,
  "reason": "早晨摘要：3 条即将到来的事项",
  "notification": {
    "title": "📅 今日摘要",
    "body": "早上好！今天有 3 件事需要关注:\n• 下午 3 点团队会议\n• Alice 的生日后天（提前准备礼物）\n• 周报明天截止",
    "priority": "normal",
    "channel": "system"
  }
}
```

## 配置参考

### 最小配置（默认值）

```yaml
features:
  proactiveButler: true
```

### 完整配置

```yaml
features:
  proactiveButler: true

butler:
  enabled: true
  decisionModel: null  # 或指定模型如 "claude-3-haiku-20240307"
  decisionTemperature: 0.3
  
  antiBother:
    minIntervalMinutes: 60
    quietHours: ["22:00", "08:00"]
    dailySummaryTime: "09:00"
  
  checkSchedule:
    - "09:00"
    - "20:00"
  
  fallbackIntervalMinutes: 60
  
  defaultChannels:
    - system
  
  storageFile: "butler_pushes.jsonl"  # 推送记录存储
```

## 故障排查

### 问题 1: 管家未初始化

```
Error: ProactiveButler not initialized
```

**解决**：检查配置 `features.proactiveButler: true` 是否启用

### 问题 2: 无推送通知

**原因**：
1. 可能在静默时段且无紧急事项
2. 最近 1 小时内已推送过
3. LLM 决策认为不需要推送

**调试**：手动触发检查并查看决策理由

```
使用 butler_daemon 工具，action 为 check
```

### 问题 3: 系统通知不显示

**macOS**：检查系统偏好设置 → 通知 → 终端（允许通知）

**Linux**：确保安装了 `notify-send` (`sudo apt install libnotify-bin`)

## 最佳实践

1. **首次使用**：先手动 `check` 几次，观察决策效果
2. **调整频率**：根据实际需求修改 `checkSchedule` 和 `minIntervalMinutes`
3. **静默时段**：根据作息调整 `quietHours`
4. **轻量模型**：建议使用默认轻量模型（省钱、快速）
5. **多渠道推送**：工作时启用 IM 推送（飞书/钉钉），休息时仅系统通知

## 未来计划

- [ ] 支持用户反馈学习（dismiss/snooze 行为分析）
- [ ] 事件驱动触发（记忆变化时立即检查）
- [ ] 多语言推送内容
- [ ] 更细粒度的推送策略配置
- [ ] Web 仪表盘查看推送历史

## 常见问题

**Q: 智能管家会消耗很多 token 吗？**

A: 不会。管家使用轻量模型（如 Claude Haiku），单次决策约消耗 300-500 tokens，按每天 2 次定时检查 + 1 次兜底，每天约 1000-1500 tokens，成本极低（< $0.01/天）。

**Q: 管家会在后台一直运行吗？**

A: 是的，启动后会在后台定时检查。但如果重启 xuanji，需要重新启动管家服务（未来将支持持久化启动配置）。

**Q: 可以自定义推送内容吗？**

A: LLM 会根据上下文自动生成，暂不支持手动模板。但可以通过调整 System Prompt 影响生成风格（需修改源码）。

**Q: 支持哪些推送渠道？**

A: 目前支持：
- ✅ 系统通知（macOS/Windows/Linux）
- ✅ 飞书机器人（需配置）
- ⏳ 钉钉/企微（开发中）
- ⏳ Email（计划中）
