-- D4: structured navigation target on Notification, alongside `link`.
--
-- Option (b), as confirmed: entityType and entityId are SEPARATE from `type`.
-- NotificationType describes the EVENT that happened; the entity describes WHAT
-- TO OPEN. They do not map one-to-one, and the existing links prove it —
-- TRADE_ACCEPTED and NEW_MESSAGE both point at a USER (the chat partner), while
-- TRADE_COMPLETED and TRADE_CANCELLED point at a list with no id at all.
--
-- `link` is deliberately left in place and untouched: the web admin still reads
-- it. Nothing here changes what any existing page sees.
--
-- entityType is a plain string rather than an enum. The set of navigable
-- targets will grow as the mobile client lands (post, comment, offer, review),
-- and under an enum each addition is another schema migration for what is
-- really just a routing token. Say the word if you would rather have the enum
-- for consistency with NotificationType and ItemStatus — it is a one-line
-- change here.

-- 1. The two columns. Both nullable: plenty of existing rows have no
--    recoverable target, and a notification with nothing to open is legitimate.
ALTER TABLE `Notification` ADD COLUMN `entityType` VARCHAR(191) NULL;
ALTER TABLE `Notification` ADD COLUMN `entityId`   VARCHAR(191) NULL;

-- 2. Backfill from what the links actually encode.
--
--    This recovers only what is IN the link. For the 37 chat links that means a
--    user id, and all 37 resolve to a real User row (verified 2026-08-25). For
--    the trade links it means no id at all — those rows get entityType 'trade'
--    and a NULL entityId, which is honest: the link never carried one.
--
--    Note this is exactly the mismatch that motivated option (b). A
--    TRADE_ACCEPTED row backfills to entityType 'user', because that is where
--    its link goes. Going forward the write sites should record the real
--    target, and for a trade notification that is the TRADE. The backfill
--    cannot invent ids that were never stored.

--    2a. Current chat links -> the partner user.
UPDATE `Notification`
SET `entityType` = 'user',
    `entityId`   = SUBSTRING(`link`, LENGTH('/dashboard/messages?partner=') + 1)
WHERE `link` LIKE '/dashboard/messages?partner=%';

--    2b. Legacy chat links, pre-/dashboard prefix. Five rows.
UPDATE `Notification`
SET `entityType` = 'user',
    `entityId`   = SUBSTRING(`link`, LENGTH('/messages?partner=') + 1)
WHERE `link` LIKE '/messages?partner=%';

--    2c. Trade list. Target kind is known, id is not.
UPDATE `Notification`
SET `entityType` = 'trade', `entityId` = NULL
WHERE `link` = '/dashboard/trades';

--    2d. Own profile. Self-referential, so no id is needed to route.
UPDATE `Notification`
SET `entityType` = 'user', `entityId` = NULL
WHERE `link` = '/profile';

--    Rows left untouched: link IS NULL, and the single bare '/messages'. Both
--    stay (NULL, NULL) — there is no target to record.

-- Expected effect on current data (counts verified 2026-08-25):
--   2a  37 rows -> ('user', <cuid>)
--   2b   5 rows -> ('user', <cuid>)
--   2c  35 rows -> ('trade', NULL)
--   2d   8 rows -> ('user', NULL)
--        1 row  ('/messages') and any NULL-link rows untouched.

-- No index. Notifications are read by recipient, never looked up by entity. Add
-- one only if a "show me everything about this trade" view actually appears.

-- CAVEAT, recorded here as well as on the model: rows written before /api/v1 —
-- TRADE_ACCEPTED in particular — end up as ('user', <userId>) rather than
-- ('trade', <tradeId>), because a chat partner is all the old link carried.
-- Left uncorrected on purpose. /api/v1 writes the real target from the start
-- and these rows retire with the web user-side routes.
