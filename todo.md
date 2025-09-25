1. Set Up Mobile Benchmarking Environment
      - Install Expo/React Native dependencies in ../chat_app (npm install), ensure llama.rn models are downloaded
  via the app’s ModelService, and verify devices expose TTFT through InferenceService (streaming tokens or fallback
  result.timings).
      - Confirm PowerMeasurementService and SystemMonitorService have platform permissions (battery/thermal APIs) if energy
  metrics are required.
  2. Mirror Prompt Synthesis Logic
      - Add a utility (e.g., src/utils/prefillBenchmark.ts) that reuses the CLI logic: query the loaded llama context
  for stable “space + token” pairs, replicate collect_space_tokens and create_prompt, and accept parameters {minTokens,
  maxTokens, step, iterations}.
      - Guard against llama.rn API gaps (e.g., no direct detokenize); if missing, substitute with existing tokenizer
  helpers from ModelService or embed a small prompt library.
  3. Drive Iterative Prefill Runs
      - Within the new utility, loop over prompt lengths and iterations; for each prompt:
          - Call InferenceService.generateResponse with maxTokens: 1, temperature: 0, and messageId/sessionId to trigger
  PerformanceService tracking.
          - Capture TTFT (PerformanceService first iteration metrics or llama.rn result.timings.prompt_ms), TPS, total
  response time, and token counts.
          - Pull system stats snapshots via SystemMonitorService.getLatestMetrics() and
  PowerMeasurementService.getCurrentMeasurements() if available.
      - Collect warm-up runs (e.g., 5 × max length) before recording metrics, mirroring the desktop script.
  4. Persist Results For Export
      - Package results as {requestedTokens, actualTokens, iteration, ttftMs, tps, systemMetrics, energyMetrics}.
      - Either:
          1. Add a lightweight writer that saves JSON under FileSystem.documentDirectory/prefill/… (using Expo FileSystem);
  or
          2. Extend ExportService with a exportPrefillBenchmark helper that stores rows in CSV/JSON and routes through the
  existing sharing flow.
      - Include metadata (model ID, context size, thread count, device info) so the desktop analysis scripts can ingest
  them.
  5. Expose the Benchmark In-App
      - Create a developer-facing screen or settings panel action (e.g., PrefillBenchmarkScreen) that wires the UI to the
  new utility, surfaces progress, and triggers the export upon completion.
      - Leverage useBenchmarkStore for status reporting (warmup, current length, iteration) and to log TTFT averages/
  percentiles in the store so existing summary views can display them.
  6. Quality Checks Before Running On Devices
      - Validate single-run output on simulator/emulator (expect TTFT fallback warnings if streaming is disabled).
      - Run a short sweep (e.g., 100–500 tokens) on a real device, inspect the generated JSON/CSV via Expo Sharing, and
  confirm TTFT trends look sane.
      - Once satisfied, schedule full sweeps (e.g., 50–3500 tokens, 20+ iterations) per device/model and archive outputs
  together with the desktop .json results for cross-platform comparisons.
