/**
 * 全面测试 Xuanji Multi-Agent 功能
 * 
 * 测试范围：
 * 1. OrchestrateTool - Sequential/Parallel/Debate/Hierarchical/Pipeline 策略
 * 2. PipelineTool - 数据流水线
 * 3. QuickTeamTool - 所有预定义模板
 * 
 * 输出：详细的性能数据、执行结果、问题报告
 */

import { OrchestrateTool } from '@/core/tools/OrchestrateTool';
import { PipelineTool } from '@/core/tools/PipelineTool';
import { QuickTeamTool } from '@/core/tools/QuickTeamTool';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { AgentRegistry } from '@/core/agent/AgentRegistry';
import { loadConfig } from '@/core/config';
import { getToolRegistry } from '@/core/tools';

// ============================================================================
// 测试结果数据结构
// ============================================================================

interface TestResult {
  testName: string;
  tool: 'orchestrate' | 'pipeline' | 'quick_team';
  strategy?: string;
  template?: string;
  success: boolean;
  duration: number;
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
  error?: string;
  details?: any;
  startTime: Date;
  endTime: Date;
}

interface TestSuiteResult {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDuration: number;
  totalTokens: {
    input: number;
    output: number;
    total: number;
  };
  results: TestResult[];
  issues: string[];
}

// ============================================================================
// 测试工具类
// ============================================================================

class MultiAgentTester {
  private results: TestResult[] = [];
  private issues: string[] = [];
  private orchestrateTool!: OrchestrateTool;
  private pipelineTool!: PipelineTool;
  private quickTeamTool!: QuickTeamTool;
  private providerManager!: ProviderManager;
  private agentRegistry!: AgentRegistry;
  private registry: any;
  private agentConfig: any;

  async initialize() {
    console.log('🔧 Initializing test environment...\n');

    // 加载配置
    const config = await loadConfig();
    this.agentConfig = {
      provider: config.provider || 'anthropic',
      model: config.model || 'claude-3-7-sonnet-20250219',
    };

    // 初始化 Provider Manager
    this.providerManager = new ProviderManager(config);

    // 初始化 Agent Registry
    this.agentRegistry = new AgentRegistry();
    await this.agentRegistry.initialize();

    // 获取 Tool Registry
    this.registry = getToolRegistry();

    // 初始化工具
    this.orchestrateTool = new OrchestrateTool();
    this.pipelineTool = new PipelineTool();
    this.quickTeamTool = new QuickTeamTool();

    // 注入依赖
    this.orchestrateTool.setDependencies({
      providerManager: this.providerManager,
      agentRegistry: this.agentRegistry,
      registry: this.registry,
      agentConfig: this.agentConfig,
      depth: 0,
    });

    this.pipelineTool.setDependencies({
      providerManager: this.providerManager,
      agentRegistry: this.agentRegistry,
      registry: this.registry,
      agentConfig: this.agentConfig,
      depth: 0,
    });

    const mainProvider = this.providerManager.getProvider(this.agentConfig);
    const lightProvider = this.providerManager.getLightProvider();

    this.quickTeamTool.setDependencies({
      provider: mainProvider,
      lightProvider: lightProvider,
      registry: this.registry,
      agentConfig: this.agentConfig,
      depth: 0,
    });

    console.log('✅ Test environment initialized\n');
  }

  // --------------------------------------------------------------------------
  // 辅助方法
  // --------------------------------------------------------------------------

  private async runTest(
    testName: string,
    tool: 'orchestrate' | 'pipeline' | 'quick_team',
    input: any,
    strategy?: string,
    template?: string,
  ): Promise<TestResult> {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🧪 Running: ${testName}`);
    console.log(`${'='.repeat(80)}\n`);

    const startTime = new Date();
    const startMs = Date.now();

    try {
      let result;
      
      switch (tool) {
        case 'orchestrate':
          result = await this.orchestrateTool.execute(input);
          break;
        case 'pipeline':
          result = await this.pipelineTool.execute(input);
          break;
        case 'quick_team':
          result = await this.quickTeamTool.execute(input);
          break;
      }

      const endTime = new Date();
      const duration = Date.now() - startMs;

      const success = !result.isError;
      
      console.log(`\n${success ? '✅' : '❌'} Test ${success ? 'PASSED' : 'FAILED'}: ${testName}`);
      console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
      
      if (result.metadata?.totalTokens) {
        const tokens = result.metadata.totalTokens;
        console.log(`Tokens: ${tokens.input} in / ${tokens.output} out / ${tokens.input + tokens.output} total`);
      }

      const testResult: TestResult = {
        testName,
        tool,
        strategy,
        template,
        success,
        duration,
        startTime,
        endTime,
        details: result.metadata,
      };

      if (result.metadata?.totalTokens) {
        testResult.tokensUsed = {
          input: result.metadata.totalTokens.input,
          output: result.metadata.totalTokens.output,
          total: result.metadata.totalTokens.input + result.metadata.totalTokens.output,
        };
      }

      if (!success) {
        testResult.error = result.content;
        this.issues.push(`${testName}: ${result.content}`);
      }

      this.results.push(testResult);
      return testResult;

    } catch (error) {
      const endTime = new Date();
      const duration = Date.now() - startMs;
      const errorMsg = error instanceof Error ? error.message : String(error);

      console.log(`\n❌ Test FAILED with exception: ${testName}`);
      console.log(`Error: ${errorMsg}`);

      const testResult: TestResult = {
        testName,
        tool,
        strategy,
        template,
        success: false,
        duration,
        error: errorMsg,
        startTime,
        endTime,
      };

      this.results.push(testResult);
      this.issues.push(`${testName}: Exception - ${errorMsg}`);
      return testResult;
    }
  }

  // --------------------------------------------------------------------------
  // OrchestrateTool 测试
  // --------------------------------------------------------------------------

  async testOrchestrateSequential() {
    return this.runTest(
      'Orchestrate: Sequential Strategy (3-stage code review)',
      'orchestrate',
      {
        team_name: 'Code Review Team',
        goal: 'Review the OrchestrateTool.ts file for architecture quality, security issues, and performance optimizations',
        strategy: 'sequential',
        members: [
          {
            id: 'architect',
            role: 'explore',
            name: 'Architecture Reviewer',
            capabilities: ['architecture analysis', 'design patterns', 'code structure'],
            system_prompt: 'You are an expert software architect. Focus on code structure, design patterns, modularity, and maintainability.',
          },
          {
            id: 'security',
            role: 'explore',
            name: 'Security Analyst',
            capabilities: ['security analysis', 'vulnerability detection', 'secure coding'],
            system_prompt: 'You are a security expert. Focus on security vulnerabilities, input validation, error handling, and secure coding practices.',
          },
          {
            id: 'performance',
            role: 'explore',
            name: 'Performance Expert',
            capabilities: ['performance analysis', 'optimization', 'efficiency'],
            system_prompt: 'You are a performance expert. Focus on runtime efficiency, memory usage, algorithmic complexity, and optimization opportunities.',
          },
        ],
        max_rounds: 5,
        timeout: 300000, // 5 minutes
      },
      'sequential',
    );
  }

  async testOrchestrateParallel() {
    return this.runTest(
      'Orchestrate: Parallel Strategy (multi-source research)',
      'orchestrate',
      {
        team_name: 'TypeScript Research Team',
        goal: 'Research TypeScript best practices for error handling from documentation, code examples, and community discussions',
        strategy: 'parallel',
        members: [
          {
            id: 'doc_researcher',
            role: 'explore',
            name: 'Documentation Researcher',
            capabilities: ['documentation reading', 'best practices extraction'],
            system_prompt: 'Search the TypeScript codebase and documentation for error handling patterns and best practices.',
          },
          {
            id: 'code_researcher',
            role: 'explore',
            name: 'Code Example Researcher',
            capabilities: ['code analysis', 'pattern recognition'],
            system_prompt: 'Analyze existing TypeScript code in this project to find real-world error handling examples.',
          },
          {
            id: 'synthesizer',
            role: 'plan',
            name: 'Knowledge Synthesizer',
            capabilities: ['synthesis', 'summarization', 'recommendation'],
            system_prompt: 'Synthesize findings from other team members and provide actionable recommendations.',
          },
        ],
        max_rounds: 5,
        timeout: 300000,
      },
      'parallel',
    );
  }

  async testOrchestrateDebate() {
    return this.runTest(
      'Orchestrate: Debate Strategy (architecture decision)',
      'orchestrate',
      {
        team_name: 'Architecture Debate Team',
        goal: 'Debate the best approach for implementing retry logic in the multi-agent system: exponential backoff vs circuit breaker vs adaptive retry',
        strategy: 'debate',
        members: [
          {
            id: 'simplicity',
            role: 'plan',
            name: 'Simplicity Advocate',
            capabilities: ['simple design', 'maintainability'],
            system_prompt: 'Argue for the simplest solution. Emphasize ease of implementation, maintenance, and debugging.',
          },
          {
            id: 'robustness',
            role: 'plan',
            name: 'Robustness Advocate',
            capabilities: ['fault tolerance', 'reliability'],
            system_prompt: 'Argue for the most robust solution. Emphasize reliability, fault tolerance, and production readiness.',
          },
          {
            id: 'pragmatist',
            role: 'plan',
            name: 'Pragmatist',
            capabilities: ['practical solutions', 'trade-off analysis'],
            system_prompt: 'Provide balanced analysis. Consider real-world constraints, team expertise, and project timeline.',
          },
        ],
        max_rounds: 3,
        timeout: 300000,
      },
      'debate',
    );
  }

  async testOrchestrateHierarchical() {
    return this.runTest(
      'Orchestrate: Hierarchical Strategy (feature development)',
      'orchestrate',
      {
        team_name: 'Feature Development Team',
        goal: 'Design and plan implementation of a new feature: agent execution timeout with graceful degradation',
        strategy: 'hierarchical',
        members: [
          {
            id: 'tech_lead',
            role: 'plan',
            name: 'Tech Lead',
            capabilities: ['technical leadership', 'architecture design', 'task planning'],
            priority: 10,
            system_prompt: 'You are the tech lead. Create a high-level plan and delegate specific tasks to team members.',
          },
          {
            id: 'backend_dev',
            role: 'coder',
            name: 'Backend Developer',
            capabilities: ['backend implementation', 'API design', 'error handling'],
            priority: 5,
            system_prompt: 'You are a backend developer. Implement core timeout logic and error handling.',
          },
          {
            id: 'qa_engineer',
            role: 'explore',
            name: 'QA Engineer',
            capabilities: ['testing', 'quality assurance', 'edge case analysis'],
            priority: 3,
            system_prompt: 'You are a QA engineer. Identify test cases, edge cases, and potential issues.',
          },
        ],
        max_rounds: 8,
        timeout: 300000,
      },
      'hierarchical',
    );
  }

  async testOrchestratePipeline() {
    return this.runTest(
      'Orchestrate: Pipeline Strategy (data processing)',
      'orchestrate',
      {
        team_name: 'TODO Analysis Pipeline',
        goal: 'Extract, categorize, prioritize, and report on all TODO comments in the codebase',
        strategy: 'pipeline',
        members: [
          {
            id: 'extractor',
            role: 'explore',
            name: 'TODO Extractor',
            capabilities: ['code search', 'pattern matching', 'data extraction'],
            system_prompt: 'Extract all TODO comments from the codebase with file location and context.',
          },
          {
            id: 'categorizer',
            role: 'plan',
            name: 'TODO Categorizer',
            capabilities: ['categorization', 'analysis', 'classification'],
            system_prompt: 'Categorize TODOs by type (bug fix, feature, refactor, documentation, etc.) and estimate complexity.',
          },
          {
            id: 'prioritizer',
            role: 'plan',
            name: 'TODO Prioritizer',
            capabilities: ['prioritization', 'impact analysis', 'decision making'],
            system_prompt: 'Prioritize TODOs based on impact, urgency, and complexity. Assign priority levels.',
          },
          {
            id: 'reporter',
            role: 'coder',
            name: 'Report Generator',
            capabilities: ['report generation', 'data visualization', 'documentation'],
            system_prompt: 'Generate a comprehensive markdown report with statistics, priority breakdown, and actionable recommendations.',
          },
        ],
        max_rounds: 6,
        timeout: 400000,
      },
      'pipeline',
    );
  }

  // --------------------------------------------------------------------------
  // PipelineTool 测试
  // --------------------------------------------------------------------------

  async testPipelineBasic() {
    return this.runTest(
      'Pipeline: Basic data flow (analyze → summarize → recommend)',
      'pipeline',
      {
        chain: [
          {
            agent_id: 'explore',
            task_template: 'Analyze the PipelineTool.ts implementation and identify its key features and design patterns',
            description: 'Code Analysis',
          },
          {
            agent_id: 'plan',
            task_template: 'Based on this analysis: {{previous_output}}\n\nSummarize the main architectural decisions and trade-offs',
            description: 'Architecture Summary',
          },
          {
            agent_id: 'plan',
            task_template: 'Given this summary: {{previous_output}}\n\nProvide 3 specific recommendations for improvement',
            description: 'Recommendations',
          },
        ],
      },
    );
  }

  async testPipelineComplex() {
    return this.runTest(
      'Pipeline: Complex 4-stage workflow (extract → clean → analyze → report)',
      'pipeline',
      {
        chain: [
          {
            agent_id: 'explore',
            task_template: 'Find all exported functions in src/core/tools/ directory. List their names and file paths.',
            description: 'Data Extraction',
          },
          {
            agent_id: 'coder',
            task_template: 'From this raw data: {{previous_output}}\n\nFormat as structured JSON with: {fileName, functionName, exported}',
            description: 'Data Cleaning',
          },
          {
            agent_id: 'plan',
            task_template: 'Analyze this structured data: {{previous_output}}\n\nIdentify patterns, count tools, and note any anomalies',
            description: 'Data Analysis',
          },
          {
            agent_id: 'coder',
            task_template: 'Generate a markdown report from: {{previous_output}}\n\nInclude summary statistics, key findings, and visualizations',
            description: 'Report Generation',
          },
        ],
      },
    );
  }

  // --------------------------------------------------------------------------
  // QuickTeamTool 测试
  // --------------------------------------------------------------------------

  async testQuickTeamCodeReview() {
    return this.runTest(
      'QuickTeam: code-review template',
      'quick_team',
      {
        template: 'code-review',
        goal: 'Review QuickTeamTool.ts for code quality',
        target: 'src/core/tools/QuickTeamTool.ts',
        timeout: 300000,
      },
      undefined,
      'code-review',
    );
  }

  async testQuickTeamResearch() {
    return this.runTest(
      'QuickTeam: research template',
      'quick_team',
      {
        template: 'research',
        goal: 'Research best practices for TypeScript async error handling in agent systems',
        timeout: 300000,
      },
      undefined,
      'research',
    );
  }

  async testQuickTeamArchitectureDebate() {
    return this.runTest(
      'QuickTeam: architecture-debate template',
      'quick_team',
      {
        template: 'architecture-debate',
        goal: 'Design a caching strategy for agent execution results',
        max_rounds: 3,
        timeout: 300000,
      },
      undefined,
      'architecture-debate',
    );
  }

  async testQuickTeamDataPipeline() {
    return this.runTest(
      'QuickTeam: data-pipeline template',
      'quick_team',
      {
        template: 'data-pipeline',
        goal: 'Process all FIXME comments and generate priority report',
        timeout: 300000,
      },
      undefined,
      'data-pipeline',
    );
  }

  async testQuickTeamFeatureDevelopment() {
    return this.runTest(
      'QuickTeam: feature-development template',
      'quick_team',
      {
        template: 'feature-development',
        goal: 'Plan implementation of agent result caching feature',
        timeout: 300000,
      },
      undefined,
      'feature-development',
    );
  }

  // --------------------------------------------------------------------------
  // 测试套件执行
  // --------------------------------------------------------------------------

  async runAllTests() {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 Starting Comprehensive Multi-Agent Test Suite');
    console.log('='.repeat(80) + '\n');

    const suiteStartTime = Date.now();

    // OrchestrateTool 测试
    console.log('\n📦 ORCHESTRATE TOOL TESTS\n');
    await this.testOrchestrateSequential();
    await this.testOrchestrateParallel();
    await this.testOrchestrateDebate();
    await this.testOrchestrateHierarchical();
    await this.testOrchestratePipeline();

    // PipelineTool 测试
    console.log('\n📦 PIPELINE TOOL TESTS\n');
    await this.testPipelineBasic();
    await this.testPipelineComplex();

    // QuickTeamTool 测试
    console.log('\n📦 QUICK TEAM TOOL TESTS\n');
    await this.testQuickTeamCodeReview();
    await this.testQuickTeamResearch();
    await this.testQuickTeamArchitectureDebate();
    await this.testQuickTeamDataPipeline();
    await this.testQuickTeamFeatureDevelopment();

    const suiteDuration = Date.now() - suiteStartTime;

    // 生成报告
    this.generateReport(suiteDuration);
  }

  // --------------------------------------------------------------------------
  // 报告生成
  // --------------------------------------------------------------------------

  generateReport(totalDuration: number) {
    const passed = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;

    const totalTokens = this.results.reduce(
      (acc, r) => {
        if (r.tokensUsed) {
          acc.input += r.tokensUsed.input;
          acc.output += r.tokensUsed.output;
          acc.total += r.tokensUsed.total;
        }
        return acc;
      },
      { input: 0, output: 0, total: 0 },
    );

    const suiteResult: TestSuiteResult = {
      totalTests: this.results.length,
      passed,
      failed,
      skipped: 0,
      totalDuration,
      totalTokens,
      results: this.results,
      issues: this.issues,
    };

    // 生成 Markdown 报告
    const report = this.formatMarkdownReport(suiteResult);

    // 输出到控制台
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 TEST SUITE SUMMARY');
    console.log('='.repeat(80) + '\n');
    console.log(report);

    // 保存到文件
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tests/multi-agent/test-report-${timestamp}.md`;
    
    fs.writeFileSync(filename, report, 'utf-8');
    console.log(`\n✅ Full report saved to: ${filename}\n`);
  }

  formatMarkdownReport(suite: TestSuiteResult): string {
    const lines: string[] = [];

    // Header
    lines.push('# Xuanji Multi-Agent Comprehensive Test Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push('');

    // Summary
    lines.push('## 📊 Summary');
    lines.push('');
    lines.push(`- **Total Tests:** ${suite.totalTests}`);
    lines.push(`- **Passed:** ${suite.passed} ✅`);
    lines.push(`- **Failed:** ${suite.failed} ❌`);
    lines.push(`- **Success Rate:** ${((suite.passed / suite.totalTests) * 100).toFixed(1)}%`);
    lines.push(`- **Total Duration:** ${(suite.totalDuration / 1000).toFixed(1)}s`);
    lines.push(`- **Average Duration:** ${(suite.totalDuration / suite.totalTests / 1000).toFixed(1)}s per test`);
    lines.push('');

    // Token Usage
    lines.push('## 🪙 Token Usage');
    lines.push('');
    lines.push(`- **Input Tokens:** ${suite.totalTokens.input.toLocaleString()}`);
    lines.push(`- **Output Tokens:** ${suite.totalTokens.output.toLocaleString()}`);
    lines.push(`- **Total Tokens:** ${suite.totalTokens.total.toLocaleString()}`);
    lines.push(`- **Average per Test:** ${Math.round(suite.totalTokens.total / suite.totalTests).toLocaleString()}`);
    lines.push('');

    // Breakdown by Tool
    lines.push('## 🔧 Breakdown by Tool');
    lines.push('');

    const byTool = suite.results.reduce((acc, r) => {
      if (!acc[r.tool]) {
        acc[r.tool] = { total: 0, passed: 0, failed: 0, duration: 0, tokens: 0 };
      }
      acc[r.tool].total++;
      if (r.success) acc[r.tool].passed++;
      else acc[r.tool].failed++;
      acc[r.tool].duration += r.duration;
      if (r.tokensUsed) acc[r.tool].tokens += r.tokensUsed.total;
      return acc;
    }, {} as Record<string, any>);

    for (const [tool, stats] of Object.entries(byTool)) {
      lines.push(`### ${tool}`);
      lines.push('');
      lines.push(`- Tests: ${stats.total}`);
      lines.push(`- Success: ${stats.passed}/${stats.total} (${((stats.passed / stats.total) * 100).toFixed(1)}%)`);
      lines.push(`- Duration: ${(stats.duration / 1000).toFixed(1)}s`);
      lines.push(`- Tokens: ${stats.tokens.toLocaleString()}`);
      lines.push('');
    }

    // Detailed Results
    lines.push('## 📋 Detailed Test Results');
    lines.push('');

    for (const result of suite.results) {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      lines.push(`### ${status}: ${result.testName}`);
      lines.push('');
      lines.push(`- **Tool:** ${result.tool}`);
      if (result.strategy) lines.push(`- **Strategy:** ${result.strategy}`);
      if (result.template) lines.push(`- **Template:** ${result.template}`);
      lines.push(`- **Duration:** ${(result.duration / 1000).toFixed(2)}s`);
      
      if (result.tokensUsed) {
        lines.push(`- **Tokens:** ${result.tokensUsed.input} in / ${result.tokensUsed.output} out / ${result.tokensUsed.total} total`);
      }

      if (result.details) {
        lines.push(`- **Details:**`);
        if (result.details.rounds) lines.push(`  - Rounds: ${result.details.rounds}`);
        if (result.details.memberCount) lines.push(`  - Members: ${result.details.memberCount}`);
        if (result.details.timedOut) lines.push(`  - ⚠️ Timed Out: ${result.details.timedOut}`);
      }

      if (result.error) {
        lines.push(`- **Error:**`);
        lines.push('```');
        lines.push(result.error);
        lines.push('```');
      }

      lines.push('');
    }

    // Issues & Findings
    if (suite.issues.length > 0) {
      lines.push('## 🐛 Issues Found');
      lines.push('');
      for (let i = 0; i < suite.issues.length; i++) {
        lines.push(`${i + 1}. ${suite.issues[i]}`);
      }
      lines.push('');
    }

    // Recommendations
    lines.push('## 💡 Recommendations');
    lines.push('');
    
    if (suite.failed > 0) {
      lines.push('- ⚠️ Some tests failed. Review error messages above.');
    }
    
    const avgDuration = suite.totalDuration / suite.totalTests / 1000;
    if (avgDuration > 60) {
      lines.push('- ⏱️ Average test duration > 60s. Consider optimizing agent timeouts or complexity.');
    }

    const avgTokens = suite.totalTokens.total / suite.totalTests;
    if (avgTokens > 50000) {
      lines.push('- 🪙 High token usage detected. Consider using lighter models for sub-agents.');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*Generated by Xuanji Multi-Agent Test Suite*');

    return lines.join('\n');
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const tester = new MultiAgentTester();
  
  try {
    await tester.initialize();
    await tester.runAllTests();
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { MultiAgentTester, TestResult, TestSuiteResult };
