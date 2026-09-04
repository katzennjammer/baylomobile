-- One perceptual hash per PHOTO, replacing one per LISTING.
--
-- WHAT WAS BROKEN. Item.imageHash is a single column, so a listing with five
-- photos contributed exactly one image to the duplicate-detection pool. Posting
-- somebody else's photo #2 was never compared against anything, which is a
-- bypass that needs no tooling and no knowledge -- just a second photo. The
-- check looked like it covered listings; it covered first photos.
--
-- ADDITIVE, AND THE OLD COLUMN STAYS. Item.imageHash is neither dropped nor
-- rewritten: the web listing wizard round-trips it through its edit mode and
-- GET /api/v1/items/[id] returns it. It keeps being written, in step with
-- position 0 of this table. Nothing here reads or modifies a single Item row
-- except the SELECT that seeds the backfill below.
--
-- Rollback is DROP TABLE `ItemImageHash`. That is genuinely all of it: no
-- existing column changed, so the previous code reads its own column and
-- behaves exactly as it did before. No backup is required for this one.

-- ─────────────────────────────────────────────────────────────────────────────
-- The table.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `position` is the index into the listing's own `images` JSON array, so a hit
-- knows WHICH photo matched. Stage 2 of the check sends Claude that photo; it
-- used to send images[0] unconditionally, which for a photo-#3 match asked
-- Claude to compare two genuinely different pictures and take its "no" as an
-- acquittal.
--
-- Composite PK, no surrogate id, matching ItemSafeZone: the pair IS the
-- identity, and it enforces one hash per photo slot rather than letting a
-- retried write stack duplicates. Its leading column serves every by-item
-- lookup, so no second index is created.
--
-- NO INDEX ON `hash`, deliberately. The scan compares Hamming distances in
-- application code and no B-tree can answer "within 10 bits of this"; an index
-- here would be paid for on every insert and read by nothing.
-- THE COLLATION IS EXPLICIT AND HAS TO BE. This database's default is
-- utf8mb4_general_ci while every Prisma-created table, Item among them, is
-- utf8mb4_unicode_ci. An unqualified CREATE TABLE here takes the DATABASE
-- default, and the foreign key below then fails with errno 150 -- MySQL will
-- not point a key at a column whose collation differs from its own. Naming it
-- costs one line and removes a failure that reads as a broken constraint
-- rather than as the charset mismatch it is.
CREATE TABLE `ItemImageHash` (
  `itemId`   VARCHAR(191) NOT NULL,
  `position` INT NOT NULL,
  `hash`     VARCHAR(64) NOT NULL,

  PRIMARY KEY (`itemId`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ON DELETE CASCADE: a hash is meaningless once its listing is gone, and a
-- deleted listing's photo should stop blocking other people's uploads.
ALTER TABLE `ItemImageHash`
  ADD CONSTRAINT `ItemImageHash_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: every hash already computed keeps working.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Position 0 for all of them, which is true by construction -- the old column
-- only ever held the lead photo's hash. Listings whose other photos were never
-- hashed stay that way; there is no stored copy of those images to hash from
-- here, and they will be covered the next time the listing is edited. This
-- migration cannot make the pool worse than it was, only larger.
INSERT INTO `ItemImageHash` (`itemId`, `position`, `hash`)
SELECT `id`, 0, `imageHash` FROM `Item` WHERE `imageHash` IS NOT NULL;
