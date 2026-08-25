-- Email verification for credentials signup.
--
-- Until now `isVerified` could only ever be set by the two Google paths, so an
-- account created with an email and a password had no route to verification at
-- all — and therefore no route to the 50-Leaf signup grant, which is gated on
-- it. This table is that route.
--
-- Target engine is MariaDB 10.4: no IF NOT EXISTS on ADD COLUMN, and DATETIME(3)
-- for Prisma DateTime columns.
--
-- Shaped after RefreshToken rather than PasswordResetToken in one respect: the
-- token is stored as a SHA-256 hash, never in the clear. The reset table's
-- plaintext column is a weakness worth not reproducing — anyone who can read
-- the table can otherwise verify any pending account.
--
-- userId, not email, is the key. The account is the thing being verified; an
-- email change must not leave behind a token that verifies a new address on the
-- strength of proof sent to the old one. ON DELETE CASCADE also means a deleted
-- account drops its pending tokens with it.
CREATE TABLE `EmailVerificationToken` (
  `id`        VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3)  NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `EmailVerificationToken_tokenHash_key` (`tokenHash`),
  INDEX `EmailVerificationToken_userId_idx` (`userId`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `EmailVerificationToken`
  ADD CONSTRAINT `EmailVerificationToken_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
