import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';

function getAnthropicClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Set it in your .env file to use OCR features.');
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export interface OcrResult {
  vin: string | null;
  odometerReading: number | null;
  confidence: {
    vin: 'high' | 'medium' | 'low' | 'not_found';
    odometer: 'high' | 'medium' | 'low' | 'not_found';
  };
  rawText: string;
}

const SUPPORTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/**
 * Extract VIN and Odometer reading from a vehicle image using Claude Vision.
 */
export async function extractVinAndOdometer(
  filePath: string,
  mimeType: string,
): Promise<OcrResult> {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error('Image file not found');
  }

  if (!SUPPORTED_MEDIA_TYPES.has(mimeType)) {
    throw new Error(
      `Unsupported image type: ${mimeType}. Supported: jpeg, png, webp, gif`,
    );
  }

  const imageBuffer = fs.readFileSync(absolutePath);
  const base64Image = imageBuffer.toString('base64');

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as MediaType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `Analyze this vehicle image and extract the following information:

1. **VIN (Vehicle Identification Number)**: A 17-character alphanumeric code. Look for it on dashboards, door jambs, stickers, or any visible label.
2. **Odometer Reading**: The numeric mileage/kilometer reading shown on the instrument cluster or digital display.

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "vin": "THE_VIN_HERE_OR_NULL",
  "odometerReading": NUMBER_OR_NULL,
  "vinConfidence": "high|medium|low|not_found",
  "odometerConfidence": "high|medium|low|not_found",
  "rawText": "any other relevant text visible in the image"
}

Rules:
- If you cannot find a VIN, set "vin" to null and "vinConfidence" to "not_found"
- If you cannot find an odometer reading, set "odometerReading" to null and "odometerConfidence" to "not_found"
- VIN must be exactly 17 characters if found (letters and digits only, no I, O, Q)
- Odometer must be a positive integer
- "high" = clearly readable, "medium" = partially readable/guessed, "low" = very uncertain`,
          },
        ],
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  const rawResponse = textContent?.text || '';

  try {
    const parsed = JSON.parse(rawResponse);

    return {
      vin: parsed.vin || null,
      odometerReading:
        parsed.odometerReading != null
          ? Math.round(Number(parsed.odometerReading))
          : null,
      confidence: {
        vin: parsed.vinConfidence || 'not_found',
        odometer: parsed.odometerConfidence || 'not_found',
      },
      rawText: parsed.rawText || '',
    };
  } catch {
    return {
      vin: null,
      odometerReading: null,
      confidence: { vin: 'not_found', odometer: 'not_found' },
      rawText: rawResponse,
    };
  }
}
