// ─── Driver-Licence Vision OCR (OpenAI, server-side) ───────────────────────────
//
// Sends a single image to an OpenAI vision model and asks it to read a driving
// licence card from ANY country, returning its fields as structured JSON. The
// key design choice: the model returns name / licenceNumber / idNumber / dates
// as SEPARATE fields so the caller can pick the licence number and explicitly
// exclude the national ID / personal number and any dates.
//
// Mirrors plateVision.service.ts: native `fetch` (no SDK), OPENAI_API_KEY,
// Chat Completions, base64 data URL, response_format json_object. The key lives
// only on the server; the image is held in memory for the request and never
// persisted.

import { env } from '../config/env';
import type { LicenceVisionOutput } from '../modules/vehicles/licenceScan.dto';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Single point of change to swap the vision model later (matches the plate flow).
export const LICENCE_VISION_MODEL = 'gpt-4o-mini';

export type LicenceMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

const DETECTION_PROMPT = `You are a strict document reader for a vehicle gate-entry system. Decide whether the image is a DRIVING LICENCE card (from ANY country) and, if so, read its fields.

Set "isLicence" to false for anything that is NOT a driving licence card — a person/selfie, a vehicle, a number plate, a standalone national ID card/book, a passport, a random document, a screenshot, or an unreadable/blurred card.

A driving licence usually contains SEVERAL numbers. Read them into DISTINCT fields — do NOT merge them and do NOT return the first number you see:
- "name": the licence holder's name exactly as printed (surname plus first names / initials).
- "licenceNumber": the DRIVING LICENCE / card number printed on the licence. This is the licence's own number, NOT a national identity number.
- "idNumber": any national identity / personal / social number printed on the card (for example the South African 13-digit ID number, or an equivalent in other countries). Return it here so it is kept separate. NEVER put a national identity number in "licenceNumber".
- "dates": every date visible (date of birth, issue date, valid-from, valid-to, expiry) as an array of strings exactly as printed. Dates must NOT appear in "licenceNumber".

Rules:
- If you cannot clearly read a field, return null for it (or [] for dates). Do NOT invent, auto-complete, or guess characters.
- Do NOT perform generic OCR of unrelated text.

Respond with ONLY a JSON object — no markdown, no code fences, no commentary — in exactly this shape:
{"isLicence": boolean, "readable": boolean, "name": string or null, "licenceNumber": string or null, "idNumber": string or null, "dates": string[], "confidence": number}

- "readable": true only when the card's fields are clearly legible.
- "confidence": a number from 0 to 1 — your confidence that this is a driving licence read correctly.
If it is not a driving licence, return {"isLicence": false, "readable": false, "name": null, "licenceNumber": null, "idNumber": null, "dates": [], "confidence": 0}.`;

// Parse the model's text into the structured shape, coercing defensively. A
// parse failure is a genuine processing error and is thrown to the caller.
function parseVisionJson(text: string): LicenceVisionOutput {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;

  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  return {
    isLicence: parsed.isLicence === true,
    readable: parsed.readable === true,
    name: typeof parsed.name === 'string' ? parsed.name : null,
    licenceNumber: typeof parsed.licenceNumber === 'string' ? parsed.licenceNumber : null,
    idNumber: typeof parsed.idNumber === 'string' ? parsed.idNumber : null,
    dates: Array.isArray(parsed.dates) ? parsed.dates.filter((d): d is string => typeof d === 'string') : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence) || 0,
  };
}

/**
 * Ask an OpenAI vision model to read a driving licence (any country).
 * @throws when the API key is missing, the request fails, or the reply cannot be parsed.
 */
export async function detectLicence(
  base64Image: string,
  mediaType: LicenceMediaType,
): Promise<LicenceVisionOutput> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Set it in your .env to use licence scanning.');
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LICENCE_VISION_MODEL,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: DETECTION_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this driving licence and return the JSON described above.' },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Image}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json?.choices?.[0]?.message?.content ?? '';

  return parseVisionJson(text);
}
