/**
 * Returns true when both sides of a trade resolve to the same item —
 * the marker for a Leaves-only offer (the offeredItemId is set to the
 * listing's own item as a placeholder when no physical item is offered).
 */
export function isLeavesOnlyTrade(
  offeredItemId: string,
  requestedItemId: string,
): boolean {
  return offeredItemId === requestedItemId
}

/**
 * Formats the canonical "A ⇄ B" trade title string.
 *
 * For Leaves-only trades, the placeholder item on the giving side is
 * replaced with "N Leaves".  Pass isSender=true when the viewer is the one
 * who gave Leaves (they gave Leaves, got the item); false when they received
 * Leaves (they gave the item, got Leaves).
 */
export function formatTradeTitleStr(
  offeredItemTitle: string,
  requestedItemTitle: string,
  offeredLeaves: number | null,
  isLeavesOnly: boolean,
  isSender: boolean,
): string {
  if (isLeavesOnly && (offeredLeaves ?? 0) > 0) {
    const leaves = `${offeredLeaves!.toLocaleString()} Leaves`
    return isSender
      ? `${leaves} ⇄ ${requestedItemTitle}`
      : `${requestedItemTitle} ⇄ ${leaves}`
  }
  return `${offeredItemTitle} ⇄ ${requestedItemTitle}`
}
