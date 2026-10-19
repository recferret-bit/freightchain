-- Full MCP tool calls of an editor job, kept with that editor's wallet. The chat does not show them.
CREATE TABLE "asset"."EditorMcpCall" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "wallet" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorMcpCall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EditorMcpCall_jobId_seq_key" ON "asset"."EditorMcpCall"("jobId", "seq");

CREATE INDEX "EditorMcpCall_wallet_createdAt_idx" ON "asset"."EditorMcpCall"("wallet", "createdAt");

ALTER TABLE "asset"."EditorMcpCall" ADD CONSTRAINT "EditorMcpCall_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "asset"."EditorJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
