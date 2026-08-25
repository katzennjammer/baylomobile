-- Move pickup location out of the `wantedItems` text blob into real columns.
--
-- `wantedItems` was a JSON envelope of the shape
--   {"wanted": "<text>", "pickup": {"lat": .., "lng": .., "address": ".."}}
-- whenever the lister enabled local pickup, and plain text otherwise. Every read
-- path returned the whole column verbatim, so full-precision home coordinates
-- and a reverse-geocoded postal address shipped to unauthenticated callers.
--
-- After this migration `wantedItems` holds ONLY the free text, and pickup lives
-- in three columns that every read path has to name explicitly.

ALTER TABLE `Item`
  ADD COLUMN `pickupLat` DOUBLE NULL,
  ADD COLUMN `pickupLng` DOUBLE NULL,
  ADD COLUMN `pickupAddress` TEXT NULL;

-- Backfill. JSON_VALID guards the plain-text rows; JSON_EXTRACT returns NULL for
-- an envelope without a `pickup` key, so a row is only touched when it really
-- carries coordinates.
UPDATE `Item`
SET
  `pickupLat`     = CAST(JSON_UNQUOTE(JSON_EXTRACT(`wantedItems`, '$.pickup.lat'))     AS DOUBLE),
  `pickupLng`     = CAST(JSON_UNQUOTE(JSON_EXTRACT(`wantedItems`, '$.pickup.lng'))     AS DOUBLE),
  `pickupAddress` = JSON_UNQUOTE(JSON_EXTRACT(`wantedItems`, '$.pickup.address'))
WHERE `wantedItems` IS NOT NULL
  AND JSON_VALID(`wantedItems`)
  AND JSON_EXTRACT(`wantedItems`, '$.pickup') IS NOT NULL;

-- Collapse the envelope down to the text it was wrapping. Done second, so the
-- backfill above still had the pickup object to read.
UPDATE `Item`
SET `wantedItems` = JSON_UNQUOTE(JSON_EXTRACT(`wantedItems`, '$.wanted'))
WHERE `wantedItems` IS NOT NULL
  AND JSON_VALID(`wantedItems`)
  AND JSON_EXTRACT(`wantedItems`, '$.wanted') IS NOT NULL;

-- A `{"wanted": null, ...}` envelope unquotes to the 4-character string "null".
UPDATE `Item` SET `wantedItems` = NULL WHERE `wantedItems` = 'null';

-- An empty address is not an address.
UPDATE `Item` SET `pickupAddress` = NULL WHERE `pickupAddress` = '' OR `pickupAddress` = 'null';
