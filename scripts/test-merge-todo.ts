#!/usr/bin/env tsx
// ============================================================
// 测试 mergeTodoMessages 逻辑
// ============================================================

type ChatMessage = {
  id: number;
  role: string;
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolIsError?: boolean;
  toolDuration?: number;
  toolParallel?: boolean;
  timestamp: number;
};

function mergeTodoMessages(todoMsgs: ChatMessage[]): ChatMessage | null {
  if (todoMsgs.length === 0) return null;

  let msgId = 1000;

  // 按操作类型分组
  const createMsgs = todoMsgs.filter(m => m.toolName === 'todo_create');
  const updateMsgs = todoMsgs.filter(m => m.toolName === 'todo_update');
  const listMsgs = todoMsgs.filter(m => m.toolName === 'todo_list');

  // 构建摘要
  const summaryParts: string[] = [];

  if (createMsgs.length > 0) {
    const taskNames = createMsgs.map(m => {
      const match = m.content.match(/已创建:\s*([^(]+)/);
      return match ? match[1].trim() : '';
    }).filter(Boolean);

    if (createMsgs.length === 1) {
      summaryParts.push(`✅ 已创建: ${taskNames[0]}`);
    } else {
      summaryParts.push(`✅ 已创建 ${createMsgs.length} 个任务: ${taskNames.join('、')}`);
    }
  }

  if (updateMsgs.length > 0) {
    const taskNames = updateMsgs.map(m => {
      const match = m.content.match(/(?:已完成|开始执行|已更新):\s*([^(]+)/);
      return match ? match[1].trim() : '';
    }).filter(Boolean);

    if (updateMsgs.length === 1) {
      summaryParts.push(updateMsgs[0].content.split('\n')[0]);
    } else {
      summaryParts.push(`📝 已更新 ${updateMsgs.length} 个任务: ${taskNames.join('、')}`);
    }
  }

  if (listMsgs.length > 0) {
    summaryParts.push(listMsgs[0].content);
  }

  return {
    id: ++msgId,
    role: 'tool',
    content: summaryParts.join('\n'),
    toolName: 'todo_batch',
    toolInput: {},
    toolIsError: false,
    toolDuration: 0,
    toolParallel: false,
    timestamp: Date.now(),
  };
}

console.log('🧪 测试 mergeTodoMessages 逻辑\n');

// 模拟 3 个 todo_create 工具调用的结果
const todoMsgs: ChatMessage[] = [
  {
    id: 1,
    role: 'tool',
    content: '✅ 已创建: 修复登录 bug (todo-001)\n<!--TODO_PROGRESS:{"completed":0,"total":1,"items":[{"title":"修复登录 bug","status":"pending"}]}-->',
    toolName: 'todo_create',
    toolInput: { title: '修复登录 bug' },
    toolIsError: false,
    toolDuration: 10,
    toolParallel: false,
    timestamp: Date.now(),
  },
  {
    id: 2,
    role: 'tool',
    content: '✅ 已创建: 添加单元测试 (todo-002)\n<!--TODO_PROGRESS:{"completed":0,"total":2,"items":[{"title":"修复登录 bug","status":"pending"},{"title":"添加单元测试","status":"pending"}]}-->',
    toolName: 'todo_create',
    toolInput: { title: '添加单元测试' },
    toolIsError: false,
    toolDuration: 10,
    toolParallel: false,
    timestamp: Date.now(),
  },
  {
    id: 3,
    role: 'tool',
    content: '✅ 已创建: 更新文档 (todo-003)\n<!--TODO_PROGRESS:{"completed":0,"total":3,"items":[{"title":"修复登录 bug","status":"pending"},{"title":"添加单元测试","status":"pending"},{"title":"更新文档","status":"pending"}]}-->',
    toolName: 'todo_create',
    toolInput: { title: '更新文档' },
    toolIsError: false,
    toolDuration: 10,
    toolParallel: false,
    timestamp: Date.now(),
  },
];

console.log('输入消息:');
todoMsgs.forEach((msg, i) => {
  console.log(`  ${i + 1}. ${msg.toolName}: ${msg.content.split('\n')[0]}`);
});

console.log('\n合并后的消息:');
const merged = mergeTodoMessages(todoMsgs);
if (merged) {
  console.log(`  工具名: ${merged.toolName}`);
  console.log(`  内容: ${merged.content}`);
} else {
  console.log('  ❌ 合并失败');
}
