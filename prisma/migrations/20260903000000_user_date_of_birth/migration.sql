-- Date of birth for the 18+ gate.
--
-- DATE and not DATETIME: a date of birth is a calendar fact with no time and no
-- zone in it. See src/lib/age.ts.
--
-- Nullable, and it stays nullable. Every account that existed before this
-- migration has no value here, and a NOT NULL column would mean either
-- inventing dates of birth for real users or locking them out of their own
-- accounts. New accounts are refused without one at the application layer.
ALTER TABLE `User` ADD COLUMN `dateOfBirth` DATE NULL;
