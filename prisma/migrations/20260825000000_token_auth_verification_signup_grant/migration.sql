-- Token-based auth for the native client, real verification flag, signup grant.
--
-- Target engine is MariaDB 10.4: no RENAME COLUMN, no IF NOT EXISTS on ADD
-- COLUMN, and enum widening is a MODIFY COLUMN that must restate every member.
--
-- Three independent changes ship together because they are entangled:
--   1. User.isVerified replaces the `password IS NULL` verification hack.
--   2. User.signupGrantClaimed gates the one-time 50-Leaf grant.
--   3. RefreshToken backs the mobile Bearer-token flow.
-- and one data backfill that depends on all three.

-- ── 1. Verification flag ─────────────────────────────────────────────────────
-- Verification used to be inferred from `password IS NULL`, which is really
-- "signed up with Google and never set a password". That conflates an
-- authentication detail with a trust decision and has no room for phone OTP.
ALTER TABLE `User` ADD COLUMN `isVerified` BOOLEAN NOT NULL DEFAULT false;

-- Backfill preserves the existing meaning exactly: everyone the old predicate
-- called verified is still verified. Four of the eight live users are
-- Google-only and are the only rows this touches, so no VERIFY_ACCOUNT
-- standing changes hands.
UPDATE `User` SET `isVerified` = true WHERE `password` IS NULL;

-- ── 2. Signup-grant claim flag ───────────────────────────────────────────────
-- Claimed at verification, never at registration. The flag and the Leaf credit
-- move in one UPDATE (see markVerified) so two concurrent verifications of the
-- same account cannot both pay out.
ALTER TABLE `User` ADD COLUMN `signupGrantClaimed` BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Widen LeafTxType ──────────────────────────────────────────────────────
-- SIGNUP_GRANT is deliberately its OWN type and not a TASK_REWARD: the weekly
-- faucet cap sums TASK_REWARD rows, so giving the grant its own type is what
-- makes it exempt from the cap without any special-casing in the cap query.
ALTER TABLE `LeafTransaction`
  MODIFY COLUMN `type` ENUM('TRADE_SPEND','TRADE_RECEIVE','TASK_REWARD','SIGNUP_GRANT') NOT NULL;

-- ── 4. RefreshToken ──────────────────────────────────────────────────────────
-- Only the SHA-256 hash is stored, so a database read yields no usable
-- credential. `usedAt` enforces single use; `familyId` is what lets a detected
-- replay revoke every descendant of the original login in one statement.
CREATE TABLE `RefreshToken` (
  `id`        VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `familyId`  VARCHAR(191) NOT NULL,
  `usedAt`    DATETIME(3)  NULL,
  `expiresAt` DATETIME(3)  NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3)  NULL,

  UNIQUE INDEX `RefreshToken_tokenHash_key` (`tokenHash`),
  INDEX `RefreshToken_userId_idx` (`userId`),
  INDEX `RefreshToken_familyId_idx` (`familyId`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `RefreshToken`
  ADD CONSTRAINT `RefreshToken_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. Backfill the signup grant for users already verified ──────────────────
-- SIGNUP_GRANT_LEAVES is 50. These users verified before the grant existed;
-- crediting them now is what keeps the flag's meaning uniform ("verified =>
-- granted") instead of leaving a cohort that can never claim it.
--
-- The ledger row and the two balances move together, exactly as on the live
-- path, so the invariant SUM(User.leaves) = SUM(positive LeafTransaction.amount)
-- survives this migration.
--
--   createdAt — left to default: when THIS ROW was written (the migration).
--   eventAt   — the verification moment. These accounts have no recorded
--               verification event, so their creation time is the closest
--               honest stand-in — the same stand-in reconcileTasks() already
--               uses for VERIFY_ACCOUNT.
--
-- The id is derived from the user id so re-running this migration is a no-op
-- rather than a second payout (PRIMARY KEY collision would abort, and the
-- signupGrantClaimed guard in the WHERE means the row is never reached twice).
INSERT INTO `LeafTransaction` (`id`, `userId`, `type`, `amount`, `description`, `eventAt`)
SELECT CONCAT('grant_', `id`), `id`, 'SIGNUP_GRANT', 50, 'Signup grant', `createdAt`
FROM `User`
WHERE `isVerified` = true AND `signupGrantClaimed` = false;

UPDATE `User`
SET `leaves`             = `leaves` + 50,
    `lifetimeLeaves`     = `lifetimeLeaves` + 50,
    `signupGrantClaimed` = true
WHERE `isVerified` = true AND `signupGrantClaimed` = false;
