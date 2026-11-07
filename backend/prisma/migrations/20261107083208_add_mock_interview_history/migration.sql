-- CreateTable
CREATE TABLE `MockInterview` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `interviewType` VARCHAR(191) NOT NULL,
    `jobDescription` TEXT NULL,
    `questions` JSON NOT NULL,
    `answers` JSON NULL,
    `report` JSON NULL,
    `overallScore` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'IN_PROGRESS',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `MockInterview_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `MockInterview_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MockInterview` ADD CONSTRAINT `MockInterview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
