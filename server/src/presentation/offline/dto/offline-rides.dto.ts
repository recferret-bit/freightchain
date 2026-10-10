import { z } from 'zod';

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);

export const offlineQuerySchema = z.object({ fingerprint });
export type OfflineQuery = z.infer<typeof offlineQuerySchema>;

export const offlineBodySchema = z.object({ fingerprint });
export type OfflineBody = z.infer<typeof offlineBodySchema>;
