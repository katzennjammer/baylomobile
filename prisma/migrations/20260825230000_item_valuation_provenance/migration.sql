-- Valuation provenance on Item.
--
-- Until now an Item stored one number, `valueLeaves`, and nothing about where
-- it came from. The listing flow computed a suggestion, the user dragged a
-- slider, and the result overwrote the suggestion in place -- so after the fact
-- there was no way to tell a model-produced value from a hand-typed one, and no
-- way to answer "how many listings were valued from real trade history?"
-- without re-running the model against today's data and hoping it matches what
-- ran at post time. It would not: the comparables set grows.
--
-- Three columns, all additive. No existing column changes type, no data is
-- rewritten, and nothing here is destructive.
--
--   suggestedLeaves   the model's number, before the owner overrode it
--   valuationSource   which of the two paths produced it
--   revaluationCount  re-valuations spent on this listing
--
-- ON THE BACKFILL: THERE ISN'T ONE, DELIBERATELY.
--
-- All 22 existing Items keep NULL in suggestedLeaves and valuationSource. They
-- predate the model and their values were user-entered against a category-only
-- estimate that ignored condition; writing today's model output into
-- suggestedLeaves for those rows would manufacture a suggestion that was never
-- shown to anyone and never overridden by anyone, and the divergence query
-- would then be measuring the model against itself. NULL states the truth --
-- "this listing predates the valuation system" -- and it is distinguishable
-- from every real value, which a backfilled number would not be.
--
-- The reporting query therefore has three buckets, not two:
--
--   SELECT COALESCE(valuationSource, '(pre-model)') AS src, COUNT(*)
--   FROM `Item` GROUP BY src;

-- 1. The model's suggestion. NULL = listing predates the valuation system.
ALTER TABLE `Item` ADD COLUMN `suggestedLeaves` INT NULL;

-- 2. Which path produced it. VARCHAR(32) and not an ENUM: the same two literals
--    ("comparables", "category_band") travel to clients on the wire, and a wire
--    value generated from a DB enum name changes the day someone renames the
--    enum. The writable set is closed in application code by VALUATION_SOURCES
--    in src/lib/valuation.ts. 32 chars is roughly twice the longer literal.
ALTER TABLE `Item` ADD COLUMN `valuationSource` VARCHAR(32) NULL;

-- 3. Re-valuations already spent. NOT NULL DEFAULT 0 -- every existing row has
--    spent none, and "unknown" is not a meaningful state for a counter.
ALTER TABLE `Item` ADD COLUMN `revaluationCount` INT NOT NULL DEFAULT 0;

-- 4. The provenance index.
--
--    The one query this column exists to serve is a GROUP BY over the whole
--    table -- "how many by each path" -- which on 22 rows and on 22,000 rows is
--    a scan either way, so the index is not for that. It is for the filtered
--    form that follows it in every review: the same breakdown per category,
--    and "show me the listings valued from comparables". Both are covered by
--    the (valuationSource, category) prefix.
--
--    Not added: an index on suggestedLeaves. It is read by primary-key lookup
--    on the item and aggregated over full scans, never used as a filter.
CREATE INDEX `Item_valuationSource_category_idx`
  ON `Item` (`valuationSource`, `category`);
