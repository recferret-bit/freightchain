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
  readonly errorCode = 'not_found';

  constructor(message = 'Not found') {
    super(message);
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

export class ServiceUnavailableError extends DomainError {
  readonly statusCode = 503;
  readonly errorCode = 'service_unavailable';

  constructor(
    message = 'Service unavailable',
    public readonly checks?: Record<string, unknown>,
  ) {
    super(message, checks ? { checks } : undefined);
  }
}
