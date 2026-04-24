/**
 * Stats display component - Ink React component for formatted output
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DailyStats } from '../../../types/stats.js';

interface StatsDisplayProps {
  stats: DailyStats[];
  title?: string;
}

export const StatsDisplay: React.FC<StatsDisplayProps> = ({ stats, title = 'Token Usage Stats' }) => {
  if (stats.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="yellow">No usage data found for the selected period.</Text>
      </Box>
    );
  }

  const totalTokens = stats.reduce((sum, s) => sum + s.totalTokens, 0);

  // Aggregate top tools across all days
  const toolMap = new Map<string, { count: number; tokens: number }>();
  for (const day of stats) {
    for (const tool of day.toolUsage) {
      const existing = toolMap.get(tool.tool) || { count: 0, tokens: 0 };
      toolMap.set(tool.tool, {
        count: existing.count + tool.count,
        tokens: existing.tokens + tool.tokens,
      });
    }
  }

  const topTools = Array.from(toolMap.entries())
    .map(([tool, data]) => ({ tool, ...data }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold color="cyan">{title}</Text>
      <Text dimColor>─────────────────────────────────────</Text>
      
      <Box flexDirection="column" paddingY={1}>
        <Text>
          <Text color="green">Total Tokens:</Text> {totalTokens.toLocaleString()}
        </Text>
        {stats.length > 1 && (
          <Text>
            <Text color="green">Period:</Text> {stats[0].date} to {stats[stats.length - 1].date}
          </Text>
        )}
      </Box>

      {topTools.length > 0 && (
        <>
          <Text bold color="cyan">Top Tools Used</Text>
          <Box flexDirection="column" paddingLeft={2}>
            {topTools.map((tool, index) => (
              <Box key={tool.tool} flexDirection="row" gap={1}>
                <Text color="yellow">{index + 1}.</Text>
                <Text>{tool.tool}</Text>
                <Text dimColor>
                  ({tool.count}x, {tool.tokens.toLocaleString()} tokens)
                </Text>
                <Text>{renderBar(tool.tokens, topTools[0].tokens)}</Text>
              </Box>
            ))}
          </Box>
        </>
      )}

      {stats.length > 1 && (
        <>
          <Box paddingTop={1}>
            <Text bold color="cyan">Daily Breakdown</Text>
          </Box>
          <Box flexDirection="column" paddingLeft={2}>
            {stats.slice(-7).map(day => (
              <Text key={day.date}>
                <Text color="blue">{day.date}</Text>
                <Text dimColor> → </Text>
                <Text>{day.totalTokens.toLocaleString()} tokens</Text>
              </Text>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};

function renderBar(value: number, max: number, width: number = 20): string {
  const filled = Math.round((value / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
