// ─── Number-Plate Vision Detector (OpenAI, server-side) ────────────────────────
//
// Sends a single image to an OpenAI vision model and asks it to decide —
// strictly — whether the image contains exactly ONE clearly readable vehicle
// number plate, and if so, the characters on it. This is NOT generic OCR: the
// prompt refuses people, buildings, roads, objects, documents, screenshots and
// unreadable plates, and the caller re-validates everything the model returns.
//
// The call is made with the native `fetch` (no SDK dependency) using
// OPENAI_API_KEY. The key lives only on the server and is never returned to the
// client. The image is held in memory for the request and never persisted.
//
// Provider is isolated to this file: `detectPlate` keeps the same signature and
// `PlateVisionOutput` contract, so swapping models/providers needs no change
// anywhere else in the feature.

import { env } from '../config/env';
import type { PlateVisionOutput } from '../modules/vehicles/plateScan.dto';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Single point of change to swap the vision model later. gpt-4o-mini is cheap +
// fast and vision-capable; use 'gpt-4o' for higher accuracy if needed.
export const PLATE_VISION_MODEL = 'gpt-4o-mini';

export type PlateMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

const DETECTION_PROMPT = `You are a strict vehicle number-plate detector for a gate-entry system. Examine the image and decide whether it contains EXACTLY ONE clearly readable vehicle registration number plate (the printed/embossed plate mounted on a car, motorcycle, truck, etc.).

Set "isPlate" to false for ANY of the following:
- a person, selfie, or face
- a building or interior
- a road or street scene with no readable plate
- a random object
- a document, paper, or form
- a screenshot
- generic text that is not a vehicle number plate
- a vehicle whose plate is missing, too far away, blurred, dirty, or obscured so the characters cannot be read with confidence

Only set "isPlate" to true when you can actually read the plate characters AND you are confident they belong to a real vehicle number plate.

Respond with ONLY a JSON object — no markdown, no code fences, no commentary — in exactly this shape:
{"isPlate": boolean, "readable": boolean, "registration": string or null, "confidence": number}

Field rules:
- "registration": the exact characters visible on the plate (letters and digits only). Do NOT invent, auto-complete, or guess characters you cannot clearly see. Use null when there is no readable plate.
- "readable": true only when the plate characters are clearly legible.
- "confidence": a number from 0 to 1 — your confidence that this is a real, correctly-read vehicle number plate.

Do NOT perform generic OCR on arbitrary text. If it is not a vehicle number plate, return {"isPlate": false, "readable": false, "registration": null, "confidence": 0}.`;

// Parse the model's text into the structured shape, coercing defensively. A
// parse failure is a genuine processing error and is thrown to the caller.
function parseVisionJson(text: string): PlateVisionOutput {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  // Grab the first {...} block in case the model added stray prose.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;

  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  return {
    isPlate: parsed.isPlate === true,
    readable: parsed.readable === true,
    registration: typeof parsed.registration === 'string' ? parsed.registration : null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence) || 0,
  };
}

/**
 * Ask an OpenAI vision model whether the image is a readable vehicle number plate.
 * @throws when the API key is missing, the request fails, or the reply cannot be parsed.
 */
export async function detectPlate(
  base64Image: string,
  mediaType: PlateMediaType,
): Promise<PlateVisionOutput> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Set it in your .env to use plate detection.');
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PLATE_VISION_MODEL,
      max_tokens: 300,
      // Force a JSON object back (the prompt already asks for JSON).
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: DETECTION_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image and return the JSON described above.' },
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
