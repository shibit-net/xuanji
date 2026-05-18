// ============================================================
// Milkdown $remark 插件: 解析子 Agent 引用标记
// ============================================================
//
// 将 📎 语法解析为 Milkdown 的自定义 inline 节点：
//   - 📎 [Name]：\"quote\" → citation-ref 节点
//   - [查看详情: Name]    → subagent-ref 节点
//
// 配合 milkdown/SubAgentNodes.ts 中的 $node 定义，
// 这些节点会被渲染为带 data-* 属性的 span 元素，
// 供 MessageBubble 中的 React portal 注入可交互组件。
// ============================================================

import { $remark } from '@milkdown/utils';
import { visit } from 'unist-util-visit';
import type { Ctx } from '@milkdown/ctx';

export interface SubAgentReferenceNode {
  type: string;
  data: {
    hName: string;
    hProperties: {
      'data-name': string;
    };
  };
  children: [];
}

export interface CitationReferenceNode {
  type: string;
  data: {
    hName: string;
    hProperties: {
      'data-name': string;
      'data-quote': string;
    };
  };
  children: [];
}

// 📎 [名称]：\"引用原文\"  或  📎 [名称]:\"引用原文\"
// 支持中英文引号："" '' \"\" 「」 直单引号 '
// 使用显式引号对匹配，防止中文文本中的「」被误判为引用结束符
const CITATION_REGEX = /📎\s*\[([^\]]+)\]\s*[：:]\s*(?:"([^"]*)"|'([^']*)'|\u201C([^\u201D]*)\u201D|\u2018([^\u2019]*)\u2019|\u300C([^\u300D]*)\u300D)/u;

/** 从多个交替捕获组中提取匹配的引用文本 */
function extractQuotedText(match: RegExpExecArray): string {
  // 交替捕获组：index 2=", 3=', 4=", 5=', 6=「」
  return match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? '';
}

export const remarkSubAgentReference = $remark(
  'subAgentReference',
  (_ctx: Ctx) => {
    return () => (tree: any) => {
      visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
        if (!parent || index === undefined) return;

        const text: string = node.value;

        // 先匹配引用语法 📎 [Name]：\"quote\"
        const citationMatch = CITATION_REGEX.exec(text);
        if (citationMatch) {
          const agentName = citationMatch[1].trim();
          const quotedText = extractQuotedText(citationMatch).trim();
          const matchStart = citationMatch.index;
          const matchEnd = matchStart + citationMatch[0].length;

          const newNodes: any[] = [];

          if (matchStart > 0) {
            newNodes.push({ type: 'text', value: text.slice(0, matchStart) });
          }

          newNodes.push({
            type: 'citationReference',
            data: {
              hName: 'citation-ref',
              hProperties: {
                'data-name': agentName,
                'data-quote': quotedText,
              },
            },
            children: [],
          });

          if (matchEnd < text.length) {
            newNodes.push({ type: 'text', value: text.slice(matchEnd) });
          }

          parent.children.splice(index, 1, ...newNodes);
          return;
        }

        // 再匹配子 Agent 块引用：[查看详情: <名称>]  或  [查看详情：<名称>]
        const subagentMatch = /\[查看详情[：:]\s*(.+?)\]/.exec(text);
        if (subagentMatch) {
          const agentName = subagentMatch[1].trim();
          const matchStart = subagentMatch.index;
          const matchEnd = matchStart + subagentMatch[0].length;

          const newNodes: any[] = [];

          if (matchStart > 0) {
            newNodes.push({ type: 'text', value: text.slice(0, matchStart) });
          }

          newNodes.push({
            type: 'subAgentReference',
            data: {
              hName: 'subagent-ref',
              hProperties: {
                'data-name': agentName,
              },
            },
            children: [],
          });

          if (matchEnd < text.length) {
            newNodes.push({ type: 'text', value: text.slice(matchEnd) });
          }

          parent.children.splice(index, 1, ...newNodes);
        }
      });
    };
  },
);
