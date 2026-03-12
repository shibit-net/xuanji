// ============================================================
// Help 面板 — 动态命令帮助系统
// ============================================================
//
// 从 SlashCommandRegistry 动态生成帮助文档
// 支持分组、搜索、详细信息展示

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from './Theme';
import type { SlashCommand } from './SlashCommands';

export interface HelpPanelProps {
  commands: SlashCommand[];
  onClose: () => void;
}

/**
 * HelpPanel — 交互式帮助面板
 * 
 * 特性:
 * - 按分组显示命令
 * - ↑↓ 导航,Enter 查看详情
 * - / 搜索过滤
 * - Q/Esc 关闭
 */
export function HelpPanel({ commands, onClose }: HelpPanelProps) {
  const theme = getTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [detailMode, setDetailMode] = useState(false);

  // 过滤命令
  const visibleCommands = commands
    .filter(cmd => !cmd.hidden)
    .filter(cmd => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        cmd.name.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query) ||
        cmd.group?.toLowerCase().includes(query)
      );
    });

  // 按分组整理
  const groupedCommands: Map<string, SlashCommand[]> = new Map();
  for (const cmd of visibleCommands) {
    const group = cmd.group || '其他';
    if (!groupedCommands.has(group)) {
      groupedCommands.set(group, []);
    }
    groupedCommands.get(group)!.push(cmd);
  }

  // 排序分组（基础 > 会话 > 工具 > 其他）
  const groupOrder = ['基础', '会话', '工具', '设置', '其他'];
  const sortedGroups = Array.from(groupedCommands.entries()).sort((a, b) => {
    const aIdx = groupOrder.indexOf(a[0]);
    const bIdx = groupOrder.indexOf(b[0]);
    if (aIdx === -1 && bIdx === -1) return a[0].localeCompare(b[0]);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  // 当前选中的命令
  const selectedCommand = visibleCommands[selectedIndex];

  useInput((ch, key) => {
    // 搜索模式
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery('');
        return;
      }
      if (key.return) {
        setSearchMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery(q => q.slice(0, -1));
        return;
      }
      if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
        setSearchQuery(q => q + ch);
        setSelectedIndex(0); // 重置选择
        return;
      }
      return;
    }

    // 详情模式
    if (detailMode) {
      if (key.escape || ch === 'q' || ch === 'Q' || key.return) {
        setDetailMode(false);
        return;
      }
      return;
    }

    // 普通模式
    if (key.escape || ch === 'q' || ch === 'Q') {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(i => Math.min(visibleCommands.length - 1, i + 1));
      return;
    }

    if (key.return) {
      setDetailMode(true);
      return;
    }

    // / 进入搜索
    if (ch === '/') {
      setSearchMode(true);
      return;
    }
  });

  // 渲染详情视图
  if (detailMode && selectedCommand) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text color={theme.primary} bold>
            {selectedCommand.icon ? `${selectedCommand.icon} ` : ''}
            {selectedCommand.name}
          </Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray">描述:</Text>
          <Text>{selectedCommand.description}</Text>
        </Box>

        {selectedCommand.usage && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="gray">用法:</Text>
            <Text color="cyan">{selectedCommand.usage}</Text>
          </Box>
        )}

        {selectedCommand.aliases && selectedCommand.aliases.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="gray">别名:</Text>
            <Text>{selectedCommand.aliases.join(', ')}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color="gray" dimColor>Enter/Esc 返回列表</Text>
        </Box>
      </Box>
    );
  }

  // 渲染列表视图
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      {/* 标题 */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text color={theme.primary} bold>📖 命令帮助</Text>
        <Text color="gray" dimColor>
          {visibleCommands.length} 条命令
        </Text>
      </Box>

      {/* 搜索栏 */}
      <Box marginBottom={1}>
        {searchMode ? (
          <Box>
            <Text color={theme.primary}>🔍 搜索: </Text>
            <Text color="white">{searchQuery}</Text>
            <Text color={theme.primary}>█</Text>
          </Box>
        ) : (
          <Text color="gray" dimColor>
            ↑↓ 导航 · Enter 详情 · / 搜索 · Q/Esc 关闭
          </Text>
        )}
      </Box>

      {/* 命令列表 */}
      <Box flexDirection="column">
        {sortedGroups.map(([groupName, cmds]) => {
          let indexOffset = 0;
          for (const [gn, gcmds] of sortedGroups) {
            if (gn === groupName) break;
            indexOffset += gcmds.length;
          }

          return (
            <Box key={groupName} flexDirection="column" marginBottom={1}>
              {/* 分组标题 */}
              <Text color={theme.primary} bold dimColor>
                ── {groupName} ──
              </Text>

              {/* 命令列表 */}
              {cmds.map((cmd, idx) => {
                const globalIndex = indexOffset + idx;
                const isSelected = globalIndex === selectedIndex;

                return (
                  <Box key={cmd.name}>
                    <Text color={isSelected ? theme.primary : 'gray'}>
                      {isSelected ? '▶ ' : '  '}
                    </Text>
                    <Box width={12}>
                      <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                        {cmd.icon ? `${cmd.icon} ` : ''}
                        {cmd.name}
                      </Text>
                    </Box>
                    <Text color={isSelected ? 'white' : 'gray'}>
                      {cmd.description}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {/* 空状态 */}
      {visibleCommands.length === 0 && (
        <Box justifyContent="center" marginY={1}>
          <Text color="gray" dimColor>
            没有找到匹配的命令
          </Text>
        </Box>
      )}
    </Box>
  );
}
