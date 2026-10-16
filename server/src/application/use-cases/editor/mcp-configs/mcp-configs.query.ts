import type { EntityConfig } from '../../../../domain/shared/entity.js';

/** Every entity's HEAD config, by id – the MCP's lookup for `use` / `ref` when it checks a source. */
export class McpConfigsQuery {}

export type McpConfigsDto = Record<string, EntityConfig>;
