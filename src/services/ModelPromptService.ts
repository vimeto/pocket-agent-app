/**
 * Model-specific prompt configurations for benchmarking
 * Based on CLI implementation to ensure consistency
 */

export type BenchmarkMode = 'base' | 'tool_submission' | 'full_tool';
export type ModelArchitecture = 'gemma' | 'llama' | 'qwen' | 'default';

interface PromptConfig {
  systemPrompt: string;
  userSuffix?: string;
  toolFormatExample?: string;
}

interface ModelPrompts {
  base: PromptConfig;
  tool_submission: PromptConfig;
  full_tool: PromptConfig;
}

export class ModelPromptService {
  private static instance: ModelPromptService;

  private modelPrompts: Record<string, ModelPrompts> = {
    gemma: {
      base: {
        systemPrompt: "Output ONLY code. No text.",
        userSuffix: "\n\nONLY Python function:"
      },
      tool_submission: {
        systemPrompt: 'Output ONLY: [submit_python_solution(code="...")]',
        userSuffix: '\n\nSubmit using [submit_python_solution(code="...")]:'
      },
      full_tool: {
        systemPrompt: `CRITICAL: You are an AI coding assistant with access to these EXACT tools:

1. run_python_code - Execute Python code directly
   Parameters: code (string)
   Example: [run_python_code(code="print(2+2)")]

2. upsert_file - Create or update a file with content
   Parameters: filename (string), content (string)
   Example: [upsert_file(filename="solution.py", content="def func():\\n    return 42")]

3. read_file - Read contents of an existing file
   Parameters: filename (string)
   Example: [read_file(filename="test.py")]

4. test_solution - Test your solution against the submission test cases
   Parameters: filename (string)
   Example: [test_solution(filename="solution.py")]

5. submit_python_solution - Submit your final solution (REQUIRED)
   Parameters: code (string) OR filename (string)
   Example: [submit_python_solution(filename="solution.py")]

OUTPUT FORMAT: Use ONLY [function_name(param="value")] or {"name": "function_name", "parameters": {...}}

WORKFLOW EXAMPLE:
Q: Write a function to calculate factorial
A: [upsert_file(filename="factorial.py", content="def factorial(n):\\n    if n <= 1:\\n        return 1\\n    return n * factorial(n-1)")]
System: File created
A: [test_solution(filename="factorial.py")]
System: All tests passed
A: [submit_python_solution(filename="factorial.py")]

RULES:
- MUST call submit_python_solution at the end
- NO explanations or plain text
- NO \`\`\`python blocks
- ONLY tool calls in the specified format`,
        toolFormatExample: `Example function calls:
[run_python_code(code="print('Hello')")]
[submit_python_solution(code="def solution():\\n    return 42")]
{"name": "read_file", "parameters": {"filename": "test.py"}}`
      }
    },
    llama: {
      base: {
        systemPrompt: "Generate Python function. Code only.",
        userSuffix: ""
      },
      tool_submission: {
        systemPrompt: "Use submit_python_solution tool.",
        userSuffix: ""
      },
      full_tool: {
        systemPrompt: `You have a Python development environment with these tools:

AVAILABLE TOOLS:
1. run_python_code(code="...") - Execute Python code
2. upsert_file(filename="...", content="...") - Create/update files
3. read_file(filename="...") - Read file contents
4. test_solution(filename="...") - Test your solution against the submission test cases
5. submit_python_solution(code="..." OR filename="...") - Submit final solution (REQUIRED IN FINAL STEP)

Use tools in \`\`\`tool_call blocks with JSON format:
\`\`\`tool_call
{"name": "tool_name", "parameters": {"param": "value"}}
\`\`\`

EXAMPLE:
U: Write a function that calculates the factorial of the difference between two numbers.\n\nTest cases:\nassert factorial_difference(5, 3) == 2\nassert factorial_difference(10, 4) == 720
A: [upsert_file(filename="factorial_difference.py", content="def factorial_difference(a, b):\\n    def factorial(n):\\n        if n == 0:\\n            return 1\\n        return n * factorial(n - 1)\\n    return factorial(abs(a - b))")]
U: Tool result 1: File created\n\nContinue working on the solution
A: [test_solution(filename="factorial_difference.py")]
U: Tool result 2: All tests passed\n\nContinue working on the solution
A: [submit_python_solution(filename="factorial_difference.py")]

You MUST use submit_python_solution to submit your final solution.`,
        toolFormatExample: `\`\`\`tool_call
{"name": "submit_python_solution", "parameters": {"code": "solution code here"}}
\`\`\``
      }
    },
    qwen: {
      base: {
        systemPrompt: "You are a Python programmer. Complete functions by providing the implementation.",
        userSuffix: "\n\nComplete this function:"
      },
      tool_submission: {
        systemPrompt: `Submit Python solutions using this exact format:

\`\`\`tool_call
{"name": "submit_python_solution", "parameters": {"code": "solution"}}
\`\`\`

Always wrap tool calls in \`\`\`tool_call blocks.`,
        userSuffix: "\n\nSubmit the complete function:"
      },
      full_tool: {
        systemPrompt: `Example input: def add(a, b): '''Add two numbers'''
Example output:
\`\`\`tool_call
{"name": "submit_python_solution", "parameters": {"code": "def add(a, b):\\n    return a + b"}}
\`\`\`

Follow this exact pattern. Available tools:
1. run_python_code - Execute code
2. upsert_file - Create/update files (filename, content)
3. read_file - Read files (filename)
4. test_solution - Test your solution (filename)
5. submit_python_solution - Submit final solution (REQUIRED)

Always use \`\`\`tool_call format.`,
        userSuffix: "\n\nYour output:",
        toolFormatExample: `\`\`\`tool_call
{"name": "submit_python_solution", "parameters": {"code": "solution"}}
\`\`\``
      }
    },
    default: {
      base: {
        systemPrompt: "Generate Python function code only.",
        userSuffix: ""
      },
      tool_submission: {
        systemPrompt: "Use submit_python_solution tool to submit code.",
        userSuffix: ""
      },
      full_tool: {
        systemPrompt: `Python env. Tools: run_python_code (code/file), upsert_file, read_file, submit_python_solution.
MUST submit final solution with submit_python_solution.`,
        toolFormatExample: `\`\`\`tool_call
{"name": "tool_name", "parameters": {}}
\`\`\``
      }
    }
  };

  // Model-specific overrides for particular model IDs
  private modelIdOverrides: Record<string, PromptConfig> = {
    'qwen-3-0.6b': {
      systemPrompt: `Example input: def add(a, b): '''Add two numbers'''
Example output:
\`\`\`tool_call
{"name": "submit_python_solution", "parameters": {"code": "def add(a, b):\\n    return a + b"}}
\`\`\`

Follow this exact pattern. Available tools:
1. run_python_code - Execute code
2. upsert_file - Create/update files (filename, content)
3. read_file - Read files (filename)
4. test_solution - Test your solution (filename)
5. submit_python_solution - Submit final solution (REQUIRED)

Always use \`\`\`tool_call format.`,
      userSuffix: "\n\nYour output:"
    },
    'deepseek-r1-distill-qwen-1.5b': {
      systemPrompt: `You are a Python coding assistant. Use these tools:

1. run_python_code(code="...") - Execute Python code
2. upsert_file(filename="...", content="...") - Create/update files
3. read_file(filename="...") - Read file contents
4. test_solution(filename="...") - Test your solution against submission test cases
5. submit_python_solution(code="..." OR filename="...") - Submit final solution (REQUIRED)

Output tool calls in \`\`\`tool_call blocks:
\`\`\`tool_call
{"name": "submit_python_solution", "parameters": {"code": "def solution():\\n    return result"}}
\`\`\`

You MUST call submit_python_solution with your complete solution.`,
      userSuffix: "\n\nSolve and submit:"
    },
    'qwen-3-4b': {
      systemPrompt: `You are a Python coding assistant. Use these tools:

1. run_python_code(code="...") - Execute Python code
2. upsert_file(filename="...", content="...") - Create/update files
3. read_file(filename="...") - Read file contents
4. test_solution(filename="...") - Test your solution against submission test cases
5. submit_python_solution(code="..." OR filename="...") - Submit final solution (REQUIRED)

Output tool calls in \`\`\`tool_call blocks:
\`\`\`tool_call
{"name": "submit_python_solution", "parameters": {"code": "def solution():\\n    return result"}}
\`\`\`

You MUST call submit_python_solution with your complete solution.`,
      userSuffix: "\n\nSolve and submit:"
    }
  };

  private constructor() {}

  static getInstance(): ModelPromptService {
    if (!ModelPromptService.instance) {
      ModelPromptService.instance = new ModelPromptService();
    }
    return ModelPromptService.instance;
  }

  /**
   * Get model-specific prompt configuration for a given mode
   * @param architecture Model architecture (gemma, llama, qwen, etc.)
   * @param mode Benchmark mode (base, tool_submission, full_tool)
   * @param modelId Optional specific model ID for fine-tuned prompts
   * @returns Prompt configuration with system prompt and optional tool format example and user suffix
   */
  getModelPrompt(
    architecture: ModelArchitecture | string,
    mode: BenchmarkMode,
    modelId?: string
  ): PromptConfig {
    // Check for model-specific overrides in full_tool mode
    if (mode === 'full_tool' && modelId && this.modelIdOverrides[modelId]) {
      return this.modelIdOverrides[modelId];
    }

    // Get architecture-specific prompts or default
    const archPrompts = this.modelPrompts[architecture] || this.modelPrompts.default;
    return archPrompts[mode];
  }

  /**
   * Detect model architecture from model ID
   * @param modelId The model identifier
   * @returns The detected architecture
   */
  detectArchitecture(modelId: string): ModelArchitecture {
    const lowerModelId = modelId.toLowerCase();

    if (lowerModelId.includes('gemma')) {
      return 'gemma';
    } else if (lowerModelId.includes('llama')) {
      return 'llama';
    } else if (lowerModelId.includes('qwen')) {
      return 'qwen';
    }

    return 'default';
  }

  /**
   * Format a problem for the model with appropriate prompt structure
   * @param problem The MBPP problem
   * @param architecture Model architecture
   * @param mode Benchmark mode
   * @param modelId Optional specific model ID
   * @returns Formatted prompt string
   */
  formatProblemPrompt(
    problem: any,
    architecture: ModelArchitecture | string,
    mode: BenchmarkMode,
    modelId?: string
  ): string {
    const config = this.getModelPrompt(architecture, mode, modelId);

    // DO NOT include the solution code! Only description and test cases
    let prompt = problem.description;

    if (problem.testCases && problem.testCases.length > 0) {
      prompt += '\n\nTest cases:';
      problem.testCases.forEach((test: string) => {
        prompt += '\n' + test;
      });
    }

    // Add user suffix if specified
    if (config.userSuffix) {
      prompt += config.userSuffix;
    }

    return prompt;
  }

  /**
   * Get the full system prompt for a benchmark run
   * @param architecture Model architecture
   * @param mode Benchmark mode
   * @param modelId Optional specific model ID
   * @returns System prompt string
   */
  getSystemPrompt(
    architecture: ModelArchitecture | string,
    mode: BenchmarkMode,
    modelId?: string
  ): string {
    const config = this.getModelPrompt(architecture, mode, modelId);
    return config.systemPrompt;
  }

  /**
   * Get tool format example for the model
   * @param architecture Model architecture
   * @param mode Benchmark mode
   * @param modelId Optional specific model ID
   * @returns Tool format example string or undefined
   */
  getToolFormatExample(
    architecture: ModelArchitecture | string,
    mode: BenchmarkMode,
    modelId?: string
  ): string | undefined {
    const config = this.getModelPrompt(architecture, mode, modelId);
    return config.toolFormatExample;
  }

  /**
   * Check if a model needs special handling for tool calls
   * @param modelId The model identifier
   * @returns True if the model needs special handling
   */
  needsSpecialToolHandling(modelId: string): boolean {
    return modelId in this.modelIdOverrides;
  }

}
