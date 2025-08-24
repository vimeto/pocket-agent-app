/**
 * Advanced tool extraction service for parsing LLM responses
 * Based on CLI implementation with comprehensive format support
 */

export interface ExtractedTool {
  name: string;
  parameters: Record<string, any>;
}

export interface ExtractionResult {
  tools: ExtractedTool[];
  error?: string;
}

export class ToolExtractorService {
  private static instance: ToolExtractorService;

  private constructor() {}

  static getInstance(): ToolExtractorService {
    if (!ToolExtractorService.instance) {
      ToolExtractorService.instance = new ToolExtractorService();
    }
    return ToolExtractorService.instance;
  }

  /**
   * Extract tool calls from response using multiple strategies
   * @param response The LLM response text
   * @param modelArchitecture The model architecture (gemma, llama, qwen, etc.)
   * @returns Extraction result with tools and optional error
   */
  extractTools(response: string, modelArchitecture?: string): ExtractionResult {
    const tools: ExtractedTool[] = [];
    
    // Remove thinking blocks first
    const cleanedResponse = this.removeThinkingBlocks(response);
    
    // Try multiple extraction strategies in order of preference
    const strategies = [
      () => this.extractGemmaPythonStyle(cleanedResponse),
      () => this.extractGemmaJsonStyle(cleanedResponse),
      () => this.extractToolCallWrapper(cleanedResponse),  // New format with tool_call wrapper
      () => this.extractQwenThinkingJson(cleanedResponse),
      () => this.extractDeepSeekFunctionFormat(cleanedResponse),
      () => this.extractToolCallBlocks(cleanedResponse),
      () => this.extractToolCodeBlocks(cleanedResponse),
      () => this.extractJsonBlocks(cleanedResponse),
      () => this.extractDirectJson(cleanedResponse),
      () => this.extractPythonSubmission(cleanedResponse),
    ];
    
    for (const strategy of strategies) {
      const extracted = strategy();
      if (extracted.length > 0) {
        tools.push(...extracted);
      }
    }
    
    // Deduplicate tools
    const uniqueTools = this.deduplicateTools(tools);
    
    if (uniqueTools.length === 0) {
      if (modelArchitecture === 'gemma') {
        return {
          tools: [],
          error: 'No function calls found. Use format: [function_name(param=value)] or {"name": "function", "parameters": {...}}'
        };
      }
      return {
        tools: [],
        error: 'No tool calls parsed. Return tool calls in ```tool_call\n{...}``` blocks.'
      };
    }
    
    return { tools: uniqueTools };
  }

  /**
   * Extract Gemma's Python-style function calls: [func_name(param=value)]
   */
  private extractGemmaPythonStyle(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /\[([a-zA-Z_]\w*)\(/g;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const funcName = match[1];
      const start = match.index! + match[0].length;
      
      // Find matching closing parenthesis
      let parenCount = 1;
      let i = start;
      while (i < response.length && parenCount > 0) {
        if (response[i] === '(' && (i === 0 || response[i-1] !== '\\')) {
          parenCount++;
        } else if (response[i] === ')' && (i === 0 || response[i-1] !== '\\')) {
          parenCount--;
        }
        i++;
      }
      
      if (parenCount === 0) {
        // Look for closing bracket
        let j = i;
        while (j < response.length && /\s/.test(response[j])) {
          j++;
        }
        
        if (j < response.length && response[j] === ']') {
          // Found complete function call
          const paramsStr = response.substring(start, i - 1);
          const params = this.parseGemmaParameters(paramsStr);
          
          tools.push({
            name: funcName,
            parameters: params
          });
        }
      }
    }
    
    return tools;
  }

  /**
   * Parse Gemma-style parameters (key=value pairs)
   */
  private parseGemmaParameters(paramsStr: string): Record<string, any> {
    const params: Record<string, any> = {};
    
    if (!paramsStr.trim()) {
      return params;
    }
    
    // Parse key=value pairs with proper quote handling
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar: string | null = null;
    let escapeCount = 0;
    
    for (let i = 0; i < paramsStr.length; i++) {
      const char = paramsStr[i];
      
      if (char === '\\') {
        escapeCount++;
        current += char;
        continue;
      }
      
      if ((char === '"' || char === "'") && (!inQuotes || char === quoteChar)) {
        // Check if quote is escaped
        if (escapeCount % 2 === 1) {
          current += char;
          escapeCount = 0;
          continue;
        }
        
        inQuotes = !inQuotes;
        if (inQuotes) {
          quoteChar = char;
        } else {
          quoteChar = null;
        }
        current += char;
      } else if (char === ',' && !inQuotes) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
      
      if (char !== '\\') {
        escapeCount = 0;
      }
    }
    
    if (current.trim()) {
      parts.push(current.trim());
    }
    
    // Parse each parameter
    for (const part of parts) {
      const eqIndex = part.indexOf('=');
      if (eqIndex > 0) {
        const key = part.substring(0, eqIndex).trim();
        let value = part.substring(eqIndex + 1).trim();
        
        // Remove quotes and handle escapes
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        // Unescape common sequences
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '\\');
        
        params[key] = value;
      }
    }
    
    return params;
  }

  /**
   * Extract Qwen's thinking patterns (after removing thinking blocks)
   */
  private extractQwenThinkingJson(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"parameters"\s*:\s*\{[^{}]*\}[^{}]*\}/g;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      try {
        const tool = JSON.parse(match[0]);
        if (this.validateTool(tool)) {
          tools.push(tool);
        }
      } catch {
        // Continue to next match
      }
    }
    
    return tools;
  }

  /**
   * Extract DeepSeek's 'functions.tool_name:' format
   */
  private extractDeepSeekFunctionFormat(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /functions\.([a-zA-Z_]\w*):\s*(.*?)(?=functions\.|$)/gs;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const toolName = match[1];
      const paramsText = match[2].trim();
      
      let params: Record<string, any> = {};
      
      if (paramsText) {
        // Try to parse as JSON if it looks like JSON
        if (paramsText.startsWith('{')) {
          try {
            const firstLine = paramsText.split('\n')[0];
            params = JSON.parse(firstLine);
          } catch {
            // Not JSON, try to extract code
            const codeLines = paramsText.split('\n');
            const code = codeLines
              .filter(line => line.trim())
              .join('\n');
            if (code) {
              params = { code };
            }
          }
        } else if (paramsText.includes('\n')) {
          // Extract code from following lines
          const code = paramsText.split('\n')
            .filter(line => line.trim())
            .join('\n');
          if (code) {
            params = { code };
          }
        }
      }
      
      // Special handling for submit_python_solution
      if (toolName === 'submit_python_solution' && Object.keys(params).length === 0) {
        // Look for code after the function call
        const remainingResponse = response.substring(match.index! + match[0].length);
        const codeMatch = remainingResponse.match(/def\s+\w+.*?(?:\n\n|$)/s);
        if (codeMatch) {
          params = { code: codeMatch[0].trim() };
        }
      }
      
      tools.push({
        name: toolName,
        parameters: params
      });
    }
    
    return tools;
  }

  /**
   * Extract Gemma's JSON-style function calls
   */
  private extractGemmaJsonStyle(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /(?<!\w)(\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"parameters"\s*:\s*\{[^{}]*\}[^{}]*\})(?!\w)/g;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      try {
        const tool = JSON.parse(match[1]);
        if (this.validateTool(tool)) {
          tools.push(tool);
        }
      } catch {
        // Continue to next match
      }
    }
    
    return tools;
  }

  /**
   * Extract from ```tool_call blocks
   */
  private extractToolCallBlocks(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /```tool_call\s*(.*?)```/gs;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const content = match[1].trim();
      
      try {
        // Clean up JSON
        const cleaned = this.fixJsonNewlines(content)
          .replace(/,\s*([}\]])/g, '$1'); // Remove trailing commas
        
        const tool = JSON.parse(cleaned);
        if (this.validateTool(tool)) {
          tools.push(tool);
        }
      } catch {
        // Try alternative parsing for malformed JSON
        const tool = this.parseMalformedJson(content);
        if (tool && this.validateTool(tool)) {
          tools.push(tool);
        }
      }
    }
    
    return tools;
  }

  /**
   * Extract from ```tool_code blocks
   */
  private extractToolCodeBlocks(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /```tool_code\s*(.*?)```/gs;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      try {
        const tool = JSON.parse(match[1].trim());
        if (this.validateTool(tool)) {
          tools.push(tool);
        }
      } catch {
        // Continue to next match
      }
    }
    
    return tools;
  }

  /**
   * Extract from ```json blocks
   */
  private extractJsonBlocks(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /```json\s*(.*?)```/gs;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      try {
        const data = JSON.parse(match[1].trim());
        
        // Handle single tool
        if (this.isValidTool(data)) {
          tools.push(data);
        }
        // Handle array of tools
        else if (Array.isArray(data)) {
          for (const item of data) {
            if (this.isValidTool(item)) {
              tools.push(item);
            }
          }
        }
      } catch {
        // Continue to next match
      }
    }
    
    return tools;
  }

  /**
   * Extract tool_call wrapper format (common in llama.rn responses)
   */
  private extractToolCallWrapper(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    
    // Pattern for {"tool_call": {"name": "...", "arguments": {...}}}
    const pattern = /\{\s*"tool_call"\s*:\s*\{([^}]+\}[^}]*)\}\s*\}/gs;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      try {
        // Parse the inner tool_call object
        const innerJson = '{' + match[1] + '}';
        const parsed = JSON.parse(innerJson);
        
        // Convert arguments to parameters
        if (parsed.name && parsed.arguments) {
          tools.push({
            name: parsed.name,
            parameters: parsed.arguments
          });
        }
      } catch (e) {
        // Try manual extraction
        const content = match[0];
        const nameMatch = content.match(/"name"\s*:\s*"([^"]+)"/s);
        const codeMatch = content.match(/"code"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        
        if (nameMatch) {
          const name = nameMatch[1];
          const parameters: Record<string, any> = {};
          
          if (codeMatch) {
            // Unescape the code
            parameters.code = codeMatch[1]
              .replace(/\\n/g, '\n')
              .replace(/\\t/g, '\t')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\');
          }
          
          // Also check for file_path
          const filePathMatch = content.match(/"file_path"\s*:\s*"([^"]+)"/s);
          if (filePathMatch) {
            parameters.file_path = filePathMatch[1];
          }
          
          if (Object.keys(parameters).length > 0 || name === 'submit_python_solution') {
            tools.push({ name, parameters });
          }
        }
      }
    }
    
    return tools;
  }

  /**
   * Extract direct JSON objects
   */
  private extractDirectJson(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"parameters"\s*:\s*\{[^{}]*\}[^{}]*\}/g;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      try {
        const tool = JSON.parse(match[0]);
        if (this.validateTool(tool)) {
          tools.push(tool);
        }
      } catch {
        // Continue to next match
      }
    }
    
    return tools;
  }

  /**
   * Extract Python code blocks as submit_python_solution calls
   */
  private extractPythonSubmission(response: string): ExtractedTool[] {
    const tools: ExtractedTool[] = [];
    const pattern = /```python\s*(.*?)```/gs;
    
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const code = match[1].trim();
      // Only treat as submission if it contains function definition
      if (code.includes('def ')) {
        tools.push({
          name: 'submit_python_solution',
          parameters: { code }
        });
      }
    }
    
    return tools;
  }

  /**
   * Remove thinking blocks from response
   */
  private removeThinkingBlocks(text: string): string {
    let filtered = text;
    
    const patterns = [
      /<think>.*?<\/think>/gis,
      /<thinking>.*?<\/thinking>/gis,
      /<thought>.*?<\/thought>/gis,
      /<reflection>.*?<\/reflection>/gis,
    ];
    
    for (const pattern of patterns) {
      filtered = filtered.replace(pattern, '');
    }
    
    // Clean up extra whitespace
    return filtered.replace(/\n\n+/g, '\n\n').trim();
  }

  /**
   * Validate tool structure
   */
  private validateTool(tool: any): tool is ExtractedTool {
    if (!tool || typeof tool !== 'object') {
      return false;
    }
    
    // Must have name field
    if (!tool.name || typeof tool.name !== 'string') {
      return false;
    }
    
    // If parameters exist, must be object
    if (tool.parameters && typeof tool.parameters !== 'object') {
      return false;
    }
    
    // Add empty parameters if missing
    if (!tool.parameters) {
      tool.parameters = {};
    }
    
    return true;
  }

  /**
   * Check if object is a valid tool (non-mutating)
   */
  private isValidTool(obj: any): obj is ExtractedTool {
    return obj && 
           typeof obj === 'object' && 
           typeof obj.name === 'string' &&
           (!obj.parameters || typeof obj.parameters === 'object');
  }

  /**
   * Deduplicate tools based on content
   */
  private deduplicateTools(tools: ExtractedTool[]): ExtractedTool[] {
    const seen = new Set<string>();
    const unique: ExtractedTool[] = [];
    
    for (const tool of tools) {
      const key = JSON.stringify(tool);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(tool);
      }
    }
    
    return unique;
  }

  /**
   * Fix newlines in JSON strings
   */
  private fixJsonNewlines(jsonStr: string): string {
    const result: string[] = [];
    let inString = false;
    let escapeNext = false;
    
    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];
      
      if (escapeNext) {
        result.push(char);
        escapeNext = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escapeNext = true;
        result.push(char);
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        result.push(char);
        continue;
      }
      
      if (char === '\n' && inString) {
        result.push('\\n');
      } else {
        result.push(char);
      }
    }
    
    return result.join('');
  }

  /**
   * Parse malformed JSON by extracting key information
   */
  private parseMalformedJson(text: string): ExtractedTool | null {
    // Look for name
    const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
    if (!nameMatch) {
      return null;
    }
    
    const tool: ExtractedTool = {
      name: nameMatch[1],
      parameters: {}
    };
    
    // Look for parameters object
    const paramsMatch = text.match(/"parameters"\s*:\s*\{([^}]*)\}/s);
    if (paramsMatch) {
      const paramsContent = paramsMatch[1];
      // Extract key-value pairs
      const kvPattern = /"([^"]+)"\s*:\s*"([^"]*?)"/g;
      let kvMatch;
      
      while ((kvMatch = kvPattern.exec(paramsContent)) !== null) {
        const [, key, value] = kvMatch;
        // Unescape newlines
        tool.parameters[key] = value.replace(/\\n/g, '\n');
      }
    }
    
    return tool;
  }

  /**
   * Extract tool from response with specific model handling
   * This is a convenience method that combines extraction with model-specific logic
   */
  extractToolFromResponse(response: string, modelId?: string): ExtractedTool | null {
    const architecture = modelId ? this.detectArchitecture(modelId) : 'default';
    const result = this.extractTools(response, architecture);
    
    if (result.tools.length > 0) {
      return result.tools[0];
    }
    
    return null;
  }

  /**
   * Detect model architecture from model ID
   */
  private detectArchitecture(modelId: string): string {
    const lower = modelId.toLowerCase();
    
    if (lower.includes('gemma')) return 'gemma';
    if (lower.includes('llama')) return 'llama';
    if (lower.includes('qwen')) return 'qwen';
    if (lower.includes('deepseek')) return 'deepseek';
    
    return 'default';
  }
}