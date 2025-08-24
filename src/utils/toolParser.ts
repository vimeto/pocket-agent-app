import { findTool } from '../config/tools';

export interface ToolCall {
  name: string;
  parameters: any;
  id: string;
}

export interface ToolResult {
  id: string;
  result?: any;
  error?: string;
}

// Parse tool calls from LLM output
// Expected format: <tool_call>{"name": "tool_name", "parameters": {...}}</tool_call>
export function parseToolCalls(text: string): { 
  cleanText: string; 
  toolCalls: ToolCall[] 
} {
  const toolCalls: ToolCall[] = [];
  const toolCallRegex = /<tool_call>(.*?)<\/tool_call>/gs;
  let cleanText = text;
  let match;
  let callIndex = 0;

  while ((match = toolCallRegex.exec(text)) !== null) {
    try {
      const toolData = JSON.parse(match[1]);
      if (toolData.name && typeof toolData.name === 'string') {
        toolCalls.push({
          name: toolData.name,
          parameters: toolData.parameters || {},
          id: `call_${callIndex++}`
        });
      }
    } catch (error) {
      console.error('Failed to parse tool call:', error);
    }
  }

  // Remove tool calls from the text
  cleanText = text.replace(toolCallRegex, '').trim();

  return { cleanText, toolCalls };
}

// Execute tool calls
export async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of toolCalls) {
    const tool = findTool(call.name);
    
    if (!tool) {
      results.push({
        id: call.id,
        error: `Unknown tool: ${call.name}`
      });
      continue;
    }

    try {
      const result = await tool.execute(call.parameters);
      results.push({
        id: call.id,
        result
      });
    } catch (error) {
      results.push({
        id: call.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

// Format tool results for inclusion in the conversation
export function formatToolResults(results: ToolResult[]): string {
  if (results.length === 0) return '';

  return '<tool_results>\n' + 
    results.map(r => {
      if (r.error) {
        return `[${r.id}] Error: ${r.error}`;
      }
      return `[${r.id}] Result: ${r.result}`;
    }).join('\n\n') + 
    '\n</tool_results>';
}