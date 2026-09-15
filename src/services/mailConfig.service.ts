import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { db } from '../db';
import { emailSettings } from '../db/models';
import { env } from '../config/env';
import { decryptSecret } from '../shared/security/crypto';

/**
 * Single source of SMTP configuration + transport for the whole app.
 *
 *  • Reads admin-saved settings from `email_settings` first; falls back to the
 *    SMTP_* env vars when no (enabled) row exists — so existing deployments keep
 *    working with no DB row.
 *  • Supports two auth types:
 *      - BASIC            → nodemailer auth { user, pass }
 *      - MICROSOFT_OAUTH2 → Azure AD client-credentials access token +
 *                           nodemailer auth { type:'OAuth2', user, accessToken }
 *                           (SASL XOAUTH2). Verified supported for Exchange
 *                           Online SMTP AUTH with the SMTP.SendAsApp app
 *                           permission and scope https://outlook.office365.com/.default.
 *  • Caches the resolved config AND the nodemailer transport in memory. For
 *    OAuth it also caches the access token with its expiry and refetches only
 *    when it is about to expire (tokens are NEVER persisted).
 */
export type MailAuthType = 'BASIC' | 'MICROSOFT_OAUTH2';

export interface MailConfig {
  authType: MailAuthType;
  host: string;
  port: number;
  secure: boolean;
  // BASIC
  user: string;
  pass: string;
  // MICROSOFT_OAUTH2
  tenantId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  senderEmail: string | null;
  // Common
  fromName: string | null;
  fromEmail: string;
  replyTo: string | null;
  enabled: boolean;
}

let cachedConfig: MailConfig | null | undefined; // undefined = not loaded; null = none available
let cachedTransport: Transporter | null = null;
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

/** Call after settings are saved so the next email picks up the new config. */
export function invalidateMailCache(): void {
  cachedConfig = undefined;
  cachedTransport = null;
  tokenCache = null;
}

async function loadConfig(): Promise<MailConfig | null> {
  // 1) Admin-saved settings (DB) take precedence.
  try {
    const [row] = await db.select().from(emailSettings).limit(1);
    if (row) {
      const authType = (row.authType as MailAuthType) || 'BASIC';
      if (authType === 'MICROSOFT_OAUTH2') {
        if (row.host && row.tenantId && row.clientId && row.clientSecretEncrypted && row.senderEmail) {
          return {
            authType,
            host: row.host,
            port: row.port,
            secure: row.secure,
            user: row.senderEmail as string, // XOAUTH2 user = mailbox
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
        }
      } else if (row.host && row.username && row.passwordEncrypted) {
        return {
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
      }
    }
  } catch (err) {
    // Table missing / decrypt failure → fall back to env rather than break email.
    console.error('[mailConfig] failed to load DB settings, falling back to env:', (err as Error)?.message);
  }

  // 2) Backward-compatible env fallback (BASIC only).
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    return {
      authType: 'BASIC',
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      tenantId: null,
      clientId: null,
      clientSecret: null,
      senderEmail: null,
      fromName: null,
      fromEmail: (env.SMTP_FROM || env.SMTP_USER) as string,
      replyTo: null,
      enabled: true,
    };
  }
  return null;
}

export async function getMailConfig(): Promise<MailConfig | null> {
  if (cachedConfig === undefined) cachedConfig = await loadConfig();
  return cachedConfig;
}

/** True when email is configured AND enabled. */
export async function isMailEnabled(): Promise<boolean> {
  const cfg = await getMailConfig();
  return !!cfg && cfg.enabled;
}

/**
 * Acquire an app-only (client-credentials) access token from Azure AD for
 * Exchange Online SMTP. Throws with an admin-friendly message on failure.
 * Tokens are returned to the caller only — never persisted.
 */
export async function acquireMicrosoftToken(cfg: MailConfig): Promise<{ token: string; expiresIn: number }> {
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
    throw new Error('Microsoft OAuth is not fully configured (tenant, client id and client secret are required).');
  }
  const url = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://outlook.office365.com/.default',
    grant_type: 'client_credentials',
  });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (e: any) {
    throw new Error(`Network error contacting Microsoft sign-in: ${e?.message ?? e}`);
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(mapAadError(json));
  }
  return { token: json.access_token as string, expiresIn: Number(json.expires_in) || 3600 };
}

/** Map an Azure AD token-endpoint error body to an admin-friendly message. */
function mapAadError(json: any): string {
  const err = String(json?.error ?? '');
  const desc = String(json?.error_description ?? '');
  const aadsts = desc.match(/AADSTS\d+/)?.[0];
  if (err === 'invalid_client' || /AADSTS7000215|AADSTS700016/.test(desc)) {
    return `Invalid Client ID or Client Secret${aadsts ? ` (${aadsts})` : ''}.`;
  }
  if (/AADSTS90002|AADSTS900023/.test(desc) || /tenant .* not found/i.test(desc)) {
    return `Invalid Tenant ID${aadsts ? ` (${aadsts})` : ''}.`;
  }
  if (err === 'unauthorized_client' || /AADSTS70011|invalid scope/i.test(desc)) {
    return `The app is not authorized for SMTP (check the SMTP.SendAsApp permission + admin consent)${aadsts ? ` (${aadsts})` : ''}.`;
  }
  return desc || err || 'Failed to obtain a Microsoft access token.';
}

/** Ensure a valid (cached) OAuth token; refetch when near expiry. */
async function getValidToken(cfg: MailConfig): Promise<string> {
  const key = `${cfg.tenantId}|${cfg.clientId}`;
  const now = Date.now();
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.token;
  }
  const { token, expiresIn } = await acquireMicrosoftToken(cfg);
  tokenCache = { key, token, expiresAt: now + expiresIn * 1000 };
  cachedTransport = null; // rebuild the transport with the fresh token
  return token;
}

/**
 * Build a transport from an explicit config. For OAuth an access token must be
 * supplied (the caller fetches it). Used directly by the Test-Email path.
 */
export function buildTransport(cfg: MailConfig, accessToken?: string): Transporter {
  const base = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    family: 4, // Render containers have no IPv6 outbound — force IPv4.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  };
  if (cfg.authType === 'MICROSOFT_OAUTH2') {
    return nodemailer.createTransport({
      ...base,
      auth: { type: 'OAuth2', user: (cfg.senderEmail || cfg.user) as string, accessToken: accessToken ?? '' },
    } as any);
  }
  return nodemailer.createTransport({ ...base, auth: { user: cfg.user, pass: cfg.pass } } as any);
}

/** Cached transport for the current (enabled) config; null when unavailable. */
export async function getMailTransport(): Promise<Transporter | null> {
  const cfg = await getMailConfig();
  if (!cfg || !cfg.enabled) return null;
  if (cfg.authType === 'MICROSOFT_OAUTH2') {
    const token = await getValidToken(cfg); // refreshes + clears transport when a new token is issued
    if (!cachedTransport) cachedTransport = buildTransport(cfg, token);
    return cachedTransport;
  }
  if (!cachedTransport) cachedTransport = buildTransport(cfg);
  return cachedTransport;
}

/** Bare from address (no display name). */
export async function resolveMailAddress(): Promise<string> {
  const cfg = await getMailConfig();
  const raw = (cfg?.fromEmail || cfg?.senderEmail || cfg?.user || '').trim();
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1] : raw).trim();
}

/** RFC-5322 From header: `"Name" <addr>` (or bare addr when no name). */
export async function resolveMailFrom(): Promise<string> {
  const cfg = await getMailConfig();
  const addr = await resolveMailAddress();
  const name = (cfg?.fromName || 'ELT Group').trim();
  return name ? `"${name}" <${addr}>` : addr;
}

export async function resolveReplyTo(): Promise<string | undefined> {
  const cfg = await getMailConfig();
  return cfg?.replyTo?.trim() || undefined;
}

/** Translate common SMTP/transport/OAuth errors into an admin-friendly message. */
export function describeMailError(err: any): string {
  const code = err?.code || err?.errno;
  const msg = String(err?.message ?? err ?? '');
  // OAuth/token messages are already friendly (thrown by acquireMicrosoftToken).
  if (/Invalid Client ID|Invalid Tenant ID|SMTP\.SendAsApp|Microsoft access token|Microsoft sign-in/i.test(msg)) return msg;
  if (code === 'EAUTH' || /invalid login|authentication failed|535/i.test(msg)) return 'Authentication failed — check the credentials (and, for OAuth, the Exchange service-principal / mailbox permission).';
  if (code === 'ECONNECTION' || code === 'ECONNREFUSED' || /getaddrinfo|ENOTFOUND/i.test(msg)) return 'Unable to connect to the SMTP server — check the host and port.';
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout/i.test(msg)) return 'Connection to the SMTP server timed out — check the host, port, and network.';
  if (/tls|ssl|certificate|wrong version number/i.test(msg)) return 'TLS/SSL error — check the "Secure" setting for this port (usually on for 465, off for 587).';
  return msg || 'Failed to send email.';
}

/**
 * Verify + send a test email using an EXPLICIT config (typically the saved
 * settings). For OAuth it fetches an access token first so token errors surface
 * clearly. Returns a structured result with a meaningful message.
 */
export async function sendTestEmail(cfg: MailConfig, to: string): Promise<{ ok: boolean; message: string }> {
  try {
    let transporter: Transporter;
    if (cfg.authType === 'MICROSOFT_OAUTH2') {
      const { token } = await acquireMicrosoftToken(cfg); // surfaces invalid tenant/client/secret
      transporter = buildTransport(cfg, token);
    } else {
      transporter = buildTransport(cfg);
    }
    await transporter.verify();
    const rawFrom = (cfg.fromEmail || cfg.senderEmail || cfg.user) as string;
    const addr = rawFrom.match(/<([^>]+)>/)?.[1] ?? rawFrom;
    const from = cfg.fromName ? `"${cfg.fromName}" <${addr}>` : addr;
    const info = await transporter.sendMail({
      from,
      to,
      ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
      subject: 'TrueGear SMTP test email',
      text: 'This is a test email confirming your SMTP settings are working correctly.',
    });
    return { ok: true, message: `Test email sent (messageId: ${info.messageId}).` };
  } catch (err) {
    return { ok: false, message: describeMailError(err) };
  }
}
