-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_avatar_key_key" ON "users"("avatar_key");
