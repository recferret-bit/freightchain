import { Body, Param, Query } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

/* Every request part of every endpoint goes through one of these: never `unknown`, never an unvalidated TS type (HTTP contract rule). */
export const ZodBody = <T>(schema: ZodType<T, ZodTypeDef, unknown>): ParameterDecorator => Body(new ZodValidationPipe(schema, { emptyBodyAsObject: true }));
export const ZodQuery = <T>(schema: ZodType<T, ZodTypeDef, unknown>): ParameterDecorator => Query(new ZodValidationPipe(schema));
export const ZodParams = <T>(schema: ZodType<T, ZodTypeDef, unknown>): ParameterDecorator => Param(new ZodValidationPipe(schema));
