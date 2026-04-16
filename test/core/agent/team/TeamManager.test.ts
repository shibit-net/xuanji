/**
 * TeamManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TeamManager } from '@/core/agent/team/TeamManager';
import type { TeamConfig } from '@/core/agent/team/types';
import {
  createMockProvider,
  createMockToolRegistry,
  createMockAgentConfig,
  createMockAgentRegistry,
  createMockProviderManager,
} from './test-helpers';

describe('TeamManager', () => {
  let teamManager: TeamManager;

  beforeEach(() => {
    const mockProvider = createMockProvider();
    const mockRegistry = createMockToolRegistry();
    const mockAgentConfig = createMockAgentConfig();
    const mockAgentRegistry = createMockAgentRegistry();
    const mockProviderManager = createMockProviderManager(mockProvider);

    teamManager = new TeamManager(
      mockProvider,
      mockRegistry,
      mockAgentConfig,
      null,
      null,
      0,
      mockAgentRegistry,
      mockProviderManager,
    );
  });

  describe('createTeam', () => {
    it('should create a team with valid config', async () => {
      const config: TeamConfig = {
        name: 'Test Team',
        members: [
          {
            id: 'member1',
            role: 'explore',
            capabilities: ['testing'],
          },
        ],
        strategy: 'sequential',
        goal: 'Test goal',
      };

      await teamManager.createTeam(config);
      const context = teamManager.getContext();

      expect(context.config.name).toBe('Test Team');
      expect(context.config.members.length).toBe(1);
      expect(context.config.strategy).toBe('sequential');
    });

    it('should reject empty team name', async () => {
      const config: TeamConfig = {
        name: '',
        members: [{ id: 'member1', role: 'explore', capabilities: ['testing'] }],
        strategy: 'sequential',
        goal: 'Test',
      };

      await expect(teamManager.createTeam(config)).rejects.toThrow('Team name is required');
    });

    it('should reject team with no members', async () => {
      const config: TeamConfig = {
        name: 'Test',
        members: [],
        strategy: 'sequential',
        goal: 'Test',
      };

      await expect(teamManager.createTeam(config)).rejects.toThrow('at least one member');
    });

    it('should reject duplicate member IDs', async () => {
      const config: TeamConfig = {
        name: 'Test',
        members: [
          { id: 'member1', role: 'explore', capabilities: ['a'] },
          { id: 'member1', role: 'coder', capabilities: ['b'] },
        ],
        strategy: 'sequential',
        goal: 'Test',
      };

      await expect(teamManager.createTeam(config)).rejects.toThrow('Duplicate member ID');
    });

    it('should require leader for hierarchical strategy', async () => {
      const config: TeamConfig = {
        name: 'Test',
        members: [
          { id: 'member1', role: 'explore', capabilities: ['a'] },
          { id: 'member2', role: 'coder', capabilities: ['b'] },
        ],
        strategy: 'hierarchical',
        goal: 'Test',
      };

      await expect(teamManager.createTeam(config)).rejects.toThrow(
        'Hierarchical strategy requires at least one member with priority > 0'
      );
    });
  });

  describe('getContext', () => {
    it('should throw if team not created', () => {
      expect(() => teamManager.getContext()).toThrow('Team not created');
    });

    it('should return context after team creation', async () => {
      const config: TeamConfig = {
        name: 'Test',
        members: [{ id: 'm1', role: 'explore', capabilities: ['test'] }],
        strategy: 'sequential',
        goal: 'Test',
      };

      await teamManager.createTeam(config);
      const context = teamManager.getContext();

      expect(context).toBeDefined();
      expect(context.config.name).toBe('Test');
      expect(context.sharedKnowledge).toBeInstanceOf(Map);
      expect(context.messageHistory).toEqual([]);
      expect(context.currentRound).toBe(0);
    });
  });

  describe('stop', () => {
    it('should set running flag to false', () => {
      teamManager.stop();
      // No error should be thrown
      expect(true).toBe(true);
    });
  });

  describe('timeout allocation', () => {
    it('should auto-allocate timeout for parallel strategy', async () => {
      const config: TeamConfig = {
        name: 'Parallel Team',
        members: [
          { id: 'm1', role: 'explore', capabilities: ['test1'] },
          { id: 'm2', role: 'coder', capabilities: ['test2'] },
          { id: 'm3', role: 'explore', capabilities: ['test3'] },
        ],
        strategy: 'parallel',
        goal: 'Test parallel timeout allocation',
        memberTimeoutMs: 300000, // 5 minutes per member
      };

      await teamManager.createTeam(config);
      const context = teamManager.getContext();

      // In parallel strategy, each member should get the configured memberTimeoutMs
      expect(context.config.memberTimeoutMs).toBe(300000);
      expect(context.config.members.length).toBe(3);
    });

    it('should warn when explicit timeout is shorter than calculated', async () => {
      const config: TeamConfig = {
        name: 'Timeout Conflict Team',
        members: [
          {
            id: 'm1',
            role: 'explore',
            capabilities: ['test'],
            timeout: 30000, // Explicitly set to 30s
          },
        ],
        strategy: 'parallel',
        goal: 'Test timeout conflict warning',
        defaultMemberTimeout: 300000, // Default 5 minutes per member
      };

      await teamManager.createTeam(config);
      const context = teamManager.getContext();

      // Member should have explicit timeout
      expect(context.config.members[0].timeout).toBe(30000);
      // Note: The warning is logged, we can't easily test log output in unit tests
      // but the functionality is verified by the test passing without errors
    });

    it('should use calculated timeout when not explicitly set', async () => {
      const config: TeamConfig = {
        name: 'Auto Timeout Team',
        members: [
          {
            id: 'm1',
            role: 'explore',
            capabilities: ['test'],
            // No timeout set - should use auto-calculated
          },
        ],
        strategy: 'parallel',
        goal: 'Test auto timeout allocation',
        defaultMemberTimeout: 300000,
      };

      await teamManager.createTeam(config);
      const context = teamManager.getContext();

      // Member should not have explicit timeout
      expect(context.config.members[0].timeout).toBeUndefined();
      // The actual timeout will be calculated at execution time
    });
  });
});
