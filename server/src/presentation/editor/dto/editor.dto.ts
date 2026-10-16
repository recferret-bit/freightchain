import { z } from 'zod';

/* The editor API's request shapes (docs/editor-api.md). The entity file itself is checked by the domain (checkEntitySource), not here. */
const entityId = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/, 'an entity id is lower-case letters, digits and dashes (2–48)');
const revisionId = z.string().uuid();
const signature = z.string().min(1).max(200);

export const entityIdParamsSchema = z.object({ id: entityId });
export type EntityIdParams = z.infer<typeof entityIdParamsSchema>;

export const revisionIdParamsSchema = z.object({ revId: revisionId });
export type RevisionIdParams = z.infer<typeof revisionIdParamsSchema>;

export const draftBodySchema = z.object({ source: z.string().min(1).max(64 * 1024), message: z.string().max(500).default(''), baseRevisionId: revisionId.nullable() });
export type DraftBody = z.infer<typeof draftBodySchema>;

export const restoreBodySchema = z.object({ revisionId, baseRevisionId: revisionId.nullable() });
export type RestoreBody = z.infer<typeof restoreBodySchema>;

export const publishChallengeBodySchema = z.object({ revisionId });
export type PublishChallengeBody = z.infer<typeof publishChallengeBodySchema>;

export const publishBodySchema = z.object({ revisionId, signature });
export type PublishBody = z.infer<typeof publishBodySchema>;

const jobId = z.string().uuid();
export const jobIdParamsSchema = z.object({ id: jobId });
export type JobIdParams = z.infer<typeof jobIdParamsSchema>;

/** POST /api/editor/jobs – baseRevisionId: omitted = not checked, null = "the seed / nothing saved yet" */
export const createJobBodySchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  entityId: entityId.nullish(),
  baseRevisionId: revisionId.nullable().optional(),
  provider: z.string().min(1).max(32).optional(),
  model: z.string().min(1).max(100).optional(),
});
export type CreateJobBody = z.infer<typeof createJobBodySchema>;

export const jobsQuerySchema = z.object({ entityId: entityId.optional() });
export type JobsQuery = z.infer<typeof jobsQuerySchema>;

export const jobEventsQuerySchema = z.object({ after: z.coerce.number().int().min(0).default(0) });
export type JobEventsQuery = z.infer<typeof jobEventsQuerySchema>;

/** the MCP's save_draft: based on the head as it is, so no base here */
export const mcpDraftBodySchema = z.object({ source: z.string().min(1).max(64 * 1024), message: z.string().max(500).default('') });
export type McpDraftBody = z.infer<typeof mcpDraftBodySchema>;
