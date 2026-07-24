import { AsyncLocalStorage } from "node:async_hooks";

/** Raw usage fields as returned by the Anthropic API. */
export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

/** Per-1M-token pricing (USD). Cache read ≈ 0.1×, cache write ≈ 1.25× input. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

function priceFor(model: string): { input: number; output: number } {
  return PRICING[model] ?? PRICING["claude-opus-4-8"];
}

export class UsageMeter {
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  cacheReadInputTokens = 0;
  cacheCreationInputTokens = 0;

  add(u: RawUsage): void {
    this.calls += 1;
    this.inputTokens += u.input_tokens ?? 0;
    this.outputTokens += u.output_tokens ?? 0;
    this.cacheReadInputTokens += u.cache_read_input_tokens ?? 0;
    this.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0;
  }

  summary(model: string): UsageSummary {
    const p = priceFor(model);
    const perTokenIn = p.input / 1_000_000;
    const perTokenOut = p.output / 1_000_000;
    const estimatedCostUsd =
      this.inputTokens * perTokenIn +
      this.outputTokens * perTokenOut +
      this.cacheReadInputTokens * perTokenIn * 0.1 +
      this.cacheCreationInputTokens * perTokenIn * 1.25;
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadInputTokens: this.cacheReadInputTokens,
      cacheCreationInputTokens: this.cacheCreationInputTokens,
      totalTokens:
        this.inputTokens + this.outputTokens + this.cacheReadInputTokens + this.cacheCreationInputTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
    };
  }
}

const store = new AsyncLocalStorage<UsageMeter>();

/** Run `fn` with a fresh usage meter in scope; returns the result and the meter. */
export async function withUsageMeter<T>(fn: () => Promise<T>): Promise<{ result: T; meter: UsageMeter }> {
  const meter = new UsageMeter();
  const result = await store.run(meter, fn);
  return { result, meter };
}

/** Record a call's usage into the meter currently in scope (no-op if none). */
export function recordUsage(u: RawUsage | undefined | null): void {
  if (u) store.getStore()?.add(u);
}
