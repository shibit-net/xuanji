// ============================================================
// TodoContextInjector — 在 System Prompt 中注入任务状态提示
// ============================================================

import { getTodoManager } from './TodoManager';

/**
 * 生成任务状态提示，注入到 System Prompt
 *
 * 让 LLM 自动感知：
 * 1. 当前有多少任务
 * 2. 是否有大量已完成任务需要清理
 * 3. 是否有孤儿任务（长期无更新）
 */
export async function generateTodoContextHint(): Promise<string> {
  const todoManager = getTodoManager();
  const todos = await todoManager.list();

  if (todos.length === 0) {
    return ''; // 没有任务，不注入提示
  }

  const completed = todos.filter((t) => t.status === 'completed');
  const pending = todos.filter((t) => t.status === 'pending');
  const inProgress = todos.filter((t) => t.status === 'in_progress');
  const failed = todos.filter((t) => t.status === 'failed');

  // 检测孤儿任务（7天无更新）
  const staleTasks = await todoManager.detectStaleTasks(7);

  const hints: string[] = [];

  // 提示 1：大量已完成任务
  if (completed.length >= 5) {
    hints.push(
      `⚠️ 检测到 ${completed.length} 个已完成任务。` +
      `在创建新任务前，建议先调用 todo_archive 工具归档旧任务，保持列表清爽。`
    );
  }

  // 提示 2：孤儿任务
  if (staleTasks.length > 0) {
    hints.push(
      `⚠️ 检测到 ${staleTasks.length} 个孤儿任务（7天无更新）：${staleTasks.map(t => t.title).join(', ')}。` +
      `建议询问用户是否继续这些任务，或调用 todo_clear 清理。`
    );
  }

  // 提示 3：失败任务累积
  if (failed.length >= 3) {
    hints.push(
      `⚠️ 检测到 ${failed.length} 个失败任务。` +
      `建议询问用户是否重试或清理这些任务。`
    );
  }

  // 提示 4：任务总数过多
  if (todos.length >= 15) {
    hints.push(
      `⚠️ 当前任务列表过长（${todos.length} 个任务）。` +
      `建议归档已完成任务或清理无关任务。`
    );
  }

  if (hints.length === 0) {
    return ''; // 没有需要提示的问题
  }

  return `
# 当前任务状态

- 总任务数：${todos.length}
- 进行中：${inProgress.length}
- 待处理：${pending.length}
- 已完成：${completed.length}
- 失败：${failed.length}

${hints.join('\n\n')}

**建议操作**：
- 归档已完成任务：\`todo_archive {"strategy": "completed"}\`
- 清理失败任务：\`todo_clear {"status": "failed"}\`
- 查看任务列表：\`todo_list\`
`;
}

/**
 * 检查用户消息是否表示开始新工作
 *
 * 如果是新工作 + 有旧任务，自动提示 LLM 清理
 */
export function detectNewWorkContext(userMessage: string, hasTodos: boolean): string | null {
  if (!hasTodos) return null;

  // 新工作关键词
  const newWorkKeywords = [
    '现在', '接下来', '然后', '新的', '另一个', '帮我',
    'now', 'next', 'then', 'new', 'another', 'help me',
  ];

  const lowerMessage = userMessage.toLowerCase();
  const hasNewWorkKeyword = newWorkKeywords.some((kw) => lowerMessage.includes(kw));

  if (hasNewWorkKeyword) {
    return `
⚠️ 用户似乎开始了新的工作。当前还有旧任务未清理。

**建议流程**：
1. 先调用 \`todo_list\` 查看旧任务状态
2. 如果旧任务已完成，调用 \`todo_archive {"strategy": "completed"}\` 归档
3. 如果旧任务无关，调用 \`todo_clear {"status": "all"}\` 清空
4. 然后为新工作创建任务
`;
  }

  return null;
}
