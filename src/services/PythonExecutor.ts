export interface PythonResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface PythonFile {
  path: string;
  content: string;
  lastModified: number;
}

export class PythonExecutor {
  private static instance: PythonExecutor;
  private webViewRef: any = null;
  private pendingExecutions: Map<string, {
    resolve: (result: PythonResult) => void;
    reject: (error: any) => void;
  }> = new Map();
  private files: Map<string, PythonFile> = new Map();
  private isReady = false;
  private readyCallbacks: (() => void)[] = [];

  private constructor() {}

  static getInstance(): PythonExecutor {
    if (!PythonExecutor.instance) {
      PythonExecutor.instance = new PythonExecutor();
    }
    return PythonExecutor.instance;
  }

  setWebViewRef(ref: any) {
    this.webViewRef = ref;
  }

  onReady() {
    this.isReady = true;
    this.readyCallbacks.forEach(callback => callback());
    this.readyCallbacks = [];
  }

  private waitForReady(): Promise<void> {
    if (this.isReady) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.readyCallbacks.push(resolve);
    });
  }

  private generateId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async runPythonCode(code: string): Promise<string> {
    console.log('[PythonExecutor] Running code:', code);
    await this.waitForReady();
    
    const id = this.generateId();
    
    // Prepare virtual filesystem modules to inject
    let fullCode = code;
    
    // Inject all virtual files as modules
    if (this.files.size > 0) {
      console.log('[PythonExecutor] Injecting', this.files.size, 'virtual files into Python environment');
      
      let injectedCode = '';
      
      // Simply execute each file's content in the global namespace
      // This makes all functions and classes directly available
      for (const [filePath, file] of this.files.entries()) {
        console.log('[PythonExecutor] Injecting file:', filePath);
        
        // Add the file content directly to be executed
        injectedCode += `\n# === Virtual File: ${filePath} ===\n`;
        injectedCode += file.content;
        injectedCode += `\n# === End of ${filePath} ===\n\n`;
      }
      
      // Add separator and then user code
      fullCode = injectedCode + `\n# === User Code ===\n` + code;
    }
    
    return new Promise((resolve, reject) => {
      this.pendingExecutions.set(id, { resolve, reject });
      
      console.log('[PythonExecutor] Posting message to WebView');
      this.webViewRef?.postMessage(JSON.stringify({
        type: 'execute',
        id,
        code: fullCode
      }));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingExecutions.has(id)) {
          this.pendingExecutions.delete(id);
          console.error('[PythonExecutor] Execution timeout');
          reject(new Error('Python execution timeout'));
        }
      }, 30000);
    }).then((result) => {
      const pythonResult = result as PythonResult;
      console.log('[PythonExecutor] Execution result:', pythonResult);
      if (pythonResult.success && pythonResult.output !== undefined) {
        return pythonResult.output;
      }
      throw new Error(pythonResult.error || 'Unknown error');
    });
  }

  async runPythonFile(filePath: string): Promise<string> {
    const file = this.files.get(filePath);
    if (!file) {
      throw new Error(`File not found: ${filePath}`);
    }
    return this.runPythonCode(file.content);
  }

  async upsertFile(filePath: string, content: string): Promise<void> {
    console.log('[PythonExecutor] Storing virtual file:', filePath, 'length:', content.length);
    this.files.set(filePath, {
      path: filePath,
      content,
      lastModified: Date.now()
    });
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!this.files.has(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    console.log('[PythonExecutor] Deleting virtual file:', filePath);
    this.files.delete(filePath);
  }
  
  // Clear all virtual files (useful between benchmark problems)
  clearVirtualFilesystem(): void {
    console.log('[PythonExecutor] Clearing virtual filesystem, had', this.files.size, 'files');
    this.files.clear();
  }

  async listFiles(): Promise<string[]> {
    return Array.from(this.files.keys()).sort();
  }

  async readFile(filePath: string): Promise<string> {
    const file = this.files.get(filePath);
    if (!file) {
      throw new Error(`File not found: ${filePath}`);
    }
    return file.content;
  }

  handleWebViewMessage(data: any) {
    console.log('[PythonExecutor] WebView message:', data);
    
    if (data.type === 'ready') {
      console.log('[PythonExecutor] Pyodide is ready');
      this.onReady();
      return;
    }

    if (data.type === 'result' && data.id) {
      const pending = this.pendingExecutions.get(data.id);
      if (pending) {
        this.pendingExecutions.delete(data.id);
        pending.resolve({
          success: data.success,
          output: data.output,
          error: data.error
        });
      }
    }
  }
}