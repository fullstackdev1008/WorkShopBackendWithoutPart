// ─── Driver-Licence Scan Service ───────────────────────────────────────────────
//
// Receives a single multipart image, processes it transiently IN MEMORY, asks
// the vision reader to extract the driving-licence fields (any country), and
// runs the result through the deterministic gates in `licenceScan.dto`. The image is
// NEVER written to DB, S3, or local disk here — the buffer goes out of scope
// when the request finishes. (The separate Driver Licence Photo upload in the
// Gate Entry form still persists to S3 as before — that flow is untouched.)
//
// Privacy: no PII (name / licence number / ID number / raw OCR text) is logged —
// only safe technical breadcrumbs (completed / failed).

import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { success } from '../../shared/http/response';
import { detectLicence } from '../../services/licenceVision.service';
import { decideLicenceResult, rejected } from './licenceScan.dto';

const SUPPORTED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 85;

export async function scanLicence(request: FastifyRequest) {
  try {
    const upload = await request.file().catch(() => null);
    if (!upload) {
      return success('Licence scan processed', rejected('PROCESSING_ERROR'));
    }

    if (!SUPPORTED_MIME.has(upload.mimetype)) {
      upload.file.resume();
      return success('Licence scan processed', rejected('UNSUPPORTED_FORMAT'));
    }

    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return success('Licence scan processed', rejected('IMAGE_TOO_LARGE'));
    }
    if (upload.file.truncated) {
      return success('Licence scan processed', rejected('IMAGE_TOO_LARGE'));
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
      return success('Licence scan processed', rejected('UNSUPPORTED_FORMAT'));
    }

    let vision;
    try {
      vision = await detectLicence(processed.toString('base64'), 'image/jpeg');
    } catch (err) {
      // Log only that it failed + name — never PII / OCR text.
      console.log('[licenceScan] vision error');
      if (err instanceof Error) console.log('[licenceScan] error name:', err.name);
      return success('Licence scan processed', rejected('PROCESSING_ERROR'));
    }

    const result = decideLicenceResult(vision);
    // Safe technical breadcrumb only — no PII.
    console.log(
      `[licenceScan] completed isLicence=${result.isLicence} confidence=${result.confidence} reason=${result.reason ?? 'null'}`,
    );
    // buffers + base64 now go out of scope → discarded.
    return success('Licence scan processed', result);
  } catch (err) {
    console.log('[licenceScan] unexpected error');
    if (err instanceof Error) console.log('[licenceScan] error name:', err.name);
    return success('Licence scan processed', rejected('PROCESSING_ERROR'));
  }
}
