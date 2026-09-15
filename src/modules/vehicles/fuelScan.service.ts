// ─── Fuel-Gauge Scan Service ───────────────────────────────────────────────────
//
// Receives a single multipart image, processes it transiently IN MEMORY, asks
// the vision classifier for the fuel level, and runs the result through the
// deterministic gate in `fuelScan.dto`. The image is NEVER written to DB, S3, or
// local disk here — the buffer goes out of scope when the request finishes. (The
// separate Fuel Indicator photo upload in the Gate Entry form still persists to
// S3 as before — that flow is untouched.)
//
// No image / base64 / prompt / raw-response logging — only a safe technical
// breadcrumb (fuelLevel / confidence / reason).

import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { success } from '../../shared/http/response';
import { detectFuelLevel } from '../../services/fuelVision.service';
import { decideFuelResult, rejected } from './fuelScan.dto';

const SUPPORTED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 85;

export async function scanFuel(request: FastifyRequest) {
  try {
    const upload = await request.file().catch(() => null);
    if (!upload) {
      return success('Fuel scan processed', rejected('PROCESSING_ERROR'));
    }

    if (!SUPPORTED_MIME.has(upload.mimetype)) {
      upload.file.resume();
      return success('Fuel scan processed', rejected('UNSUPPORTED_FORMAT'));
    }

    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return success('Fuel scan processed', rejected('IMAGE_TOO_LARGE'));
    }
    if (upload.file.truncated) {
      return success('Fuel scan processed', rejected('IMAGE_TOO_LARGE'));
    }

    // Preprocess in memory (EXIF-rotate + downscale + JPEG). Never persisted.
    let processed: Buffer;
    try {
      processed = await sharp(buffer)
        .rotate()
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    } catch {
      return success('Fuel scan processed', rejected('UNSUPPORTED_FORMAT'));
    }

    let vision;
    try {
      vision = await detectFuelLevel(processed.toString('base64'), 'image/jpeg');
    } catch (err) {
      console.log('[fuelScan] vision error');
      if (err instanceof Error) console.log('[fuelScan] error name:', err.name);
      return success('Fuel scan processed', rejected('PROCESSING_ERROR'));
    }

    const result = decideFuelResult(vision);
    console.log(
      `[fuelScan] completed fuelLevel=${result.fuelLevel ?? 'null'} confidence=${result.confidence} reason=${result.reason ?? 'null'}`,
    );
    // buffers + base64 now go out of scope → discarded.
    return success('Fuel scan processed', result);
  } catch (err) {
    console.log('[fuelScan] unexpected error');
    if (err instanceof Error) console.log('[fuelScan] error name:', err.name);
    return success('Fuel scan processed', rejected('PROCESSING_ERROR'));
  }
}
