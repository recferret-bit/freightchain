import { BadRequestError } from '../../domain/shared/errors.js';

/** anticheat.md §14.6. Checked only after the batch MAC. */
export const STREAMS_COMPRESSED_MAX = 64 * 1024;
export const STREAMS_UNCOMPRESSED_MAX = 256 * 1024;

/** `encoded` is base64 of a deflate-raw payload. Absent means the v1 samples stand alone. `inflate` is the platform inflater. */
export function assertBatchStreams(encoded: string | undefined, inflate: (raw: Buffer) => Buffer): void {
  if (!encoded) return;
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length > STREAMS_COMPRESSED_MAX) throw new BadRequestError('v2.1 streams exceed the compressed cap', 'batch-streams-oversize');
  let plain: Buffer;
  try { plain = inflate(raw); }
  catch { throw new BadRequestError('v2.1 streams do not inflate', 'batch-streams-invalid'); }
  if (plain.length > STREAMS_UNCOMPRESSED_MAX) throw new BadRequestError('v2.1 streams exceed the uncompressed cap', 'batch-streams-oversize');
}
