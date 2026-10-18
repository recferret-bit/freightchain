import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { GeoHeaders } from '../../../application/ports/prize/geo-locator.port.js';

/** The request headers, for the geo locator. The controller does not read a name itself. */
export const ClientGeo = createParamDecorator((_data: unknown, ctx: ExecutionContext): GeoHeaders => {
  const headers = ctx.switchToHttp().getRequest<{ headers?: GeoHeaders }>().headers;
  return headers ?? {};
});
