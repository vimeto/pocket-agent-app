import { Tool, AVAILABLE_TOOLS } from './tools';
import { PythonExecutor } from '../services/PythonExecutor';

const pythonExecutor = PythonExecutor.getInstance();

// Tool for testing solutions before submission
export const TEST_SOLUTION_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'test_solution',
    description: 'Test your solution against the submission test cases. Reads the solution from a file and runs all tests.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The name of the Python file containing your solution'
        }
      },
      required: ['filename']
    }
  },
  execute: async (params: { filename: string }) => {
    // This will be handled in the benchmark executor to run against actual test cases
    // Here we just return a placeholder
    return { testing: true, filename: params.filename };
  }
};

// This is a special tool only available in benchmark mode
export const SUBMIT_SOLUTION_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'submit_python_solution',
    description: 'Submit your final Python solution for the problem. You can either provide the code directly OR a filename.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The complete Python code solution (use this if you have the code as a string)'
        },
        filename: {
          type: 'string',
          description: 'Name of the Python file containing the solution (use this if you saved the solution to a file)'
        }
      },
      required: [] // Neither is strictly required, but one must be provided
    }
  },
  execute: async (params: { code?: string; filename?: string }) => {
    // This is handled specially in benchmark mode
    // The actual file reading (if filename is provided) will be done in benchmarkExecutor
    return { submitted: true, code: params.code, filename: params.filename };
  }
};

export function getToolsForBenchmark(mode: 'base' | 'tool_submission' | 'full_tool') {
  switch (mode) {
    case 'base':
      // No tools in base mode
      return [];
    
    case 'tool_submission':
      // Only submit tool
      return [SUBMIT_SOLUTION_TOOL];
    
    case 'full_tool':
      // All tools including test and submit
      return [...AVAILABLE_TOOLS, TEST_SOLUTION_TOOL, SUBMIT_SOLUTION_TOOL];
    
    default:
      return [];
  }
}

export function getBenchmarkToolsForLlama(mode: 'base' | 'tool_submission' | 'full_tool') {
  return getToolsForBenchmark(mode).map(tool => ({
    type: tool.type,
    function: tool.function
  }));
}

export function findBenchmarkTool(name: string, mode: 'base' | 'tool_submission' | 'full_tool'): Tool | undefined {
  const tools = getToolsForBenchmark(mode);
  return tools.find(tool => tool.function.name === name);
}