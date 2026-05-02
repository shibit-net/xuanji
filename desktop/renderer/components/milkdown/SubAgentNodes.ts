// ============================================================
// Milkdown 自定义节点: 子 Agent 引用 / 引用引用
// ============================================================
//
// 这些节点由 remarkSubAgentReference $remark 插件在解析阶段生成，
// 将被渲染为带 data-* 属性的 span 元素，供 post-render
// React portal 注入可交互组件（SubAgentBlock / CitationChip）。
// ============================================================

import { $node } from '@milkdown/utils';
import type { Ctx } from '@milkdown/ctx';

// ─── subAgentReference ─────────────────────────────────────

export const subAgentReferenceNode = $node(
  'subAgentReference',
  (_ctx: Ctx) => ({
    atom: true,
    group: 'inline',
    inline: true,
    attrs: {
      name: {
        default: '',
        validate: 'string',
      },
    },
    toDOM: (node) => {
      return [
        'span',
        {
          'data-name': node.attrs.name,
          'data-type': 'subagent-ref',
          class: 'subagent-ref',
        },
        '', // 空内容，因为 React portal 会替换这个 span
      ];
    },
    parseDOM: [
      {
        tag: 'span[data-type="subagent-ref"]',
        getAttrs: (dom) => {
          if (typeof dom === 'string') return {};
          const el = dom as HTMLElement;
          return { name: el.getAttribute('data-name') ?? '' };
        },
      },
    ],
    parseMarkdown: {
      match: (node: any) => node.type === 'subAgentReference',
      runner: (state: any, node: any, proseType: any) => {
        state.addNode(proseType, {
          name: (node.data?.hProperties?.['data-name'] ?? '') as string,
        });
      },
    },
    toMarkdown: {
      match: (node: any) => node.type.name === 'subAgentReference',
      runner: (state: any, node: any) => {
        const name = node.attrs.name;
        state.addNode('text', undefined, `📎 [${name}]`);
      },
    },
  }),
);

// ─── citationReference ─────────────────────────────────────

export const citationReferenceNode = $node(
  'citationReference',
  (_ctx: Ctx) => ({
    atom: true,
    group: 'inline',
    inline: true,
    attrs: {
      name: {
        default: '',
        validate: 'string',
      },
      quote: {
        default: '',
        validate: 'string',
      },
    },
    toDOM: (node) => {
      return [
        'span',
        {
          'data-name': node.attrs.name,
          'data-quote': node.attrs.quote,
          'data-type': 'citation-ref',
          class: 'citation-ref',
        },
        '',
      ];
    },
    parseDOM: [
      {
        tag: 'span[data-type="citation-ref"]',
        getAttrs: (dom) => {
          if (typeof dom === 'string') return {};
          const el = dom as HTMLElement;
          return {
            name: el.getAttribute('data-name') ?? '',
            quote: el.getAttribute('data-quote') ?? '',
          };
        },
      },
    ],
    parseMarkdown: {
      match: (node: any) => node.type === 'citationReference',
      runner: (state: any, node: any, proseType: any) => {
        state.addNode(proseType, {
          name: (node.data?.hProperties?.['data-name'] ?? '') as string,
          quote: (node.data?.hProperties?.['data-quote'] ?? '') as string,
        });
      },
    },
    toMarkdown: {
      match: (node: any) => node.type.name === 'citationReference',
      runner: (state: any, node: any) => {
        const name = node.attrs.name;
        const quote = node.attrs.quote;
        state.addNode('text', undefined, `📎 [${name}]："${quote}"`);
      },
    },
  }),
);
