/* Domain errors: framework-free, each carries its HTTP status and a stable machine code. The single ProblemDetailsFilter renders them as RFC 9457 problem+json. */
export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: string;
  readonly extensions?: Record<string, unknown>;

  constructor(message: string, extensions?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.extensions = extensions;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static notFound(errorCodeOrMessage = 'not_found', message?: string): NotFoundError {
    if (message !== undefined) {
      return new NotFoundError(message, errorCodeOrMessage);
    }
    return new NotFoundError(errorCodeOrMessage);
  }
}

export class BadRequestError extends DomainError {
  readonly statusCode = 400;
  readonly errorCode: string;

  constructor(message = 'Bad request', errorCode = 'bad_request', extensions?: Record<string, unknown>) {
    super(message, extensions);
    this.errorCode = errorCode;
  }
}

/** The request is well-formed but its content is refused, with every reason (an entity that does not validate: `errors` refuse it, `warnings` only inform). */
export class UnprocessableEntityError extends DomainError {
  readonly statusCode = 422;
  readonly errorCode: string;

  constructor(message: string, errorCode: string, readonly errors: readonly string[] = [], readonly warnings: readonly string[] = []) {
    super(message);
    this.errorCode = errorCode;
  }
}

export class UnauthorizedError extends DomainError {
  readonly statusCode = 401;
  readonly errorCode: string;

  constructor(message = 'Unauthorized', errorCode = 'unauthorized') {
    super(message);
    this.errorCode = errorCode;
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  readonly errorCode: string;

  constructor(message = 'Not found', errorCode = 'not_found') {
    super(message);
    this.errorCode = errorCode;
  }
}

export class ConflictError extends DomainError {
  readonly statusCode = 409;
  readonly errorCode: string;

  constructor(message = 'Conflict', errorCode = 'conflict') {
    super(message);
    this.errorCode = errorCode;
  }
}

/** An optimistic-lock miss: someone else saved the same aggregate first. */
export class VersionConflictError extends DomainError {
  readonly statusCode = 409;
  readonly errorCode = 'version_conflict';

  constructor(message = 'The record was changed by another request – retry') {
    super(message);
  }
}

/** Dual approval is waiting on a second admin. 202 so the first request did not apply the change. */
export class PendingApprovalError extends DomainError {
  readonly statusCode = 202;
  readonly errorCode = 'pending_approval';

  constructor(readonly proposalId: string) {
    super(`waiting for a second admin: ${proposalId}`);
  }
}

export class ForbiddenError extends DomainError {
  readonly statusCode = 403;
  readonly errorCode: string;

  constructor(message = 'Forbidden', errorCode = 'forbidden') {
    super(message);
    this.errorCode = errorCode;
  }
}

/** The request's body is in a form this route does not take (a form post where JSON is expected – the login-CSRF shape, audit H7). */
export class UnsupportedMediaTypeError extends DomainError {
  readonly statusCode = 415;
  readonly errorCode: string;

  constructor(message = 'Unsupported media type', errorCode = 'unsupported_media_type') {
    super(message);
    this.errorCode = errorCode;
  }
}

/** A per-wallet quota (e.g. a ride effect's sliding gap) is used up – try again later or another way. */
export class TooManyRequestsError extends DomainError {
  readonly statusCode = 429;
  readonly errorCode: string;

  /** retryAfterSeconds: sent as the Retry-After header (ProblemDetailsFilter) when known */
  constructor(message = 'Too many requests', errorCode = 'rate_limited', readonly retryAfterSeconds?: number) {
    super(message);
    this.errorCode = errorCode;
  }
}

/** The handler's JSON does not match the route's `@ZodResponse` schema. The problem filter renders it; controllers do not throw framework exceptions. */
export class ResponseSchemaViolationError extends DomainError {
  readonly statusCode = 500;
  readonly errorCode = 'response_schema_violation';

  constructor(message = 'Response did not match its schema') {
    super(message);
  }
}

/** The minigame window closed. ProblemDetailsFilter renders `errorCode` (mg_expired) at 410. */
export class GoneError extends DomainError {
  readonly statusCode = 410;
  readonly errorCode: string;

  constructor(message = 'Gone', errorCode = 'gone') {
    super(message);
    this.errorCode = errorCode;
  }
}

export class ServiceUnavailableError extends DomainError {
  readonly statusCode = 503;
  readonly errorCode: string;
  readonly checks?: Record<string, unknown>;

  /** A string second argument is a machine code (`honk_chain`); an object is the readiness `checks` map. */
  constructor(message = 'Service unavailable', checksOrCode?: Record<string, unknown> | string) {
    const checks = typeof checksOrCode === 'string' ? undefined : checksOrCode;
    super(message, checks ? { checks } : undefined);
    this.checks = checks;
    this.errorCode = typeof checksOrCode === 'string' ? checksOrCode : 'service_unavailable';
  }
}
