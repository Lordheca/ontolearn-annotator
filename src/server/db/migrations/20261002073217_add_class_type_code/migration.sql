/*
  Warnings:

  - A unique constraint covering the columns `[projectId,code]` on the table `ClassType` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `ClassType` ADD COLUMN `code` VARCHAR(191) NULL,
    ADD COLUMN `position` INTEGER NULL;

-- CreateIndex
CREATE INDEX `ClassType_relatedId_idx` ON `ClassType`(`relatedId`);

-- CreateIndex
CREATE UNIQUE INDEX `ClassType_projectId_code_key` ON `ClassType`(`projectId`, `code`);

-- AddForeignKey
ALTER TABLE `ClassType` ADD CONSTRAINT `ClassType_relatedId_fkey` FOREIGN KEY (`relatedId`) REFERENCES `ClassType`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
