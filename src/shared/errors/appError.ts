import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { getUniqueConstraintMessage } from './mapDbErrors';

// ─── Custom Error Classes ─────────────────────────────────────────────────────
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

// ─── Centralized Error Handler ────────────────────────────────────────────────
export async function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Zod validation errors → 400
  if (error instanceof ZodError) {
    const messages = error.errors
      .map((e) => {
        const field = e.path.join('.');
        return field ? `${field}: ${e.message}` : e.message;
      })
      .join(', ');
    return reply.code(400).send({
      status: false,
      statusCode: 400,
      error: 'Validation Error',
      message: messages,
    });
  }

  // Our own AppError (ValidationError, NotFoundError, ConflictError, etc.)
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      status: false,
      statusCode: error.statusCode,
      error: error.name.replace('Error', ' Error').trim(),
      message: error.message,
    });
  }

  // PostgreSQL unique constraint violation (23505) → 409
  if ((error as any).code === '23505') {
    const message = getUniqueConstraintMessage(error);
    return reply.code(409).send({
      status: false,
      statusCode: 409,
      error: 'Conflict',
      message,
    });
  }

  // PostgreSQL foreign key constraint violation (23503) → 400
  if ((error as any).code === '23503') {
    return reply.code(400).send({
      status: false,
      statusCode: 400,
      error: 'Bad Request',
      message: 'Referenced record does not exist',
    });
  }

  // PostgreSQL not-null violation (23502) → 400
  if ((error as any).code === '23502') {
    const column: string = (error as any).column || 'unknown';
    return reply.code(400).send({
      status: false,
      statusCode: 400,
      error: 'Validation Error',
      message: `Missing required field: ${column}`,
    });
  }

  // Fastify payload too large → 413
  if ((error as any).statusCode === 413) {
    return reply.code(413).send({
      status: false,
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'File size exceeds the allowed limit (max 10 MB)',
    });
  }

  // Generic Fastify errors with a statusCode
  if ((error as FastifyError).statusCode) {
    const fe = error as FastifyError;
    return reply.code(fe.statusCode!).send({
      status: false,
      statusCode: fe.statusCode,
      error: fe.code || 'Error',
      message: fe.message,
    });
  }

  // Unhandled / unexpected errors → 500
  request.log.error(error);
  return reply.code(500).send({
    status: false,
    statusCode: 500,
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  });
}
