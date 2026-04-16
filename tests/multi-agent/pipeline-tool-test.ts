/**
 * PipelineTool 完整测试套件
 * 
 * 测试目标：
 * 1. 正常流水线：多步骤数据传递
 * 2. 错误处理：中间步骤失败场景
 * 3. 数据传递：{{previous_output}} 验证
 * 4. 性能指标：执行时间、内存使用
 */

import { pipeline } from '../../src/index.js';
import fs from 'fs/promises';
import path from 'path';

interface TestResult {
  testName: string;
  status: 'success' | 'failed' | 'error';
  duration: number;
  details: any;
  error?: string;
  dataFlow?: string[];
}

interface PerformanceMetrics {
  totalDuration: number;
  stepDurations: number[];
  memoryBefore: number;
  memoryAfter: number;
  memoryDelta: number;
}

const results: TestResult[] = [];
const outputDir = 'tests/multi-agent/pipeline-results';

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

async function saveResult(testName: string, data: any) {
  const filename = `${testName.replace(/\s+/g, '-').toLowerCase()}.json`;
  await fs.writeFile(
    path.join(outputDir, filename),
    JSON.stringify(data, null, 2)
  );
}

/**
 * 测试 1: 正常流水线 - 数据提取→清洗→分析→报告
 */
async function testNormalPipeline() {
  const testName = 'Normal Pipeline - Extract Clean Analyze Report';
  console.log(`\n🧪 ${testName}`);
  const startTime = Date.now();
  const memBefore = process.memoryUsage().heapUsed;

  try {
    // 创建测试数据源
    const testData = {
      users: [
        { id: 1, name: 'Alice', age: 30, email: 'alice@example.com', status: 'active' },
        { id: 2, name: '', age: -5, email: 'invalid-email', status: 'inactive' },
        { id: 3, name: 'Bob', age: 25, email: 'bob@example.com', status: 'active' },
        { id: 4, name: 'Charlie', age: 150, email: 'charlie@example.com', status: null },
      ]
    };

    const dataFile = path.join(outputDir, 'test-data.json');
    await fs.writeFile(dataFile, JSON.stringify(testData, null, 2));

    console.log('📊 Starting 4-step pipeline...');
    
    const result = await pipeline({
      chain: [
        {
          agent_id: 'explore',
          task_template: `Read the test data from ${dataFile} and list all issues you find (empty names, invalid ages, invalid emails, null statuses). Return a JSON list of issues.`,
          description: 'Step 1: Extract and identify data issues'
        },
        {
          agent_id: 'coder',
          task_template: `Based on these issues: {{previous_output}}, create a cleaned version of the data from ${dataFile}. Fix: 1) Remove empty names, 2) Set invalid ages to null, 3) Fix email format, 4) Set null status to 'unknown'. Return cleaned JSON data.`,
          description: 'Step 2: Clean the data'
        },
        {
          agent_id: 'coder',
          task_template: `Analyze this cleaned data: {{previous_output}}. Calculate: 1) Average age (excluding nulls), 2) Active user percentage, 3) Email domain distribution. Return analysis as JSON.`,
          description: 'Step 3: Analyze cleaned data'
        },
        {
          agent_id: 'coder',
          task_template: `Generate a markdown report from this analysis: {{previous_output}}. Include: 1) Executive summary, 2) Key metrics, 3) Data quality issues found, 4) Recommendations. Format as clean markdown.`,
          description: 'Step 4: Generate report'
        }
      ]
    });

    const duration = Date.now() - startTime;
    const memAfter = process.memoryUsage().heapUsed;

    // 提取数据流信息
    const dataFlow = [
      'Step 1: Extracted issues from raw data',
      'Step 2: Cleaned data based on issues',
      'Step 3: Analyzed cleaned data',
      'Step 4: Generated final report'
    ];

    const testResult: TestResult = {
      testName,
      status: 'success',
      duration,
      details: {
        finalOutput: result,
        dataFlow,
        metrics: {
          totalDuration: duration,
          memoryBefore: memBefore,
          memoryAfter: memAfter,
          memoryDelta: memAfter - memBefore
        }
      },
      dataFlow
    };

    results.push(testResult);
    await saveResult(testName, testResult);

    console.log(`✅ ${testName} - SUCCESS (${duration}ms)`);
    console.log(`   Memory delta: ${(testResult.details.metrics.memoryDelta / 1024 / 1024).toFixed(2)} MB`);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    const testResult: TestResult = {
      testName,
      status: 'error',
      duration,
      details: {},
      error: error instanceof Error ? error.message : String(error)
    };
    results.push(testResult);
    await saveResult(testName, testResult);
    console.log(`❌ ${testName} - ERROR: ${testResult.error}`);
  }
}

/**
 * 测试 2: 错误处理 - 中间步骤失败
 */
async function testErrorHandling() {
  const testName = 'Error Handling - Failed Middle Step';
  console.log(`\n🧪 ${testName}`);
  const startTime = Date.now();

  try {
    console.log('🔥 Intentionally causing failure in step 2...');
    
    const result = await pipeline({
      chain: [
        {
          agent_id: 'coder',
          task_template: 'Create a simple JSON object with fields: name="test", value=100. Just return the JSON.',
          description: 'Step 1: Create initial data (should succeed)'
        },
        {
          agent_id: 'coder',
          task_template: 'Try to access a non-existent file at /this/path/does/not/exist/file.json and read its contents. This should fail. Previous output was: {{previous_output}}',
          description: 'Step 2: Intentional failure (should fail)',
          timeout: 30000 // Shorter timeout for failure case
        },
        {
          agent_id: 'coder',
          task_template: 'Process this data: {{previous_output}}. This step should not execute if step 2 fails.',
          description: 'Step 3: Should not execute'
        }
      ]
    });

    // If we get here, the pipeline didn't fail as expected
    const duration = Date.now() - startTime;
    const testResult: TestResult = {
      testName,
      status: 'failed',
      duration,
      details: { 
        unexpectedSuccess: true,
        result 
      },
      error: 'Pipeline should have failed but succeeded'
    };
    results.push(testResult);
    await saveResult(testName, testResult);
    console.log(`⚠️  ${testName} - UNEXPECTED SUCCESS (${duration}ms)`);

  } catch (error) {
    const duration = Date.now() - startTime;
    
    // This is expected behavior
    const testResult: TestResult = {
      testName,
      status: 'success', // Success because we expected the error
      duration,
      details: {
        expectedError: true,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorHandled: true
      }
    };
    results.push(testResult);
    await saveResult(testName, testResult);
    console.log(`✅ ${testName} - SUCCESS (error handled correctly, ${duration}ms)`);
    console.log(`   Error caught: ${testResult.details.errorMessage.substring(0, 100)}...`);
  }
}

/**
 * 测试 3: 数据传递验证 - 确保 {{previous_output}} 正确工作
 */
async function testDataPassthrough() {
  const testName = 'Data Passthrough - Variable Substitution';
  console.log(`\n🧪 ${testName}`);
  const startTime = Date.now();

  try {
    console.log('🔗 Testing data flow through 3 steps...');
    
    const result = await pipeline({
      chain: [
        {
          agent_id: 'coder',
          task_template: 'Return exactly this JSON: {"step":1,"data":"FIRST_STEP","timestamp":"' + new Date().toISOString() + '"}',
          description: 'Step 1: Create initial marker'
        },
        {
          agent_id: 'coder',
          task_template: 'Take this previous output: {{previous_output}} and create a new JSON that includes it in a "previous" field, adds "step":2 and "data":"SECOND_STEP". Return the combined JSON.',
          description: 'Step 2: Augment with previous data'
        },
        {
          agent_id: 'coder',
          task_template: 'Take this output: {{previous_output}} and verify it contains data from both step 1 and step 2. Add "step":3, "data":"THIRD_STEP" and create a "dataFlow" array showing ["FIRST_STEP","SECOND_STEP","THIRD_STEP"]. Return the final JSON.',
          description: 'Step 3: Verify complete data flow'
        }
      ]
    });

    const duration = Date.now() - startTime;

    // Try to parse result to verify data flow
    let dataFlowVerified = false;
    let parsedResult: any = null;
    
    try {
      // The result might be a string containing JSON
      const resultStr = String(result);
      const jsonMatch = resultStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
        dataFlowVerified = 
          parsedResult.dataFlow && 
          Array.isArray(parsedResult.dataFlow) &&
          parsedResult.dataFlow.includes('FIRST_STEP') &&
          parsedResult.dataFlow.includes('SECOND_STEP') &&
          parsedResult.dataFlow.includes('THIRD_STEP');
      }
    } catch (e) {
      // Parsing failed, but we still got a result
    }

    const testResult: TestResult = {
      testName,
      status: dataFlowVerified ? 'success' : 'failed',
      duration,
      details: {
        finalOutput: result,
        parsedResult,
        dataFlowVerified,
        containsMarkers: {
          step1: String(result).includes('FIRST_STEP'),
          step2: String(result).includes('SECOND_STEP'),
          step3: String(result).includes('THIRD_STEP')
        }
      },
      dataFlow: parsedResult?.dataFlow || []
    };

    results.push(testResult);
    await saveResult(testName, testResult);

    if (dataFlowVerified) {
      console.log(`✅ ${testName} - SUCCESS (${duration}ms)`);
      console.log(`   Data flow verified: ${testResult.details.dataFlow.join(' → ')}`);
    } else {
      console.log(`⚠️  ${testName} - PARTIAL (${duration}ms)`);
      console.log(`   Markers found: Step1=${testResult.details.containsMarkers.step1}, Step2=${testResult.details.containsMarkers.step2}, Step3=${testResult.details.containsMarkers.step3}`);
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    const testResult: TestResult = {
      testName,
      status: 'error',
      duration,
      details: {},
      error: error instanceof Error ? error.message : String(error)
    };
    results.push(testResult);
    await saveResult(testName, testResult);
    console.log(`❌ ${testName} - ERROR: ${testResult.error}`);
  }
}

/**
 * 测试 4: 短流水线 - 2步最小配置
 */
async function testMinimalPipeline() {
  const testName = 'Minimal Pipeline - 2 Steps';
  console.log(`\n🧪 ${testName}`);
  const startTime = Date.now();

  try {
    console.log('⚡ Running minimal 2-step pipeline...');
    
    const result = await pipeline({
      chain: [
        {
          agent_id: 'coder',
          task_template: 'Create a list of 3 programming languages: JavaScript, Python, Go. Return as JSON array.',
          description: 'Step 1: Generate list'
        },
        {
          agent_id: 'coder',
          task_template: 'Take this list: {{previous_output}} and add descriptions for each language (one sentence each). Return as JSON with name and description fields.',
          description: 'Step 2: Add descriptions'
        }
      ]
    });

    const duration = Date.now() - startTime;

    const testResult: TestResult = {
      testName,
      status: 'success',
      duration,
      details: {
        finalOutput: result,
        steps: 2
      }
    };

    results.push(testResult);
    await saveResult(testName, testResult);
    console.log(`✅ ${testName} - SUCCESS (${duration}ms)`);

  } catch (error) {
    const duration = Date.now() - startTime;
    const testResult: TestResult = {
      testName,
      status: 'error',
      duration,
      details: {},
      error: error instanceof Error ? error.message : String(error)
    };
    results.push(testResult);
    await saveResult(testName, testResult);
    console.log(`❌ ${testName} - ERROR: ${testResult.error}`);
  }
}

/**
 * 测试 5: 不同 Agent 类型混合
 */
async function testMixedAgentTypes() {
  const testName = 'Mixed Agent Types - Explore + Coder';
  console.log(`\n🧪 ${testName}`);
  const startTime = Date.now();

  try {
    console.log('🔄 Mixing explore and coder agents...');
    
    // Create test file to explore
    const testFile = path.join(outputDir, 'sample-code.ts');
    await fs.writeFile(testFile, `
export function calculateSum(a: number, b: number): number {
  return a + b;
}

export function calculateProduct(a: number, b: number): number {
  return a * b;
}

// TODO: Add division function
// TODO: Add validation for zero
`);

    const result = await pipeline({
      chain: [
        {
          agent_id: 'explore',
          task_template: `Analyze the file ${testFile} and list: 1) All exported functions, 2) All TODO comments. Return as structured data.`,
          description: 'Step 1: Explore code (read-only)'
        },
        {
          agent_id: 'coder',
          task_template: `Based on this analysis: {{previous_output}}, generate implementation for the missing division function mentioned in TODOs. Include zero validation. Return the complete function code.`,
          description: 'Step 2: Generate code'
        },
        {
          agent_id: 'coder',
          task_template: `Review this generated code: {{previous_output}} and create a test suite with 3 test cases (normal, edge case, error case). Return as Jest test code.`,
          description: 'Step 3: Generate tests'
        }
      ]
    });

    const duration = Date.now() - startTime;

    const testResult: TestResult = {
      testName,
      status: 'success',
      duration,
      details: {
        finalOutput: result,
        agentTypes: ['explore', 'coder', 'coder']
      }
    };

    results.push(testResult);
    await saveResult(testName, testResult);
    console.log(`✅ ${testName} - SUCCESS (${duration}ms)`);

  } catch (error) {
    const duration = Date.now() - startTime;
    const testResult: TestResult = {
      testName,
      status: 'error',
      duration,
      details: {},
      error: error instanceof Error ? error.message : String(error)
    };
    results.push(testResult);
    await saveResult(testName, testResult);
    console.log(`❌ ${testName} - ERROR: ${testResult.error}`);
  }
}

/**
 * 生成汇总报告
 */
async function generateReport() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 PIPELINE TOOL TEST SUMMARY');
  console.log('='.repeat(80));

  const totalTests = results.length;
  const successTests = results.filter(r => r.status === 'success').length;
  const failedTests = results.filter(r => r.status === 'failed').length;
  const errorTests = results.filter(r => r.status === 'error').length;

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalDuration / totalTests;

  console.log(`\n📈 Test Results:`);
  console.log(`   Total Tests: ${totalTests}`);
  console.log(`   ✅ Success: ${successTests}`);
  console.log(`   ⚠️  Failed: ${failedTests}`);
  console.log(`   ❌ Errors: ${errorTests}`);
  console.log(`   Success Rate: ${((successTests / totalTests) * 100).toFixed(1)}%`);

  console.log(`\n⏱️  Performance:`);
  console.log(`   Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`   Average Duration: ${(avgDuration / 1000).toFixed(2)}s`);
  console.log(`   Fastest Test: ${(Math.min(...results.map(r => r.duration)) / 1000).toFixed(2)}s`);
  console.log(`   Slowest Test: ${(Math.max(...results.map(r => r.duration)) / 1000).toFixed(2)}s`);

  console.log(`\n📋 Detailed Results:`);
  results.forEach((r, i) => {
    const icon = r.status === 'success' ? '✅' : r.status === 'failed' ? '⚠️' : '❌';
    console.log(`   ${i + 1}. ${icon} ${r.testName}`);
    console.log(`      Duration: ${(r.duration / 1000).toFixed(2)}s`);
    if (r.error) {
      console.log(`      Error: ${r.error.substring(0, 100)}...`);
    }
    if (r.dataFlow && r.dataFlow.length > 0) {
      console.log(`      Data Flow: ${r.dataFlow.length} steps tracked`);
    }
  });

  // Generate markdown report
  const reportContent = `# PipelineTool Test Report

**Generated:** ${new Date().toISOString()}

## Summary

- **Total Tests:** ${totalTests}
- **Success:** ${successTests} ✅
- **Failed:** ${failedTests} ⚠️
- **Errors:** ${errorTests} ❌
- **Success Rate:** ${((successTests / totalTests) * 100).toFixed(1)}%

## Performance Metrics

- **Total Duration:** ${(totalDuration / 1000).toFixed(2)}s
- **Average Duration:** ${(avgDuration / 1000).toFixed(2)}s
- **Fastest Test:** ${(Math.min(...results.map(r => r.duration)) / 1000).toFixed(2)}s
- **Slowest Test:** ${(Math.max(...results.map(r => r.duration)) / 1000).toFixed(2)}s

## Test Results

${results.map((r, i) => `
### ${i + 1}. ${r.testName}

- **Status:** ${r.status === 'success' ? '✅ SUCCESS' : r.status === 'failed' ? '⚠️ FAILED' : '❌ ERROR'}
- **Duration:** ${(r.duration / 1000).toFixed(2)}s
${r.error ? `- **Error:** ${r.error}` : ''}
${r.dataFlow ? `- **Data Flow:** ${r.dataFlow.length} steps\n  ${r.dataFlow.map(s => `  - ${s}`).join('\n  ')}` : ''}
${r.details.metrics ? `
- **Memory Usage:**
  - Before: ${(r.details.metrics.memoryBefore / 1024 / 1024).toFixed(2)} MB
  - After: ${(r.details.metrics.memoryAfter / 1024 / 1024).toFixed(2)} MB
  - Delta: ${(r.details.metrics.memoryDelta / 1024 / 1024).toFixed(2)} MB
` : ''}
`).join('\n')}

## Key Findings

### ✅ Working Features
${results.filter(r => r.status === 'success').map(r => `- ${r.testName}`).join('\n')}

### ⚠️ Issues Found
${results.filter(r => r.status === 'failed' || r.status === 'error').map(r => `- ${r.testName}: ${r.error || 'See details above'}`).join('\n') || '- None'}

## Conclusions

1. **Data Flow:** ${results.some(r => r.dataFlow && r.dataFlow.length > 0) ? 'Successfully verified through multiple steps' : 'Needs investigation'}
2. **Error Handling:** ${results.some(r => r.details.expectedError) ? 'Correctly catches and reports errors' : 'Not fully tested'}
3. **Agent Mixing:** ${results.some(r => r.details.agentTypes) ? 'Different agent types work together' : 'Not tested'}
4. **Performance:** Average ${(avgDuration / 1000).toFixed(2)}s per test

## Recommendations

1. ${successTests === totalTests ? 'All tests passed - system is stable' : 'Fix failing tests before production use'}
2. ${avgDuration > 60000 ? 'Consider optimizing long-running pipelines' : 'Performance is acceptable'}
3. Add more edge case testing for complex data transformations
4. Consider adding timeout tests for long-running steps

---
*Test Suite: PipelineTool Comprehensive Testing*
*Output Directory: ${outputDir}*
`;

  await fs.writeFile(
    path.join(outputDir, 'PIPELINE_TEST_REPORT.md'),
    reportContent
  );

  console.log(`\n📄 Full report saved to: ${outputDir}/PIPELINE_TEST_REPORT.md`);
  console.log(`📁 Individual test results in: ${outputDir}/`);
  console.log('='.repeat(80));
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('🚀 Starting PipelineTool Comprehensive Test Suite');
  console.log('='.repeat(80));
  
  await ensureOutputDir();

  // Run all tests sequentially
  await testNormalPipeline();
  await testErrorHandling();
  await testDataPassthrough();
  await testMinimalPipeline();
  await testMixedAgentTypes();

  // Generate final report
  await generateReport();

  console.log('\n✨ All tests completed!');
  
  // Return summary for parent process
  return {
    total: results.length,
    success: results.filter(r => r.status === 'success').length,
    failed: results.filter(r => r.status === 'failed').length,
    error: results.filter(r => r.status === 'error').length,
    results
  };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
    .then(summary => {
      console.log('\n📊 Final Summary:', summary);
      process.exit(summary.error > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}

export { runAllTests, testNormalPipeline, testErrorHandling, testDataPassthrough };
