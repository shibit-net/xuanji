/**
 * 测试结果分析工具
 * 
 * 分析多次测试运行的结果，找出性能趋势和稳定性问题
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  totalDuration: number;
  totalTokens: {
    input: number;
    output: number;
    total: number;
  };
  results: Array<{
    testName: string;
    tool: string;
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
  }>;
  issues: string[];
}

class TestAnalyzer {
  private reports: TestReport[] = [];

  /**
   * 加载所有测试报告
   */
  loadReports(directory: string = 'tests/multi-agent') {
    const files = fs.readdirSync(directory)
      .filter(f => f.startsWith('test-report-') && f.endsWith('.md'))
      .sort()
      .reverse() // 最新的在前
      .slice(0, 10); // 最多分析最近 10 次

    console.log(`📊 Found ${files.length} test reports\n`);

    for (const file of files) {
      const content = fs.readFileSync(path.join(directory, file), 'utf-8');
      const report = this.parseReport(content, file);
      if (report) {
        this.reports.push(report);
      }
    }

    console.log(`✅ Loaded ${this.reports.length} reports\n`);
  }

  /**
   * 解析 Markdown 报告
   */
  private parseReport(content: string, filename: string): TestReport | null {
    try {
      // 从文件名提取时间戳
      const timestamp = filename.replace('test-report-', '').replace('.md', '');

      // 提取关键数据（简化版，实际应该更完善）
      const totalTestsMatch = content.match(/\*\*Total Tests:\*\* (\d+)/);
      const passedMatch = content.match(/\*\*Passed:\*\* (\d+)/);
      const failedMatch = content.match(/\*\*Failed:\*\* (\d+)/);
      const durationMatch = content.match(/\*\*Total Duration:\*\* ([\d.]+)s/);
      const inputTokensMatch = content.match(/\*\*Input Tokens:\*\* ([\d,]+)/);
      const outputTokensMatch = content.match(/\*\*Output Tokens:\*\* ([\d,]+)/);

      if (!totalTestsMatch || !passedMatch) {
        return null;
      }

      return {
        timestamp,
        totalTests: parseInt(totalTestsMatch[1]),
        passed: parseInt(passedMatch[1]),
        failed: parseInt(failedMatch?.[1] || '0'),
        totalDuration: parseFloat(durationMatch?.[1] || '0') * 1000,
        totalTokens: {
          input: parseInt(inputTokensMatch?.[1]?.replace(/,/g, '') || '0'),
          output: parseInt(outputTokensMatch?.[1]?.replace(/,/g, '') || '0'),
          total: 0,
        },
        results: [],
        issues: [],
      };
    } catch (error) {
      console.error(`Failed to parse ${filename}:`, error);
      return null;
    }
  }

  /**
   * 生成趋势分析
   */
  analyzeTrends() {
    if (this.reports.length === 0) {
      console.log('❌ No reports to analyze\n');
      return;
    }

    console.log('📈 TREND ANALYSIS\n');
    console.log('='.repeat(60) + '\n');

    // 成功率趋势
    console.log('Success Rate Trend:');
    for (const report of this.reports.slice(0, 5)) {
      const rate = (report.passed / report.totalTests * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(parseFloat(rate) / 5));
      console.log(`  ${report.timestamp}: ${bar} ${rate}% (${report.passed}/${report.totalTests})`);
    }
    console.log('');

    // 性能趋势
    console.log('Performance Trend (avg duration per test):');
    for (const report of this.reports.slice(0, 5)) {
      const avgDuration = (report.totalDuration / report.totalTests / 1000).toFixed(1);
      console.log(`  ${report.timestamp}: ${avgDuration}s`);
    }
    console.log('');

    // Token 使用趋势
    console.log('Token Usage Trend:');
    for (const report of this.reports.slice(0, 5)) {
      const totalTokens = (report.totalTokens.input + report.totalTokens.output).toLocaleString();
      const avgTokens = Math.round((report.totalTokens.input + report.totalTokens.output) / report.totalTests).toLocaleString();
      console.log(`  ${report.timestamp}: ${totalTokens} total (${avgTokens} avg)`);
    }
    console.log('');
  }

  /**
   * 生成统计摘要
   */
  generateSummary() {
    if (this.reports.length === 0) {
      return;
    }

    console.log('📊 SUMMARY STATISTICS\n');
    console.log('='.repeat(60) + '\n');

    const latest = this.reports[0];
    const avgSuccessRate = this.reports.reduce((sum, r) => sum + (r.passed / r.totalTests), 0) / this.reports.length * 100;
    const avgDuration = this.reports.reduce((sum, r) => sum + r.totalDuration, 0) / this.reports.length / 1000;
    const avgTokens = this.reports.reduce((sum, r) => sum + r.totalTokens.input + r.totalTokens.output, 0) / this.reports.length;

    console.log(`Latest Report: ${latest.timestamp}`);
    console.log(`  Success Rate: ${(latest.passed / latest.totalTests * 100).toFixed(1)}%`);
    console.log(`  Duration: ${(latest.totalDuration / 1000).toFixed(1)}s`);
    console.log(`  Total Tokens: ${(latest.totalTokens.input + latest.totalTokens.output).toLocaleString()}`);
    console.log('');

    console.log(`Average Across ${this.reports.length} Reports:`);
    console.log(`  Success Rate: ${avgSuccessRate.toFixed(1)}%`);
    console.log(`  Duration: ${avgDuration.toFixed(1)}s`);
    console.log(`  Total Tokens: ${avgTokens.toFixed(0)}`);
    console.log('');

    // 问题统计
    const totalIssues = this.reports.reduce((sum, r) => sum + r.issues.length, 0);
    if (totalIssues > 0) {
      console.log(`⚠️  Total Issues Found: ${totalIssues}`);
      console.log(`   Average per Report: ${(totalIssues / this.reports.length).toFixed(1)}`);
      console.log('');
    }
  }

  /**
   * 识别常见问题
   */
  identifyCommonIssues() {
    console.log('🐛 COMMON ISSUES\n');
    console.log('='.repeat(60) + '\n');

    const issueMap = new Map<string, number>();

    for (const report of this.reports) {
      for (const issue of report.issues) {
        // 简化 issue 文本用于分组
        const key = issue.split(':')[0];
        issueMap.set(key, (issueMap.get(key) || 0) + 1);
      }
    }

    if (issueMap.size === 0) {
      console.log('✅ No recurring issues found\n');
      return;
    }

    const sorted = Array.from(issueMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    console.log('Top Issues (by frequency):');
    for (const [issue, count] of sorted) {
      console.log(`  ${count}x - ${issue}`);
    }
    console.log('');
  }

  /**
   * 生成建议
   */
  generateRecommendations() {
    if (this.reports.length === 0) {
      return;
    }

    console.log('💡 RECOMMENDATIONS\n');
    console.log('='.repeat(60) + '\n');

    const latest = this.reports[0];
    const recommendations: string[] = [];

    // 成功率检查
    const successRate = latest.passed / latest.totalTests;
    if (successRate < 0.8) {
      recommendations.push('⚠️  Success rate < 80%. Review failing tests and fix underlying issues.');
    } else if (successRate < 1.0) {
      recommendations.push('⚡ Success rate < 100%. Some tests are flaky or need attention.');
    } else {
      recommendations.push('✅ All tests passing. Great job!');
    }

    // 性能检查
    const avgDuration = latest.totalDuration / latest.totalTests / 1000;
    if (avgDuration > 60) {
      recommendations.push('⏱️  Average test duration > 60s. Consider optimizing timeouts or complexity.');
    } else if (avgDuration > 30) {
      recommendations.push('⏱️  Average test duration > 30s. Monitor for performance regressions.');
    }

    // Token 使用检查
    const avgTokens = (latest.totalTokens.input + latest.totalTokens.output) / latest.totalTests;
    if (avgTokens > 50000) {
      recommendations.push('🪙 High token usage (>50K avg). Consider using lighter models for sub-agents.');
    } else if (avgTokens > 30000) {
      recommendations.push('🪙 Moderate token usage (>30K avg). Monitor costs and optimize prompts.');
    }

    // 趋势检查
    if (this.reports.length >= 3) {
      const recentRates = this.reports.slice(0, 3).map(r => r.passed / r.totalTests);
      const isDecreasing = recentRates[0] < recentRates[1] && recentRates[1] < recentRates[2];
      if (isDecreasing) {
        recommendations.push('📉 Success rate trending down. Investigate recent changes.');
      }
    }

    for (const rec of recommendations) {
      console.log(`  ${rec}`);
    }
    console.log('');
  }
}

// Main
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 Multi-Agent Test Results Analyzer');
  console.log('='.repeat(60) + '\n');

  const analyzer = new TestAnalyzer();
  analyzer.loadReports();
  analyzer.generateSummary();
  analyzer.analyzeTrends();
  analyzer.identifyCommonIssues();
  analyzer.generateRecommendations();

  console.log('='.repeat(60) + '\n');
}

if (require.main === module) {
  main().catch(console.error);
}

export { TestAnalyzer };
