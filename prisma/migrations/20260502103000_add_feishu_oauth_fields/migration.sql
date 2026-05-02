ALTER TABLE "User"
ADD COLUMN "feishuOpenId" TEXT,
ADD COLUMN "feishuUnionId" TEXT,
ADD COLUMN "feishuUserId" TEXT,
ADD COLUMN "feishuTenantKey" TEXT,
ADD COLUMN "feishuName" TEXT,
ADD COLUMN "feishuEmail" TEXT,
ADD COLUMN "feishuAvatarUrl" TEXT,
ADD COLUMN "feishuAccessToken" TEXT,
ADD COLUMN "feishuRefreshToken" TEXT,
ADD COLUMN "feishuScope" TEXT,
ADD COLUMN "feishuTokenType" TEXT,
ADD COLUMN "feishuAccessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "feishuRefreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "feishuConnectedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_feishuOpenId_key" ON "User"("feishuOpenId");
