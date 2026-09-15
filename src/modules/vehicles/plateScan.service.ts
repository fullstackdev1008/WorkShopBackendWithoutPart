// ─── Number-Plate Scan Service ─────────────────────────────────────────────────
//
// Receives a single multipart image, processes it transiently IN MEMORY, asks
// the vision detector whether it is a readable vehicle number plate, and runs
// the result through the deterministic gates in `plateScan.dto`. The image is
// NEVER written to DB, S3, or local disk — the buffer goes out of scope when the
// request finishes.
//
// Every outcome (accept or reject) is returned as a normal 200 response whose
// `data` is a PlateScanResult, so the frontend reads `data.reason === null` to
// decide whether to search. No new vehicle-search API is involved.

import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { success } from '../../shared/http/response';
import { detectPlate } from '../../services/plateVision.service';
import { decidePlateResult, rejected } from './plateScan.dto';

// jpeg / png / webp only (Anthropic-supported + our compression target).
const SUPPORTED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

// Preprocessing target — downscale keeps the vision payload small/fast without
// hurting plate legibility.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 85;

// Server-side brightness backstop for the client's IMAGE_TOO_DARK check. Kept
// deliberately low (near-black frames only) so legitimate low-light plates are
// not falsely rejected here — the model + confidence gate handle the rest.
const DARK_MEAN_LUMA = 20;

export async function scanPlate(request: FastifyRequest) {
  try {
    // ── Read the uploaded file (multipart) ──────────────────────────────────
    const upload = await request.file().catch(() => null);
    if (!upload) {
      return success('Plate scan processed', rejected('PROCESSING_ERROR'));
    }

    if (!SUPPORTED_MIME.has(upload.mimetype)) {
      // Drain the stream so the connection isn't left hanging.
      upload.file.resume();
      return success('Plate scan processed', rejected('UNSUPPORTED_FORMAT'));
    }

    // toBuffer() honours the global multipart fileSize limit (10 MB). On
    // overflow the stream is truncated — surface that as IMAGE_TOO_LARGE.
    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return success('Plate scan processed', rejected('IMAGE_TOO_LARGE'));
    }
    if (upload.file.truncated) {
      return success('Plate scan processed', rejected('IMAGE_TOO_LARGE'));
    }

    // ── Preprocess in memory (never persisted) ──────────────────────────────
    let processed: Buffer;
    try {
      const image = sharp(buffer).rotate(); // auto-correct EXIF orientation

      // Brightness backstop.
      const stats = await sharp(buffer).stats();
      const rgb = stats.channels.slice(0, 3);
      const meanLuma = rgb.length > 0 ? rgb.reduce((sum, c) => sum + c.mean, 0) / rgb.length : 255;
      if (meanLuma < DARK_MEAN_LUMA) {
        return success('Plate scan processed', rejected('IMAGE_TOO_DARK'));
      }

      processed = await image
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    } catch {
      // If sharp can't decode it, treat the bytes as an unsupported/corrupt image.
      return success('Plate scan processed', rejected('UNSUPPORTED_FORMAT'));
    }

    // ── Vision detection (server-side; key never leaves the backend) ─────────
    let vision;
    try {
      vision = await detectPlate(processed.toString('base64'), 'image/jpeg');
    } catch (err) {
      console.log('[plateScan] vision error :- ', err);
      return success('Plate scan processed', rejected('PROCESSING_ERROR'));
    }

    // ── Deterministic gates decide the final result ─────────────────────────
    const result = decidePlateResult(vision);
    // buffers (`buffer`, `processed`) and base64 now go out of scope → discarded.
    return success('Plate scan processed', result);
  } catch (err) {
    console.log('error :- ', err);
    return success('Plate scan processed', rejected('PROCESSING_ERROR'));
  }
}
