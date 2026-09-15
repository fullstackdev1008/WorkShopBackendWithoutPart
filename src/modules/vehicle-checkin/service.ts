import { FastifyRequest } from 'fastify';
import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import {
  vehicles,
  vehicleCheckIns,
  vehicleCheckInPhotos,
  customers,
} from '../../db/models';
import { resolveUserScope, shopFilter, checkInInScope } from '../../shared/security/scope';
import {
  createCheckInSchema,
  updateCheckInSchema,
  insertPhotoSchema,
  checkInIdParamSchema,
  checkInPhotoParamSchema,
  checkInPhotoIdParamSchema,
  checkInListQuerySchema,
} from './dto';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { handleSingleFileUpload, deleteFile } from '../../shared/upload/upload';
import { signUrl } from '../../middleware/s3';
import { resolveActorId } from '../../shared/utils/resolveActor';

const MIN_PHOTOS_FOR_CONFIRM = 4;

// ─── List Check-Ins ──────────────────────────────────────────────────────────
export async function listCheckIns(request: FastifyRequest) {
  try {
    const { vehicleId, status } = request.query as any;
    const scope = await resolveUserScope(request);

    const conditions: ReturnType<typeof eq>[] = [eq(vehicleCheckIns.isActive, true)];

    if (vehicleId) conditions.push(eq(vehicleCheckIns.vehicleId, vehicleId));
    if (status) conditions.push(eq(vehicleCheckIns.status, status as any));
    // Shop scoping (no-op for super-admin / ALL).
    const checkInShopCond = shopFilter(scope);
    if (checkInShopCond) conditions.push(checkInShopCond as any);

    const checkIns = await db
      .select()
      .from(vehicleCheckIns)
      .where(and(...conditions));

    return success('Check-ins fetched successfully', { data: checkIns, total: checkIns.length });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Check-In Details ────────────────────────────────────────────────────
export async function getCheckInDetails(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const scope = await resolveUserScope(request);

    const [checkIn] = await db
      .select()
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, id))
      .limit(1);

    if (!checkIn) {
      return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    }
    // Shop scope (IDOR guard).
    if (!checkInInScope(scope, checkIn.shop as any)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    const photos = await db
      .select()
      .from(vehicleCheckInPhotos)
      .where(
        and(
          eq(vehicleCheckInPhotos.vehicleCheckInId, id),
          isNull(vehicleCheckInPhotos.deletedAt),
        ),
      );

    const [vehicleRow] = await db
      .select({
        id: vehicles.id,
        vin: vehicles.vin,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(eq(vehicles.id, checkIn.vehicleId))
      .limit(1);

    const signedPhotos = await Promise.all(
      photos.map(async (p: any) => ({ ...p, imageUrl: await signUrl(p.imageUrl) })),
    );

    return success('Check-in details fetched successfully', {
      ...checkIn,
      vehicle: vehicleRow || null,
      photos: signedPhotos,
      photoCount: photos.length,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create Check-In ─────────────────────────────────────────────────────────
export async function createCheckIn(request: FastifyRequest) {
  try {
    const body = request.body as any;
    const { vehicleId, ...rest } = body;
    const actorId = await resolveActorId(request);

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Duplicate-entry rule mirrors confirm-entry:
    //   - If the vehicle is in 'In Service' or 'Ready for Billing', the
    //     prior visit has been handed off → silently close the old check-in.
    //   - Otherwise, block the new entry with a 409.
    const ALLOW_REENTRY_STATUSES = new Set([
      'Job Card (Full Cust. Approval)',
      'In Service',
      'Ready for Billing',
    ]);

    // Need vehicle status for the rule above. The earlier select only
    // returned the id, so fetch the full row.
    const [vehicleFull] = await db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    const wantsActive = rest.isActive !== false;
    if (wantsActive) {
      const [existing] = await db
        .select({
          id: vehicleCheckIns.id,
          status: vehicleCheckIns.status,
          checkInTime: vehicleCheckIns.checkInTime,
        })
        .from(vehicleCheckIns)
        .where(
          and(
            eq(vehicleCheckIns.vehicleId, vehicleId),
            eq(vehicleCheckIns.isActive, true),
          ),
        )
        .limit(1);

      if (existing) {
        if (ALLOW_REENTRY_STATUSES.has(vehicleFull?.status as string)) {
          await db
            .update(vehicleCheckIns)
            .set({
              isActive: false,
              status: 'IN_SERVICE',
              completedAt: new Date(),
              updatedAt: new Date(),
              updatedBy: actorId,
            })
            .where(eq(vehicleCheckIns.id, existing.id));
        } else {
          const entryTime = new Date(existing.checkInTime).toLocaleString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short',
            hour12: true,
          });
          return error(
            HttpStatus.CONFLICT,
            `This vehicle already has an active check-in (entered ${entryTime}, status: ${existing.status}). Cancel or complete the existing entry first.`,
          );
        }
      }
    }

    const [newCheckIn] = await db
      .insert(vehicleCheckIns)
      // shop normalised to null when absent (fail-closed for scoped views).
      .values({ vehicleId, ...rest, shop: (rest as any).shop ?? null, createdBy: actorId, updatedBy: actorId })
      .returning();

    return created('Check-in created successfully', newCheckIn);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Check-In ─────────────────────────────────────────────────────────
export async function updateCheckIn(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [checkIn] = await db
      .select({ id: vehicleCheckIns.id })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, id))
      .limit(1);

    if (!checkIn) {
      return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    }

    const actorId = await resolveActorId(request);
    const [updated] = await db
      .update(vehicleCheckIns)
      .set({ ...body, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(vehicleCheckIns.id, id))
      .returning();

    return success('Check-in updated successfully', updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Check-In ─────────────────────────────────────────────────────────
export async function deleteCheckIn(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [checkIn] = await db
      .select({ id: vehicleCheckIns.id })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, id))
      .limit(1);

    if (!checkIn) {
      return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    }

    const photos = await db
      .select()
      .from(vehicleCheckInPhotos)
      .where(eq(vehicleCheckInPhotos.vehicleCheckInId, id));

    await db.delete(vehicleCheckIns).where(eq(vehicleCheckIns.id, id));
    await Promise.all(photos.map((photo: any) => deleteFile(photo.imageUrl)));

    return success('Check-in and associated photos deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Insert Photo ────────────────────────────────────────────────────────────
export async function insertPhoto(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;

    const [checkIn] = await db
      .select({ id: vehicleCheckIns.id, status: vehicleCheckIns.status })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, checkInId))
      .limit(1);

    if (!checkIn) {
      return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    }

    let uploadedFile;
    try {
      const result = await handleSingleFileUpload(request);
      uploadedFile = result.file;
    } catch (err: any) {
      return error(HttpStatus.BAD_REQUEST, err.message);
    }

    const photoType = (request.query as any).photoType;
    const parsed = insertPhotoSchema.safeParse({ photoType });
    if (!parsed.success) {
      await deleteFile(uploadedFile.path);
      const messages = parsed.error.errors.map((e) => e.message).join(', ');
      return error(HttpStatus.BAD_REQUEST, messages);
    }

    const [newPhoto] = await db
      .insert(vehicleCheckInPhotos)
      .values({
        vehicleCheckInId: checkInId,
        photoType: parsed.data.photoType,
        imageUrl: uploadedFile.path,
      })
      .returning();

    const [{ total: photoCount }] = await db
      .select({ total: count() })
      .from(vehicleCheckInPhotos)
      .where(
        and(
          eq(vehicleCheckInPhotos.vehicleCheckInId, checkInId),
          isNull(vehicleCheckInPhotos.deletedAt),
        ),
      );

    return created('Photo uploaded successfully', {
      photo: { ...newPhoto, imageUrl: await signUrl(newPhoto.imageUrl) },
      photoCount,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Photo ────────────────────────────────────────────────────────────
export async function deletePhoto(request: FastifyRequest) {
  try {
    const { checkInId, photoId } = request.params as any;

    const [photo] = await db
      .select()
      .from(vehicleCheckInPhotos)
      .where(
        and(
          eq(vehicleCheckInPhotos.id, photoId),
          eq(vehicleCheckInPhotos.vehicleCheckInId, checkInId),
        ),
      )
      .limit(1);

    if (!photo) {
      return error(HttpStatus.NOT_FOUND, 'Photo not found for this check-in');
    }

    await db.delete(vehicleCheckInPhotos).where(eq(vehicleCheckInPhotos.id, photoId));
    await deleteFile(photo.imageUrl);

    return success('Photo deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Confirm Check-In ────────────────────────────────────────────────────────
export async function confirmCheckIn(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [checkIn] = await db
      .select({
        checkInId: vehicleCheckIns.id,
        vehicleId: vehicleCheckIns.vehicleId,
        odometerReading: vehicleCheckIns.odometerReading,
        checkInTime: vehicleCheckIns.checkInTime,
        status: vehicleCheckIns.status,
        vin: vehicles.vin,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
      })
      .from(vehicleCheckIns)
      .innerJoin(vehicles, eq(vehicleCheckIns.vehicleId, vehicles.id))
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(eq(vehicleCheckIns.id, id))
      .limit(1);

    if (!checkIn) {
      return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    }

    if (checkIn.status === 'COMPLETED' || checkIn.status === 'CANCELLED') {
      return error(HttpStatus.BAD_REQUEST, `Cannot confirm a check-in that is already ${checkIn.status}`);
    }

    const [{ total: photoCount }] = await db
      .select({ total: count() })
      .from(vehicleCheckInPhotos)
      .where(
        and(
          eq(vehicleCheckInPhotos.vehicleCheckInId, id),
          isNull(vehicleCheckInPhotos.deletedAt),
        ),
      );

    if (photoCount < MIN_PHOTOS_FOR_CONFIRM) {
      return error(
        HttpStatus.BAD_REQUEST,
        `Minimum ${MIN_PHOTOS_FOR_CONFIRM} photos required before confirming. Currently ${photoCount} photo(s) uploaded.`,
      );
    }

    const checkInDate = new Date(checkIn.checkInTime);
    const checkInTimeFormatted = checkInDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const actorId = await resolveActorId(request);
    await db
      .update(vehicleCheckIns)
      .set({ status: 'IN_QUEUE', confirmedAt: new Date(), updatedAt: new Date(), updatedBy: actorId })
      .where(eq(vehicleCheckIns.id, id));

    return success('Check-in confirmed successfully', {
      checkInId: checkIn.checkInId,
      registration: checkIn.registrationNumber || checkIn.vin,
      vehicle: `${checkIn.brand} ${checkIn.model}`,
      owner: `${checkIn.customerFirstName ?? ''} ${checkIn.customerLastName ?? ''}`.trim(),
      odometerReading: checkIn.odometerReading,
      photosCaptured: photoCount,
      checkInTime: checkInTimeFormatted,
      status: 'IN_QUEUE',
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
