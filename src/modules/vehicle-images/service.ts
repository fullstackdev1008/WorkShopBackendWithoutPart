import { FastifyRequest } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../../db';
import { vehicleImages, vehicles } from '../../db/models';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { vehicleImageParamSchema, vehicleImageIdParamSchema } from './dto';
import {
  deleteFile,
  handleFileUploads,
  handleSingleFileUpload,
  MAX_IMAGES_PER_VEHICLE,
} from '../../shared/upload/upload';
import { signUrl } from '../../middleware/s3';

// ─── List Images ─────────────────────────────────────────────────────────────
export async function listImages(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    const images = await db
      .select()
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, vehicleId));

    const signedImages = await Promise.all(
      images.map(async (img: any) => ({ ...img, imagePath: await signUrl(img.imagePath) })),
    );

    return success('Images fetched successfully', { data: signedImages, total: signedImages.length });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Upload Images ────────────────────────────────────────────────────────────
export async function uploadImages(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    const [{ total: currentCount }] = await db
      .select({ total: count() })
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, vehicleId));

    if (currentCount >= MAX_IMAGES_PER_VEHICLE) {
      return error(HttpStatus.BAD_REQUEST, `Maximum ${MAX_IMAGES_PER_VEHICLE} images allowed per vehicle`);
    }

    let uploadedFiles;
    let fields: Record<string, string> = {};
    try {
      const result = await handleFileUploads(request);
      uploadedFiles = result.files;
      fields = result.fields;
    } catch (err: any) {
      return error(HttpStatus.BAD_REQUEST, err.message);
    }

    if (uploadedFiles.length === 0) {
      return error(HttpStatus.BAD_REQUEST, 'No valid image files provided');
    }

    const remainingSlots = MAX_IMAGES_PER_VEHICLE - currentCount;
    if (uploadedFiles.length > remainingSlots) {
      await Promise.all(uploadedFiles.map((f) => deleteFile(f.path)));
      return error(
        HttpStatus.BAD_REQUEST,
        `Cannot upload ${uploadedFiles.length} image(s). Only ${remainingSlots} slot(s) remaining (max ${MAX_IMAGES_PER_VEHICLE})`,
      );
    }

    const category = fields.category || null;

    // Phase 8 — compliance metadata (3.3). Extract from multipart fields.
    // capturedAt freshness check rejects uploads more than 5 minutes old —
    // strong signal that the photo came from the gallery, not a live capture.
    const lat = fields.gpsLat ? Number(fields.gpsLat) : null;
    const lng = fields.gpsLng ? Number(fields.gpsLng) : null;
    const accuracy = fields.gpsAccuracyM ? Math.round(Number(fields.gpsAccuracyM)) : null;
    const capturedAtRaw = fields.capturedAt || null;
    const deviceUserAgent = fields.deviceUserAgent
      ? String(fields.deviceUserAgent).slice(0, 255)
      : (request.headers['user-agent'] ?? null);
    const addressText = fields.addressText ? String(fields.addressText).slice(0, 500) : null;
    const skipFreshness = String(fields.skipFreshness ?? '').toLowerCase() === 'true';

    let capturedAt: Date | null = null;
    if (capturedAtRaw) {
      const parsed = new Date(capturedAtRaw);
      if (!isNaN(parsed.getTime())) {
        capturedAt = parsed;
        if (!skipFreshness) {
          const ageMs = Date.now() - parsed.getTime();
          if (ageMs > 5 * 60 * 1000) {
            // Roll back the uploaded blobs before returning the error.
            await Promise.all(uploadedFiles.map((f) => deleteFile(f.path)));
            return error(
              HttpStatus.BAD_REQUEST,
              'Photo capture is older than 5 minutes — please take a live photo.',
            );
          }
        }
      }
    }

    const insertedImages = await db
      .insert(vehicleImages)
      .values(
        uploadedFiles.map((f) => ({
          vehicleId,
          imagePath: f.path,
          imageCategory: category,
          gpsLat: lat != null && !isNaN(lat) ? String(lat) : null,
          gpsLng: lng != null && !isNaN(lng) ? String(lng) : null,
          gpsAccuracyM: accuracy != null && !isNaN(accuracy) ? accuracy : null,
          capturedAt,
          deviceUserAgent,
          addressText,
        })),
      )
      .returning();

    const [{ total: newCount }] = await db
      .select({ total: count() })
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, vehicleId));

    const signedImages = await Promise.all(
      insertedImages.map(async (img: any) => ({ ...img, imagePath: await signUrl(img.imagePath) })),
    );

    return created(`${uploadedFiles.length} image(s) uploaded successfully`, {
      uploaded: signedImages,
      photosCaptured: `${newCount}/${MAX_IMAGES_PER_VEHICLE}`,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Replace Image ────────────────────────────────────────────────────────────
export async function replaceImage(request: FastifyRequest) {
  try {
    const { vehicleId, imageId } = request.params as any;

    const [existingImage] = await db
      .select()
      .from(vehicleImages)
      .where(
        and(
          eq(vehicleImages.id, imageId),
          eq(vehicleImages.vehicleId, vehicleId),
        ),
      )
      .limit(1);

    if (!existingImage) {
      return error(HttpStatus.NOT_FOUND, 'Image not found for this vehicle');
    }

    let newFile;
    let fields: Record<string, string> = {};
    try {
      const result = await handleSingleFileUpload(request);
      newFile = result.file;
      fields = result.fields;
    } catch (err: any) {
      return error(HttpStatus.BAD_REQUEST, err.message);
    }

    // Phase 8 — compliance metadata + freshness gate (3.3).
    const lat = fields.gpsLat ? Number(fields.gpsLat) : null;
    const lng = fields.gpsLng ? Number(fields.gpsLng) : null;
    const accuracy = fields.gpsAccuracyM ? Math.round(Number(fields.gpsAccuracyM)) : null;
    const capturedAtRaw = fields.capturedAt || null;
    const deviceUserAgent = fields.deviceUserAgent
      ? String(fields.deviceUserAgent).slice(0, 255)
      : (request.headers['user-agent'] ?? null);
    const addressText = fields.addressText ? String(fields.addressText).slice(0, 500) : null;
    const skipFreshness = String(fields.skipFreshness ?? '').toLowerCase() === 'true';

    let capturedAt: Date | null = null;
    if (capturedAtRaw) {
      const parsed = new Date(capturedAtRaw);
      if (!isNaN(parsed.getTime())) {
        capturedAt = parsed;
        if (!skipFreshness) {
          const ageMs = Date.now() - parsed.getTime();
          if (ageMs > 5 * 60 * 1000) {
            await deleteFile(newFile.path);
            return error(
              HttpStatus.BAD_REQUEST,
              'Photo capture is older than 5 minutes — please take a live photo.',
            );
          }
        }
      }
    }

    await deleteFile(existingImage.imagePath);

    const category = fields.category || null;

    const [updated] = await db
      .update(vehicleImages)
      .set({
        imagePath: newFile.path,
        imageCategory: category,
        gpsLat: lat != null && !isNaN(lat) ? String(lat) : null,
        gpsLng: lng != null && !isNaN(lng) ? String(lng) : null,
        gpsAccuracyM: accuracy != null && !isNaN(accuracy) ? accuracy : null,
        capturedAt,
        deviceUserAgent,
        addressText,
      })
      .where(eq(vehicleImages.id, imageId))
      .returning();

    return success('Image replaced successfully', { ...updated, imagePath: await signUrl(updated.imagePath) });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Image ─────────────────────────────────────────────────────────────
export async function deleteImage(request: FastifyRequest) {
  try {
    const { vehicleId, imageId } = request.params as any;

    const [image] = await db
      .select()
      .from(vehicleImages)
      .where(
        and(
          eq(vehicleImages.id, imageId),
          eq(vehicleImages.vehicleId, vehicleId),
        ),
      )
      .limit(1);

    if (!image) {
      return error(HttpStatus.NOT_FOUND, 'Image not found for this vehicle');
    }

    await db.delete(vehicleImages).where(eq(vehicleImages.id, imageId));
    await deleteFile(image.imagePath);

    return success('Image deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
