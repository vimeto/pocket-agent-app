# 🚀 Pocket Agent - Your Local AI Powerhouse

Run, benchmark, and experiment with LLMs directly on your phone.

## ✨ What's This?

Pocket Agent transforms your mobile device into an AI research lab. Run state-of-the-art language models locally, execute Python code in a sandboxed environment, and benchmark performance with scientific precision.

## 🎯 Core Features

### 💬 **Chat Mode**
- Stream responses from local LLMs with sub-second latency
- Tool-calling support (Python execution, file management)
- Multi-session management with full conversation history
- Real-time performance metrics (TTFT, TPS, memory usage)

### 🧪 **Benchmark Suite**
- **MBPP Dataset**: Test models on 500+ Python programming challenges
- **Three Evaluation Modes**:
  - `base`: Raw code generation
  - `tool_submission`: Structured tool usage
  - `full_tool`: Complete development environment simulation
- **Autonomous Mode**: Run overnight benchmarks with thermal/battery protection
- **Joint Mode**: Compare multiple approaches in batched experiments

### 📊 **Performance Analytics**
- Token-level latency tracking
- Energy consumption monitoring (mJ per token)
- Memory profiling (peak/avg/min)
- Tool call latency analysis
- Export results as JSON for further analysis

### 🐍 **Python Sandbox**
Execute Python code safely with:
- Virtual filesystem (create, read, update, delete files)
- Import tracking and module management
- Test runner for validation
- Full standard library support

## 🏗 Architecture

```
src/
├── screens/          # UI screens (Chat, Benchmark, Settings)
├── services/         # Core services
│   ├── InferenceService      # LLM inference engine
│   ├── BenchmarkEvaluation   # Code evaluation & testing
│   ├── AutonomousBenchmark   # Long-running experiments
│   ├── PythonExecutor        # Sandboxed Python runtime
│   ├── PerformanceService    # Metrics collection
│   └── ModelPromptService    # Model-specific prompting
├── components/       # Reusable UI components
├── stores/          # Zustand state management
├── utils/           # Helpers (tool executor, benchmark runner)
└── config/          # Tools & benchmark configurations
```

## 🚦 Quick Start

```bash
# Install dependencies
npm install

# iOS
npx expo run:ios

# Android
npx expo run:android

# Development mode
npx expo start
```

NOTE: you must create a dev build to support these native bindings.

## 🤖 Supported Models

Download models directly from Hugging Face:
- **Llama 3.2** (1B, 3B) - Latest instruction-tuned models
- **Gemma 2** (2B, 9B) - Google's efficient architecture
- **Qwen 2.5** (0.5B-7B) - Multilingual powerhouse
- **Phi-3** (3.8B) - Microsoft's compact genius
- **DeepSeek** (1.5B) - Reasoning-optimized

All models use 4-bit quantization (Q4_K_M)

## 🔬 Benchmark Modes Explained

### Base Mode
Pure code generation - model writes Python functions from descriptions.

### Tool Submission Mode
Model uses `submit_python_solution()` to structure responses.

### Full Tool Mode
Complete IDE simulation with:
- `upsert_file()` - Create/update files
- `run_python_code()` - Execute snippets
- `test_solution()` - Validate against test cases
- `submit_python_solution()` - Final submission

## 📈 Performance Metrics

Track everything that matters:
- **TTFT**: Time to first token (response latency)
- **TPS**: Tokens per second (generation speed)
- **Memory**: RAM usage patterns
- **Energy**: Battery consumption per inference
- **Tool Latency**: Time spent in tool calls

## 🎮 Advanced Features

### Autonomous Benchmarking
Set it and forget it:
- Configurable battery/temperature thresholds
- Auto-pause and resume capability
- Checkpoint saving for interruption recovery
- Batch processing with memory management

### Joint Benchmarking
Compare approaches scientifically:
- Run multiple modes on same problem sets
- Aggregate statistics across batches
- Export combined results for analysis

### Model-Specific Prompting
Optimized prompts for each architecture:
- Gemma, Llama, Qwen-specific formatting
- Custom tool call syntax per model
- Fine-tuned system prompts for best results

## 🛠 Development

Built with modern mobile AI stack:
- **React Native + Expo** - Cross-platform UI
- **llama.rn** - On-device inference engine
- **TypeScript** - Type-safe development
- **Zustand** - Lightweight state management
- **GGUF Models** - Optimized quantization

## 📊 Export & Analysis

Export benchmark results with:
- Problem-level success rates
- Token-by-token latencies
- Tool call sequences
- Energy consumption profiles
- Statistical summaries

## 🔮 Roadmap

- [ ] Multimodal support (vision, audio)
- [ ] Fine-tuning on device
- [ ] GRPO using a mesh of user devices
- [ ] Custom dataset support
- [ ] Model quantization tools

## 📝 License

MIT - Go wild!

---

**Built with ❤️ for edge AI researchers and enthusiasts**
