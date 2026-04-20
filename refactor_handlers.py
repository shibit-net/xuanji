#!/usr/bin/env python3
"""
批量重构 agent-bridge.ts 中的 handler 函数
将所有 handler 函数从使用 safeSend 改为直接返回结果
"""

import re
import sys

def refactor_handler(content):
    """重构 handler 函数"""

    # 1. 修改函数签名：移除 requestId 参数
    # async function handleXxx(requestId: string, data: any) -> async function handleXxx(data: any)
    content = re.sub(
        r'async function (handle\w+)\(requestId: string, data: any\)',
        r'async function \1(data: any)',
        content
    )

    # async function handleXxx(requestId: string) -> async function handleXxx()
    content = re.sub(
        r'async function (handle\w+)\(requestId: string\)',
        r'async function \1()',
        content
    )

    # 2. 替换 safeSend 调用为 return 语句
    # safeSend({ requestId, data: { ... } }); -> return { ... };

    # 处理多行的 safeSend
    def replace_safesend(match):
        indent = match.group(1)
        data_content = match.group(2)
        return f'{indent}return {data_content};'

    # 匹配 safeSend({ requestId, data: {...} });
    content = re.sub(
        r'(\s+)safeSend\(\{\s*requestId,\s*data:\s*(\{[^}]+\})\s*\}\);',
        replace_safesend,
        content
    )

    # 处理跨多行的 safeSend（更复杂的情况）
    # 这需要更复杂的处理，暂时手动处理

    return content

def main():
    file_path = 'desktop/main/agent-bridge.ts'

    # 读取文件
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 重构
    new_content = refactor_handler(content)

    # 写回文件
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f'✅ 重构完成: {file_path}')

if __name__ == '__main__':
    main()
