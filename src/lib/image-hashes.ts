/**
 * Turning what a listing wizard sent into ItemImageHash rows.
 *
 * TWO CLIENTS SEND TWO DIFFERENT SHAPES, and both have to keep working.
 *
 *   - The mobile wizard sends `imageHashes`, one entry per photo, positionally
 *     aligned with `images`. Entries may be null: /api/ai/phash answers
 *     `{ hash: null, status: "passed" }` when it could not fetch or decode an
 *     image, so a photo can reach here with no hash beside one that has a hash.
 *   - The web wizard sends only `imageHash`, the lead photo's, because that is
 *     the single value it has ever tracked.
 *
 * A web listing therefore contributes one row and a mobile listing up to five.
 * That is a real difference in coverage between the two clients, and it is the
 * honest one: the web wizard genuinely only ever hashed the first photo. It is
 * not papered over here by inventing rows for photos nothing has looked at.
 */
export interface ImageHashInput {
  imageHashes?: (string | null)[] | null
  imageHash?: string | null
}

export interface ImageHashRow {
  position: number
  hash: string
}

/**
 * POSITION IS THE INDEX INTO `images`, NOT A COUNTER.
 *
 * The nulls are dropped only AFTER each entry has been paired with its own
 * index. Filtering first and numbering second would shift every hash after a
 * gap one place left and bind it to the wrong photo — which would not throw,
 * would not fail a test that only counts rows, and would quietly make Stage 2
 * compare a match against a picture of something else.
 */
export function imageHashRows(input: ImageHashInput): ImageHashRow[] {
  const list = input.imageHashes
  if (list && list.length > 0) {
    return list
      .map((hash, position) => ({ position, hash }))
      .filter((r): r is ImageHashRow => typeof r.hash === "string" && r.hash.length > 0)
  }
  return input.imageHash ? [{ position: 0, hash: input.imageHash }] : []
}

/**
 * What goes in the legacy `Item.imageHash` column: position 0's hash, or null.
 *
 * Strictly position 0 and not "the first hash present". The column means "the
 * lead photo's hash"; a listing whose lead photo could not be hashed but whose
 * second could has no lead hash, and saying otherwise would put a hash in a
 * column that promises which image it came from.
 */
export function leadImageHash(rows: ImageHashRow[]): string | null {
  return rows.find((r) => r.position === 0)?.hash ?? null
}
