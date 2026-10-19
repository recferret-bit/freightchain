import { z } from 'zod';
import { ZodValidationPipe } from '../../../../src/infrastructure/http/pipes/zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  it('parses, throws the ZodError (the filter turns it into a 400), and can treat an empty body as {}', () => {
    const schema = z.object({ a: z.string().default('x') });
    expect(new ZodValidationPipe(schema, { emptyBodyAsObject: true }).transform(undefined)).toEqual({ a: 'x' });
    expect(() => new ZodValidationPipe(schema).transform(undefined)).toThrow(z.ZodError);
    expect(() => new ZodValidationPipe(schema).transform({ a: 1 })).toThrow(z.ZodError);
  });
});
