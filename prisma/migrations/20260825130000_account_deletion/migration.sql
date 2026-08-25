-- Account deletion marker. See the note on User.deletedAt in schema.prisma for
-- why deletion anonymises the row instead of removing it: LeafTransaction
-- cascades from User, so a real DELETE would destroy the ledger history that
-- SUM(User.leaves) == SUM(LeafTransaction.amount) is checked against.
ALTER TABLE `User` ADD COLUMN `deletedAt` DATETIME(3) NULL;
CREATE INDEX `User_deletedAt_idx` ON `User`(`deletedAt`);
