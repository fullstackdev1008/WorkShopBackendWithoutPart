// ─── Fuel-Gauge Vision Classifier (OpenAI, server-side) ────────────────────────
//
// Sends a single image to an OpenAI vision model and asks it to CLASSIFY the
// vehicle fuel gauge into one of five levels (this is visual classification, not
// OCR). The model must identify the fuel gauge specifically and reject other
// dashboard instruments (speedometer, RPM, temperature, battery, oil).
//
// Mirrors plateVision/licenceVision: native `fetch` (no SDK), OPENAI_API_KEY,
// Chat Completions, base64 data URL, response_format json_object. The key lives
// only on the server; the image is held in memory for the request and never
// persisted. No image/base64/prompt/raw-response logging.

import { env } from '../config/env';
import type { FuelVisionOutput } from '../modules/vehicles/fuelScan.dto';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Single point of change to swap the vision model later (matches plate/licence).
export const FUEL_VISION_MODEL = 'gpt-4o-mini';

export type FuelMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

const CLASSIFY_PROMPT = `You are a strict dashboard-instrument classifier for a vehicle gate-entry system. Look at the image and find the vehicle's FUEL GAUGE — the dial marked E (empty) to F (full), or one showing a fuel-pump icon. Determine how full the tank is from the needle or bar position.

This is visual classification, NOT text OCR. Judge the needle/bar position relative to E → F and snap to the NEAREST of these five levels:
- "EMPTY"        (at or just above E)
- "QUARTER"      (about 1/4)
- "HALF"         (about 1/2)
- "THREE_QUARTER" (about 3/4)
- "FULL"         (at or just below F)

If the needle sits between two marked levels, choose the nearest level but LOWER your confidence.

Set "fuelLevel" to null (do NOT guess) and give a "reason" when:
- there is no gauge visible → "NO_FUEL_GAUGE"
- the gauge shown is NOT the fuel gauge (speedometer/km-h/mph, tachometer/RPM, temperature C–H, battery/volt, oil, or any other instrument) → "NOT_A_FUEL_GAUGE"
- the fuel gauge is present but blurry, dark, cropped, glare-obstructed, or otherwise not reliably readable → "NOT_READABLE"

Support analog needle gauges, different dashboard designs, and digital fuel bar gauges.

Respond with ONLY a JSON object — no markdown, no code fences, no commentary — in exactly this shape:
{"fuelLevel": "EMPTY" | "QUARTER" | "HALF" | "THREE_QUARTER" | "FULL" | null, "confidence": number, "reason": string or null}

- "confidence": a number from 0 to 1 for how sure you are of the fuel level.
- "reason": null when a level is returned; otherwise one of "NO_FUEL_GAUGE", "NOT_A_FUEL_GAUGE", "NOT_READABLE".
Never intentionally guess when the fuel gauge cannot be reliably identified.`;

// Parse the model's text into the structured shape, coercing defensively. A
// parse failure is a genuine processing error and is thrown to the caller.
function parseVisionJson(text: string): FuelVisionOutput {
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
    fuelLevel: typeof parsed.fuelLevel === 'string' ? parsed.fuelLevel : null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence) || 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
  };
}

/**
 * Ask an OpenAI vision model to classify the vehicle fuel gauge level.
 * @throws when the API key is missing, the request fails, or the reply cannot be parsed.
 */
export async function detectFuelLevel(
  base64Image: string,
  mediaType: FuelMediaType,
): Promise<FuelVisionOutput> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Set it in your .env to use fuel-gauge scanning.');
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: FUEL_VISION_MODEL,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Classify the fuel gauge in this image and return the JSON described above.' },
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
