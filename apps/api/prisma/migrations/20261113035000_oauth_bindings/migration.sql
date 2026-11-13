-- D-03：OAuth 多绑。新增 OAuthBinding 表，(provider, oauthId) 全局唯一绑一个用户；
-- 回填旧 User.oauthProvider/oauthId 单绑数据后，重建 User 表删除旧列。

-- CreateTable
CREATE TABLE "OAuthBinding" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "oauthId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill：把旧的单绑字段迁成绑定行。仅迁移未软删用户（对齐旧 oauthLogin 的
-- deletedAt:null 语义，软删用户的身份可被重新绑定）；同一 (provider, oauthId)
-- 若被多个用户占用（旧索引非唯一），仅保留 id 最小（最早注册）的活跃用户，
-- 避免回填撞唯一约束。
INSERT INTO "OAuthBinding" ("userId", "provider", "oauthId", "createdAt")
SELECT u."id", u."oauthProvider", u."oauthId", u."createdAt"
FROM "User" u
WHERE u."oauthProvider" IS NOT NULL
  AND u."oauthId" IS NOT NULL
  AND u."deletedAt" IS NULL
  AND u."id" = (
    SELECT MIN(u2."id") FROM "User" u2
    WHERE u2."oauthProvider" = u."oauthProvider"
      AND u2."oauthId" = u."oauthId"
      AND u2."deletedAt" IS NULL
  );

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
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
    "sessionsRevokedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("accessToken", "allowSaveMessage", "allowSendEmailToOthers", "createdAt", "defaultChannel", "deletedAt", "displayName", "email", "id", "mustChangePassword", "passwordHash", "role", "sessionsRevokedAt", "status", "username") SELECT "accessToken", "allowSaveMessage", "allowSendEmailToOthers", "createdAt", "defaultChannel", "deletedAt", "displayName", "email", "id", "mustChangePassword", "passwordHash", "role", "sessionsRevokedAt", "status", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OAuthBinding_userId_idx" ON "OAuthBinding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthBinding_provider_oauthId_key" ON "OAuthBinding"("provider", "oauthId");
