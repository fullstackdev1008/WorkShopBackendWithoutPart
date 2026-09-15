import { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { emailSettings } from '../../db/models';
import { success, created, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { encryptSecret, decryptSecret } from '../../shared/security/crypto';
import { getMailConfig, invalidateMailCache, sendTestEmail, type MailConfig, type MailAuthType } from '../../services/mailConfig.service';
import { updateEmailSettingsSchema, testEmailSchema } from './dto';

async function firstRow() {
  const [row] = await db.select().from(emailSettings).limit(1);
  return row ?? null;
}

// Shape returned by GET/PUT — never exposes password or client secret.
function safeView(row: {
  authType?: string | null;
  host?: string | null;
  port?: number | null;
  secure?: boolean | null;
  username?: string | null;
  passwordEncrypted?: string | null;
  tenantId?: string | null;
  clientId?: string | null;
  clientSecretEncrypted?: string | null;
  senderEmail?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  enabled?: boolean | null;
}) {
  return {
    authType: (row.authType as MailAuthType) || 'BASIC',
    host: row.host ?? '',
    port: row.port ?? 587,
    secure: row.secure ?? false,
    username: row.username ?? '',
    tenantId: row.tenantId ?? '',
    clientId: row.clientId ?? '',
    senderEmail: row.senderEmail ?? '',
    fromName: row.fromName ?? '',
    fromEmail: row.fromEmail ?? '',
    replyTo: row.replyTo ?? '',
    enabled: row.enabled ?? false,
    passwordConfigured: !!row.passwordEncrypted,
    clientSecretConfigured: !!row.clientSecretEncrypted,
  };
}

// GET /api/admin/settings/email — never returns password / client secret.
export async function getEmailSettings(_request: FastifyRequest) {
  try {
    const row = await firstRow();
    return success('Email settings fetched successfully', safeView(row ?? {}));
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// PUT /api/admin/settings/email — upsert the single settings row.
export async function updateEmailSettings(request: FastifyRequest) {
  try {
    const parse = updateEmailSettingsSchema.safeParse(request.body);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid request body');
    const body = parse.data;
    const actorId = await resolveActorId(request);

    const existing = await firstRow();
    const authType: MailAuthType = body.authType ?? 'BASIC';

    // Secret handling — supplied (non-empty) → encrypt & replace; blank/omitted → keep.
    let passwordEncrypted = existing?.passwordEncrypted ?? null;
    let clientSecretEncrypted = existing?.clientSecretEncrypted ?? null;

    if (authType === 'BASIC') {
      if (body.password && body.password.trim() !== '') passwordEncrypted = encryptSecret(body.password);
      if (!passwordEncrypted) return error(HttpStatus.BAD_REQUEST, 'Password is required');
    } else {
      if (body.clientSecret && body.clientSecret.trim() !== '') clientSecretEncrypted = encryptSecret(body.clientSecret);
      if (!clientSecretEncrypted) return error(HttpStatus.BAD_REQUEST, 'Client secret is required');
    }

    const values = {
      authType,
      host: body.host,
      port: body.port,
      secure: body.secure ?? false,
      // BASIC
      username: authType === 'BASIC' ? (body.username ?? null) : null,
      passwordEncrypted: authType === 'BASIC' ? passwordEncrypted : null,
      // MICROSOFT_OAUTH2
      tenantId: authType === 'MICROSOFT_OAUTH2' ? (body.tenantId ?? null) : null,
      clientId: authType === 'MICROSOFT_OAUTH2' ? (body.clientId ?? null) : null,
      clientSecretEncrypted: authType === 'MICROSOFT_OAUTH2' ? clientSecretEncrypted : null,
      senderEmail: authType === 'MICROSOFT_OAUTH2' ? (body.senderEmail?.trim() || null) : null,
      // Common
      fromName: body.fromName?.trim() || null,
      fromEmail: body.fromEmail,
      replyTo: body.replyTo ? body.replyTo.trim() || null : null,
      enabled: body.enabled ?? false,
      updatedBy: actorId,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(emailSettings).set(values).where(eq(emailSettings.id, existing.id));
    } else {
      await db.insert(emailSettings).values(values);
    }

    // Latest config takes effect immediately — no restart.
    invalidateMailCache();

    // Lightweight audit (who/when) — secrets are NEVER logged.
    console.log(
      `[Settings] Email settings updated by user ${actorId ?? 'unknown'} ` +
        `(authType=${authType}, host=${body.host}, enabled=${values.enabled}, ` +
        `secretChanged=${!!((authType === 'BASIC' ? body.password : body.clientSecret) || '').trim()})`
    );

    return (existing ? success : created)('Email settings saved successfully', safeView(values));
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// POST /api/admin/settings/email/test — verify + send using an EXPLICIT config
// built from the SAVED row (or env fallback). Never exposes secrets.
export async function testEmailSettings(request: FastifyRequest) {
  try {
    const parse = testEmailSchema.safeParse(request.body);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid recipient');
    const { to } = parse.data;

    // Build the config to test from the saved row; fall back to the resolved
    // config (which itself falls back to env) so a fresh env-only setup can test.
    let cfg: MailConfig | null = null;
    const row = await firstRow();
    const rowAuthType = (row?.authType as MailAuthType) || 'BASIC';

    if (row && rowAuthType === 'MICROSOFT_OAUTH2' && row.host && row.tenantId && row.clientId && row.clientSecretEncrypted && row.senderEmail) {
      cfg = {
        authType: 'MICROSOFT_OAUTH2',
        host: row.host,
        port: row.port,
        secure: row.secure,
        user: row.senderEmail,
        pass: '',
        tenantId: row.tenantId,
        clientId: row.clientId,
        clientSecret: decryptSecret(row.clientSecretEncrypted),
        senderEmail: row.senderEmail,
        fromName: row.fromName,
        fromEmail: (row.fromEmail || row.senderEmail) as string,
        replyTo: row.replyTo,
        enabled: row.enabled,
      };
    } else if (row && rowAuthType === 'BASIC' && row.host && row.username && row.passwordEncrypted) {
      cfg = {
        authType: 'BASIC',
        host: row.host,
        port: row.port,
        secure: row.secure,
        user: row.username,
        pass: decryptSecret(row.passwordEncrypted),
        tenantId: null,
        clientId: null,
        clientSecret: null,
        senderEmail: null,
        fromName: row.fromName,
        fromEmail: (row.fromEmail || row.username) as string,
        replyTo: row.replyTo,
        enabled: row.enabled,
      };
    } else {
      cfg = await getMailConfig();
    }

    if (!cfg) {
      return error(HttpStatus.BAD_REQUEST, 'Email is not configured. Save settings first, then send a test email.');
    }

    const result = await sendTestEmail(cfg, to);
    if (!result.ok) return error(HttpStatus.BAD_REQUEST, result.message);
    return success(result.message, { to });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
