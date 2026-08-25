-- Split the two timestamps on LeafTransaction that were being conflated.
--
--   createdAt — when THIS ROW was written. Never backdated.
--   eventAt   — when the qualifying action actually happened.
--
-- The weekly-cap change anchored the faucet window to the awarding event, and
-- did so by stamping createdAt with the event time. That made the window
-- correct but destroyed the write-time half of the audit trail: for the 20
-- backfilled TASK_REWARD rows, createdAt said June/July when the rows were in
-- fact written on 2026-08-24. This migration gives each fact its own column.
--
-- Target engine is MariaDB 10.4: no RENAME COLUMN, and a NOT NULL DATETIME
-- cannot be added to a populated table under NO_ZERO_DATE, so eventAt is added
-- nullable, backfilled, then tightened.

-- 1. Add eventAt, nullable for now.
ALTER TABLE `LeafTransaction` ADD COLUMN `eventAt` DATETIME(3) NULL;

-- 2. Backfill. Every existing row currently carries the EVENT time in
--    createdAt (the restamp did this), so eventAt inherits it verbatim.
UPDATE `LeafTransaction` SET `eventAt` = `createdAt`;

-- 3. Tighten to NOT NULL now that every row has a value.
ALTER TABLE `LeafTransaction` MODIFY COLUMN `eventAt` DATETIME(3) NOT NULL;

-- 4. Restore createdAt to true write time for the 20 restamped rows.
--
--    These were expected to be unrecoverable. They are not: the backup taken
--    immediately before the restamp (baylo-backup-pre-restamp-20260824-224939.sql)
--    still held the original values, and all 20 ids matched, so the timestamps
--    below are the EXACT write times, not approximations. They cluster in one
--    ~300ms span because that is how long the backfill run took.
--
--    Rows created after this migration get createdAt from @default(now()) and
--    need no correction. On a database that never ran that backfill these
--    statements match nothing and are harmless no-ops.
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.663000' WHERE `id` = 'cmt7c2bh30001fk73ykb8wyt9';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.689000' WHERE `id` = 'cmt7c2bht0003fk73xqa8q0wi';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.706000' WHERE `id` = 'cmt7c2bia0005fk73c3vagsip';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.725000' WHERE `id` = 'cmt7c2bit0008fk73jiaf2c9f';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.751000' WHERE `id` = 'cmt7c2bjj000afk73ec6fknnu';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.759000' WHERE `id` = 'cmt7c2bjr000cfk73f8osrxw6';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.770000' WHERE `id` = 'cmt7c2bk2000efk73ick4c6b8';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.793000' WHERE `id` = 'cmt7c2bkp000hfk73lw4q0jrs';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.803000' WHERE `id` = 'cmt7c2bkz000jfk73jctmbajk';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.824000' WHERE `id` = 'cmt7c2blk000lfk73y6xuv0yp';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.840000' WHERE `id` = 'cmt7c2bm0000nfk73pdq2ajjg';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.851000' WHERE `id` = 'cmt7c2bmb000pfk73otv4rmas';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.872000' WHERE `id` = 'cmt7c2bmw000sfk737tgxwpi5';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.881000' WHERE `id` = 'cmt7c2bn5000ufk7390b9qyra';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.891000' WHERE `id` = 'cmt7c2bnf000wfk731izkyam8';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.901000' WHERE `id` = 'cmt7c2bnp000yfk734cel3gt9';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.921000' WHERE `id` = 'cmt7c2bo90011fk732jkqnlbg';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.928000' WHERE `id` = 'cmt7c2bog0013fk73m6jldymg';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.938000' WHERE `id` = 'cmt7c2boq0015fk73uzu6569u';
UPDATE `LeafTransaction` SET `createdAt` = '2026-08-24 14:30:24.953000' WHERE `id` = 'cmt7c2bp50017fk73y6pk2qdd';

-- 5. Index the cap's lookup path: the weekly window now reads eventAt.
ALTER TABLE `LeafTransaction` ADD INDEX `LeafTransaction_userId_eventAt_idx` (`userId`, `eventAt`);
