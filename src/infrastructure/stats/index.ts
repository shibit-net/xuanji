/**
 * Stats module exports
 */

export { TokenStatsCollector } from './TokenStatsCollector.js';
export { StatsStorage } from './StatsStorage.js';
export { calculateCost } from './PricingConfig.js';

// Singleton instance for global usage
import { TokenStatsCollector } from './TokenStatsCollector.js';
export const globalStatsCollector = new TokenStatsCollector();
