import { z } from 'zod';

// Admin email settings. Two auth types:
//  • BASIC            → host + username + password (password optional on update:
//                       blank/omitted keeps the existing encrypted password).
//  • MICROSOFT_OAUTH2 → host + tenantId + clientId + clientSecret + senderEmail
//                       (clientSecret optional on update: blank/omitted keeps
//                       the existing encrypted secret).
export const updateEmailSettingsSchema = z
  .object({
    authType: z.enum(['BASIC', 'MICROSOFT_OAUTH2']).optional().default('BASIC'),
    host: z.string({ required_error: 'SMTP host is required' }).trim().min(1, 'SMTP host is required').max(255),
    port: z.coerce
      .number({ invalid_type_error: 'Port must be a number' })
      .int('Port must be a whole number')
      .min(1, 'Invalid port')
      .max(65535, 'Invalid port'),
    secure: z.boolean().optional().default(false),
    // BASIC
    username: z.string().trim().max(255).optional(),
    password: z.string().max(1024).optional(), // blank/omitted → keep existing
    // MICROSOFT_OAUTH2
    tenantId: z.string().trim().max(255).optional(),
    clientId: z.string().trim().max(255).optional(),
    clientSecret: z.string().max(2048).optional(), // blank/omitted → keep existing
    senderEmail: z.union([z.string().trim().email('Invalid sender email').max(255), z.literal('')]).optional(),
    // Common
    fromName: z.string().trim().max(120).nullable().optional(),
    fromEmail: z.string().trim().email('Invalid From email').max(255),
    replyTo: z.union([z.string().trim().email('Invalid Reply-To email').max(255), z.literal('')]).nullable().optional(),
    enabled: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.authType === 'MICROSOFT_OAUTH2') {
      if (!v.tenantId?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tenantId'], message: 'Tenant ID is required' });
      if (!v.clientId?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'Client ID is required' });
      if (!v.senderEmail?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['senderEmail'], message: 'Sender email is required' });
      // clientSecret required only when none is stored yet — enforced in the service.
    } else {
      if (!v.username?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['username'], message: 'Username is required' });
      // password required only when none is stored yet — enforced in the service.
    }
  });

export const testEmailSchema = z.object({
  to: z.string({ required_error: 'Recipient is required' }).trim().email('Invalid recipient email'),
});
