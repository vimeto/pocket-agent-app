import AsyncStorage from '@react-native-async-storage/async-storage';
import { MBPPProblem } from '../types/benchmark';

const MBPP_DATASET_URL = 'https://raw.githubusercontent.com/google-research/google-research/master/mbpp/sanitized-mbpp.json';
const CACHE_KEY = 'mbpp_dataset_cache';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

export class MBPPDatasetService {
  private static instance: MBPPDatasetService;
  private problems: Map<number, MBPPProblem> = new Map();
  private isLoading: boolean = false;
  private loadPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): MBPPDatasetService {
    if (!MBPPDatasetService.instance) {
      MBPPDatasetService.instance = new MBPPDatasetService();
    }
    return MBPPDatasetService.instance;
  }

  async loadDataset(forceFallback: boolean = false): Promise<void> {
    if (this.problems.size > 0 && !forceFallback) return;

    if (this.isLoading && this.loadPromise) {
      return this.loadPromise;
    }

    this.isLoading = true;
    this.loadPromise = forceFallback
      ? this.loadFallbackDatasetAsync()
      : this.loadDatasetInternal();

    try {
      await this.loadPromise;
    } finally {
      this.isLoading = false;
      this.loadPromise = null;
    }
  }

  private async loadFallbackDatasetAsync(): Promise<void> {
    this.problems.clear();
    this.loadFallbackDataset();
    console.log('[MBPPDataset] Forced fallback dataset load:', this.problems.size, 'problems');
  }

  private async loadDatasetInternal(): Promise<void> {
    try {
      // Try to load from cache first
      const cached = await this.loadFromCache();
      if (cached) {
        console.log('[MBPPDataset] Loaded from cache:', this.problems.size, 'problems');
        return;
      }

      // Fetch from network
      console.log('[MBPPDataset] Fetching from network...');
      const response = await fetch(MBPP_DATASET_URL);
      const data = await response.json();

      // Parse and store problems
      this.parseDataset(data);

      // Save to cache
      await this.saveToCache(data);

      console.log('[MBPPDataset] Loaded from network:', this.problems.size, 'problems');
    } catch (error) {
      console.error('[MBPPDataset] Error loading dataset:', error);
      // Fallback to embedded subset
      this.loadFallbackDataset();
    }
  }

  private parseDataset(data: any[]): void {
    this.problems.clear();

    for (const item of data) {
      // Filter for test problems (IDs 11-510)
      if (item.task_id >= 11 && item.task_id <= 510) {
        const problem: MBPPProblem = {
          id: item.task_id,
          description: item.text || item.prompt,
          code: item.code,
          testCases: item.test_list || []  // Keep raw assert statements
        };

        this.problems.set(problem.id, problem);
      }
    }
  }


  private async loadFromCache(): Promise<boolean> {
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (!cached) return false;

      const { data, timestamp } = JSON.parse(cached);

      // Check if cache is expired
      if (Date.now() - timestamp > CACHE_EXPIRY) {
        await AsyncStorage.removeItem(CACHE_KEY);
        return false;
      }

      this.parseDataset(data);
      return true;
    } catch (error) {
      console.error('[MBPPDataset] Cache load error:', error);
      return false;
    }
  }

  private async saveToCache(data: any[]): Promise<void> {
    try {
      const cacheData = {
        data,
        timestamp: Date.now()
      };
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      console.error('[MBPPDataset] Cache save error:', error);
    }
  }

  private loadFallbackDataset(): void {
    // Embedded subset for offline use
    const fallbackProblems: MBPPProblem[] = [
      {
        id: 11,
        description: "Write a python function to remove first and last occurrence of a given character from the string.",
        code: "def remove_Occ(s,ch):\n    s = s.replace(ch,\"\",1)\n    s = s[::-1].replace(ch,\"\",1)[::-1]\n    return s",
        testCases: [
          "assert remove_Occ('hello','l') == 'heo'",
          "assert remove_Occ('abcda','a') == 'bcd'",
          "assert remove_Occ('PHP','P') == 'H'"
        ]
      },
      {
        id: 12,
        description: "Write a function to sort a given matrix in ascending order according to the sum of its rows.",
        code: "def sort_matrix(M):\n    result = sorted(M, key=sum)\n    return result",
        testCases: [
          "assert sort_matrix([[1, 2, 3], [2, 4, 5], [1, 1, 1]]) == [[1, 1, 1], [1, 2, 3], [2, 4, 5]]",
          "assert sort_matrix([[1, 2, 3], [-2, 4, -5], [1, -1, 1]]) == [[-2, 4, -5], [1, -1, 1], [1, 2, 3]]",
          "assert sort_matrix([[5,8,9],[6,4,3],[2,1,4]]) == [[2, 1, 4], [6, 4, 3], [5, 8, 9]]"
        ]
      },
      {
        id: 13,
        description: "Write a function to count the most common words in a dictionary.",
        code: "from collections import Counter\ndef count_common(words):\n    word_counts = Counter(words)\n    top_four = word_counts.most_common(4)\n    return (top_four)",
        testCases: [
          "assert count_common(['red','green','black','pink','black','white','black','eyes','white','black','orange','pink','pink','red','red','white','orange','white','black','pink','green','green','pink','green','pink','white','orange','orange','red']) == [('pink', 6), ('black', 5), ('white', 5), ('red', 4)]",
          "assert count_common(['one', 'two', 'three', 'four', 'five', 'one', 'two', 'one', 'three', 'one']) == [('one', 4), ('two', 2), ('three', 2), ('four', 1)]",
          "assert count_common(['Facebook','Apple','Amazon','Netflix','Google','Apple','Netflix','Amazon']) == [('Apple', 2), ('Amazon', 2), ('Netflix', 2), ('Facebook', 1)]"
        ]
      },
      {
        id: 14,
        description: "Write a python function to find the volume of a triangular prism.",
        code: "def find_Volume(l,b,h):\n    return ((l * b * h) / 2)",
        testCases: [
          "assert find_Volume(10,8,6) == 240",
          "assert find_Volume(3,2,2) == 6",
          "assert find_Volume(1,2,1) == 1"
        ]
      },
      {
        id: 15,
        description: "Write a function to split a string at lowercase letters.",
        code: "import re\ndef split_lowerstring(text):\n    return (re.findall('[a-z][^a-z]*', text))",
        testCases: [
          "assert split_lowerstring('AbCd') == ['bC', 'd']",
          "assert split_lowerstring('Python') == ['y', 't', 'h', 'o', 'n']",
          "assert split_lowerstring('Programming') == ['r', 'o', 'g', 'r', 'a', 'm', 'm', 'i', 'n', 'g']"
        ]
      }
    ];

    this.problems.clear();
    for (const problem of fallbackProblems) {
      this.problems.set(problem.id, problem);
    }
  }

  getProblemById(id: number): MBPPProblem | undefined {
    return this.problems.get(id);
  }

  getAllProblems(): MBPPProblem[] {
    return Array.from(this.problems.values());
  }


  getProblemsInRange(startId: number, endId: number): MBPPProblem[] {
    const result: MBPPProblem[] = [];
    for (let id = startId; id <= endId; id++) {
      const problem = this.problems.get(id);
      if (problem) {
        result.push(problem);
      }
    }
    return result;
  }

  getRandomProblems(count: number): MBPPProblem[] {
    const allProblems = this.getAllProblems();
    const shuffled = [...allProblems].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  getTotalProblemCount(): number {
    return this.problems.size;
  }

  isLoaded(): boolean {
    return this.problems.size > 0;
  }

  async clearCache(): Promise<void> {
    await AsyncStorage.removeItem(CACHE_KEY);
    this.problems.clear();
  }

  // Backward compatibility methods
  getProblems(): MBPPProblem[] {
    return this.getAllProblems();
  }

  getProblem(id: number): MBPPProblem | undefined {
    return this.getProblemById(id);
  }

  getRandomProblem(): MBPPProblem | null {
    const problems = this.getRandomProblems(1);
    return problems.length > 0 ? problems[0] : null;
  }

  formatProblemForPrompt(problem: MBPPProblem): string {
    // Use the exact MBPP format
    let prompt = problem.description;

    if (problem.testCases && problem.testCases.length > 0) {
      // Add test cases in MBPP format
      prompt += '\n';
      prompt += '\n';
      prompt += 'Test cases:\n';
      problem.testCases.forEach(test => {
        prompt += '\n' + test;
      });
    }

    return prompt;
  }

  extractCodeFromResponse(response: string): string | null {
    // Clean up response first (remove special tokens)
    const cleanResponse = response
      .replace(/<end_of_turn>/g, '')
      .replace(/<eos>/g, '')
      .replace(/<|endoftext|>/g, '')
      .trim();

    // Try to extract code from markdown blocks
    const patterns = [
      /```python\n([\s\S]*?)\n```/,
      /```python\n([\s\S]*?)```/,  // Without trailing newline
      /```\n([\s\S]*?)\n```/,
      /```\n([\s\S]*?)```/,  // Without trailing newline
      /```([\s\S]*?)```/,  // Any code block
    ];

    for (const pattern of patterns) {
      const match = cleanResponse.match(pattern);
      if (match) {
        const code = match[1].trim();
        console.log('[MBPPDataset] Extracted code from markdown block, length:', code.length);
        return code;
      }
    }

    // Try to find function definition in plain text
    const functionMatch = cleanResponse.match(/(def\s+\w+.*?:[\s\S]*?)(?=\n\n|\n$|$)/);
    if (functionMatch) {
      const code = functionMatch[1].trim();
      console.log('[MBPPDataset] Extracted function from plain text, length:', code.length);
      return code;
    }

    // If still no match, check if the entire response looks like Python code
    if (cleanResponse.includes('def ') && cleanResponse.includes(':')) {
      console.log('[MBPPDataset] Using entire response as code, length:', cleanResponse.length);
      return cleanResponse;
    }

    console.log('[MBPPDataset] No code found in response');
    console.log('[MBPPDataset] Response preview:', cleanResponse.substring(0, 200));
    return null;
  }
}
