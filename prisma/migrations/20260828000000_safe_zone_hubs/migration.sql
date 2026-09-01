-- Safe-Zone Hubs: curated public meetup locations.
--
-- WHAT THIS REPLACES, and why it is a schema change rather than a UI one.
--
-- The obvious way to answer "where would we meet?" is to plot every listing's
-- Item.pickupLat/pickupLng on a map. That publishes an approximate home address
-- for every seller offering local pickup, and coarsening the pin does not fix
-- it: a ~1 km circle around a listing that is re-posted weekly from the same
-- house resolves to that house after a handful of observations. resolvePickup()
-- already treats those columns as the seller's front door and only ever shows
-- them to the owner and an accepted counterparty; a map would hand them to
-- everyone.
--
-- A hub is a different KIND of object. Nobody lives at a mall information desk,
-- so its coordinate carries no privacy cost to anybody -- which is why the two
-- coordinate columns here are stored and served at FULL PRECISION and must
-- never be run through coarsen(). Precision is the entire point: two strangers
-- who have agreed to meet need the actual door, not the general vicinity.
--
-- EVERYTHING HERE IS ADDITIVE. Two new tables, one new enum type carried inline
-- on a new column, and two MODIFYs that APPEND values to existing enums. No
-- column changes type, none is dropped, no existing row is rewritten or read.
-- The Item table is not touched at all -- the association lives in its own
-- table, so this migration cannot disturb a single listing.
--
-- Rollback: restore from baylo-backup-pre-safezone-hubs-20260828-152032.sql
-- rather than hand-writing the inverse. Dropping ItemSafeZone before
-- SafeZoneHub is the only ordering that works (the FK is RESTRICT), and that is
-- exactly the sort of detail that gets missed at the worst moment.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SafeZoneHub -- the curated places themselves.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `landmark` is NOT NULL AND NOT DEFAULTED. "Meet at Parkmall" is not a meeting
-- point; a mall has six entrances. The whole value of this table over a plain
-- pin is the sentence that says which door, and an optional column here is a
-- column that is empty on every hub somebody added in a hurry. The admin route
-- requires it, and so does the database.
--
-- `city` is a VARCHAR and not an ENUM on purpose: the hub list grows city by
-- city, and adding Consolacion should be an INSERT, not a migration.
--
-- The type ENUM is declared inline rather than as a shared type -- MySQL has no
-- CREATE TYPE, so this is the only form available; the values match the
-- SafeZoneType enum in schema.prisma and the wire map in src/lib/safe-zones.ts.
CREATE TABLE `SafeZoneHub` (
  `id`        VARCHAR(191) NOT NULL,
  `name`      VARCHAR(120) NOT NULL,
  `type`      ENUM('MALL','BARANGAY_HALL','POLICE_STATION','PUBLIC_PLAZA','TRANSPORT_HUB') NOT NULL,
  `address`   VARCHAR(300) NOT NULL,

  -- PUBLIC AND PRECISE. DOUBLE, not DECIMAL(9,6) and certainly not a rounded
  -- value: these are public places and the privacy argument that coarsens
  -- Item.pickupLat does not apply to any of them. Never pass one of these
  -- through coarsen().
  `latitude`  DOUBLE NOT NULL,
  `longitude` DOUBLE NOT NULL,

  `city`      VARCHAR(80)  NOT NULL,
  `landmark`  VARCHAR(200) NOT NULL,

  -- Deactivation, never deletion. See the FK note in section 2.
  `isActive`  BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- The picker's only query: active hubs in one city. Both filter columns, in
  -- the order the WHERE clause names them.
  INDEX `SafeZoneHub_isActive_city_idx` (`isActive`, `city`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ItemSafeZone -- the join.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- COMPOSITE PRIMARY KEY, not a cuid with a unique index beside it. The pair IS
-- the row's identity -- there is no such thing as two different associations
-- between the same listing and the same hub -- and making that the PK means a
-- double-tapped save cannot create a duplicate whatever the route does. It also
-- saves a column and an index on what will be the widest-fanning join here.
--
-- THE TWO onDelete CLAUSES DIFFER, AND BOTH DIRECTIONS ARE DELIBERATE:
--
--   itemId  CASCADE   A deleted listing's associations mean nothing and nothing
--                     audits them. Listing deletion is a soft delete anyway
--                     (status = 'REMOVED'), so this fires approximately never.
--
--   hubId   RESTRICT  The database REFUSES to delete a hub that any listing
--                     points at. This is the enforcement half of "deactivate,
--                     never delete": deactivation is a flag and leaves these
--                     rows untouched, so a listing at a hub that closed still
--                     shows where it was going to be, flagged unavailable. A
--                     DELETE would take that away silently. The admin surface
--                     exposes no delete for this reason; RESTRICT is what makes
--                     the rule hold for somebody at a SQL prompt too.
CREATE TABLE `ItemSafeZone` (
  `itemId`    VARCHAR(191) NOT NULL,
  `hubId`     VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`itemId`, `hubId`),
  -- "which listings are offered at this hub" -- GET /api/v1/hubs/[id]/items.
  -- The PK's leading column already answers the other direction.
  INDEX `ItemSafeZone_hubId_idx` (`hubId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ItemSafeZone`
  ADD CONSTRAINT `ItemSafeZone_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT. See the note above -- this is the constraint, not a preference.
ALTER TABLE `ItemSafeZone`
  ADD CONSTRAINT `ItemSafeZone_hubId_fkey`
  FOREIGN KEY (`hubId`) REFERENCES `SafeZoneHub`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AdminActionKind += the four hub verbs; AdminTargetType += HUB.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Creating, editing and deactivating a hub are moderator acts on shared state,
-- so they write the same audit row every other moderator act writes. A hub
-- whose coordinate quietly moved 400 metres, with no record of who moved it, is
-- the failure this prevents: people navigate to these places.
--
-- Appending to a MySQL ENUM is metadata-only when the new values go LAST and no
-- existing value is reordered or renamed -- existing rows keep their integer
-- ordinals and no table rewrite happens. Both conditions hold. Reordering
-- either list later would silently remap every existing AdminAction row.
ALTER TABLE `AdminAction`
  MODIFY `action` ENUM(
    'REPORT_REVIEWING','REPORT_DISMISSED','REPORT_ACTIONED',
    'LISTING_HIDDEN','LISTING_UNHIDDEN',
    'USER_SUSPENDED','USER_UNSUSPENDED',
    'HUB_CREATED','HUB_UPDATED','HUB_DEACTIVATED','HUB_REACTIVATED'
  ) NOT NULL;

ALTER TABLE `AdminAction`
  MODIFY `targetType` ENUM('REPORT','LISTING','USER','HUB') NOT NULL;
