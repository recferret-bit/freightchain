/* RFC 9457 problem details – the one error body of the API (Content-Type: application/problem+json). */
export const PROBLEM_TYPE_BASE = '/problems/';

export const problemTypeFor = (code: string): string => `${PROBLEM_TYPE_BASE}${code}`;

export interface ProblemFieldError {
  path: string;
  code: string;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  requestId: string;
  /** field errors of a malformed request, or the reasons an entity was refused (422 entity_invalid / spec_invalid: plain strings) */
  errors?: ProblemFieldError[] | readonly string[];
  warnings?: readonly string[];
  checks?: Record<string, unknown>;
}

export const PROBLEM_TITLES: Record<string, string> = {
  bad_request: 'Bad request',
  validation_error: 'Validation error',
  malformed_json: 'Malformed JSON',
  payload_too_large: 'Payload too large',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  not_found: 'Not found',
  conflict: 'Conflict',
  entity_invalid: 'Entity refused',
  stale_base: 'Stale base revision',
  version_conflict: 'Version conflict',
  rate_limited: 'Rate limited',
  service_unavailable: 'Service unavailable',
  internal_error: 'Internal error',
  response_schema_violation: 'Response schema violation',
};

export const titleForCode = (code: string): string => PROBLEM_TITLES[code] ?? 'Error';
