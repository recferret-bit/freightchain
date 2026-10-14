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
