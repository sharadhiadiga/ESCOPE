-- CreateTable
CREATE TABLE "slack_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slackUserId" TEXT,
    "teamId" TEXT,
    "teamName" TEXT,
    "botAccessToken" TEXT,
    "incomingWebhookUrl" TEXT,
    "channel" TEXT,
    "channelId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_connections_userId_key" ON "slack_connections"("userId");

-- CreateIndex
CREATE INDEX "slack_connections_userId_idx" ON "slack_connections"("userId");

-- AddForeignKey
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
