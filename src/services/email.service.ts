import dns from "dns";
import path from "path";
import fs from "fs";
import {
  getMailTransport,
  isMailEnabled,
  resolveMailFrom,
  resolveMailAddress,
} from "./mailConfig.service";

// Render containers don't have IPv6 outbound. Force Node's DNS resolver to
// return IPv4 addresses first so SMTP connections never try to dial v6.
dns.setDefaultResultOrder("ipv4first");

// Company logo, embedded inline in every email via a CID attachment so it
// renders without depending on a public URL (and isn't blocked like remote
// images often are). Referenced in the HTML as <img src="cid:company-logo">.
// Resolved from cwd to match how the app resolves UPLOAD_DIR (see app.ts).
const LOGO_PATH = path.resolve(process.cwd(), "public", "logo.png");
const logoAttachments = fs.existsSync(LOGO_PATH)
  ? [{ filename: "logo.png", path: LOGO_PATH, cid: "company-logo" }]
  : [];

const CURRENCY_LOCALES: Record<string, string> = {
  ZAR: "en-ZA",
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "ar-AE",
};

// ─── From-address normalisation ───────────────────────────────────────────────
//
// SMTP_FROM in the environment may be a bare address ("x@y.com") OR already
// include a display name ("ELT Group <x@y.com>" / "ELT Group<x@y.com>"). The
// old code wrapped it unconditionally — `"ELT Group" <${SMTP_FROM}>` — which,
// when SMTP_FROM already had a name, produced an INVALID RFC-5322 header like
// `"ELT Group" <ELT Group<x@y.com>>` (nested brackets). A malformed From hurts
// DKIM/DMARC alignment, and mailboxes that fail alignment (Outlook especially)
// are far more likely to quarantine the mail or neutralise its links via Safe
// Links. These helpers always yield a valid header and a clean bare address.

// ─── Outlook-safe ("bulletproof") CTA button ──────────────────────────────────
//
// Desktop Outlook (Windows) renders email through Microsoft Word, which:
//   • ignores `background: linear-gradient(...)`  → the button loses its fill,
//   • ignores `border-radius`,
//   • mishandles `padding` on an inline <a>       → the clickable area shrinks.
// The previous CTA was `color:#fff` text on a gradient background, so in Outlook
// the gradient vanished and the white text sat on a white/transparent box —
// invisible, with a near-zero hit target. That is exactly why the approval link
// appeared "blocked / not clickable / impossible to copy" in Outlook.
//
// This renders a VML rounded-rect (with a SOLID fill) for Outlook inside an
// `[if mso]` conditional, and a solid-background <a> for every other client.
// A solid background-color guarantees the label is always readable. Callers
// should ALSO render a visible plain-text fallback link (see templates) so the
// URL is copyable even if a client drops the button entirely.
function buildCtaButton(url: string, label: string, color = "#158E86"): string {
  return `
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px;v-text-anchor:middle;width:280px;" arcsize="18%" strokecolor="${color}" fillcolor="${color}">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:600;">${label}</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${url}" style="display:inline-block;background-color:${color};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;padding:14px 32px;letter-spacing:0.2px;font-family:'Segoe UI',Arial,sans-serif;">${label}</a>
              <!--<![endif]-->`;
}

interface EstimateEmailParams {
  customerName: string;
  customerEmail: string;
  vehicleInfo: string;
  items: {
    jobDescription: string;
    labourCost: number;
    partsCost: number;
    lineTotal: number;
  }[];
  subtotal: number;
  taxLabel: string;
  taxPercentage: number;
  taxAmount: number;
  totalEstimate: number;
  approvalUrl: string;
  currencyCode?: string;
}

function buildEmailHtml(params: EstimateEmailParams): string {
  const {
    customerName,
    vehicleInfo,
    items,
    subtotal,
    taxLabel,
    taxPercentage,
    taxAmount,
    totalEstimate,
    approvalUrl,
    currencyCode = "ZAR",
  } = params;

  const locale = CURRENCY_LOCALES[currencyCode] ?? "en-ZA";
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n);

  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;">${item.jobDescription}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right;">${fmt(item.partsCost)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right;">${fmt(item.labourCost)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:600;color:#333;text-align:right;">${fmt(item.lineTotal)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Service Estimate</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#04C397,#158E86);padding:32px 32px 28px;">
              <img src="cid:company-logo" alt="ELT Group" height="44" style="display:block;height:44px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Service Estimate Ready for Your Review</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 16px;">
              <p style="margin:0 0 8px;font-size:15px;color:#333;">Hello <strong>${customerName}</strong>,</p>
              <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
                Your service estimate for <strong>${vehicleInfo}</strong> is ready. Please review the details below and approve at your convenience.
              </p>
            </td>
          </tr>

          <!-- Estimate table -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
                <thead>
                  <tr style="background:#fafafa;">
                    <th style="padding:10px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#999;text-align:left;">Description</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#999;text-align:right;">Parts</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#999;text-align:right;">Labour</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#999;text-align:right;">Total</th>
                  </tr>
                </thead>
                <tbody>${itemRows}</tbody>
                <tfoot>
                  <tr>
                    <td colspan="3" style="padding:10px 12px;font-size:12px;color:#666;text-align:right;">Subtotal</td>
                    <td style="padding:10px 12px;font-size:12px;color:#333;font-weight:600;text-align:right;">${fmt(subtotal)}</td>
                  </tr>
                  <tr>
                    <td colspan="3" style="padding:6px 12px;font-size:12px;color:#666;text-align:right;">${taxLabel} (${taxPercentage}%)</td>
                    <td style="padding:6px 12px;font-size:12px;color:#333;font-weight:600;text-align:right;">${fmt(taxAmount)}</td>
                  </tr>
                  <tr style="background:#f9f9f9;">
                    <td colspan="3" style="padding:12px 12px;font-size:14px;font-weight:700;color:#333;text-align:right;">Total Estimate</td>
                    <td style="padding:12px 12px;font-size:14px;font-weight:700;color:#04C397;text-align:right;">${fmt(totalEstimate)}</td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px;text-align:center;">
              ${buildCtaButton(approvalUrl, "Review &amp; Approve Estimate", "#158E86")}
              <p style="margin:18px 0 0;font-size:12px;color:#888;line-height:1.6;">
                Button not working? Copy and paste this link into your browser:<br />
                <a href="${approvalUrl}" style="color:#158E86;text-decoration:underline;word-break:break-all;">${approvalUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;line-height:1.6;">
                This email was sent by ELT Group. If you did not request this estimate, please ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPlainText(params: EstimateEmailParams): string {
  const {
    customerName,
    vehicleInfo,
    totalEstimate,
    approvalUrl,
    currencyCode = "ZAR",
  } = params;
  const locale = CURRENCY_LOCALES[currencyCode] ?? "en-ZA";
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n);
  return [
    `Hello ${customerName},`,
    ``,
    `Your service estimate for ${vehicleInfo} is ready.`,
    ``,
    `Total Estimate: ${fmt(totalEstimate)}`,
    ``,
    `Review and approve your estimate here:`,
    approvalUrl,
    ``,
    `Thank you for choosing ELT Group.`,
  ].join("\n");
}

// ─── Appointment Confirmation Email ───────────────────────────────────────────

interface AppointmentConfirmationParams {
  customerName: string;
  customerEmail: string;
  bookingRef: string;
  vehicleInfo: string;
  serviceType: string;
  appointmentDate: string; // e.g. "2026-03-14"
  appointmentTime: string; // e.g. "10:00"
  complaints: string[];
}

function buildAppointmentConfirmationHtml(
  p: AppointmentConfirmationParams,
): string {
  const dateStr = new Date(p.appointmentDate + "T00:00:00").toLocaleDateString(
    "en-GB",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );
  const [hh, mm] = p.appointmentTime.split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  const timeStr = `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
  const serviceLabel = p.serviceType
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const complaintRows = p.complaints.length
    ? p.complaints
        .map(
          (c) =>
            `<li style="margin:4px 0;font-size:13px;color:#555;">${c}</li>`,
        )
        .join("")
    : '<li style="margin:4px 0;font-size:13px;color:#555;">General service</li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#ff5100,#e03d00);padding:32px 32px 28px;">
              <img src="cid:company-logo" alt="ELT Group" height="44" style="display:block;height:44px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Appointment Confirmed</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 16px;">
              <p style="margin:0 0 8px;font-size:15px;color:#333;">Hello <strong>${p.customerName}</strong>,</p>
              <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
                Your service appointment has been <strong style="color:#22c55e;">confirmed</strong>. Please find the details below.
              </p>
            </td>
          </tr>

          <!-- Details card -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                <tr style="background:#fafafa;">
                  <td colspan="2" style="padding:12px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#999;">Booking Details</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;width:40%;border-top:1px solid #f0f0f0;">Booking Ref</td>
                  <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#ff5100;border-top:1px solid #f0f0f0;">${p.bookingRef}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Vehicle</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;font-weight:600;border-top:1px solid #f0f0f0;">${p.vehicleInfo}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Date</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">${dateStr}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Time</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">${timeStr}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Service Type</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">${serviceLabel}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;vertical-align:top;">Complaints</td>
                  <td style="padding:10px 16px;border-top:1px solid #f0f0f0;">
                    <ul style="margin:0;padding-left:16px;">${complaintRows}</ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Note -->
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0;font-size:12px;color:#999;line-height:1.6;text-align:center;">
                Please arrive 10 minutes before your scheduled time. If you need to reschedule or cancel, contact us as soon as possible.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;line-height:1.6;">
                This email was sent by ELT Group. Booking reference: ${p.bookingRef}.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendAppointmentConfirmationEmail(
  params: AppointmentConfirmationParams,
): Promise<void> {
  if (!(await isMailEnabled())) {
    console.log(
      `[Email] SMTP not configured — skipping appointment confirmation to ${params.customerEmail}`,
    );
    return;
  }
  try {
    // family: 4 forces IPv4 — Render containers don't have IPv6 outbound and
    // smtp.gmail.com resolves to v6 first by default, causing ENETUNREACH.
    const transporter = (await getMailTransport())!;
    const info = await transporter.sendMail({
      from: await resolveMailFrom(),
      attachments: logoAttachments,
      to: params.customerEmail,
      subject: `Appointment Confirmed — ${params.bookingRef} | ${params.appointmentDate} ${params.appointmentTime}`,
      html: buildAppointmentConfirmationHtml(params),
    });
    console.log(
      `[Email] Appointment confirmation sent to ${params.customerEmail}, messageId: ${info.messageId}`,
    );
  } catch (err) {
    console.error(
      `[Email] Failed to send appointment confirmation to ${params.customerEmail}:`,
      err,
    );
  }
}

// ─── Appointment Cancellation Email ───────────────────────────────────────────

interface AppointmentCancellationParams {
  customerName: string;
  customerEmail: string;
  bookingRef: string;
  vehicleInfo: string;
  appointmentDate: string;
  appointmentTime: string;
  cancellationReason: string;
}

function buildCancellationHtml(p: AppointmentCancellationParams): string {
  const dateStr = new Date(p.appointmentDate + "T00:00:00").toLocaleDateString(
    "en-GB",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );
  const [hh, mm] = p.appointmentTime.split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  const timeStr = `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Cancelled</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:32px 32px 28px;">
              <img src="cid:company-logo" alt="ELT Group" height="44" style="display:block;height:44px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Appointment Cancelled</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 16px;">
              <p style="margin:0 0 8px;font-size:15px;color:#333;">Hello <strong>${p.customerName}</strong>,</p>
              <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
                We regret to inform you that your service appointment has been <strong style="color:#dc2626;">cancelled</strong>. Details are below.
              </p>
            </td>
          </tr>

          <!-- Details card -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                <tr style="background:#fafafa;">
                  <td colspan="2" style="padding:12px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#999;">Cancelled Booking</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;width:40%;border-top:1px solid #f0f0f0;">Booking Ref</td>
                  <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#dc2626;border-top:1px solid #f0f0f0;">${p.bookingRef}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Vehicle</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;font-weight:600;border-top:1px solid #f0f0f0;">${p.vehicleInfo}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Date</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">${dateStr}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Time</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">${timeStr}</td>
                </tr>
                ${
                  p.cancellationReason
                    ? `
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;vertical-align:top;">Reason</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">${p.cancellationReason}</td>
                </tr>`
                    : ""
                }
              </table>
            </td>
          </tr>

          <!-- Note -->
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0;font-size:12px;color:#999;line-height:1.6;text-align:center;">
                To reschedule your appointment, please contact us or book a new appointment online.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;line-height:1.6;">
                This email was sent by ELT Group. Booking reference: ${p.bookingRef}.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendAppointmentCancellationEmail(
  params: AppointmentCancellationParams,
): Promise<void> {
  if (!(await isMailEnabled())) {
    console.log(
      `[Email] SMTP not configured — skipping cancellation email to ${params.customerEmail}`,
    );
    return;
  }
  try {
    // family: 4 forces IPv4 — Render containers don't have IPv6 outbound and
    // smtp.gmail.com resolves to v6 first by default, causing ENETUNREACH.
    const transporter = (await getMailTransport())!;
    const info = await transporter.sendMail({
      from: await resolveMailFrom(),
      attachments: logoAttachments,
      to: params.customerEmail,
      subject: `Appointment Cancelled — ${params.bookingRef}`,
      html: buildCancellationHtml(params),
    });
    console.log(
      `[Email] Cancellation email sent to ${params.customerEmail}, messageId: ${info.messageId}`,
    );
  } catch (err) {
    console.error(
      `[Email] Failed to send cancellation email to ${params.customerEmail}:`,
      err,
    );
  }
}

// ─── Appointment Reschedule Email ─────────────────────────────────────────────

interface AppointmentRescheduleParams {
  customerName: string;
  customerEmail: string;
  bookingRef: string;
  vehicleInfo: string;
  oldDate: string;
  oldTime: string;
  newDate: string;
  newTime: string;
  rescheduleCount: number;
  reason: string;
}

function formatDateTimeForEmail(
  dateStr: string,
  timeStr: string,
): { date: string; time: string } {
  const d = new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const [hh, mm] = timeStr.split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return { date: d, time: `${h12}:${String(mm).padStart(2, "0")} ${ampm}` };
}

function buildRescheduleHtml(p: AppointmentRescheduleParams): string {
  const old = formatDateTimeForEmail(p.oldDate, p.oldTime);
  const nw = formatDateTimeForEmail(p.newDate, p.newTime);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Rescheduled</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:32px 32px 28px;">
              <img src="cid:company-logo" alt="ELT Group" height="44" style="display:block;height:44px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Appointment Rescheduled</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 16px;">
              <p style="margin:0 0 8px;font-size:15px;color:#333;">Hello <strong>${p.customerName}</strong>,</p>
              <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
                Your service appointment has been <strong style="color:#d97706;">rescheduled</strong>. Here are the updated details.
              </p>
            </td>
          </tr>

          <!-- Details card -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                <tr style="background:#fafafa;">
                  <td colspan="2" style="padding:12px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#999;">Updated Booking</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;width:40%;border-top:1px solid #f0f0f0;">Booking Ref</td>
                  <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#d97706;border-top:1px solid #f0f0f0;">${p.bookingRef}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Vehicle</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;font-weight:600;border-top:1px solid #f0f0f0;">${p.vehicleInfo}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Previous Date</td>
                  <td style="padding:10px 16px;font-size:13px;color:#999;border-top:1px solid #f0f0f0;text-decoration:line-through;">${old.date} at ${old.time}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">New Date</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;font-weight:700;border-top:1px solid #f0f0f0;">${nw.date} at ${nw.time}</td>
                </tr>
                ${
                  p.reason
                    ? `
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;vertical-align:top;">Reason</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">${p.reason}</td>
                </tr>`
                    : ""
                }
              </table>
            </td>
          </tr>

          <!-- Note -->
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0;font-size:12px;color:#999;line-height:1.6;text-align:center;">
                This appointment has been rescheduled ${p.rescheduleCount} time(s). Please arrive 10 minutes before your new scheduled time.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;line-height:1.6;">
                This email was sent by ELT Group. Booking reference: ${p.bookingRef}.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendAppointmentRescheduleEmail(
  params: AppointmentRescheduleParams,
): Promise<void> {
  if (!(await isMailEnabled())) {
    console.log(
      `[Email] SMTP not configured — skipping reschedule email to ${params.customerEmail}`,
    );
    return;
  }
  try {
    // family: 4 forces IPv4 — Render containers don't have IPv6 outbound and
    // smtp.gmail.com resolves to v6 first by default, causing ENETUNREACH.
    const transporter = (await getMailTransport())!;
    const info = await transporter.sendMail({
      from: await resolveMailFrom(),
      attachments: logoAttachments,
      to: params.customerEmail,
      subject: `Appointment Rescheduled — ${params.bookingRef} | New: ${params.newDate} ${params.newTime}`,
      html: buildRescheduleHtml(params),
    });
    console.log(
      `[Email] Reschedule email sent to ${params.customerEmail}, messageId: ${info.messageId}`,
    );
  } catch (err) {
    console.error(
      `[Email] Failed to send reschedule email to ${params.customerEmail}:`,
      err,
    );
  }
}

// ─── Welcome Email ────────────────────────────────────────────────────────────

interface WelcomeEmailParams {
  username: string;
  email: string;
  password: string;
  roleSlug: string;
  roleName: string;
  loginUrl: string;
}

const ROLE_DESCRIPTIONS: Record<
  string,
  { title: string; description: string; duties: string[] }
> = {
  "super-admin": {
    title: "System Administrator",
    description: "You have full access to the ELT Group platform.",
    duties: [
      "Manage all users, roles, and permissions",
      "Configure system settings and service types",
      "View all reports and dashboards across the platform",
      "Oversee all workshop operations end-to-end",
    ],
  },
  "service-advisor": {
    title: "Service Advisor",
    description:
      "You are the primary point of contact between the customer and the workshop.",
    duties: [
      "Review QC inspection reports and create job cards",
      "Add service items (labour + parts) and set costs",
      "Share estimates with customers and collect approvals",
      "Track vehicle progress from inspection to billing",
    ],
  },
  "qc-inspector": {
    title: "QC Inspector",
    description:
      "You are responsible for inspecting every vehicle that enters the workshop.",
    duties: [
      "Perform exterior, interior, and brake inspections",
      "Record pass/fail results and upload photos per item",
      "Submit brake test findings and overall inspection status",
      "Flag critical issues for the service advisor",
    ],
  },
  "parts-manager": {
    title: "Parts Manager",
    description:
      "You manage parts availability and supply for all active job cards.",
    duties: [
      "Review incoming part requests from service advisors",
      "Confirm parts availability or flag unavailable items",
      "Update expected delivery times for pending parts",
      "Dispatch parts once available for approved job cards",
    ],
  },
  security: {
    title: "Security / Gate Officer",
    description: "You manage vehicle entry and exit at the workshop gate.",
    duties: [
      "Record vehicle check-ins with odometer readings",
      "Capture entry photos (front, rear, sides)",
      "Verify vehicle accessories at check-in",
      "Mark vehicles as completed and handle exit",
    ],
  },
};

function buildWelcomeHtml(p: WelcomeEmailParams): string {
  const role = ROLE_DESCRIPTIONS[p.roleSlug] ?? {
    title: p.roleName,
    description: `You have been granted access to the ELT Group platform as ${p.roleName}.`,
    duties: ["Log in to the platform to get started."],
  };

  const dutyRows = role.duties
    .map(
      (d) =>
        `<li style="margin:6px 0;font-size:13px;color:#555;line-height:1.5;">${d}</li>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ELT Group</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 32px 28px;">
              <img src="cid:company-logo" alt="ELT Group" height="44" style="display:block;height:44px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Welcome — Your Account is Ready</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 16px;">
              <p style="margin:0 0 8px;font-size:15px;color:#333;">Hello <strong>${p.username}</strong>,</p>
              <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
                Your account has been created on the <strong>ELT Group</strong> platform.
                You have been assigned the role of <strong style="color:#4f46e5;">${role.title}</strong>.
              </p>
            </td>
          </tr>

          <!-- Login credentials -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                <tr style="background:#fafafa;">
                  <td colspan="2" style="padding:12px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#999;">Your Login Credentials</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;width:35%;border-top:1px solid #f0f0f0;">Username</td>
                  <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#333;border-top:1px solid #f0f0f0;font-family:monospace;">${p.username}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Password</td>
                  <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#333;border-top:1px solid #f0f0f0;font-family:monospace;">${p.password}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Role</td>
                  <td style="padding:10px 16px;font-size:13px;color:#4f46e5;font-weight:600;border-top:1px solid #f0f0f0;">${role.title}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Role description -->
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0 0 10px;font-size:13px;color:#444;font-weight:600;">What you'll do on this platform:</p>
              <p style="margin:0 0 12px;font-size:13px;color:#666;line-height:1.6;">${role.description}</p>
              <ul style="margin:0;padding-left:18px;">${dutyRows}</ul>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px;text-align:center;">
              ${buildCtaButton(p.loginUrl, "Log In to ELT Group", "#4f46e5")}
              <p style="margin:16px 0 0;font-size:12px;color:#888;line-height:1.6;">
                Platform URL: <a href="${p.loginUrl}" style="color:#4f46e5;text-decoration:underline;word-break:break-all;">${p.loginUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Security note -->
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0;font-size:11px;color:#f59e0b;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;line-height:1.6;">
                &#9888; For security, please change your password after your first login. Keep your credentials confidential.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;line-height:1.6;">
                This email was sent by ELT Group. If you did not expect this account, please contact your administrator.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendWelcomeEmail(
  params: WelcomeEmailParams,
): Promise<void> {
  if (!(await isMailEnabled())) {
    console.log(
      `[Email] SMTP not configured — skipping welcome email to ${params.email}`,
    );
    return;
  }
  try {
    // family: 4 forces IPv4 — Render containers don't have IPv6 outbound and
    // smtp.gmail.com resolves to v6 first by default, causing ENETUNREACH.
    const transporter = (await getMailTransport())!;
    const info = await transporter.sendMail({
      from: await resolveMailFrom(),
      attachments: logoAttachments,
      to: params.email,
      subject: `Welcome to ELT Group — Your Login Details`,
      html: buildWelcomeHtml(params),
    });
    console.log(
      `[Email] Welcome email sent to ${params.email}, messageId: ${info.messageId}`,
    );
  } catch (err) {
    console.error(
      `[Email] Failed to send welcome email to ${params.email}:`,
      err,
    );
  }
}

// ─── Estimate Email ────────────────────────────────────────────────────────────

export async function sendEstimateEmail(params: EstimateEmailParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  if (!(await isMailEnabled())) {
    console.log(
      `[Email] SMTP credentials not configured. Email not sent to ${params.customerEmail}.`,
    );
    return { success: false, error: "SMTP credentials not configured" };
  }

  try {
    // Port 465 = TLS-from-start (secure: true). Anything else (587, 25) = STARTTLS upgrade.
    // family: 4 forces IPv4 — Render containers don't have IPv6 outbound.
    // Timeouts cap a hung SMTP connection so the share-estimate API doesn't
    // block for 2+ minutes when the SMTP host is unreachable on prod.
    const transporter = (await getMailTransport())!;

    const fromAddress = await resolveMailAddress();
    const info = await transporter.sendMail({
      from: await resolveMailFrom(),
      attachments: logoAttachments,
      to: params.customerEmail,
      // Neutral subject — "Action Required" / urgency phrasing is a common
      // spam-filter trigger.
      subject: `Your service estimate for ${params.vehicleInfo}`,
      // Reply-To + List-Unsubscribe improve deliverability and reduce the
      // chance of being filtered to spam. Use the bare address (no display
      // name) so the mailto: URI stays valid.
      replyTo: fromAddress,
      headers: {
        'List-Unsubscribe': `<mailto:${fromAddress}?subject=unsubscribe>`,
      },
      text: buildPlainText(params),
      html: buildEmailHtml(params),
    });

    console.log(
      `[Email] Sent to ${params.customerEmail}, messageId: ${info.messageId}`,
    );
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Email] Failed to send to ${params.customerEmail}:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─── Status Update Emails (Entry / QC Start / QC Done) ────────────────────────
//
// Lightweight transactional notifications sent at workshop milestones to keep
// the customer informed in near-real-time. They share one HTML shell, just
// with different headers, body copy, and accent colours.

interface StatusEmailParams {
  customerName: string;
  customerEmail: string;
  vehicleInfo: string;
  bookingRef?: string | null;
}

function buildStatusEmailHtml(opts: {
  title: string;
  subtitle: string;
  accent: string;
  customerName: string;
  vehicleInfo: string;
  bookingRef?: string | null;
  message: string;
}): string {
  const { title, subtitle, accent, customerName, vehicleInfo, bookingRef, message } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:${accent};padding:32px 32px 28px;">
              <img src="cid:company-logo" alt="ELT Group" height="44" style="display:block;height:44px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">${subtitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 16px;">
              <p style="margin:0 0 8px;font-size:15px;color:#333;">Hello <strong>${customerName}</strong>,</p>
              <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">${message}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;width:40%;">Vehicle</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;font-weight:600;">${vehicleInfo}</td>
                </tr>
                ${bookingRef ? `
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Booking Ref</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;font-weight:700;border-top:1px solid #f0f0f0;">${bookingRef}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding:10px 16px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;">Time</td>
                  <td style="padding:10px 16px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">${new Date().toLocaleString('en-GB')}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;line-height:1.6;">This email was sent by ELT Group to keep you informed on your service progress.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendStatusEmail(
  params: StatusEmailParams,
  opts: { subject: string; title: string; subtitle: string; accent: string; message: string; logTag: string },
): Promise<void> {
  if (!(await isMailEnabled())) {
    console.log(`[Email] SMTP not configured — skipping ${opts.logTag} to ${params.customerEmail}`);
    return;
  }
  if (!params.customerEmail) {
    console.log(`[Email] No customer email — skipping ${opts.logTag}`);
    return;
  }
  try {
    const transporter = (await getMailTransport())!;
    const info = await transporter.sendMail({
      from: await resolveMailFrom(),
      attachments: logoAttachments,
      to: params.customerEmail,
      subject: opts.subject,
      html: buildStatusEmailHtml({
        title: opts.title,
        subtitle: opts.subtitle,
        accent: opts.accent,
        customerName: params.customerName,
        vehicleInfo: params.vehicleInfo,
        bookingRef: params.bookingRef,
        message: opts.message,
      }),
    });
    console.log(`[Email] ${opts.logTag} sent to ${params.customerEmail}, messageId: ${info.messageId}`);
  } catch (err) {
    console.error(`[Email] Failed to send ${opts.logTag} to ${params.customerEmail}:`, err);
  }
}

export async function sendVehicleEntryEmail(params: StatusEmailParams): Promise<void> {
  return sendStatusEmail(params, {
    subject: `Vehicle Checked In — ${params.vehicleInfo}`,
    title: 'Vehicle Checked In',
    subtitle: 'Your vehicle has arrived at the workshop',
    accent: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
    message:
      'Your vehicle has been successfully checked in at our workshop gate. It will now be queued for quality inspection. We will notify you again when the inspection begins.',
    logTag: 'Vehicle entry',
  });
}

export async function sendQcStartedEmail(params: StatusEmailParams): Promise<void> {
  return sendStatusEmail(params, {
    subject: `QC Inspection Started — ${params.vehicleInfo}`,
    title: 'Inspection Started',
    subtitle: 'Quality inspection is now in progress',
    accent: 'linear-gradient(135deg,#f59e0b,#d97706)',
    message:
      'Our quality inspector has started the inspection of your vehicle. We will share the inspection results with you as soon as it is completed.',
    logTag: 'QC started',
  });
}

export async function sendQcCompletedEmail(params: StatusEmailParams): Promise<void> {
  return sendStatusEmail(params, {
    subject: `QC Inspection Completed — ${params.vehicleInfo}`,
    title: 'Inspection Completed',
    subtitle: 'Your QC inspection is finished',
    accent: 'linear-gradient(135deg,#10b981,#047857)',
    message:
      'The quality inspection of your vehicle has been completed. Our service advisor will review the findings and share an estimate with you shortly.',
    logTag: 'QC completed',
  });
}
