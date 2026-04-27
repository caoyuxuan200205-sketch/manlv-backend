-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mcpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mcpServers" JSONB;
