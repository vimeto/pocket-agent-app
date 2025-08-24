import { InferenceService } from '../services/InferenceService';
import { BenchmarkEvaluationService } from '../services/BenchmarkEvaluationService';
import { PerformanceService } from '../services/PerformanceService';
import { MBPPProblem, BenchmarkMode } from '../types/benchmark';
import { getBenchmarkToolsForLlama, findBenchmarkTool } from '../config/benchmarkTools';
import { ChatMessage } from '../types';

// Helper function to detect model architecture
function detectModelArchitecture(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes('gemma')) return 'gemma';
  if (lower.includes('llama')) return 'llama';
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('deepseek')) return 'deepseek';
  return 'default';
}

interface ExecutionResult {
  response: string;
  code: string;
  toolCalls: any[];
  success: boolean;
  actualMessageId?: string;  // The actual messageId used for performance tracking
  toolCallValid?: boolean;  // Whether the model returned a valid tool call format
  toolCallExtracted?: boolean;  // Whether we managed to extract a tool call
  firstIterationTTFT?: number;  // TTFT from the first iteration (initial response)
  aggregatedToolCallLatencies?: any[];  // All tool call latencies from all iterations
}

export async function executeBenchmarkProblem(
  problem: MBPPProblem,
  mode: BenchmarkMode,
  inferenceService: InferenceService,
  inferenceConfig: any,
  messageId: string,
  sessionId: string,
  onToken: (token: string) => void,
  modelId?: string,
  isFirstIteration: boolean = true
): Promise<ExecutionResult> {
  // Only clear virtual filesystem on first iteration of a new problem
  const { PythonExecutor } = require('../services/PythonExecutor');
  const pythonExecutor = PythonExecutor.getInstance();
  if (isFirstIteration) {
    pythonExecutor.clearVirtualFilesystem();
    console.log('[benchmarkExecutor] Cleared virtual filesystem for new problem');
  } else {
    console.log('[benchmarkExecutor] Keeping virtual filesystem for iteration', messageId);
  }
  
  // Track files created during execution for code extraction
  const fileContents: Map<string, string> = new Map();
  console.log('[benchmarkExecutor] Starting execution for problem:', problem.id, 'in mode:', mode);
  const evaluationService = BenchmarkEvaluationService.getInstance();
  const performanceService = PerformanceService.getInstance();
  
  // Get appropriate system prompt with model-specific configuration
  const systemPrompt = evaluationService.getSystemPrompt(mode, modelId);
  const userPrompt = evaluationService.formatProblemForPrompt(problem, true, modelId);
  
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  // Configure inference based on mode
  const config = { ...inferenceConfig };
  
  // Detect model architecture to determine if it supports native tools
  const architecture = modelId ? detectModelArchitecture(modelId) : 'default';
  const supportsNativeTools = ['llama', 'default'].includes(architecture);
  
  // Only pass tools to models that support native tool calling
  if (supportsNativeTools && mode !== 'base') {
    const tools = getBenchmarkToolsForLlama(mode);
    if (tools.length > 0) {
      config.jinja = true;
      config.tools = tools;
      if (mode === 'tool_submission') {
        config.tool_choice = 'required';
      }
    }
  }
  // For models like Gemma, tool descriptions are in the system prompt

  let fullResponse = '';
  let extractedCode = '';
  let allToolCalls: any[] = [];
  let continueProcessing = true;
  let iterationCount = 0;
  const maxIterations = mode === 'full_tool' ? 10 : 1;
  let actualMessageId = '';  // Track the actual messageId used
  let toolCallValid = false;  // Track if valid tool call format was used
  let toolCallExtracted = false;  // Track if we managed to extract a tool call
  
  // Track metrics from first iteration (for TTFT) and aggregate tool latencies
  let firstIterationMetrics: any = null;
  let aggregatedToolCallLatencies: any[] = []

  while (continueProcessing && iterationCount < maxIterations) {
    iterationCount++;
    console.log(`[benchmarkExecutor] Starting iteration ${iterationCount} for mode ${mode}`);
    
    const result = await inferenceService.generateResponse(
      messages,
      config,
      (token: string) => {
        fullResponse += token;
        onToken(token);
      },
      `${messageId}_${iterationCount}`,
      sessionId
    );
    
    // Track the actual messageId used for this iteration
    actualMessageId = `${messageId}_${iterationCount}`;
    
    // Capture first iteration metrics for TTFT
    if (iterationCount === 1 && !firstIterationMetrics) {
      const performanceService = PerformanceService.getInstance();
      firstIterationMetrics = performanceService.getMessageMetrics(actualMessageId);
      console.log(`[benchmarkExecutor] Captured first iteration metrics, TTFT: ${firstIterationMetrics?.ttft}ms`);
    }
    
    console.log(`[benchmarkExecutor] Got response in iteration ${iterationCount}, checking for tool calls...`);

    // Handle different modes
    if (mode === 'base') {
      // Base mode: just extract code from response
      console.log('[benchmarkExecutor] Base mode - extracting code from response');
      extractedCode = evaluationService.extractCodeFromResponse(fullResponse) || '';
      console.log('[benchmarkExecutor] Extracted code:', extractedCode ? 'Found' : 'Not found');
      continueProcessing = false;
    } 
    else if (mode === 'tool_submission' || mode === 'full_tool') {
      // Look for tool calls
      let toolCalls = result?.tool_calls;
      
      // Check if we got native tool calls
      if (toolCalls && toolCalls.length > 0) {
        toolCallValid = true;
        toolCallExtracted = true;
        console.log('[benchmarkExecutor] Got native tool calls from model');
      }
      
      // For models that don't support native tools, always try extraction
      if (!supportsNativeTools || (!toolCalls && fullResponse)) {
        console.log('[benchmarkExecutor] Extracting tool calls from response for', modelId);
        const extractedTools = evaluationService.extractToolCallsFromResponse(fullResponse, modelId);
        if (extractedTools && extractedTools.length > 0) {
          console.log('[benchmarkExecutor] Extracted', extractedTools.length, 'tool call(s)');
          toolCallExtracted = true;
          
          // Check if it was in proper format based on model architecture
          const architecture = modelId ? detectModelArchitecture(modelId) : 'default';
          if (architecture === 'gemma') {
            // For Gemma, check if it used [function_name()] format
            toolCallValid = extractedTools.some(t => 
              fullResponse.includes(`[${t.name}(`) || fullResponse.includes('"name":'));
          } else {
            // For other models, check for tool_call blocks or JSON
            toolCallValid = fullResponse.includes('```tool_call') || 
                          fullResponse.includes('"tool_call"');
          }
          
          if (!toolCallValid) {
            console.log('[benchmarkExecutor] WARNING: Tool calls extracted but not in proper format!');
          }
          
          // Convert all extracted tools to the expected format
          toolCalls = extractedTools.map((tool, index) => ({
            type: 'function',
            function: {
              name: tool.name,
              arguments: tool.parameters
            },
            id: `tool_${Date.now()}_${index}`
          }));
        } else {
          console.log('[benchmarkExecutor] No tool calls extracted from response');
          toolCallValid = false;
          toolCallExtracted = false;
        }
      }

      if (toolCalls && toolCalls.length > 0) {
        allToolCalls.push(...toolCalls);
        
        // Collect all tool results first
        const toolResults: { name: string; result: string; error?: boolean }[] = [];
        let foundSubmitSolution = false;
        
        // Process all tool calls sequentially
        for (const toolCall of toolCalls) {
          const tool = findBenchmarkTool(toolCall.function.name, mode);
          
          if (tool) {
            if (toolCall.function.name === 'submit_python_solution') {
              foundSubmitSolution = true;
              // Extract code from submission
              console.log('[benchmarkExecutor] Found submit_python_solution tool call');
              const args = typeof toolCall.function.arguments === 'string' 
                ? JSON.parse(toolCall.function.arguments) 
                : toolCall.function.arguments;
              
              if (args.filename || args.file_path) {  // Handle both parameter names for backwards compatibility
                const filename = args.filename || args.file_path;
                // First check our tracked files
                if (fileContents.has(filename)) {
                  extractedCode = fileContents.get(filename) || '';
                  console.log('[benchmarkExecutor] Retrieved code from tracked file:', filename, 'length:', extractedCode.length);
                } else {
                  // Try to read from actual file system
                  console.log('[benchmarkExecutor] Reading solution from file:', filePath);
                  try {
                    const fileTools = findBenchmarkTool('read_file', mode);
                    if (fileTools) {
                      // Track file read timing
                      const currentIterationMessageId = `${messageId}_${iterationCount}`;
                      performanceService.startToolCall(currentIterationMessageId, 'read_file');
                      const readStartTime = Date.now();
                      
                      const fileContent = await fileTools.execute({ filename: filename });
                      extractedCode = fileContent;
                      
                      const readExecutionTime = Date.now() - readStartTime;
                      performanceService.endToolCall(currentIterationMessageId, readExecutionTime);
                      
                      console.log('[benchmarkExecutor] Read code from file, length:', extractedCode.length);
                    } else {
                      console.error('[benchmarkExecutor] read_file tool not available');
                      extractedCode = args.code || '';
                    }
                  } catch (error) {
                    console.error('[benchmarkExecutor] Error reading file:', error);
                    extractedCode = args.code || '';
                  }
                }
              } else {
                extractedCode = args.code || '';
                console.log('[benchmarkExecutor] Extracted code from direct submission, length:', extractedCode.length);
              }
              
              // Mark that we're done after submit_python_solution
              continueProcessing = false;
              // Don't break - process remaining tool calls in the same response
            } else if (mode === 'full_tool') {
              // Execute other tools in full tool mode
              try {
                const args = typeof toolCall.function.arguments === 'string' 
                  ? JSON.parse(toolCall.function.arguments) 
                  : toolCall.function.arguments;
                
                console.log(`[benchmarkExecutor] Executing tool ${toolCall.function.name} with args:`, args);
                
                // Track file contents for upsert_file
                if (toolCall.function.name === 'upsert_file') {
                  const filename = args.filename || args.file_path;  // Handle both parameter names for backwards compatibility
                  if (filename && args.content) {
                    fileContents.set(filename, args.content);
                    console.log(`[benchmarkExecutor] Tracked file content for ${filename}, length:`, args.content.length);
                  }
                }
                
                // Track tool call timing
                const currentIterationMessageId = `${messageId}_${iterationCount}`;
                performanceService.startToolCall(currentIterationMessageId, toolCall.function.name);
                const toolStartTime = Date.now();
                
                let toolResult;
                
                // Special handling for test_solution
                if (toolCall.function.name === 'test_solution') {
                  const filename = args.filename;
                  console.log('[benchmarkExecutor] Running test_solution for:', filename);
                  
                  // Get the code from tracked files
                  let codeToTest = '';
                  if (fileContents.has(filename)) {
                    codeToTest = fileContents.get(filename) || '';
                  } else {
                    // Try to read from virtual filesystem
                    try {
                      const readTool = findBenchmarkTool('read_file', mode);
                      if (readTool) {
                        codeToTest = await readTool.execute({ filename });
                      }
                    } catch (error) {
                      console.error('[benchmarkExecutor] Could not read file for testing:', error);
                    }
                  }
                  
                  if (codeToTest) {
                    // Run the actual tests using the evaluation service
                    const testResults = await evaluationService.evaluateSolution(problem, codeToTest);
                    const passed = testResults.testResults.filter(t => t.passed).length;
                    const total = testResults.testResults.length;
                    
                    if (testResults.success) {
                      toolResult = `All ${total} tests passed`;
                    } else {
                      toolResult = `${passed}/${total} tests passed\n`;
                      testResults.testResults.forEach((test, i) => {
                        if (!test.passed) {
                          const testCase = typeof test.testCase === 'string' ? test.testCase : `Test ${i+1}`;
                          toolResult += `FAILED: ${testCase}\n`;
                          if (test.error) {
                            toolResult += `  Error: ${test.error}\n`;
                          }
                        }
                      });
                    }
                  } else {
                    toolResult = `Error: File ${filename} not found`;
                  }
                } else {
                  // Pass parameters as-is for other tools
                  const normalizedArgs = { ...args };
                  toolResult = await tool.execute(normalizedArgs);
                }
                
                const toolExecutionTime = Date.now() - toolStartTime;
                performanceService.endToolCall(currentIterationMessageId, toolExecutionTime);
                
                console.log(`[benchmarkExecutor] Tool ${toolCall.function.name} result:`, toolResult);
                
                // Collect the result
                toolResults.push({
                  name: toolCall.function.name,
                  result: String(toolResult)
                });
              } catch (error) {
                console.error(`[benchmarkExecutor] Tool ${toolCall.function.name} error:`, error);
                
                // Collect the error
                toolResults.push({
                  name: toolCall.function.name,
                  result: String(error),
                  error: true
                });
              }
            }
          } else {
            console.warn(`[benchmarkExecutor] Tool ${toolCall.function.name} not found`);
          }
        }
        
        // After processing all tool calls, update the conversation if needed
        if (mode === 'full_tool' && toolResults.length > 0 && !foundSubmitSolution) {
          // Add the assistant's message with tool calls
          messages.push({
            role: 'assistant',
            content: fullResponse
          });
          
          // Build a single user message with all tool results
          let toolResultsMessage = '';
          for (const toolResult of toolResults) {
            if (toolResult.error) {
              toolResultsMessage += `Tool error for ${toolResult.name}:\n${toolResult.result}\n\n`;
            } else {
              toolResultsMessage += `Tool result for ${toolResult.name}:\n${toolResult.result}\n\n`;
            }
          }
          toolResultsMessage += 'Continue working on the solution. When ready, use submit_python_solution to submit your final code.';
          
          messages.push({
            role: 'user',
            content: toolResultsMessage
          });
          
          // Clear response for next iteration
          fullResponse = '';
        } else if (foundSubmitSolution) {
          // We found submit_python_solution, stop processing
          continueProcessing = false;
        }
      } else {
        // No tool calls found
        if (mode === 'tool_submission') {
          // Try to extract code anyway
          console.log('[benchmarkExecutor] No tool calls in tool_submission mode, trying to extract code from response');
          console.log('[benchmarkExecutor] WARNING: Model did not return proper tool call format!');
          toolCallValid = false;
          toolCallExtracted = false;
          extractedCode = evaluationService.extractCodeFromResponse(fullResponse) || '';
        } else if (mode === 'full_tool' && iterationCount > 1) {
          // In full_tool mode, if we've done iterations but no tool calls, the model might be done
          console.log('[benchmarkExecutor] No more tool calls in full_tool mode, model might be done');
          // Try to extract code from the final response
          extractedCode = evaluationService.extractCodeFromResponse(fullResponse) || '';
        }
        continueProcessing = false;
      }
    }
  }

  // If no code extracted, try one more time
  if (!extractedCode) {
    console.log('[benchmarkExecutor] No code extracted yet, trying final extraction...');
    extractedCode = evaluationService.extractCodeFromResponse(fullResponse) || '';
  }

  console.log('[benchmarkExecutor] Final result:');
  console.log('[benchmarkExecutor] - Response length:', fullResponse.length);
  console.log('[benchmarkExecutor] - Code extracted:', !!extractedCode);
  console.log('[benchmarkExecutor] - Code length:', extractedCode.length);
  console.log('[benchmarkExecutor] - Tool calls:', allToolCalls.length);
  
  // Collect all tool call latencies from all iterations
  for (let i = 1; i <= iterationCount; i++) {
    const iterMessageId = `${messageId}_${i}`;
    const iterMetrics = performanceService.getMessageMetrics(iterMessageId);
    console.log(`[benchmarkExecutor] Checking iteration ${i} metrics for ${iterMessageId}:`, {
      hasMetrics: !!iterMetrics,
      hasToolLatencies: !!iterMetrics?.toolCallLatencies,
      toolLatencyCount: iterMetrics?.toolCallLatencies?.length || 0
    });
    if (iterMetrics?.toolCallLatencies && iterMetrics.toolCallLatencies.length > 0) {
      aggregatedToolCallLatencies.push(...iterMetrics.toolCallLatencies);
      console.log(`[benchmarkExecutor] Added ${iterMetrics.toolCallLatencies.length} tool latencies from iteration ${i}`);
    }
  }
  
  return {
    response: fullResponse,
    code: extractedCode,
    toolCalls: allToolCalls,
    success: !!extractedCode,
    actualMessageId: actualMessageId || messageId,
    toolCallValid: mode === 'tool_submission' ? toolCallValid : undefined,
    toolCallExtracted: mode === 'tool_submission' ? toolCallExtracted : undefined,
    // Include first iteration metrics and aggregated tool latencies
    firstIterationTTFT: firstIterationMetrics?.ttft,
    aggregatedToolCallLatencies: aggregatedToolCallLatencies
  };
}