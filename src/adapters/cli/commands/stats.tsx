/**
 * Stats command - display token usage statistics
 */

import React from 'react';
import { render } from 'ink';
import { TokenStatsCollector } from '../../../core/stats/index.js';
import { StatsDisplay } from '../components/StatsDisplay.js';
import type { DailyStats } from '../../../types/stats.js';

export interface StatsCommandOptions {
  today?: boolean;
  week?: boolean;
  month?: boolean;
  json?: boolean;
}

export async function statsCommand(options: StatsCommandOptions = {}): Promise<void> {
  const collector = new TokenStatsCollector();

  let stats: DailyStats[];
  let title: string;

  if (options.today) {
    const today = new Date();
    const dailyStats = await collector.getDailyStats(today);
    stats = dailyStats ? [dailyStats] : [];
    title = 'Today\'s Token Usage';
  } else if (options.week) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    stats = await collector.getRangeStats(startDate, endDate);
    title = 'Last 7 Days Token Usage';
  } else if (options.month) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    stats = await collector.getRangeStats(startDate, endDate);
    title = 'Last 30 Days Token Usage';
  } else {
    // Default: today
    const today = new Date();
    const dailyStats = await collector.getDailyStats(today);
    stats = dailyStats ? [dailyStats] : [];
    title = 'Today\'s Token Usage';
  }

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  render(<StatsDisplay stats={stats} title={title} />);
}
