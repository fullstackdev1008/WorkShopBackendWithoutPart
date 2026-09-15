import { z } from 'zod';

export const AppEnvSchema = z.enum(['development', 'production', 'test']);

export const ConfigSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    env: AppEnvSchema,
    port: z.number().int().positive(),
    host: z.string().min(1),
    frontendUrl: z.string().url(),
  }),

  database: z.object({
    url: z.string().min(1),
  }),

  security: z.object({
    jwtSecret: z.string().min(1),
    jwtExpiresIn: z.string().min(1),
  }),

  storage: z.object({
    useLocal: z.boolean(),
    uploadDir: z.string().min(1),
    maxFileSize: z.number().int().positive(),
    s3Bucket: z.string(),
    s3Region: z.string(),
    s3Endpoint: z.string(),
    s3AccessKeyId: z.string(),
    s3SecretAccessKey: z.string(),
  }),

  smtp: z.object({
    host: z.string().optional(),
    port: z.number().int().positive(),
    user: z.string().optional(),
    pass: z.string().optional(),
    from: z.string().optional(),
  }),

  whatsapp: z.object({
    phoneNumberId: z.string().optional(),
    accessToken: z.string().optional(),
  }),

  evolve: z.object({
    apiUrl: z.string().url(),
    interfaceCode: z.string().min(1),
    sourceSystem: z.string().min(1),
    targetSystem: z.string().min(1),
    messageCreator: z.string().min(1),
  }),

  ai: z.object({
    anthropicApiKey: z.string().optional(),
  }),
});

export type AppEnv = z.infer<typeof AppEnvSchema>;
export type AppConfig = z.infer<typeof ConfigSchema>;
