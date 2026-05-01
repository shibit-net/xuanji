/**
 * Remark 插件：解析子 agent 引用标记
 *
 * 将 [查看详情: <名称>] 转换为 subAgentReference 节点
 * 将 📎 [名称]："引用原文" 转换为 citationReference 节点
 */

import { visit } from 'unist-util-visit';

export interface SubAgentReferenceNode {
  type: 'subAgentReference';
  data: {
    hName: 'sub-agent-reference';
    hProperties: {
      agentName: string;
    };
  };
  children: [];
}

export interface CitationReferenceNode {
  type: 'citationReference';
  data: {
    hName: 'citation-reference';
    hProperties: {
      agentName: string;
      quotedText: string;
    };
  };
  children: [];
}

// 📎 [名称]："引用原文"  或  📎 [名称]:"引用原文"  或  📎 [名称]："引用原文"
// 支持：中文/英文冒号、直引号/弯引号、有无空格
const CITATION_REGEX = /\u{1F4CE}\s*\[([^\]]+)\]\s*[：:]\s*["\u201C\u2018\u300C](.+?)["\u201D\u2019\u300D]/u;

export function remarkSubAgentReference() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
      if (!parent || index === undefined) return;

      const text: string = node.value;

      // 先尝试匹配引用语法 📎 [Name]："quote"（支持多种引号）
      const citationMatch = CITATION_REGEX.exec(text);
      if (citationMatch) {
        const agentName = citationMatch[1].trim();
        const quotedText = citationMatch[2].trim();
        console.log('[remarkSubAgentReference] ✅ 解析到引用:', { agentName, quotedText: quotedText.substring(0, 50) });
        const matchStart = citationMatch.index;
        const matchEnd = matchStart + citationMatch[0].length;

        const newNodes: any[] = [];

        if (matchStart > 0) {
          newNodes.push({ type: 'text', value: text.slice(0, matchStart) });
        }

        newNodes.push({
          type: 'citationReference',
          data: {
            hName: 'citation-reference',
            hProperties: { agentName, quotedText },
          },
          children: [],
        });

        if (matchEnd < text.length) {
          newNodes.push({ type: 'text', value: text.slice(matchEnd) });
        }

        parent.children.splice(index, 1, ...newNodes);
        return;
      }

      // 再匹配引用标记：[查看详情: <名称>]
      const match = /\[查看详情:\s*(.+?)\]/.exec(text);
      if (!match) return;

      const agentName = match[1].trim();
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;

      const newNodes: any[] = [];

      if (matchStart > 0) {
        newNodes.push({ type: 'text', value: text.slice(0, matchStart) });
      }

      newNodes.push({
        type: 'subAgentReference',
        data: {
          hName: 'sub-agent-reference',
          hProperties: { agentName },
        },
        children: [],
      });

      if (matchEnd < text.length) {
        newNodes.push({ type: 'text', value: text.slice(matchEnd) });
      }

      parent.children.splice(index, 1, ...newNodes);
    });
  };
}
