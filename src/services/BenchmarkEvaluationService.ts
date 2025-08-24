import { PythonExecutor } from './PythonExecutor';
import { MBPPDatasetService } from './MBPPDatasetService';
import { ModelPromptService } from './ModelPromptService';
import { ToolExtractorService } from './ToolExtractorService';
import { MBPPProblem, TestResult, BenchmarkMode } from '../types/benchmark';

export interface EvaluationResult {
  success: boolean;
  testResults: TestResult[];
  code: string;
  error?: string;
}

export class BenchmarkEvaluationService {
  private static instance: BenchmarkEvaluationService;
  private pythonExecutor: PythonExecutor;
  private datasetService: MBPPDatasetService;
  private promptService: ModelPromptService;
  private toolExtractor: ToolExtractorService;

  private constructor() {
    this.pythonExecutor = PythonExecutor.getInstance();
    this.datasetService = MBPPDatasetService.getInstance();
    this.promptService = ModelPromptService.getInstance();
    this.toolExtractor = ToolExtractorService.getInstance();
  }

  static getInstance(): BenchmarkEvaluationService {
    if (!BenchmarkEvaluationService.instance) {
      BenchmarkEvaluationService.instance = new BenchmarkEvaluationService();
    }
    return BenchmarkEvaluationService.instance;
  }

  getSystemPrompt(mode: BenchmarkMode, modelId?: string): string {
    // Detect architecture from model ID if provided
    const architecture = modelId ? this.promptService.detectArchitecture(modelId) : 'default';
    return this.promptService.getSystemPrompt(architecture, mode, modelId);
  }

  extractCodeFromResponse(response: string): string | null {
    console.log('[BenchmarkEvaluationService] Extracting code from response length:', response.length);
    console.log('[BenchmarkEvaluationService] Response preview:', response.substring(0, 200) + '...');
    
    // Try to extract code from markdown blocks
    const patterns = [
      /```python\n([\s\S]*?)\n```/,
      /```\n([\s\S]*?)\n```/,
      /```(\w+\.py)?\n([\s\S]*?)\n```/,
    ];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = response.match(pattern);
      if (match) {
        const extractedCode = match[match.length === 3 ? 2 : 1].trim();
        console.log(`[BenchmarkEvaluationService] Pattern ${i} matched, extracted code length:`, extractedCode.length);
        console.log('[BenchmarkEvaluationService] Extracted code preview:', extractedCode.substring(0, 100) + '...');
        return extractedCode;
      }
    }

    // Try to find function definition
    console.log('[BenchmarkEvaluationService] No markdown blocks found, trying to find function definition...');
    const functionMatch = response.match(/(def\s+\w+.*?:\n[\s\S]*?)(?=\n\n|\n$|$)/m);
    if (functionMatch) {
      const extractedCode = functionMatch[1];
      console.log('[BenchmarkEvaluationService] Function definition found, length:', extractedCode.length);
      console.log('[BenchmarkEvaluationService] Function preview:', extractedCode.substring(0, 100) + '...');
      return extractedCode;
    }

    console.log('[BenchmarkEvaluationService] WARNING: No code found in response!');
    return null;
  }

  async evaluateSolution(
    problem: MBPPProblem,
    code: string
  ): Promise<EvaluationResult> {
    console.log('[BenchmarkEvaluationService] Evaluating solution for problem:', problem.id);
    console.log('[BenchmarkEvaluationService] Code to evaluate:', code);
    console.log('[BenchmarkEvaluationService] Number of test cases:', problem.testCases.length);
    
    const testResults: TestResult[] = [];
    let testScript = '';

    try {
      // Create test script with the solution and all test cases
      testScript = `
${code}

# Test results
test_results = []
`;

      // Add each test case
      for (let i = 0; i < problem.testCases.length; i++) {
        const testCase = problem.testCases[i]; // This is a string like "assert remove_Occ('hello','l') == 'heo'"
        console.log(`[BenchmarkEvaluationService] Adding test case ${i + 1}:`, testCase);
        
        const testCode = `
# Test case ${i + 1}
try:
    ${testCase}
    test_results.append({
        'index': ${i},
        'passed': True,
        'error': None
    })
    print(f"Test case ${i + 1} PASSED")
except AssertionError as e:
    test_results.append({
        'index': ${i},
        'passed': False,
        'error': f'Assertion failed: {str(e)}'
    })
    print(f"Test case ${i + 1} FAILED: Assertion failed - {str(e)}")
except Exception as e:
    test_results.append({
        'index': ${i},
        'passed': False,
        'error': f'Error: {type(e).__name__}: {str(e)}'
    })
    print(f"Test case ${i + 1} FAILED: {type(e).__name__} - {str(e)}")
`;
        testScript += testCode;
      }

      // Output results as JSON
      testScript += `
import json
print(json.dumps(test_results))
`;

      // Execute the test script
      console.log('[BenchmarkEvaluationService] Executing test script...');
      const output = await this.pythonExecutor.runPythonCode(testScript);
      console.log('[BenchmarkEvaluationService] Python output:', output);
      
      // Parse JSON from the last line (after all print statements)
      const lines = output.trim().split('\n');
      const jsonLine = lines[lines.length - 1];
      console.log('[BenchmarkEvaluationService] Parsing JSON from last line:', jsonLine);
      
      const results = JSON.parse(jsonLine);
      console.log('[BenchmarkEvaluationService] Parsed results:', results);

      // Map results to TestResult objects
      for (const result of results) {
        testResults.push({
          testCase: problem.testCases[result.index],
          passed: result.passed,
          error: result.error || undefined,
        });
      }

      const allPassed = testResults.every(t => t.passed);
      console.log('[BenchmarkEvaluationService] All tests passed:', allPassed);
      console.log('[BenchmarkEvaluationService] Test summary:', 
        testResults.map((t, i) => `Test ${i + 1}: ${t.passed ? 'PASSED' : 'FAILED'}`).join(', '));
      
      return {
        success: allPassed,
        testResults,
        code,
      };
    } catch (error) {
      console.error('[BenchmarkEvaluationService] Evaluation error:', error);
      console.error('[BenchmarkEvaluationService] Test script that failed:', testScript);
      return {
        success: false,
        testResults,
        code,
        error: `Evaluation error: ${error}`,
      };
    }
  }

  extractToolCallFromResponse(response: string, modelId?: string): any | null {
    // Use advanced tool extraction service
    console.log('[BenchmarkEvaluationService] Extracting tool from response for model:', modelId);
    const result = this.toolExtractor.extractToolFromResponse(response, modelId);
    if (result) {
      console.log('[BenchmarkEvaluationService] Successfully extracted tool:', result.name);
    } else {
      console.log('[BenchmarkEvaluationService] No tools extracted from response');
      // Log a preview of the response for debugging
      console.log('[BenchmarkEvaluationService] Response preview:', response.substring(0, 500));
    }
    return result;
  }

  extractToolCallsFromResponse(response: string, modelId?: string): any[] {
    // Use advanced tool extraction service to get ALL tools
    console.log('[BenchmarkEvaluationService] Extracting all tools from response for model:', modelId);
    const architecture = modelId ? this.promptService.detectArchitecture(modelId) : 'default';
    const result = this.toolExtractor.extractTools(response, architecture);
    
    if (result.tools.length > 0) {
      console.log('[BenchmarkEvaluationService] Successfully extracted', result.tools.length, 'tool(s)');
      result.tools.forEach(tool => {
        console.log('[BenchmarkEvaluationService] - Tool:', tool.name);
      });
    } else {
      console.log('[BenchmarkEvaluationService] No tools extracted from response');
      if (result.error) {
        console.log('[BenchmarkEvaluationService] Extraction error:', result.error);
      }
      // Log a preview of the response for debugging
      console.log('[BenchmarkEvaluationService] Response preview:', response.substring(0, 500));
    }
    return result.tools;
  }

  formatProblemForPrompt(problem: MBPPProblem, includeTests: boolean = true, modelId?: string): string {
    // If model ID is provided, use model-specific formatting
    if (modelId) {
      const architecture = this.promptService.detectArchitecture(modelId);
      // For now, still use the dataset service format, but could customize per model
      return this.datasetService.formatProblemForPrompt(problem);
    }
    return this.datasetService.formatProblemForPrompt(problem);
  }
}