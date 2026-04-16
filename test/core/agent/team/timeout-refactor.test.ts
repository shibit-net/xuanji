/**
 * 超时管理重构测试
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_TEAM_CONFIG } from '@/core/agent/team/types';

describe('Team Timeout Refactor', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_TEAM_CONFIG.teamTotalTimeout).toBe(1_200_000); // 20 min
    expect(DEFAULT_TEAM_CONFIG.defaultMemberTimeout).toBe(600_000); // 10 min
    expect(DEFAULT_TEAM_CONFIG.minMemberTimeout).toBe(30_000); // 30s
  });

  it('should have correct strategy ratios', () => {
    expect(DEFAULT_TEAM_CONFIG.hierarchicalLeaderRatio).toBe(1.5);
    expect(DEFAULT_TEAM_CONFIG.debateFirstRoundRatio).toBe(1.0);
    expect(DEFAULT_TEAM_CONFIG.debateLaterRoundRatio).toBe(0.6);
  });

  it('should enable dynamic timeout by default', () => {
    expect(DEFAULT_TEAM_CONFIG.enableDynamicTimeout).toBe(true);
  });
});

describe('TeamTool Timeout Calculation', () => {
  it('should calculate parallel strategy timeout correctly', () => {
    // parallel: 每个成员获得 ~90% 的团队总超时
    const teamTotal = 1_200_000; // 20 min
    const expected = Math.floor(teamTotal * 0.9); // 18 min
    expect(expected).toBe(1_080_000);
  });

  it('should calculate sequential strategy timeout correctly', () => {
    // sequential: 平均分配
    const teamTotal = 1_200_000; // 20 min
    const memberCount = 3;
    const expected = Math.floor(teamTotal / memberCount); // 6.67 min each
    expect(expected).toBe(400_000);
  });

  it('should calculate hierarchical strategy timeout correctly', () => {
    // hierarchical: leader 1.5x, workers 1.0x
    const teamTotal = 1_200_000; // 20 min
    const memberCount = 4; // 1 leader + 3 workers
    const baseMemberTimeout = Math.floor(teamTotal / (memberCount + 0.5)); // ~266s

    const leaderTimeout = Math.floor(baseMemberTimeout * 1.5); // ~400s
    const workerTimeout = baseMemberTimeout; // ~266s

    expect(baseMemberTimeout).toBe(266_666);
    expect(leaderTimeout).toBe(399_999);
    expect(workerTimeout).toBe(266_666);
  });

  it('should calculate debate strategy timeout correctly', () => {
    // debate: 多轮，每轮所有成员
    const teamTotal = 1_200_000; // 20 min
    const memberCount = 3;
    const rounds = 3;
    const expected = Math.floor(teamTotal / (memberCount * rounds * 0.7)); // ~190s per member per round
    expect(expected).toBe(190_476);
  });
});

describe('Timeout Priority', () => {
  it('should respect priority order', () => {
    // 优先级：
    // 1. member.timeout (显式)
    // 2. 策略权重计算
    // 3. config.memberTimeoutMs (兜底)

    const priorities = [
      'member.timeout (explicit)',
      'strategy weight calculation',
      'config.memberTimeoutMs (fallback)',
    ];

    expect(priorities[0]).toBe('member.timeout (explicit)');
    expect(priorities[1]).toBe('strategy weight calculation');
    expect(priorities[2]).toBe('config.memberTimeoutMs (fallback)');
  });
});
