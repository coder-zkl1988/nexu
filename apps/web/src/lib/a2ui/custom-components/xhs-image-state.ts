export function mergeXhsImages(
  current: readonly string[],
  incoming: readonly string[],
): string[] {
  return [...new Set([...current, ...incoming])];
}
