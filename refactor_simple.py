#!/usr/bin/env python3
"""
批量重构 agent-bridge.ts 中的 handler 函数
"""

import re

def refactor_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. 修改函数签名
    # async function handleXxx(requestId: string, data: any) -> async function handleXxx(data: any)
    content = re.sub(
        r'(async function handle\w+)\(requestId: string, data: any\)',
        r'\1(data: any)',
        content
    )

    # async function handleXxx(requestId: string) -> async function handleXxx()
    content = re.sub(
        r'(async function handle\w+)\(requestId: string\)',
        r'\1()',
        content
    )

    # function handleXxx(requestId: string, data: any) -> function handleXxx(data: any)
    content = re.sub(
        r'(function handle\w+)\(requestId: string, data: any\)',
        r'\1(data: any)',
        content
    )

    # function handleXxx(requestId: string) -> function handleXxx()
    content = re.sub(
        r'(function handle\w+)\(requestId: string\)',
        r'\1()',
        content
    )

    # 2. 替换简单的 safeSend 调用
    # safeSend({ requestId, data: { success: true } }); -> return { success: true };
    content = re.sub(
        r'safeSend\(\{\s*requestId,\s*data:\s*(\{[^}]+\})\s*\}\);',
        r'return \1;',
        content
    )

    # 3. 替换带 type 的 safeSend（保留这些，因为它们是事件通知）
    # 不修改 safeSend({ type: '...', data: {...} })

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f'✅ 重构完成: {file_path}')

if __name__ == '__main__':
    refactor_file('desktop/main/agent-bridge.ts')
