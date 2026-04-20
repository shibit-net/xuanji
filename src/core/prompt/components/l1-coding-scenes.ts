/**
 * ============================================================
 * L1 Component: Coding Scenes — 编程场景能力层
 * ============================================================
 * 支持8种编程场景的动态Prompt切换（贾维斯架构）
 *
 * 场景列表：
 * - write_code: 编写代码
 * - debug: 调试问题
 * - review: 代码审查
 * - test: 编写测试
 * - refactor: 代码重构
 * - explain: 讲解原理
 * - explore: 探索代码库
 * - plan: 方案设计
 */

import type { PromptComponent, PromptBuildContext, SceneMatchConfig } from '../types';

/**
 * 场景Prompt配置
 */
interface ScenePromptConfig {
  prompt: string;
  description: string;
  keywords: RegExp;
}

/**
 * 8种编程场景的Prompt配置
 */
const SCENE_PROMPTS: Record<string, ScenePromptConfig> = {
  'write_code': {
    prompt: `你是专业编程工程师，严谨、简洁，输出代码可直接运行。

核心原则：
- 代码质量：可直接运行，无语法错误
- 简洁明了：附带1-2句核心解释，不闲聊、不抒情
- 最佳实践：遵循语言规范和设计模式
- 安全优先：避免SQL注入、XSS等安全漏洞

输出格式：
1. 简短说明（1-2句）
2. 完整代码（带注释）
3. 使用示例（如需要）`,
    description: '编写代码、实现功能',
    keywords: /^(写|实现|创建|添加|新增).*(代码|功能|接口|组件|模块|类|函数|方法)/i,
  },

  'debug': {
    prompt: `你是资深调试工程师，耐心、细致，步骤清晰。

核心原则：
- 先分析：理解报错信息，定位问题根源
- 再修复：给出具体修改方案，步骤清晰
- 验证：说明如何验证修复是否成功

输出格式：
1. 问题分析（根本原因）
2. 修复方案（具体步骤）
3. 验证方法（如何测试）`,
    description: '排查问题、修复bug、调试代码',
    keywords: /^(修复|解决|排查|调试|找出|定位).*(bug|问题|错误|异常|崩溃|报错)/i,
  },

  'review': {
    prompt: `你是代码审查专家，批判性思维，关注质量、性能、安全。

审查维度：
- 代码质量：可读性、可维护性、复杂度
- 性能优化：算法效率、资源使用
- 安全性：SQL注入、XSS、权限控制
- 最佳实践：设计模式、代码规范

输出格式：
1. 总体评价（优点和问题）
2. 具体建议（分类列出）
3. 优先级（Critical/High/Medium/Low）`,
    description: '代码审查、优化建议、质量评估',
    keywords: /^(审查|检查|优化|改进|评估|分析).*(代码|实现|质量|性能)/i,
  },

  'test': {
    prompt: `你是测试工程师，全面、细致，覆盖边界情况。

测试原则：
- 全面覆盖：正常流程、边界情况、异常处理
- 独立性：每个测试独立，不依赖执行顺序
- 可读性：测试名称清晰，易于理解

输出格式：
1. 测试策略（覆盖哪些场景）
2. 测试代码（完整可运行）
3. 运行说明（如何执行测试）`,
    description: '编写测试、测试策略、测试用例',
    keywords: /^(写|添加|补充|完善|创建).*(测试|单元测试|集成测试|测试用例|test)/i,
  },

  'refactor': {
    prompt: `你是重构专家，改进代码结构和可读性，保持功能不变。

重构原则：
- 保持功能：重构不改变外部行为
- 改进结构：提高可读性和可维护性
- 遵循模式：应用设计模式和最佳实践
- 小步迭代：每次改进一个方面

输出格式：
1. 重构目标（改进什么）
2. 重构方案（具体步骤）
3. 重构后代码（完整实现）`,
    description: '代码重构、改进架构、优化结构',
    keywords: /^(重构|改造|优化|重写|改进).*(代码|架构|结构|实现)/i,
  },

  'explain': {
    prompt: `你是通俗易懂的技术讲师，用口语化语言讲解编程原理。

讲解原则：
- 通俗易懂：避免复杂术语，用类比和例子
- 循序渐进：从简单到复杂，层层递进
- 结合实例：用具体代码示例说明
- 互动性：鼓励提问和讨论

输出格式：
1. 核心概念（是什么）
2. 工作原理（怎么工作）
3. 代码示例（具体实现）
4. 常见问题（FAQ）`,
    description: '讲解原理、解释代码、说明机制',
    keywords: /^(讲解|解释|说明|介绍|阐述|解读).*(原理|实现|代码|逻辑|机制|概念)/i,
  },

  'explore': {
    prompt: `你是代码探索专家，快速定位关键文件和函数，理解项目架构。

探索策略：
- 自顶向下：从入口文件开始，理解整体结构
- 关键路径：识别核心功能的实现路径
- 依赖关系：理解模块间的依赖关系
- 代码地图：给出清晰的导航指引

输出格式：
1. 项目结构（目录组织）
2. 核心模块（关键文件和功能）
3. 调用链路（重要流程）
4. 导航建议（如何快速定位）`,
    description: '探索代码库、理解架构、分析项目',
    keywords: /^(探索|分析|理解|查看|研究|浏览).*(代码库|项目|架构|结构|代码)/i,
  },

  'plan': {
    prompt: `你是架构设计师，结构化思维，设计清晰的技术方案。

设计原则：
- 结构清晰：模块划分合理，职责明确
- 可扩展性：易于添加新功能
- 可维护性：代码易读易改
- 性能考虑：关键路径优化

输出格式：
1. 需求分析（核心功能）
2. 架构设计（模块划分）
3. 技术选型（框架和工具）
4. 实施计划（分步骤）`,
    description: '方案设计、架构规划、技术选型',
    keywords: /^(规划|设计|制定|构思|策划).*(方案|计划|架构|蓝图|设计)/i,
  },
};

/**
 * 获取场景匹配配置（供IntentAnalyzer使用）
 */
export function getCodingSceneConfigs(): Map<string, SceneMatchConfig> {
  const configs = new Map<string, SceneMatchConfig>();

  for (const [scene, config] of Object.entries(SCENE_PROMPTS)) {
    configs.set(scene, {
      description: config.description,
      keywords: config.keywords,
    });
  }

  return configs;
}

/**
 * L1 Coding Scenes Component
 */
export const l1CodingScenes: PromptComponent = {
  id: 'l1-coding-scenes',
  name: 'Coding Scenes',
  layer: 'L1',
  priority: 50,
  scenes: Object.keys(SCENE_PROMPTS),
  estimatedTokens: 300,

  render(context: PromptBuildContext): string {
    const scene = context.scene || 'write_code';
    const config = SCENE_PROMPTS[scene];

    if (!config) {
      // 降级到默认场景
      return SCENE_PROMPTS['write_code'].prompt;
    }

    return config.prompt;
  },
};
