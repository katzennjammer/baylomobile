-- Baylo goes purely non-monetary: "points" become "Pasa Leaves", and every
-- payment-handling / peso-denominated column is removed.
--
-- Target engine is MariaDB 10.4, which has no RENAME COLUMN and no
-- ALTER TABLE ... RENAME INDEX, so this uses CHANGE COLUMN and explicit
-- DROP INDEX / ADD INDEX instead.

-- 1. User.points -> User.leaves
ALTER TABLE `User` CHANGE COLUMN `points` `leaves` INT NOT NULL DEFAULT 0;

-- 2. Offer.offeredPoints -> Offer.offeredLeaves
ALTER TABLE `Offer` CHANGE COLUMN `offeredPoints` `offeredLeaves` INT NULL;

-- 3. Item.estimatedValue (PHP, double) -> Item.valueLeaves (Leaves, int)
--    De-peg: existing peso values convert at the retired 5 PHP = 1 point rate.
ALTER TABLE `Item` ADD COLUMN `valueLeaves` INT NULL;
UPDATE `Item` SET `valueLeaves` = ROUND(`estimatedValue` / 5) WHERE `estimatedValue` IS NOT NULL;
ALTER TABLE `Item` DROP COLUMN `estimatedValue`;

-- 4. Purge the monetary era.
--
--    Every existing balance traces back to the demo top-up endpoint or a
--    PayMongo test payment -- Leaves that were minted for money in a system
--    that no longer exists. There is no honest way to carry them forward: the
--    new model has no mint, so a non-zero opening balance would be Leaves that
--    no trade ever produced. The whole ledger goes, and every balance resets to
--    zero, so the only Leaves that can exist from here on are ones a completed
--    trade actually moved.
--
--    This must happen BEFORE the enum narrows in step 5, while TOP_UP rows can
--    still be addressed.
DELETE FROM `WalletTransaction`;
UPDATE `User` SET `leaves` = 0;

--    PENDING offers pledging Leaves are now backed by balances that are gone,
--    so they can never be honoured. Decline them rather than leave them to fail
--    at accept time. (OfferStatus has no CANCELLED member; DECLINED is the
--    terminal rejected state.)
UPDATE `Offer` SET `status` = 'DECLINED', `updatedAt` = CURRENT_TIMESTAMP(3)
  WHERE `status` = 'PENDING' AND `offeredLeaves` IS NOT NULL;

-- 5. WalletTransaction -> LeafTransaction
ALTER TABLE `WalletTransaction`
  DROP COLUMN `grossAmount`,
  DROP COLUMN `gatewayFee`,
  DROP COLUMN `platformFee`,
  DROP COLUMN `netPoints`,
  DROP COLUMN `provider`,
  DROP COLUMN `gatewayRef`,
  MODIFY COLUMN `type` ENUM('TRADE_SPEND', 'TRADE_RECEIVE') NOT NULL;

ALTER TABLE `WalletTransaction` DROP FOREIGN KEY `WalletTransaction_userId_fkey`;
ALTER TABLE `WalletTransaction` DROP INDEX `WalletTransaction_userId_idx`;
ALTER TABLE `WalletTransaction` DROP INDEX `WalletTransaction_userId_createdAt_idx`;

ALTER TABLE `WalletTransaction` RENAME TO `LeafTransaction`;

ALTER TABLE `LeafTransaction` ADD INDEX `LeafTransaction_userId_idx` (`userId`);
ALTER TABLE `LeafTransaction` ADD INDEX `LeafTransaction_userId_createdAt_idx` (`userId`, `createdAt`);
ALTER TABLE `LeafTransaction` ADD CONSTRAINT `LeafTransaction_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
