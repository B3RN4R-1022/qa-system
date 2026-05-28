/*
  Warnings:

  - Added the required column `asanaId` to the `QAEvent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "QAEvent" ADD COLUMN     "asanaId" TEXT NOT NULL;
