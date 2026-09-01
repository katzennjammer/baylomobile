-- SAFEZONE_MEETUP: from an unfalsifiable boolean to a pre-committed hub claim.
--
-- RUNS AFTER 20260828000000_safe_zone_hubs. The foreign key below references
-- SafeZoneHub, which that migration creates; applied out of order this one
-- fails on the ALTER.
--
-- WHAT THIS CHANGES, and what it honestly does not.
--
-- TradeRequest.safeZoneMeetup was a BOOLEAN set at confirmation by either
-- participant sending `safeZone: true`. It gated a 10-Leaf award per party per
-- trade. Nothing corroborated it, nothing could contradict it, and it named no
-- place -- so a moderator reading a dispute learned only that somebody had once
-- ticked a box.
--
-- It is replaced by a nullable foreign key naming WHICH hub. The award
-- condition becomes `safeZoneHubId IS NOT NULL`.
--
-- THIS IS PRE-COMMITTED SELF-ATTESTATION. IT IS NOT VERIFICATION.
--
--   Not established: that these two people were at this place. Nothing in this
--   system observes the world. Somebody who wants the Leaves without making the
--   trip sends the same request as somebody who made it.
--
--   Established: the claim is pre-committed and mutual. The application refuses
--   a hub that BOTH traded listings were not already offered at, so both owners
--   had to name it publicly, independently, before the trade existed -- and the
--   counterparty could see it when they made the offer. The lie now has to be
--   set up in advance by two people in public rather than ticked at the end by
--   one.
--
-- GPS proximity was considered and rejected: a client coordinate is spoofable
-- from a developer-options toggle, and every seeded landmark is indoors or
-- under a roof where GPS drifts 50-200 m, so an honest-user-safe radius in a
-- dense commercial strip would cover several other hubs anyway. A check that
-- fails honest users and does not stop dishonest ones is worse than no check
-- and a truthful comment.
--
-- ── ON DROPPING THE COLUMN ──────────────────────────────────────────────────
--
-- This is the only DESTRUCTIVE statement in the Safe-Zone work. It is safe
-- here, and the reason is measured rather than assumed:
--
--   SELECT COUNT(*) FROM TradeRequest WHERE safeZoneMeetup = 1;  -->  0
--
-- Zero rows on 28 Aug 2026, and zero SAFEZONE_MEETUP rows in TaskCompletion --
-- the feature had never once been used. RE-RUN THAT COUNT BEFORE APPLYING THIS
-- ON ANY OTHER DATABASE. If it is not zero, stop: those rows name no hub and
-- there is nothing to migrate them to, so the correct move is to add the new
-- column, backfill by hand from whatever record exists, and drop the old one in
-- a separate migration once it reads zero.
--
-- Rollback: restore from baylo-backup-pre-safezone-faucet-20260828-193004.sql.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The hub claim.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- NULL means "no Safe-Zone meetup claimed", which is the default state and the
-- one the vast majority of trades stay in. There is deliberately no DEFAULT and
-- no NOT NULL: a trade that names no hub must be indistinguishable from one
-- that predates the column.
ALTER TABLE `TradeRequest` ADD COLUMN `safeZoneHubId` VARCHAR(191) NULL;

-- NO EXPLICIT INDEX. MySQL creates one automatically to back the foreign key
-- below, and it serves the reporting query this column exists for -- "which
-- hubs do people actually meet at", the thing the old boolean could never
-- answer. A hand-added second index on the same column would be redundant
-- storage AND would read as drift against the Prisma schema, which does not
-- declare one precisely because the constraint already implies it.

-- RESTRICT, matching ItemSafeZone.hubId. A hub carrying meetup history is as
-- undeletable as one carrying listings: deleting it would erase the only record
-- of where a disputed trade was said to have happened. Hubs are deactivated,
-- never deleted -- see the admin routes, which expose no delete at all.
ALTER TABLE `TradeRequest`
  ADD CONSTRAINT `TradeRequest_safeZoneHubId_fkey`
  FOREIGN KEY (`safeZoneHubId`) REFERENCES `SafeZoneHub`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The boolean goes.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The name survives ON THE WIRE, derived rather than stored: /api/v1/trades
-- still sends `safeZoneMeetup`, computed as `safeZoneHubId !== null`, so a
-- shipped mobile client that reads the old field keeps working while there is
-- exactly one source of truth behind it. A stored boolean beside the FK would
-- be a second source of truth that can disagree with the first, which is how
-- the offeredLeaves bug happened.
ALTER TABLE `TradeRequest` DROP COLUMN `safeZoneMeetup`;
