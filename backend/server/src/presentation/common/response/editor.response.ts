import { z } from 'zod';
import { EVENT_TYPES, JOB_STATUSES } from '../../../domain/editor/editor-job.js';
import { authChallengeResponse, bool, enums, num, numOrNull, obj, str, strOrNull } from './wire.js';

/** Entity files are an open document (the shared entity core). The wrapper fields around them are fixed. */
const entityConfig = z.record(str, z.unknown());
export const entityBundleResponse = obj({ rev: str, entities: z.array(entityConfig) });
export const entityRowResponse = obj({ id: str, kind: str, label: strOrNull, source: z.enum(['seed', 'db']), headRevisionId: strOrNull, publishedRevisionId: strOrNull, headSeq: numOrNull, publishedSeq: numOrNull, updatedAt: strOrNull });
export const entityRowsResponse = z.array(entityRowResponse);
export const revisionResponse = obj({
  id: str, entityId: str, seq: num, parentId: strOrNull, message: str, authorWallet: str, jobId: strOrNull, prompt: strOrNull, createdAt: str, head: bool, published: bool,
  source: str.optional(), config: entityConfig.optional(), warnings: z.array(str).optional(),
});
export const revisionsResponse = z.array(revisionResponse);
export const entityHeadResponse = obj({ row: entityRowResponse, source: str, config: entityConfig });
export const publishedResponse = obj({ rev: str });
export const editorJobResponse = obj({
  id: str, wallet: str, prompt: str, provider: str, model: str, entityId: strOrNull, baseRevisionId: strOrNull, resultRevisionId: strOrNull, status: enums(JOB_STATUSES), error: strOrNull, tokensIn: num, tokensOut: num, createdAt: str, finishedAt: strOrNull,
});
export const editorJobsResponse = z.array(editorJobResponse);
export const jobCreatedResponse = obj({ jobId: str });
export const jobEventsResponse = obj({ status: enums(JOB_STATUSES), events: z.array(obj({ seq: num, type: enums(EVENT_TYPES), payload: z.record(str, z.unknown()), at: str })) });
export const editorMeResponse = obj({ wallet: str, providers: z.array(obj({ id: str, label: str, models: z.array(str), default: str })), defaultProvider: strOrNull });
/** The token is the editor cookie. The body is the session the page shows. */
export const editorSignInResponse = obj({ wallet: str, expiresAt: num });
export const mcpConfigsResponse = z.record(str, entityConfig);
export { authChallengeResponse as editorChallengeResponse };
