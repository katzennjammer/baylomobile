-- D2: a real offeredLeaves column on TradeRequest.
--
-- Until now the Leaves attached to a trade were never stored on the trade. They
-- lived on the Offer that produced it, and five call sites recovered them by
-- re-querying with the same correlation:
--
--   src/app/api/trades/[id]/confirm/submit/route.ts:154   <-- SETTLEMENT
--   src/app/auth/login/page.tsx:56
--   src/app/dashboard/page.tsx:297
--   src/app/dashboard/trades/page.tsx:84
--   src/app/dashboard/trades/page.tsx:168
--
--   offer WHERE senderId = trade.senderId
--           AND postId   = trade.requestedItemId
--           AND status   = 'ACCEPTED'
--
-- That correlation is not unique, and settlement resolves it with findFirst()
-- and no orderBy -- so it debits an arbitrary row of the matching set. On live
-- data five trades match more than one accepted offer; one matches eight. Those
-- five are safe only by luck: each group happens to hold a single distinct
-- amount. One further group (sender cmqbbcfv8..., post cmqbbbh16...) holds TWO
-- amounts, 100 and 200 Leaves. It has no TradeRequest today, so nothing reads
-- it -- but the day a trade is created for that pair, settlement picks 100 or
-- 200 by optimiser whim. Storing the value on the trade removes the
-- correlation, and with it that hazard.

-- 1. Add the column, nullable. NULL means "no Leaves in this trade" -- exactly
--    what the `?? 0` at each of the five sites already meant.
ALTER TABLE `TradeRequest` ADD COLUMN `offeredLeaves` INT NULL;

-- 2. Backfill from the accepted offer that produced each trade.
--
--    Grouped, not a bare UPDATE ... JOIN: against an ambiguous group a direct
--    join silently takes whichever row the optimiser returns first. MAX() is at
--    least deterministic, and for every group that a trade actually keys to it
--    is provably identical to any other pick.
--
--    GUARD -- run first. Must return zero rows, or stop: it means some trade
--    now keys to a group with two different amounts and MAX() would be a guess.
--
--      SELECT o.senderId, o.postId, COUNT(DISTINCT o.offeredLeaves) AS v
--      FROM `Offer` o
--      JOIN `TradeRequest` tr
--        ON tr.senderId = o.senderId AND tr.requestedItemId = o.postId
--      WHERE o.status = 'ACCEPTED' AND o.offeredLeaves > 0
--      GROUP BY o.senderId, o.postId HAVING v > 1;
--
--    Verified empty on 2026-08-25. Expected effect: 18 rows updated,
--    amounts 22..800 Leaves.
UPDATE `TradeRequest` tr
JOIN (
  SELECT o.`senderId`, o.`postId`, MAX(o.`offeredLeaves`) AS `leaves`
  FROM `Offer` o
  WHERE o.`status` = 'ACCEPTED' AND o.`offeredLeaves` > 0
  GROUP BY o.`senderId`, o.`postId`
) src
  ON  src.`senderId` = tr.`senderId`
  AND src.`postId`   = tr.`requestedItemId`
SET tr.`offeredLeaves` = src.`leaves`;

-- No index: the column is read by primary-key lookup on the trade, never
-- filtered on.
