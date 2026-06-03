/**
 * Provider pricing configuration
 * Prices in USD per 1M tokens
 */

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

interface ProviderPricing {
  [model: string]: ModelPricing;
}

const PRICING_TABLE: Record<string, ProviderPricing> = {
  anthropic: {
    'claude-3-5-sonnet-20241022': { inputPer1M: 3.0, outputPer1M: 15.0 },
    'claude-3-5-sonnet-20240620': { inputPer1M: 3.0, outputPer1M: 15.0 },
    'claude-3-opus-20240229': { inputPer1M: 15.0, outputPer1M: 75.0 },
    'claude-3-sonnet-20240229': { inputPer1M: 3.0, outputPer1M: 15.0 },
    'claude-3-haiku-20240307': { inputPer1M: 0.25, outputPer1M: 1.25 },
  },
  openai: {
    'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },
    'gpt-4': { inputPer1M: 30.0, outputPer1M: 60.0 },
    'gpt-3.5-turbo': { inputPer1M: 0.5, outputPer1M: 1.5 },
  },
  openrouter: {
    default: { inputPer1M: 5.0, outputPer1M: 15.0 }, // Average estimate
  },
};

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const providerPricing = PRICING_TABLE[provider.toLowerCase()];
  if (!providerPricing) {
    return 0; // Unknown provider
  }

  const modelPricing = providerPricing[model] || providerPricing.default;
  if (!modelPricing) {
    return 0; // Unknown model
  }

  const inputCost = (inputTokens / 1_000_000) * modelPricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.outputPer1M;

  return inputCost + outputCost;
}
