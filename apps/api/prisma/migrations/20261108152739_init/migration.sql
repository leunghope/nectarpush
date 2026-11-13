-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "email" TEXT,
    "defaultChannel" TEXT,
    "accessToken" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "allowSendEmailToOthers" BOOLEAN NOT NULL DEFAULT false,
    "allowSaveMessage" BOOLEAN NOT NULL DEFAULT true,
    "oauthProvider" TEXT,
    "oauthId" TEXT,
    "sessionsRevokedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL DEFAULT '{}',
    "accessToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Channel_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerId" INTEGER NOT NULL,
    "uuid" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "content" TEXT,
    "url" TEXT,
    "channelName" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "to" TEXT,
    "renderMode" TEXT NOT NULL DEFAULT 'markdown',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "channelId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" INTEGER NOT NULL,
    "channelId" INTEGER,
    "channelName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageDelivery_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "targetChannel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "extractRule" TEXT NOT NULL DEFAULT '{}',
    "constructRule" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webhook_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Option" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "EmailCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "token" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_oauthProvider_oauthId_idx" ON "User"("oauthProvider", "oauthId");

-- CreateIndex
CREATE INDEX "Channel_ownerId_type_idx" ON "Channel"("ownerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_ownerId_name_key" ON "Channel"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Message_uuid_key" ON "Message"("uuid");

-- CreateIndex
CREATE INDEX "Message_ownerId_createdAt_idx" ON "Message"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "MessageDelivery_messageId_idx" ON "MessageDelivery"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Webhook_link_key" ON "Webhook"("link");

-- CreateIndex
CREATE UNIQUE INDEX "Webhook_ownerId_name_key" ON "Webhook"("ownerId", "name");

-- CreateIndex
CREATE INDEX "EmailCode_email_purpose_idx" ON "EmailCode"("email", "purpose");
