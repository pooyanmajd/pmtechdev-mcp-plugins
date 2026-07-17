export const DEFAULT_SEARCH_TIME_BUDGET_MS = 12_000;
export const HARD_MAX_SEARCH_TIME_BUDGET_MS = 110_000;

export function maximumSearchTimeBudgetMs(timeoutMs: number): number {
  const marginMs = Math.max(1, Math.floor(timeoutMs / 5));
  return Math.max(1, Math.min(HARD_MAX_SEARCH_TIME_BUDGET_MS, timeoutMs - marginMs));
}
