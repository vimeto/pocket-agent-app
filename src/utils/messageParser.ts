export interface ParsedMessage {
  type: 'text' | 'thinking' | 'incomplete-thinking';
  content: string;
}

export function parseMessageContent(text: string, isGenerating: boolean = false): ParsedMessage[] {
  const parts: ParsedMessage[] = [];
  const completeThinkingRegex = /<think>([\s\S]*?)<\/think>/g;
  const incompleteThinkingRegex = /<think>([\s\S]*?)$/;
  let lastIndex = 0;
  let match;

  // First, find all complete thinking sections
  while ((match = completeThinkingRegex.exec(text)) !== null) {
    // Add text before the thinking section
    if (match.index > lastIndex) {
      const textContent = text.substring(lastIndex, match.index).trim();
      if (textContent) {
        parts.push({ type: 'text', content: textContent });
      }
    }

    // Add thinking section
    const thinkingContent = match[1].trim();
    if (thinkingContent) {
      parts.push({ type: 'thinking', content: thinkingContent });
    }

    lastIndex = match.index + match[0].length;
  }

  // Handle remaining text
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    
    // Check for incomplete thinking tag during generation
    if (isGenerating) {
      const incompleteMatch = incompleteThinkingRegex.exec(remainingText);
      if (incompleteMatch) {
        // Add text before incomplete thinking
        const beforeThinking = remainingText.substring(0, incompleteMatch.index).trim();
        if (beforeThinking) {
          parts.push({ type: 'text', content: beforeThinking });
        }
        
        // Add incomplete thinking section
        const incompleteThinkingContent = incompleteMatch[1].trim();
        if (incompleteThinkingContent) {
          parts.push({ type: 'incomplete-thinking', content: incompleteThinkingContent });
        }
      } else if (remainingText.trim()) {
        // No incomplete thinking tag, just regular text
        parts.push({ type: 'text', content: remainingText.trim() });
      }
    } else if (remainingText.trim()) {
      // Not generating, treat as regular text
      parts.push({ type: 'text', content: remainingText.trim() });
    }
  }

  // If no parts were found, return the entire text as a single part
  if (parts.length === 0 && text.trim()) {
    parts.push({ type: 'text', content: text });
  }

  return parts;
}