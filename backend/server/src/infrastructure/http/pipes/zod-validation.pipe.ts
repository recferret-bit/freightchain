import type { PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

export interface ZodValidationPipeOptions {
  /** Treat an absent request body (undefined) as {} before parsing, so all-optional schemas accept empty POST bodies. */
  emptyBodyAsObject?: boolean;
}

/** Parses with the schema; a ZodError propagates to the ProblemDetailsFilter (400 validation_error with per-field errors). */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(
    readonly schema: ZodType<T, ZodTypeDef, unknown>,
    private readonly options: ZodValidationPipeOptions = {},
  ) {}

  transform(value: unknown): T {
    return this.schema.parse(value === undefined && this.options.emptyBodyAsObject ? {} : value);
  }
}
