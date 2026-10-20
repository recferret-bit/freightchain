import { SetMetadata } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

/** Method metadata: the JSON this route returns. Read by ZodResponseInterceptor and the OpenAPI generator. */
export const ZOD_RESPONSE = 'fc:zod_response';
/** Non-JSON routes (PNG, redirects, SSE, raw buffers). Exempt from the response check and the meta-check. */
export const ZOD_RESPONSE_RAW = 'fc:zod_response_raw';

export interface ZodResponseMeta {
  schema: ZodTypeAny;
  /** Documented success status. Absent = the method's @HttpCode, else Nest's default. */
  status?: number;
}

export const ZodResponse = (schema: ZodTypeAny, status?: number): MethodDecorator => SetMetadata(ZOD_RESPONSE, { schema, status } satisfies ZodResponseMeta);

export const ZodResponseRaw = (): MethodDecorator => SetMetadata(ZOD_RESPONSE_RAW, true);
