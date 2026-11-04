-- CreateTable
CREATE TABLE `JobDigestPreference` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `sendTime` VARCHAR(191) NOT NULL DEFAULT '08:00',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Kolkata',
    `enabledAt` DATETIME(3) NULL,
    `lastSentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `JobDigestPreference_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobDigestDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JobDigestDelivery_userId_sentAt_idx`(`userId`, `sentAt`),
    INDEX `JobDigestDelivery_jobId_idx`(`jobId`),
    UNIQUE INDEX `JobDigestDelivery_userId_jobId_key`(`userId`, `jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `JobDigestPreference` ADD CONSTRAINT `JobDigestPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobDigestDelivery` ADD CONSTRAINT `JobDigestDelivery_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobDigestDelivery` ADD CONSTRAINT `JobDigestDelivery_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
