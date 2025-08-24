import { PythonExecutor } from '../services/PythonExecutor';

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };
  };
  execute: (params: any) => Promise<any>;
}

const pythonExecutor = PythonExecutor.getInstance();

export const AVAILABLE_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'run_python_code',
      description: 'Execute Python code and return the output',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The Python code to execute'
          }
        },
        required: ['code']
      }
    },
    execute: async (params: { code: string }) => {
      return await pythonExecutor.runPythonCode(params.code);
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_python_file',
      description: 'Execute a Python file by name and return the output',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'The name of the Python file to execute'
          }
        },
        required: ['filename']
      }
    },
    execute: async (params: { filename: string }) => {
      return await pythonExecutor.runPythonFile(params.filename);
    }
  },
  {
    type: 'function',
    function: {
      name: 'upsert_file',
      description: 'Create or update a file with the given content',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'The name of the file to save'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file'
          }
        },
        required: ['filename', 'content']
      }
    },
    execute: async (params: { filename: string; content: string }) => {
      await pythonExecutor.upsertFile(params.filename, params.content);
      return `File ${params.filename} saved successfully`;
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file by name',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'The name of the file to delete'
          }
        },
        required: ['filename']
      }
    },
    execute: async (params: { filename: string }) => {
      await pythonExecutor.deleteFile(params.filename);
      return `File ${params.filename} deleted successfully`;
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all files in the sandbox',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    execute: async () => {
      const files = await pythonExecutor.listFiles();
      return files.join('\n');
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'The name of the file to read'
          }
        },
        required: ['filename']
      }
    },
    execute: async (params: { filename: string }) => {
      return await pythonExecutor.readFile(params.filename);
    }
  }
];

export function getToolsForLlama() {
  return AVAILABLE_TOOLS.map(tool => ({
    type: tool.type,
    function: tool.function
  }));
}

export function findTool(name: string): Tool | undefined {
  return AVAILABLE_TOOLS.find(tool => tool.function.name === name);
}

export function formatToolsForPrompt(): string {
  return AVAILABLE_TOOLS.map(tool => {
    const params = Object.entries(tool.function.parameters.properties)
      .map(([key, prop]: [string, any]) => `  - ${key}: ${prop.type} - ${prop.description}`)
      .join('\n');
    
    return `${tool.function.name}:
  ${tool.function.description}\n  Parameters:\n${params}`;
  }).join('\n\n');
}