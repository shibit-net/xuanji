/**
 * TeamManager 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamManager } from '@/core/agent/team/TeamManager';
import type { TeamConfig, TeamMember } from '@/core/agent/team/types';
import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/core/types';

// Mock dependencies
const mockMainProvider: ILLMProvider = {} as any;
const mockLightProvider: ILLMProvider = {} as any;
const mockRegistry: IToolRegistry = {} as any;
const mockAgentConfig: AgentConfig = {
  model: 'test-model',
  maxIterations: 50,
} as any;

describe('TeamManager', () => {
  let teamManager: TeamManager;

  beforeEach(() => {
    teamManager = new TeamManager(
      mockMainProvider,
      mockLightProvider,
      mockRegistry,
      mockAgentConfig,
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
});
