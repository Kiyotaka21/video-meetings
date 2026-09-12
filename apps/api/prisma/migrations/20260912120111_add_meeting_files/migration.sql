-- CreateEnum
CREATE TYPE "file_kind" AS ENUM ('recording', 'document');

-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('uploaded', 'processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "meeting_files" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "kind" "file_kind" NOT NULL,
    "status" "file_status" NOT NULL DEFAULT 'uploaded',
    "path" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_files_meeting_id_created_at_idx" ON "meeting_files"("meeting_id", "created_at");

-- AddForeignKey
ALTER TABLE "meeting_files" ADD CONSTRAINT "meeting_files_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
