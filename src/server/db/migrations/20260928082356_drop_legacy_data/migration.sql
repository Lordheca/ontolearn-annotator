/*
  Warnings:

  - You are about to drop the `Data` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `Data` DROP FOREIGN KEY `Data_projectId_fkey`;

-- DropTable
DROP TABLE `Data`;
