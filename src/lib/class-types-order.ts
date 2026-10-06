/**
 * Orders class types for display: classes with a position first (the order of the
 * imported class list, which is the legend's order), then the rest in the order
 * they came in. MySQL sorts NULL first in ascending order, so this cannot be done
 * with `orderBy: { position: "asc" }` alone.
 */
export function sortByPosition<T extends { position: number | null }>(classTypes: T[]): T[] {
  const positioned = classTypes
    .filter((classType) => classType.position !== null)
    .sort((a, b) => (a.position as number) - (b.position as number));
  const rest = classTypes.filter((classType) => classType.position === null);
  return [...positioned, ...rest];
}