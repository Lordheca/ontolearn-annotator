-- AlterTable
ALTER TABLE `Annotation` ADD COLUMN `modelVersion` VARCHAR(191) NULL,
    MODIFY `author` ENUM('USER', 'ML', 'HEADWORK', 'EXPERT') NOT NULL;

-- AlterTable
ALTER TABLE `AnnotationType` ADD COLUMN `confidence` DOUBLE NULL;

-- CreateIndex
CREATE INDEX `Annotation_dataFileId_author_idx` ON `Annotation`(`dataFileId`, `author`);
