-- Reporting, blocking, and the admin moderation surface.
--
-- Google Play's UGC policy requires in-app reporting and in-app blocking before
-- a marketplace app passes review. This migration is the database half of that.
--
-- EVERYTHING HERE IS ADDITIVE. Four new tables, three new columns on existing
-- tables, one new value on an existing enum. No column changes type, no column
-- is dropped, no row is rewritten. The only statements that touch existing
-- tables are ADD COLUMN and one MODIFY that appends an enum value, and both
-- leave every existing row exactly as it was.
--
-- Rollback is therefore a matter of dropping what was added -- but restore from
-- the dump instead (baylo-backup-pre-moderation-<stamp>.sql); a hand-written
-- rollback is one more thing to get wrong at the worst moment.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. User.role -- the first privileged concept in this schema.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every existing authorisation decision in this codebase is ownership-based:
-- you may edit this item because it is your item. That shape cannot express
-- "may act on somebody else's content", which is the entire job of a moderator.
--
-- DEFAULT 'USER' and NOT NULL, so all 8 existing rows become ordinary users and
-- nobody is silently handed privilege by a migration.
--
-- NOTHING IN THE API WRITES THIS COLUMN. There is no promotion endpoint, and
-- that absence is the security control: an endpoint that can grant ADMIN is a
-- privilege-escalation target whose whole value is saving somebody one SQL
-- prompt a year, while the escalation it enables is total. Promotion is:
--
--   UPDATE `User` SET `role` = 'ADMIN' WHERE `email` = 'you@example.com';
--
-- Run that by hand, deliberately, on the box.
ALTER TABLE `User` ADD COLUMN `role` ENUM('USER','MODERATOR','ADMIN') NOT NULL DEFAULT 'USER';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. User suspension.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Two columns, and reading either one alone is a bug:
--
--   suspendedAt     non-null means suspended RIGHT NOW.
--   suspendedUntil  when it lifts. NULL WITH suspendedAt SET IS INDEFINITE,
--                   not "already expired".
--
-- suspensionState() in src/lib/moderation.ts is the only correct reading of the
-- pair. Both are cleared on unsuspend: the history of who suspended whom, and
-- why, belongs in AdminAction below, where it sits next to the reason.
ALTER TABLE `User` ADD COLUMN `suspendedAt`    DATETIME(3) NULL;
ALTER TABLE `User` ADD COLUMN `suspendedUntil` DATETIME(3) NULL;

-- The admin queue's "currently suspended" filter, and nothing else. A partial
-- index would be better -- almost every row is NULL -- and MySQL has none.
CREATE INDEX `User_suspendedAt_idx` ON `User` (`suspendedAt`);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Item.moderationHiddenAt -- moderator takedown.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A SEPARATE COLUMN AND NOT `status = 'REMOVED'`, for one concrete reason: the
-- owner can already move their own item between REMOVED, OWNED and AVAILABLE --
-- POST /api/items/[id]/relist does exactly that -- so a takedown expressed as a
-- status is a takedown the person it was aimed at can undo. Every read path
-- filters `moderationHiddenAt IS NULL` in its WHERE clause, and relist refuses
-- while it is set.
ALTER TABLE `Item` ADD COLUMN `moderationHiddenAt` DATETIME(3) NULL;

-- Composite, and in this order on purpose. The hot query is the feed's
--   WHERE status = 'AVAILABLE' AND moderationHiddenAt IS NULL
-- which uses the equality column first and the IS NULL check as the second
-- key part. The reverse order would serve only the admin's much rarer
-- "show me everything I have hidden".
CREATE INDEX `Item_status_moderationHiddenAt_idx`
  ON `Item` (`status`, `moderationHiddenAt`);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. NotificationType += REPORT_RESOLVED.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The reporter is told the outcome. Play expects it and /trust promises it in
-- so many words ("Every report is reviewed by a human").
--
-- Appending to a MySQL ENUM is metadata-only when the new value goes LAST and
-- no existing value is reordered or renamed: existing rows keep their integer
-- ordinals and no table rewrite happens. Both conditions hold here. Reordering
-- this list later would silently remap every existing row.
ALTER TABLE `Notification`
  MODIFY `type` ENUM(
    'TRADE_REQUEST','TRADE_ACCEPTED','TRADE_REJECTED','TRADE_COMPLETED',
    'TRADE_CANCELLED','NEW_MESSAGE','NEW_REVIEW','FOLLOW_REQUEST',
    'FOLLOW_ACCEPTED','REPORT_RESOLVED'
  ) NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Report.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The target is a (targetType, targetId) PAIR rather than three nullable
-- foreign keys, and that is a deliberate trade of a real database constraint
-- for a property the constraint would destroy: A REPORT MUST SURVIVE ITS
-- TARGET. A scam listing that gets deleted -- by its owner, or by us -- is
-- exactly the report a moderator still needs to read, and an FK with ON DELETE
-- CASCADE erases the evidence at the moment it starts mattering. The route
-- validates that the target exists when the report is filed; after that,
-- nothing keeps it alive and nothing needs to.
--
-- `reporterId` IS a real FK, with CASCADE: a report has no meaning without
-- somebody standing behind it, and account deletion here is anonymisation
-- rather than row removal, so this fires approximately never.
CREATE TABLE `Report` (
  `id`             VARCHAR(191) NOT NULL,
  `reporterId`     VARCHAR(191) NOT NULL,
  `targetType`     ENUM('LISTING','USER','MESSAGE') NOT NULL,
  `targetId`       VARCHAR(191) NOT NULL,
  `category`       ENUM('SPAM','PROHIBITED_ITEM','SCAM_OR_FRAUD','HARASSMENT','COUNTERFEIT','OTHER') NOT NULL,
  `notes`          TEXT NULL,
  `status`         ENUM('OPEN','REVIEWING','ACTIONED','DISMISSED') NOT NULL DEFAULT 'OPEN',

  -- "One OPEN report per reporter per target" expressed as a constraint the
  -- database enforces rather than a check the application remembers.
  --
  -- MySQL treats NULLs as DISTINCT inside a unique index -- the same property
  -- TaskCompletion.refId leans on, inverted. This column holds the literal
  -- 'live' while the report is OPEN or REVIEWING and NULL once it is ACTIONED
  -- or DISMISSED. The unique index below therefore permits exactly ONE live
  -- report per (reporter, target) and ANY NUMBER of resolved ones.
  --
  -- Both halves matter. Without the index a reporter races themselves into two
  -- open reports and the queue fills with duplicates. Without the NULL-ing, a
  -- reporter who was once told "no" could never report that target again --
  -- which is wrong, because a seller who re-posts the same violation next month
  -- has committed a new violation.
  --
  -- MAINTAINED BY THE APPLICATION, in the same UPDATE that moves `status`, and
  -- never separately: resolveReport() in src/lib/moderation.ts is the only code
  -- that writes either column.
  --
  -- IT WAS GOING TO BE A STORED GENERATED COLUMN, which cannot drift at all:
  --   openKey VARCHAR(4) AS (IF(status IN ('OPEN','REVIEWING'),'live',NULL)) STORED
  -- That version was built and tested here on 26 Aug 2026, and MariaDB 10.4.32
  -- HANGS THE ENTIRE SERVER on an UPDATE to such a table: the update thread
  -- leaks an X-latch in row0upd.cc while holding DICT_SYS exclusive, every
  -- other session then blocks in "Opening tables", and the server will not even
  -- shut down cleanly afterwards. Recorded here rather than left for the next
  -- person to rediscover the same way. Do not reintroduce it on this version.
  `openKey`        VARCHAR(4) NULL,

  `resolvedById`   VARCHAR(191) NULL,
  `resolvedAt`     DATETIME(3) NULL,
  `resolutionNote` TEXT NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `Report_reporterId_targetType_targetId_openKey_key`
    (`reporterId`, `targetType`, `targetId`, `openKey`),
  -- The queue: filter by status, newest first.
  INDEX `Report_status_createdAt_idx` (`status`, `createdAt`),
  -- "everything ever filed against this listing" -- the report detail screen.
  INDEX `Report_targetType_targetId_idx` (`targetType`, `targetId`),
  INDEX `Report_reporterId_idx` (`reporterId`),
  INDEX `Report_resolvedById_idx` (`resolvedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Report`
  ADD CONSTRAINT `Report_reporterId_fkey`
  FOREIGN KEY (`reporterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: the report outlives the staff account that closed it.
ALTER TABLE `Report`
  ADD CONSTRAINT `Report_resolvedById_fkey`
  FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Block.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ONE ROW PER BLOCK, NOT A MIRRORED PAIR.
--
-- A block is asymmetric as an ACT -- only the blocker chose it, only the
-- blocker can undo it -- and symmetric in EFFECT, because every enforcement
-- point queries both directions. Writing a mirror row would make "who blocked
-- whom" unrecoverable, and that is the single fact a moderator reading a
-- harassment report most needs.
--
-- The unique pair is what makes POST /api/blocks idempotent under a double tap.
CREATE TABLE `Block` (
  `id`        VARCHAR(191) NOT NULL,
  `blockerId` VARCHAR(191) NOT NULL,
  `blockedId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `Block_blockerId_blockedId_key` (`blockerId`, `blockedId`),
  -- The unique index above already serves "whom have I blocked?" from its
  -- leading column. This one serves the other question every feed query asks --
  -- "who has blocked ME?" -- which reads the second column and would otherwise
  -- be a full scan on the hottest path in the app.
  INDEX `Block_blockedId_idx` (`blockedId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Block`
  ADD CONSTRAINT `Block_blockerId_fkey`
  FOREIGN KEY (`blockerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Block`
  ADD CONSTRAINT `Block_blockedId_fkey`
  FOREIGN KEY (`blockedId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. AdminAction -- the audit trail.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Moderation without an audit row is indistinguishable from abuse. A suspended
-- account, a hidden listing and a dismissed report look identical whether a
-- moderator followed the policy or settled a grudge, and the only difference
-- that can ever be recovered afterwards is the one written down at the time.
--
-- `reason` is NOT NULL and has NO DEFAULT. Every route that writes one of these
-- makes the moderator type it; an optional reason is a reason nobody fills in.
--
-- `actorId` gets NO ON DELETE clause, which on MySQL means RESTRICT: the
-- database refuses to delete a staff account that has moderated anything.
-- Deleting a moderator must not vacuum up the record of what they did.
CREATE TABLE `AdminAction` (
  `id`         VARCHAR(191) NOT NULL,
  `actorId`    VARCHAR(191) NOT NULL,
  `action`     ENUM(
                 'REPORT_REVIEWING','REPORT_DISMISSED','REPORT_ACTIONED',
                 'LISTING_HIDDEN','LISTING_UNHIDDEN',
                 'USER_SUSPENDED','USER_UNSUSPENDED'
               ) NOT NULL,
  `targetType` ENUM('REPORT','LISTING','USER') NOT NULL,
  `targetId`   VARCHAR(191) NOT NULL,
  `reportId`   VARCHAR(191) NULL,
  `reason`     TEXT NOT NULL,
  -- JSON snapshot of what changed: prior item status, prior suspension dates,
  -- the listing title as it read at takedown. A plain TEXT column and not a
  -- relation, matching LeafTransaction.tradeId -- the audit points at things,
  -- nothing points back at the audit.
  `detail`     TEXT NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- "what has this moderator done lately" -- the accountability query.
  INDEX `AdminAction_actorId_createdAt_idx` (`actorId`, `createdAt`),
  -- "what has been done to this listing/user" -- the target history panel.
  INDEX `AdminAction_targetType_targetId_idx` (`targetType`, `targetId`),
  INDEX `AdminAction_createdAt_idx` (`createdAt`),
  INDEX `AdminAction_reportId_idx` (`reportId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- No ON DELETE: RESTRICT. See the note above.
ALTER TABLE `AdminAction`
  ADD CONSTRAINT `AdminAction_actorId_fkey`
  FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON UPDATE CASCADE;

ALTER TABLE `AdminAction`
  ADD CONSTRAINT `AdminAction_reportId_fkey`
  FOREIGN KEY (`reportId`) REFERENCES `Report`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
