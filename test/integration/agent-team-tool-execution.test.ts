import { describe, it, expect, beforeEach } from 'vitest';
import { TeamTool } from '@/core/tools/TeamTool';
import {
  createIntelligentMockProvider,
  createMockToolRegistry,
  createMockAgentConfig,
  createMockAgentRegistry,
  createMockProviderManager,
} from '../helpers/mock-factory';

describe('Integration: TeamTool agent_team execution', () => {
  let teamTool: TeamTool;

  beforeEach(() => {
    const provider = createIntelligentMockProvider({
      delay: [1, 4],
      responses: {
        // sequential
        'cap_seq_arch': 'ARCH_REVIEW_DONE',
        'cap_seq_security': 'SECURITY_REVIEW_DONE',
        'cap_seq_perf': 'PERFORMANCE_REVIEW_DONE',

        // parallel
        'cap_parallel_docs': 'DOC_RESEARCH_RESULT',
        'cap_parallel_code': 'CODE_RESEARCH_RESULT',
        'cap_parallel_community': 'COMMUNITY_RESEARCH_RESULT',

        // hierarchical
        'cap_hier_lead': 'LEADER_PLAN_READY',
        'cap_hier_backend': 'BACKEND_WORK_DONE',
        'cap_hier_frontend': 'FRONTEND_WORK_DONE',

        // debate
        'cap_debate_pro': 'I agree, consensus: choose option A for maintainability.',
        'cap_debate_con': 'I agree, consensus: option A has lower migration risk.',

        // pipeline
        'cap_pipe_extract': 'PIPE_OUTPUT_EXTRACT',
        'cap_pipe_clean': 'PIPE_OUTPUT_CLEAN',
        'cap_pipe_analyze': 'PIPE_OUTPUT_ANALYZE',
        'cap_pipe_report': 'PIPE_OUTPUT_REPORT',
      },
      defaultResponse: 'DEFAULT_TEAM_RESULT',
    });

    teamTool = new TeamTool();
    teamTool.setDependencies({
      provider,
      registry: createMockToolRegistry(),
      agentConfig: createMockAgentConfig(),
      agentRegistry: createMockAgentRegistry(),
      providerManager: createMockProviderManager(provider),
    });
  });

  it('should execute sequential strategy via agent_team', async () => {
    const result = await teamTool.execute({
      team_name: 'Sequential Team',
      goal: 'Review implementation quality',
      strategy: 'sequential',
      members: [
        { id: 'architect', role: 'plan', capabilities: ['cap_seq_arch'] },
        { id: 'security', role: 'explore', capabilities: ['cap_seq_security'] },
        { id: 'performance', role: 'explore', capabilities: ['cap_seq_perf'] },
      ],
      timeout: 15000,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Strategy: sequential');
    expect(result.content).toContain('PERFORMANCE_REVIEW_DONE');
    expect((result.metadata as any)?.teamExecution).toBe(true);
    expect((result.metadata as any)?.strategy).toBe('sequential');
  });

  it('should execute parallel strategy via agent_team', async () => {
    const result = await teamTool.execute({
      team_name: 'Parallel Team',
      goal: 'Research from multiple channels',
      strategy: 'parallel',
      members: [
        { id: 'docs', role: 'explore', capabilities: ['cap_parallel_docs'] },
        { id: 'code', role: 'explore', capabilities: ['cap_parallel_code'] },
        { id: 'community', role: 'explore', capabilities: ['cap_parallel_community'] },
      ],
      timeout: 15000,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Strategy: parallel');
    expect(result.content).toContain('[docs]');
    expect(result.content).toContain('[code]');
    expect(result.content).toContain('[community]');
    expect(result.content).toContain('---');
  });

  it('should execute hierarchical strategy via agent_team', async () => {
    const result = await teamTool.execute({
      team_name: 'Hierarchical Team',
      goal: 'Implement auth module',
      strategy: 'hierarchical',
      members: [
        { id: 'tech-lead', role: 'plan', capabilities: ['cap_hier_lead'], priority: 10 },
        { id: 'backend', role: 'coder', capabilities: ['cap_hier_backend'], priority: 5 },
        { id: 'frontend', role: 'coder', capabilities: ['cap_hier_frontend'], priority: 4 },
      ],
      timeout: 15000,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Strategy: hierarchical');
    expect(result.content).toContain('[Leader Analysis]');
    expect(result.content).toContain('LEADER_PLAN_READY');
    expect(result.content).toContain('[Team Execution]');
  });

  it('should execute debate strategy via agent_team', async () => {
    const result = await teamTool.execute({
      team_name: 'Debate Team',
      goal: 'Decide architecture direction',
      strategy: 'debate',
      members: [
        { id: 'proponent', role: 'plan', capabilities: ['cap_debate_pro'] },
        { id: 'opponent', role: 'plan', capabilities: ['cap_debate_con'] },
      ],
      max_rounds: 3,
      timeout: 15000,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Strategy: debate');
    expect(result.content).toContain('[Debate Summary');
    expect(result.content.toLowerCase()).toContain('debate');
    expect(((result.metadata as any)?.rounds ?? 0)).toBeGreaterThan(0);
    expect(((result.metadata as any)?.rounds ?? 0)).toBeLessThanOrEqual(3);
  });

  it('should execute pipeline strategy via agent_team', async () => {
    const result = await teamTool.execute({
      team_name: 'Pipeline Team',
      goal: 'Process raw findings',
      strategy: 'pipeline',
      members: [
        { id: 'extractor', role: 'explore', capabilities: ['cap_pipe_extract'], priority: 4 },
        { id: 'cleaner', role: 'coder', capabilities: ['cap_pipe_clean'], priority: 3 },
        { id: 'analyzer', role: 'coder', capabilities: ['cap_pipe_analyze'], priority: 2 },
        { id: 'reporter', role: 'coder', capabilities: ['cap_pipe_report'], priority: 1 },
      ],
      timeout: 15000,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Strategy: pipeline');
    expect(result.content).toContain('PIPE_OUTPUT_REPORT');
    expect((result.metadata as any)?.memberCount).toBe(4);
    expect((result.metadata as any)?.strategy).toBe('pipeline');
  });
});
