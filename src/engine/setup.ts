/** Recipe identities and duration come from a validated RunConfig. No RNG or state mutation. */
export function setupDurationMs(setupMs: number, fromRecipeId: string, toRecipeId: string): number {
  return fromRecipeId === toRecipeId ? 0 : setupMs;
}
