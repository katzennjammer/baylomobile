-- Deferred Points Agreement, and the ledger columns that record paying one off.
--
-- Additive only. No existing row is rewritten, no column is dropped, and no
-- backfill is needed: there is no prior representation of deferred debt to
-- migrate from. Rolling back is `DROP TABLE DeferredContract` plus dropping the
-- two additions below, with no data loss beyond the feature itself.
--
-- NOT INCLUDED, deliberately: `prisma migrate diff` also proposes
--   DROP INDEX `User_deletedAt_idx` ON `user`;
-- That index is pre-existing drift -- 20260825130000_account_deletion created
-- it, and schema.prisma never declared the matching @@index. It has nothing to
-- do with this change and is left exactly where it is.

-- 1. The ledger learns two new movement types.
--
--    They are always written as a PAIR in one transaction: CONTRACT_PAY for -n
--    on the debtor, CONTRACT_COLLECT for +n on the creditor. The pair nets to
--    zero across users, which is what keeps
--    SUM(User.leaves) == SUM(LeafTransaction.amount) true through every payment
--    the same way the TRADE_SPEND/TRADE_RECEIVE pair already does.
--
--    MODIFY on an ENUM appends values without touching existing rows; every
--    current row keeps its type.
ALTER TABLE `LeafTransaction`
  MODIFY `type` ENUM(
    'TRADE_SPEND', 'TRADE_RECEIVE', 'TASK_REWARD', 'SIGNUP_GRANT',
    'CONTRACT_PAY', 'CONTRACT_COLLECT'
  ) NOT NULL;

-- 2. Which contract a payment row paid down. Nullable, and NULL on every row
--    that exists today. A plain column, not a foreign key -- offerId and
--    tradeId next to it are the same: the ledger points at things, nothing
--    points back at the ledger.
ALTER TABLE `LeafTransaction` ADD COLUMN `contractId` VARCHAR(191) NULL;

-- 3. The contract itself.
--
--    amountLeaves and amountPaidLeaves rather than one decrementing balance, so
--    that a half-paid contract still shows how big the promise originally was.
--
--    defaultedAt is separate from status = 'DEFAULTED' and outlives it. When a
--    defaulted debt is finally paid the status moves to FULFILLED -- that is
--    the debtor's way out of the trading restriction -- but defaultedAt stays
--    stamped, and it is what "past defaults" counts and what the permanent tier
--    demotion is derived from.
--
--    There is no column here for returning, reversing or repossessing the item.
--    That is not an omission: the item changed hands in person and nothing in
--    this system can recover it.
CREATE TABLE `DeferredContract` (
    `id` VARCHAR(191) NOT NULL,
    `tradeId` VARCHAR(191) NOT NULL,
    `debtorId` VARCHAR(191) NOT NULL,
    `creditorId` VARCHAR(191) NOT NULL,
    `amountLeaves` INTEGER NOT NULL,
    `amountPaidLeaves` INTEGER NOT NULL DEFAULT 0,
    `deadline` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING_ACCEPT', 'ACTIVE', 'FULFILLED', 'DEFAULTED', 'DECLINED') NOT NULL DEFAULT 'PENDING_ACCEPT',
    `extensionUsed` BOOLEAN NOT NULL DEFAULT false,
    `extensionRequestedAt` DATETIME(3) NULL,
    `extensionRequestedDeadline` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acceptedAt` DATETIME(3) NULL,
    `fulfilledAt` DATETIME(3) NULL,
    `defaultedAt` DATETIME(3) NULL,

    -- (debtorId, status): the exposure cap and the one-contract-at-a-time check.
    INDEX `DeferredContract_debtorId_status_idx`(`debtorId`, `status`),
    -- (creditorId, status): the creditor's side of the list endpoint.
    INDEX `DeferredContract_creditorId_status_idx`(`creditorId`, `status`),
    -- (status, deadline): the lazy deadline sweep, which is the only query that
    -- looks across all debtors at once.
    INDEX `DeferredContract_status_deadline_idx`(`status`, `deadline`),
    INDEX `DeferredContract_tradeId_idx`(`tradeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DeferredContract` ADD CONSTRAINT `DeferredContract_tradeId_fkey`
  FOREIGN KEY (`tradeId`) REFERENCES `TradeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DeferredContract` ADD CONSTRAINT `DeferredContract_debtorId_fkey`
  FOREIGN KEY (`debtorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DeferredContract` ADD CONSTRAINT `DeferredContract_creditorId_fkey`
  FOREIGN KEY (`creditorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
