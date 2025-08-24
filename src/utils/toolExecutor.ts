import { Message } from '../types';
import { findTool } from '../config/tools';

export async function executeToolCallsSequentially(
  messages: any[],
  inferenceService: any,
  inferenceConfig: any,
  sessionId: string,
  addMessage: (sessionId: string, message: Message) => void,
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void,
  scrollToBottom: () => void
) {
  let currentMessages = [...messages];
  let continueProcessing = true;
  let toolCallCount = 0;
  const maxToolCalls = 10; // Prevent infinite loops

  while (continueProcessing && toolCallCount < maxToolCalls) {
    toolCallCount++;
    
    const assistantMessageId = `${Date.now()}_${toolCallCount}`;
    const assistantMessage: Message = {
      id: assistantMessageId,
      text: '',
      sender: 'assistant',
      timestamp: new Date(),
    };
    
    addMessage(sessionId, assistantMessage);
    scrollToBottom();

    let responseText = '';
    console.log(`[ToolExecutor] Making request ${toolCallCount}`);
    
    const result = await inferenceService.generateResponse(
      currentMessages,
      {
        ...inferenceConfig,
        temperature: 0.1,
        jinja: true,
        tool_choice: 'auto',
        tools: inferenceConfig.tools,
      },
      (token: string) => {
        responseText += token;
        updateMessage(sessionId, assistantMessageId, { text: responseText });
      },
      assistantMessageId,
      sessionId
    );

    console.log(`[ToolExecutor] Response ${toolCallCount}:`, result);
    
    const resultText = result?.text || responseText;
    let toolCalls = result?.tool_calls;
    
    // Try to parse tool calls from text if not provided
    if (!toolCalls && resultText) {
      const jsonStart = resultText.indexOf('{');
      const jsonEnd = resultText.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = resultText.substring(jsonStart, jsonEnd + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          
          if (parsed.tool_call) {
            toolCalls = [{
              type: 'function',
              function: {
                name: parsed.tool_call.name,
                arguments: parsed.tool_call.arguments
              },
              id: `tool_${Date.now()}`
            }];
          } else if (parsed.name && parsed.parameters) {
            toolCalls = [{
              type: 'function',
              function: {
                name: parsed.name,
                arguments: parsed.parameters
              },
              id: `tool_${Date.now()}`
            }];
          }
        } catch (e) {
          console.log('[ToolExecutor] No valid tool call found in response');
        }
      }
    }

    if (toolCalls && toolCalls.length > 0) {
      // Create a single message for tool call and result
      const toolCallResults: string[] = [];
      
      // Execute tools
      for (const toolCall of toolCalls) {
        const tool = findTool(toolCall.function.name);
        if (tool) {
          try {
            let args = toolCall.function.arguments;
            if (typeof args === 'string') {
              args = JSON.parse(args);
            }
            
            const toolResult = await tool.execute(args);
            console.log(`[ToolExecutor] Tool ${toolCall.function.name} result:`, toolResult);
            
            // Store result for display
            toolCallResults.push(`**${toolCall.function.name}**\n${toolResult}`);
            
            // Update messages for next iteration
            currentMessages = [
              ...currentMessages,
              {
                role: 'assistant',
                content: `Called ${toolCall.function.name}`
              },
              {
                role: 'user',
                content: `Tool result: ${toolResult}\n\nContinue with the next tool if needed. If all tasks are complete, provide a plain text summary (not JSON) of what was accomplished.`
              }
            ];
          } catch (error) {
            console.error(`[ToolExecutor] Tool error:`, error);
            toolCallResults.push(`**${toolCall.function.name}**\nError: ${error}`);
            
            // Stop processing on error
            continueProcessing = false;
          }
        }
      }
      
      // Update the message with grouped tool call and results
      updateMessage(sessionId, assistantMessageId, { 
        text: toolCallResults.join('\n\n'),
        isToolCall: true,
        toolCalls: toolCalls
      });
    } else {
      // No tool call found, this is the final response
      // Check if it's a JSON response format and extract the actual message
      let finalText = resultText;
      
      // Try multiple JSON patterns
      const jsonPatterns = [
        /\{"response":\s*"([^"]+)"\}/,  // {"response": "message"}
        /\{'response':\s*'([^']+)'\}/,  // {'response': 'message'}
        /\{"response":\s*"(.+?)"\s*\}/s, // Multi-line response
      ];
      
      for (const pattern of jsonPatterns) {
        const match = resultText.match(pattern);
        if (match) {
          finalText = match[1];
          console.log('[ToolExecutor] Extracted response from JSON:', finalText);
          break;
        }
      }
      
      // If no pattern matched, try general JSON parsing
      if (finalText === resultText && resultText.includes('"response"')) {
        try {
          // Find the JSON object in the text
          const jsonStart = resultText.indexOf('{');
          const jsonEnd = resultText.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1) {
            const jsonStr = resultText.substring(jsonStart, jsonEnd + 1);
            const parsed = JSON.parse(jsonStr);
            if (parsed.response) {
              finalText = parsed.response;
              console.log('[ToolExecutor] Parsed response from JSON object:', finalText);
            }
          }
        } catch (e) {
          console.log('[ToolExecutor] Could not parse response JSON, using raw text');
        }
      }
      
      // Remove any formatting tokens
      finalText = finalText
        .replace(/<end_of_turn>/g, '')
        .replace(/<\|.*?\|>/g, '') // Remove any <|token|> style markers
        .trim();
      
      updateMessage(sessionId, assistantMessageId, { text: finalText });
      continueProcessing = false;
    }
  }
  
  if (toolCallCount >= maxToolCalls) {
    const warningMessage: Message = {
      id: `${Date.now()}_warning`,
      text: 'Maximum number of tool calls reached.',
      sender: 'assistant',
      timestamp: new Date(),
    };
    addMessage(sessionId, warningMessage);
  }
}