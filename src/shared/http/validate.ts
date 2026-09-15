import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ZodError, type ZodIssue, type ZodTypeAny } from 'zod';
import { error } from './response';
import { HttpStatus } from './status';

type ValidateTarget = 'body' | 'query' | 'params';

export interface ValidateOptions {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type NormalizedFieldError = {
  field: string;
  message: string;
  code?: ZodIssue['code'];
  expected?: unknown;
  received?: unknown;
};

function prettifyField(field: string) {
  const last = field.split('.').pop() || field;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function formatZodErrors(zodError: ZodError, prefix?: ValidateTarget): NormalizedFieldError[] {
  return zodError.errors.map((issue) => {
    const p = issue.path.join('.') || 'root';
    const field = prefix ? `${prefix}.${p}`.replace(`${prefix}.root`, prefix) : p;
    return { field, message: issue.message, code: issue.code, expected: (issue as any).expected, received: (issue as any).received };
  });
}

function normalizeMessage(err: NormalizedFieldError) {
  const label = prettifyField(err.field);
  if (err.message === 'Required' || (err.code === 'invalid_type' && err.received === 'undefined')) return `${label} is required`;
  if (err.code === 'invalid_type') return `${label} must be a ${typeof err.expected === 'string' ? err.expected : 'valid value'}`;
  return `${label}: ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`;
}

// ─── preHandler factory ───────────────────────────────────────────────────────
// Usage in routes: { preHandler: [validate(MySchema)] }
// Usage with targets: { preHandler: [validate({ body: BodySchema, query: QuerySchema })] }
export function validate(schemaOrOptions: ZodTypeAny | ValidateOptions, target: ValidateTarget = 'body'): preHandlerHookHandler {
  const options: ValidateOptions = 'parse' in schemaOrOptions ? { [target]: schemaOrOptions } : schemaOrOptions;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const allErrors: NormalizedFieldError[] = [];

      const validatePart = (schema: ZodTypeAny | undefined, value: unknown, key: ValidateTarget) => {
        if (!schema) return;
        const result = schema.safeParse(value);
        if (!result.success) allErrors.push(...formatZodErrors(result.error, key));
        else (req as any)[key] = result.data;
      };

      validatePart(options.params, req.params, 'params');
      validatePart(options.query, req.query, 'query');
      validatePart(options.body, req.body, 'body');

      if (allErrors.length > 0) {
        const message = allErrors.map(normalizeMessage).join(', ');
        return reply.status(HttpStatus.BAD_REQUEST).send(error(HttpStatus.BAD_REQUEST, message));
      }
    } catch (err) {
      return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send(error(HttpStatus.INTERNAL_SERVER_ERROR, 'Validation failed'));
    }
  };
}

export const validateBody = validate;
export function validateQuery(schema: ZodTypeAny): preHandlerHookHandler { return validate(schema, 'query'); }
export function validateParams(schema: ZodTypeAny): preHandlerHookHandler { return validate(schema, 'params'); }
