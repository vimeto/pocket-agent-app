import React, { useRef, useEffect } from 'react';
import { View } from 'react-native';
import WebView from 'react-native-webview';
import { PythonExecutor } from '../services/PythonExecutor';

const PYODIDE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js"></script>
</head>
<body>
  <script>
    let pyodide = null;
    let isReady = false;

    async function main() {
      try {
        pyodide = await loadPyodide({
          indexURL: "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/"
        });
        
        // Set up stdout capture
        pyodide.runPython(\`
import sys
from io import StringIO

class OutputCapture:
    def __init__(self):
        self.buffer = StringIO()
        
    def write(self, text):
        self.buffer.write(text)
        
    def getvalue(self):
        return self.buffer.getvalue()
        
    def clear(self):
        self.buffer = StringIO()
\`);
        
        isReady = true;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'ready'
        }));
      } catch (error) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error',
          error: error.toString()
        }));
      }
    }

    async function executePython(code, id) {
      if (!isReady || !pyodide) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'result',
          id: id,
          success: false,
          error: 'Pyodide not ready'
        }));
        return;
      }

      try {
        // Capture stdout
        pyodide.runPython(\`
output_capture = OutputCapture()
sys.stdout = output_capture
sys.stderr = output_capture
\`);

        // Execute the code
        const result = await pyodide.runPythonAsync(code);
        
        // Get captured output
        const output = pyodide.runPython('output_capture.getvalue()');
        
        // Reset stdout
        pyodide.runPython(\`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
output_capture.clear()
\`);
        
        // Combine result and output
        let finalOutput = output || '';
        if (result !== undefined && result !== null && result !== pyodide.globals.get('None')) {
          if (finalOutput && !finalOutput.endsWith('\\n')) {
            finalOutput += '\\n';
          }
          finalOutput += String(result);
        }
        
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'result',
          id: id,
          success: true,
          output: finalOutput
        }));
      } catch (error) {
        // Reset stdout on error
        try {
          pyodide.runPython(\`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
\`);
        } catch (e) {}
        
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'result',
          id: id,
          success: false,
          error: error.toString()
        }));
      }
    }

    // Handle messages from React Native
    window.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'execute') {
          executePython(data.code, data.id);
        }
      } catch (error) {
        console.error('Message handling error:', error);
      }
    });

    // Initialize Pyodide
    main();
  </script>
</body>
</html>
`;

export const PythonWebView: React.FC = () => {
  const webViewRef = useRef<WebView>(null);
  const executor = PythonExecutor.getInstance();

  useEffect(() => {
    executor.setWebViewRef(webViewRef.current);
  }, []);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      executor.handleWebViewMessage(data);
    } catch (error) {
      console.error('Failed to parse WebView message:', error);
    }
  };

  return (
    <View style={{ height: 0, width: 0 }}>
      <WebView
        ref={webViewRef}
        source={{ html: PYODIDE_HTML }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        style={{ height: 0, width: 0 }}
      />
    </View>
  );
};