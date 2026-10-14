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

export class UnauthorizedError extends DomainError {
  readonly statusCode = 401;
  readonly errorCode = 'unauthorized';

  constructor(message = 'Unauthorized') {
    super(message);
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

export class ForbiddenError extends DomainError {
  readonly statusCode = 403;
  readonly errorCode: string;

  constructor(message = 'Forbidden', errorCode = 'forbidden') {
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
