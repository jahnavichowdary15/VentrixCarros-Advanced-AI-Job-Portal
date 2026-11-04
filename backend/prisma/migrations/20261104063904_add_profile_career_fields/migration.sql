-- AlterTable
ALTER TABLE `profile` ADD COLUMN `githubUrl` VARCHAR(191) NULL,
    ADD COLUMN `jobType` VARCHAR(191) NULL,
    ADD COLUMN `preferredLocation` VARCHAR(191) NULL,
    ADD COLUMN `preferredRole` VARCHAR(191) NULL;
