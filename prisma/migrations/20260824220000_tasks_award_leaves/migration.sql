-- The Eco-Points currency is removed. Tasks stay; they now award Pasa Leaves.
--
-- Two balances from here on:
--   User.leaves         -- spendable, moves on trades and settlement
--   User.lifetimeLeaves -- monotonic, only ever incremented by a positive
--                          award, never decremented, never spent. Ranks,
--                          badges and profile display key off this, so a user
--                          cannot lose a rank by spending what they earned.
--
-- Target engine is MariaDB 10.4: no RENAME COLUMN, no ALTER TABLE ... RENAME
-- INDEX, so this uses CHANGE COLUMN and explicit DROP INDEX / ADD INDEX.

-- 0. PRECONDITION -- ecoPoints must sum to 0 before the column is dropped.
--
--    Balances were meant to be zeroed by the previous step. If any user still
--    holds Eco-Points, dropping the column silently discards them, so this
--    migration must abort instead. The server runs in non-strict sql_mode, so
--    a NOT NULL / division-by-zero trick would only warn; a duplicate primary
--    key aborts regardless of mode. If the guard trips, the migration stops
--    here with:
--      ERROR 1062: Duplicate entry 'ecoPoints must sum to 0 ...' for key 'PRIMARY'
--    and NOTHING below has run.
CREATE TEMPORARY TABLE `_migration_guard` (`assertion` VARCHAR(191) NOT NULL PRIMARY KEY);
INSERT INTO `_migration_guard` (`assertion`)
  VALUES ('ecoPoints must sum to 0 before dropping the column');
INSERT INTO `_migration_guard` (`assertion`)
  SELECT 'ecoPoints must sum to 0 before dropping the column'
  FROM `User` WHERE `ecoPoints` <> 0 LIMIT 1;
DROP TEMPORARY TABLE `_migration_guard`;

-- 1. The monotonic earned-Leaves counter that ranks key off.
ALTER TABLE `User` ADD COLUMN `lifetimeLeaves` INT NOT NULL DEFAULT 0;

-- 2. Retire the Eco-Points currency.
ALTER TABLE `User` DROP COLUMN `ecoPoints`;

-- 3. The existing completion rows reference the purged economy -- their
--    `points` were denominated in Eco-Points, which no longer exist. Clearing
--    them lets the reconcile backfill re-award the same tasks in Leaves, under
--    the new faucet caps.
DELETE FROM `EcoTaskCompletion`;

-- 4. EcoTaskCompletion -> TaskCompletion.
--
--    The unique constraint is carried over unchanged: same three columns, same
--    order, same uniqueness. Only its NAME follows the table rename, so Prisma
--    does not report drift. That constraint is what makes every award
--    idempotent and what makes FIRST_LISTING / VERIFY_ACCOUNT /
--    COMPLETE_PROFILE one-time -- it must not be relaxed.
ALTER TABLE `EcoTaskCompletion` DROP FOREIGN KEY `EcoTaskCompletion_userId_fkey`;
ALTER TABLE `EcoTaskCompletion` DROP INDEX `EcoTaskCompletion_userId_task_refId_key`;
ALTER TABLE `EcoTaskCompletion` DROP INDEX `EcoTaskCompletion_userId_idx`;

ALTER TABLE `EcoTaskCompletion` RENAME TO `TaskCompletion`;

--    enum EcoTask -> enum TaskKind (members unchanged), and the award column is
--    now denominated in Leaves.
ALTER TABLE `TaskCompletion`
  MODIFY COLUMN `task` ENUM('VERIFY_ACCOUNT', 'COMPLETE_PROFILE', 'FIRST_LISTING', 'VERIFIED_SWAP', 'SAFEZONE_MEETUP') NOT NULL,
  CHANGE COLUMN `points` `leaves` INT NOT NULL;

ALTER TABLE `TaskCompletion`
  ADD UNIQUE INDEX `TaskCompletion_userId_task_refId_key` (`userId`, `task`, `refId`);
ALTER TABLE `TaskCompletion` ADD INDEX `TaskCompletion_userId_idx` (`userId`);
ALTER TABLE `TaskCompletion` ADD CONSTRAINT `TaskCompletion_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Task awards are real Leaf movements and must appear in the ledger, so the
--    balance stays reconstructable from LeafTransaction alone. Unlike a trade
--    settlement (a matching SPEND/RECEIVE pair that nets to zero across users),
--    a TASK_REWARD is a one-sided credit -- which is exactly why it is capped by
--    WEEKLY_TASK_LEAF_CAP and gated on a new counterparty for VERIFIED_SWAP.
ALTER TABLE `LeafTransaction`
  MODIFY COLUMN `type` ENUM('TRADE_SPEND', 'TRADE_RECEIVE', 'TASK_REWARD') NOT NULL;
