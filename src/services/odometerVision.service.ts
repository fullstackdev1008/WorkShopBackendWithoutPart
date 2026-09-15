// ─── Odometer Vision Reader (OpenAI, server-side) ──────────────────────────────
//
// Sends a single image to an OpenAI vision model and asks it to read the vehicle
// TOTAL ODOMETER reading, distinguishing it from the trip meter, speedometer,
// tachometer, fuel/temperature gauges and other cluster numbers. Returns a
// structured JSON value; the caller re-validates everything.
//
// Mirrors plateVision/licenceVision/fuelVision: native `fetch` (no SDK),
// OPENAI_API_KEY, Chat Completions, base64 data URL, response_format json_object.
// The key lives only on the server; the image is held in memory for the request
// and never persisted. No image / base64 / prompt / raw-response logging.

import { env } from '../config/env';
import type { OdometerVisionOutput } from '../modules/vehicles/odometerScan.dto';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Single point of change to swap the vision model later (matches plate/licence/fuel).
export const ODOMETER_VISION_MODEL = 'gpt-4o-mini';

export type OdometerMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

const READ_PROMPT = `You are a strict instrument-cluster reader for a vehicle gate-entry system. Find the vehicle's TOTAL ODOMETER reading — the cumulative distance the vehicle has travelled — and return it as a whole number.

The odometer is usually a 5–7 digit whole number on the instrument cluster. Do NOT confuse it with any of these:
- the TRIP meter (labelled TRIP, TRIP A, TRIP B; usually a smaller number, often with a decimal like 123.4)
- the current SPEED / speedometer (km/h or mph)
- the TACHOMETER / RPM
- the FUEL gauge or TEMPERATURE gauge
- the clock/time, outside temperature, or any warning indicator
If both a trip meter and an odometer are visible, return the TOTAL odometer, not the trip value.

Read the digits exactly as shown. Do NOT convert units. Do NOT invent or guess digits you cannot clearly see.

Set "odometer" to null (do NOT guess) and give a "reason" when:
- no odometer reading is visible → "NO_ODOMETER"
- the odometer is present but blurry, dark, cropped, glare-obstructed, or otherwise not reliably readable → "NOT_READABLE"

Respond with ONLY a JSON object — no markdown, no code fences, no commentary — in exactly this shape:
{"odometer": number | null, "confidence": number, "reason": string or null}

- "odometer": the total odometer value as an integer (no commas, no units), or null.
- "confidence": a number from 0 to 1 for how sure you are of the reading.
- "reason": null when a value is returned; otherwise "NO_ODOMETER" or "NOT_READABLE".
Never intentionally guess when the odometer cannot be reliably read.`;

function parseVisionJson(text: string): OdometerVisionOutput {
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
    odometer:
      typeof parsed.odometer === 'number' || typeof parsed.odometer === 'string' ? parsed.odometer : null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence) || 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
  };
}

/**
 * Ask an OpenAI vision model to read the vehicle total odometer value.
 * @throws when the API key is missing, the request fails, or the reply cannot be parsed.
 */
export async function detectOdometer(
  base64Image: string,
  mediaType: OdometerMediaType,
): Promise<OdometerVisionOutput> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Set it in your .env to use odometer scanning.');
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ODOMETER_VISION_MODEL,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: READ_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read the total odometer value in this image and return the JSON described above.' },
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
