-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BUYER', 'SELLER_OWNER', 'ADMIN_OPERATOR', 'ADMIN_SUPER', 'DEMO_ADMIN');

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ClientApp" AS ENUM ('SHOP', 'SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DisplayDensity" AS ENUM ('MINIMAL', 'STANDARD', 'MAXIMAL');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "googleSub" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "demoExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seller" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "brandName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "introduction" TEXT,
    "logoUrl" TEXT,
    "status" "SellerStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "commissionRateBp" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" UUID NOT NULL,
    "density" "DisplayDensity" NOT NULL DEFAULT 'STANDARD',
    "locale" TEXT NOT NULL DEFAULT 'ko-KR',
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "notifyOrder" BOOLEAN NOT NULL DEFAULT true,
    "notifyClaim" BOOLEAN NOT NULL DEFAULT true,
    "notifyMarketing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "app" "ClientApp" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isDemo_demoExpiresAt_idx" ON "User"("isDemo", "demoExpiresAt");

-- CreateIndex
CREATE INDEX "UserRole_role_idx" ON "UserRole"("role");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_role_key" ON "UserRole"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_userId_key" ON "Seller"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_brandName_key" ON "Seller"("brandName");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_slug_key" ON "Seller"("slug");

-- CreateIndex
CREATE INDEX "Seller_status_idx" ON "Seller"("status");

-- CreateIndex
CREATE INDEX "Address_userId_idx" ON "Address"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_app_idx" ON "RefreshToken"("userId", "app");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seller" ADD CONSTRAINT "Seller_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema language cannot express.
--
-- Written by hand and kept here rather than enforced in application code: every
-- rule below is a race that a service-layer check loses. `migrate diff` ignores
-- partial indexes and CHECK constraints, so a later `migrate dev` will not try
-- to drop them.
-- ---------------------------------------------------------------------------

-- One live account per Google identity.
--
-- Partial rather than a plain unique index because withdrawal is a soft delete:
-- with `UNIQUE("googleSub")` the row left behind for referential integrity would
-- hold the Google account hostage and its owner could never sign up again. NULLs
-- never collide in a unique index, so demo accounts — which have no Google
-- identity at all — are unaffected.
CREATE UNIQUE INDEX "User_googleSub_active_key" ON "User" ("googleSub") WHERE "deletedAt" IS NULL;

-- Exactly one default shipping address per user.
--
-- The predicate is what makes this possible: only rows with "isDefault" enter
-- the index, so a user keeps any number of ordinary addresses and at most one
-- default. Checking "does a default already exist?" in the service instead would
-- let two concurrent requests both read zero and both write one.
CREATE UNIQUE INDEX "Address_userId_default_key" ON "Address" ("userId") WHERE "isDefault";

-- A demo account always has an expiry; a real one never does.
--
-- Without this the two columns could disagree and "is this a demo?" would have
-- two different answers depending on which column a query happened to read —
-- including in the sweep that deletes expired demo data.
ALTER TABLE "User" ADD CONSTRAINT "User_demo_expiry_check"
  CHECK (("isDemo" AND "demoExpiresAt" IS NOT NULL) OR (NOT "isDemo" AND "demoExpiresAt" IS NULL));

-- A live real account has a Google identity.
--
-- Demo accounts are exempt (they never signed in with Google) and so are
-- withdrawn rows, whose identity may be scrubbed while the row stays behind.
ALTER TABLE "User" ADD CONSTRAINT "User_google_identity_check"
  CHECK ("isDemo" OR "deletedAt" IS NOT NULL OR "googleSub" IS NOT NULL);

-- Commission is basis points: an integer 0–10000 (0.00%–100.00%).
--
-- The bound is here and not only in a DTO because settlement multiplies by this
-- number; a negative or out-of-range rate would pay a seller more than the order
-- was worth, and nothing downstream would notice.
ALTER TABLE "Seller" ADD CONSTRAINT "Seller_commissionRateBp_check"
  CHECK ("commissionRateBp" IS NULL OR ("commissionRateBp" BETWEEN 0 AND 10000));
