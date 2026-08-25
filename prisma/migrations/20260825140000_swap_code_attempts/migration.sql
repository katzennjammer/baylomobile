-- Bound the number of guesses against a swap confirmation code.
-- Without a counter a 6-digit code with a 15-minute life is grindable by the
-- one party who is allowed to submit against it, which defeats the in-person
-- proof that VERIFIED_SWAP and SAFEZONE_MEETUP rewards are based on.
ALTER TABLE `SwapConfirmationCode` ADD COLUMN `attempts` INT NOT NULL DEFAULT 0;
