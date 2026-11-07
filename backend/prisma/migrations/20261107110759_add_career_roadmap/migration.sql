-- CreateTable
CREATE TABLE `CareerRoadmap` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `currentRole` VARCHAR(191) NOT NULL,
    `targetRole` VARCHAR(191) NOT NULL,
    `timeline` VARCHAR(191) NOT NULL,
    `skills` JSON NOT NULL,
    `careerGoal` TEXT NULL,
    `roadmap` JSON NOT NULL,
    `progress` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'IN_PROGRESS',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `CareerRoadmap_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `CareerRoadmap_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CareerRoadmap` ADD CONSTRAINT `CareerRoadmap_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
