import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * Generates a cryptographically secure approval token.
 */
export function generateApprovalToken(): string {
  return crypto.randomBytes(32).toString('hex'); // 64 chars
}

/**
 * Builds the customer-facing approval URL.
 * Uses the request origin if provided, otherwise falls back to FRONTEND_URL env.
 */
export function buildApprovalUrl(token: string, requestOrigin?: string): string {
  const baseUrl = requestOrigin || env.FRONTEND_URL;
  return `${baseUrl}/customer-approval/${token}`;
}

interface WhatsAppEstimateParams {
  customerName: string;
  customerPhone: string;
  countryCode: string;
  vehicleInfo: string;
  totalEstimate: string;
  approvalUrl: string;
}

/**
 * Sends a WhatsApp message with the estimate approval link
 * using the Meta WhatsApp Cloud API.
 */
export async function sendWhatsAppEstimate(params: WhatsAppEstimateParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  const { customerName, customerPhone, countryCode, vehicleInfo, totalEstimate, approvalUrl } = params;

  // Build the full phone number (strip leading zeros, remove non-digits, prepend country code)
  const cleanPhone = customerPhone.replace(/^0+/, '').replace(/\D/g, '');
  const fullPhone = `${countryCode.replace('+', '')}${cleanPhone}`;

  // Compose the message text
  const message = [
    `Hello ${customerName},`,
    ``,
    `Your vehicle service estimate for *${vehicleInfo}* is ready.`,
    ``,
    `*Estimated Total:* ${totalEstimate}`,
    ``,
    `Please review and approve the estimate using the link below:`,
    `${approvalUrl}`,
    ``,
    `Thank you for choosing ELT Group!`,
  ].join('\n');

  // Check if WhatsApp credentials are configured
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
    console.log(`[WhatsApp] Credentials not configured. Message not sent.`);
    console.log(`[WhatsApp] To: ${fullPhone}`);
    console.log(`[WhatsApp] Message:\n${message}`);
    return { success: false, error: 'WhatsApp credentials not configured' };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: fullPhone,
        type: 'text',
        text: { body: message },
      }),
    });

    const data = await response.json() as any;

    if (!response.ok) {
      console.error(`[WhatsApp] API error:`, data);
      return {
        success: false,
        error: data.error?.message || `API returned ${response.status}`,
      };
    }

    const messageId = data.messages?.[0]?.id;
    console.log(`[WhatsApp] Message sent to ${fullPhone}, messageId: ${messageId}`);

    return { success: true, messageId };
  } catch (err) {
    console.error(`[WhatsApp] Failed to send message:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
