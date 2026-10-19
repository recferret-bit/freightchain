-- 3D models as data (client/shared/entity/): the editor's revisions on top of the code's seed, and the AI editor's jobs (docs/agents/editor.md).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "asset";

-- CreateTable
CREATE TABLE "asset"."Entity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "headRevisionId" TEXT,
    "publishedRevisionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset"."EntityRevision" (
    "id" UUID NOT NULL,
    "entityId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "parentId" UUID,
    "source" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "authorWallet" TEXT NOT NULL,
    "jobId" UUID,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset"."EditorJob" (
    "id" UUID NOT NULL,
    "wallet" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "entityId" TEXT,
    "baseRevisionId" UUID,
    "resultRevisionId" UUID,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EditorJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset"."EditorJobEvent" (
    "jobId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorJobEvent_pkey" PRIMARY KEY ("jobId","seq")
);

-- CreateIndex
CREATE INDEX "Entity_publishedAt_idx" ON "asset"."Entity"("publishedAt");

-- CreateIndex
CREATE INDEX "EntityRevision_jobId_idx" ON "asset"."EntityRevision"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityRevision_entityId_seq_key" ON "asset"."EntityRevision"("entityId", "seq");

-- CreateIndex
CREATE INDEX "EditorJob_wallet_createdAt_idx" ON "asset"."EditorJob"("wallet", "createdAt");

-- CreateIndex
CREATE INDEX "EditorJob_entityId_createdAt_idx" ON "asset"."EditorJob"("entityId", "createdAt");

-- CreateIndex
CREATE INDEX "EditorJob_status_idx" ON "asset"."EditorJob"("status");

-- AddForeignKey
ALTER TABLE "asset"."EntityRevision" ADD CONSTRAINT "EntityRevision_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "asset"."Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset"."EditorJobEvent" ADD CONSTRAINT "EditorJobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "asset"."EditorJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
