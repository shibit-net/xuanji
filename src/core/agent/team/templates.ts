/**
 * 团队模板 — 预定义的常用团队配置
 */

import type { TeamMember } from './types';
import type { AgentRoleType } from '../SubAgentContext';

/**
 * 团队模板定义
 */
export interface TeamTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 推荐的协作策略 */
  recommendedStrategy: 'sequential' | 'parallel' | 'hierarchical' | 'debate' | 'pipeline';
  /** 团队成员定义（函数，支持动态配置） */
  members: (context?: { target?: string }) => TeamMember[];
  /** 适用场景 */
  useCases: string[];
}

/**
 * 预定义的团队模板库
 */
export const TEAM_TEMPLATES: Record<string, TeamTemplate> = {
  /**
   * 代码审查团队（串行）
   */
  'code-review': {
    id: 'code-review',
    name: 'Code Review Team',
    description: 'Sequential code review from architecture, security, and performance perspectives',
    recommendedStrategy: 'sequential',
    members: () => [
      {
        id: 'architect',
        agentId: 'plan',
        name: 'Architecture Reviewer',
        capabilities: ['architecture analysis', 'design patterns', 'SOLID principles', 'code structure'],
        priority: 3,
        systemPrompt: 'Evaluate the architecture and design. Check if code follows best practices, design patterns, and SOLID principles. Identify structural issues and suggest improvements.',
      },
      {
        id: 'security',
        agentId: 'explore',
        name: 'Security Reviewer',
        capabilities: ['security analysis', 'vulnerability detection', 'input validation', 'authentication'],
        priority: 2,
        systemPrompt: 'Analyze security vulnerabilities: SQL injection, XSS, CSRF, improper error handling, data leakage. Check input validation, authentication, and authorization logic.',
      },
      {
        id: 'performance',
        agentId: 'explore',
        name: 'Performance Reviewer',
        capabilities: ['performance analysis', 'memory optimization', 'algorithm efficiency', 'profiling'],
        priority: 1,
        systemPrompt: 'Identify performance bottlenecks: inefficient algorithms, memory leaks, unnecessary computations, N+1 queries. Suggest optimizations for speed and resource usage.',
      },
    ],
    useCases: [
      'Review code changes before merging',
      'Analyze pull requests from multiple angles',
      'Comprehensive code quality assessment',
    ],
  },

  /**
   * 研究团队（并行）
   */
  'research': {
    id: 'research',
    name: 'Multi-Source Research Team',
    description: 'Parallel research from documentation, code examples, and community sources',
    recommendedStrategy: 'parallel',
    members: () => [
      {
        id: 'docs-researcher',
        agentId: 'explore',
        name: 'Documentation Researcher',
        capabilities: ['official docs', 'API references', 'technical specs', 'best practices'],
        systemPrompt: 'Search official documentation, API references, and technical specifications. Focus on authoritative sources and best practices.',
      },
      {
        id: 'code-researcher',
        agentId: 'explore',
        name: 'Code Example Researcher',
        capabilities: ['code search', 'GitHub exploration', 'open source projects', 'implementation patterns'],
        systemPrompt: 'Find real-world code examples, open source implementations, and usage patterns. Look for production-ready solutions.',
      },
      {
        id: 'community-researcher',
        agentId: 'explore',
        name: 'Community Researcher',
        capabilities: ['blog posts', 'Stack Overflow', 'community discussions', 'case studies'],
        systemPrompt: 'Search blog posts, community discussions, Stack Overflow, and case studies. Focus on practical experiences and lessons learned.',
      },
    ],
    useCases: [
      'Research new technology or framework',
      'Gather information from multiple sources',
      'Compare different approaches or tools',
    ],
  },

  /**
   * 架构设计团队（辩论）
   */
  'architecture-debate': {
    id: 'architecture-debate',
    name: 'Architecture Design Debate',
    description: 'Debate-based architecture design with multiple perspectives',
    recommendedStrategy: 'debate',
    members: () => [
      {
        id: 'simplicity-advocate',
        agentId: 'plan',
        name: 'Simplicity Advocate',
        capabilities: ['simple solutions', 'maintainability', 'YAGNI', 'readability'],
        systemPrompt: 'Advocate for the simplest solution that works. Challenge over-engineering. Prioritize maintainability, readability, and the YAGNI principle.',
      },
      {
        id: 'scalability-expert',
        agentId: 'plan',
        name: 'Scalability Expert',
        capabilities: ['scalability', 'distributed systems', 'high availability', 'performance at scale'],
        systemPrompt: 'Ensure the design can scale to high load. Consider distributed scenarios, fault tolerance, horizontal scaling, and performance under stress.',
      },
      {
        id: 'pragmatist',
        agentId: 'plan',
        name: 'Pragmatic Engineer',
        capabilities: ['practical solutions', 'trade-off analysis', 'deadline awareness', 'MVP thinking'],
        systemPrompt: 'Balance idealism with reality. Consider time constraints, team skill level, and business priorities. Identify practical trade-offs and recommend the best compromise.',
      },
    ],
    useCases: [
      'Design system architecture with trade-off analysis',
      'Evaluate multiple architectural approaches',
      'Make critical technical decisions through discussion',
    ],
  },

  /**
   * 数据处理流水线（管道）
   */
  'data-pipeline': {
    id: 'data-pipeline',
    name: 'Data Processing Pipeline',
    description: 'Multi-stage data processing from extraction to reporting',
    recommendedStrategy: 'pipeline',
    members: () => [
      {
        id: 'extractor',
        agentId: 'explore',
        name: 'Data Extractor',
        capabilities: ['data extraction', 'API calls', 'file parsing', 'web scraping'],
        priority: 4,
        systemPrompt: 'Extract raw data from the source. Use appropriate tools (read_file, web_search, grep) to gather all required information. Output structured data.',
      },
      {
        id: 'cleaner',
        agentId: 'general-purpose',
        name: 'Data Cleaner',
        capabilities: ['data cleaning', 'deduplication', 'validation', 'normalization'],
        priority: 3,
        systemPrompt: 'Clean and normalize the input data. Remove duplicates, fix formatting issues, validate data integrity, and standardize formats.',
      },
      {
        id: 'analyzer',
        agentId: 'general-purpose',
        name: 'Data Analyzer',
        capabilities: ['data analysis', 'pattern recognition', 'categorization', 'statistical analysis'],
        priority: 2,
        systemPrompt: 'Analyze the cleaned data. Identify patterns, trends, categories, and insights. Perform statistical analysis and summarize key findings.',
      },
      {
        id: 'reporter',
        agentId: 'general-purpose',
        name: 'Report Generator',
        capabilities: ['report generation', 'visualization', 'summarization', 'documentation'],
        priority: 1,
        systemPrompt: 'Generate a comprehensive report based on the analysis. Create clear summaries, actionable insights, and recommendations. Format for readability.',
      },
    ],
    useCases: [
      'Process and analyze log files',
      'Extract insights from large datasets',
      'Generate reports from raw data',
    ],
  },

  /**
   * 特性开发团队（层级）
   */
  'feature-development': {
    id: 'feature-development',
    name: 'Feature Development Team',
    description: 'Hierarchical team with tech lead coordinating implementation',
    recommendedStrategy: 'hierarchical',
    members: () => [
      {
        id: 'tech-lead',
        agentId: 'plan',
        name: 'Tech Lead',
        capabilities: ['system design', 'technical leadership', 'architecture decisions', 'task breakdown'],
        priority: 10,
        systemPrompt: 'As tech lead, analyze requirements, design the architecture, break down tasks, identify technical challenges, and provide implementation guidance for the team.',
      },
      {
        id: 'backend-dev',
        agentId: 'coder',
        name: 'Backend Developer',
        capabilities: ['backend development', 'API design', 'database design', 'business logic'],
        priority: 5,
        systemPrompt: 'Based on tech lead\'s design, implement backend logic: database schema, API endpoints, business logic, and data processing.',
      },
      {
        id: 'frontend-dev',
        agentId: 'coder',
        name: 'Frontend Developer',
        capabilities: ['frontend development', 'UI implementation', 'state management', 'user interaction'],
        priority: 5,
        systemPrompt: 'Based on tech lead\'s design, implement frontend: UI components, state management, API integration, and user interactions.',
      },
      {
        id: 'qa',
        agentId: 'coder',
        name: 'QA Engineer',
        capabilities: ['testing', 'test automation', 'quality assurance', 'edge cases'],
        priority: 3,
        systemPrompt: 'Design test strategy and write test cases based on the implementation. Ensure code coverage, edge case handling, and quality standards.',
      },
    ],
    useCases: [
      'Implement new features with coordination',
      'Develop complex functionality requiring multiple roles',
      'Full-stack development with testing',
    ],
  },
};

/**
 * 根据模板 ID 获取团队配置
 */
export function getTeamTemplate(templateId: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES[templateId];
}

/**
 * 获取所有可用的模板 ID
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(TEAM_TEMPLATES);
}

/**
 * 根据用户描述推荐模板
 */
export function recommendTemplate(description: string): string | null {
  const lowerDesc = description.toLowerCase();

  // 代码审查相关
  if (lowerDesc.includes('review') || lowerDesc.includes('审查') || 
      lowerDesc.includes('check code') || lowerDesc.includes('quality')) {
    return 'code-review';
  }

  // 研究相关
  if (lowerDesc.includes('research') || lowerDesc.includes('搜索') || 
      lowerDesc.includes('调研') || lowerDesc.includes('gather')) {
    return 'research';
  }

  // 架构设计相关
  if ((lowerDesc.includes('design') || lowerDesc.includes('architect') || lowerDesc.includes('设计')) &&
      (lowerDesc.includes('debate') || lowerDesc.includes('discuss') || lowerDesc.includes('evaluate') || lowerDesc.includes('辩论'))) {
    return 'architecture-debate';
  }

  // 数据处理相关
  if (lowerDesc.includes('process') || lowerDesc.includes('extract') || 
      lowerDesc.includes('analyze') || lowerDesc.includes('pipeline') || 
      lowerDesc.includes('数据') || lowerDesc.includes('处理')) {
    return 'data-pipeline';
  }

  // 特性开发相关
  if (lowerDesc.includes('implement') || lowerDesc.includes('develop') || 
      lowerDesc.includes('feature') || lowerDesc.includes('功能开发')) {
    return 'feature-development';
  }

  return null;
}
