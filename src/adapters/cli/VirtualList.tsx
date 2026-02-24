// ============================================================
// M1 终端 UI — 虚拟滚动列表
// ============================================================

import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';

export interface VirtualListProps {
  items: string[]; // 所有行
  maxHeight?: number; // 最大显示高度（行数），默认 50
  color?: string;
}

/**
 * VirtualList — 虚拟滚动列表组件
 * 只渲染可见区域的内容，提升大量数据时的性能
 */
export function VirtualList({ items, maxHeight = 50, color }: VirtualListProps) {
  const [scrollOffset, setScrollOffset] = useState(0);

  // 计算可见范围
  const visibleItems = useMemo(() => {
    const start = scrollOffset;
    const end = Math.min(scrollOffset + maxHeight, items.length);
    return items.slice(start, end);
  }, [items, scrollOffset, maxHeight]);

  const hasMore = items.length > maxHeight;
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + maxHeight < items.length;

  return (
    <Box flexDirection="column">
      {/* 渲染可见行 */}
      {visibleItems.map((line, i) => (
        <Text key={scrollOffset + i} color={color}>
          {line}
        </Text>
      ))}

      {/* 滚动提示 */}
      {hasMore && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            显示 {scrollOffset + 1}-{Math.min(scrollOffset + maxHeight, items.length)} / {items.length} 行
            {canScrollDown && ' | 还有更多内容...'}
          </Text>
        </Box>
      )}
    </Box>
  );
}
