import { FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { gatePasses, invoices, vehicles, customers, vehicleCheckIns, vehicleImages, vehicleCheckInPhotos, appointments } from '../../db/models';
import { gt, sql } from 'drizzle-orm';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { setRoStatus } from '../../shared/utils/roStatus';
import { handleSingleFileUpload } from '../../shared/upload/upload';
import { signUrl } from '../../middleware/s3';

function toPhotoTypeLocal(
  category: string | null,
): 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'DASHBOARD' | 'ENGINE' | 'OTHER' {
  const cat = (category ?? '').toLowerCase();
  if (cat.includes('front')) return 'FRONT';
  if (cat.includes('rear') || cat.includes('back')) return 'REAR';
  if (cat.includes('left')) return 'LEFT';
  if (cat.includes('right')) return 'RIGHT';
  if (cat.includes('dashboard') || cat.includes('dash')) return 'DASHBOARD';
  if (cat.includes('engine')) return 'ENGINE';
  return 'OTHER';
}

// ─── Upload driver's licence photo (captured at the gate before release) ─────
// Stores the image and returns its storage path (sent back in the redeem call
// as driverOutLicenceImageUrl) plus a signed URL for immediate preview.
export async function uploadLicencePhoto(request: FastifyRequest) {
  try {
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    let uploaded;
    try {
      const result = await handleSingleFileUpload(request);
      uploaded = result.file;
    } catch (err: any) {
      return error(HttpStatus.BAD_REQUEST, err?.message ?? 'No file uploaded');
    }

    return success('Licence photo uploaded', {
      path: uploaded.path,
      url: await signUrl(uploaded.path),
    });
  } catch (err) {
    console.log('uploadLicencePhoto error', err);
    return serverError(err);
  }
}

// ─── Lookup by code (security scans pass at the gate) ────────────────────────
export async function lookupByCode(request: FastifyRequest) {
  try {
    const { code } = request.params as any;
    const [row] = await db
      .select({
        gp: gatePasses,
        invoice: invoices,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerEmail: customers.primaryEmail,
      })
      .from(gatePasses)
      .leftJoin(invoices, eq(gatePasses.invoiceId, invoices.id))
      .leftJoin(vehicles, eq(gatePasses.vehicleId, vehicles.id))
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(gatePasses.code, code))
      .limit(1);

    if (!row) return error(HttpStatus.NOT_FOUND, 'Gate pass not found');

    return success('OK', {
      ...row.gp,
      invoice: row.invoice
        ? {
            id: row.invoice.id,
            invoiceNo: row.invoice.invoiceNo,
            status: row.invoice.status,
            totalAmount: row.invoice.totalAmount,
            paidAmount: row.invoice.paidAmount,
            currencyCode: row.invoice.currencyCode,
          }
        : null,
      vehicle: { registrationNumber: row.registrationNumber, brand: row.brand, model: row.model },
      customer: {
        name: `${row.customerFirstName ?? ''} ${row.customerLastName ?? ''}`.trim() || null,
        email: row.customerEmail,
      },
    });
  } catch (err) {
    return serverError(err);
  }
}

// ─── List active passes (security dashboard) ─────────────────────────────────
export async function listActive(request: FastifyRequest) {
  try {
    const q = (request.query ?? {}) as { page?: string | number; limit?: string | number };
    const paginated = q.page != null || q.limit != null;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;

    const where = eq(gatePasses.status, 'ACTIVE');

    const baseQuery = db
      .select({
        gp: gatePasses,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        invoiceNo: invoices.invoiceNo,
      })
      .from(gatePasses)
      .leftJoin(invoices, eq(gatePasses.invoiceId, invoices.id))
      .leftJoin(vehicles, eq(gatePasses.vehicleId, vehicles.id))
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(where)
      .orderBy(desc(gatePasses.generatedAt));

    const rows = paginated
      ? await baseQuery.limit(limit).offset(offset)
      : await baseQuery;

    const data = rows.map((r) => ({
      ...r.gp,
      vehicle: { registrationNumber: r.registrationNumber, brand: r.brand, model: r.model },
      customerName: `${r.customerFirstName ?? ''} ${r.customerLastName ?? ''}`.trim() || null,
      invoiceNo: r.invoiceNo,
    }));

    if (!paginated) {
      return success('OK', data);
    }

    const [{ totalRows }] = await db
      .select({ totalRows: sql<number>`COUNT(*)::int` })
      .from(gatePasses)
      .where(where);
    const totalNum = Number(totalRows) || 0;

    return success('OK', {
      data,
      pagination: {
        page,
        limit,
        total: totalNum,
        totalPages: Math.max(1, Math.ceil(totalNum / limit)),
      },
    });
  } catch (err) {
    return serverError(err);
  }
}

// ─── Redeem (mark vehicle released) ──────────────────────────────────────────
// Captures odometer + driver-out signature, flips pass to REDEEMED, moves
// the check-in's RO status to RELEASED. CLOSED is set right after — Phase 7
// doesn't introduce a separate "post-departure" wait; we close the loop now.
export async function redeem(request: FastifyRequest) {
  try {
    const { code } = request.params as any;
    const body = (request.body ?? {}) as {
      odometerOut?: number;
      driverOutName?: string;
      driverOutLicenceImageUrl?: string;
      driverOutSignatureUrl?: string;
      notes?: string;
    };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const [gp] = await db
      .select()
      .from(gatePasses)
      .where(eq(gatePasses.code, code))
      .limit(1);
    if (!gp) return error(HttpStatus.NOT_FOUND, 'Gate pass not found');
    if (gp.status !== 'ACTIVE') {
      return error(HttpStatus.BAD_REQUEST, `Gate pass is ${gp.status.toLowerCase()}`);
    }

    const now = new Date();
    await db
      .update(gatePasses)
      .set({
        status: 'REDEEMED',
        redeemedAt: now,
        redeemedBy: actorId,
        odometerOut: body.odometerOut ?? null,
        driverOutName: body.driverOutName ?? null,
        driverOutLicenceImageUrl: body.driverOutLicenceImageUrl ?? null,
        driverOutSignatureUrl: body.driverOutSignatureUrl ?? null,
        notes: body.notes ?? null,
        updatedAt: now,
      })
      .where(eq(gatePasses.id, gp.id));

    if (gp.checkInId) {
      await setRoStatus(gp.checkInId, 'RELEASED', actorId, `Gate pass ${gp.code} redeemed`);
      await setRoStatus(gp.checkInId, 'CLOSED', actorId, 'Vehicle released — RO closed');
      // Close the active check-in record too so re-entries open a fresh one.
      // completedAt is what Vehicle 360 uses to mark a visit as "released" —
      // without it, the visit shows as still in progress.
      await db
        .update(vehicleCheckIns)
        .set({ status: 'COMPLETED', updatedAt: now, isActive: false, completedAt: now })
        .where(and(eq(vehicleCheckIns.id, gp.checkInId)));

      // Archive this visit's photos from vehicle_images → vehicle_check_in_photos
      // and clear vehicle_images so the next visit starts with a blank canvas.
      // Without this step, photos uploaded during the current visit stay in
      // vehicle_images and would be incorrectly assigned to the next visit's
      // archive run, mixing photos across visits.
      if (gp.vehicleId) {
        const imgs = await db
          .select()
          .from(vehicleImages)
          .where(eq(vehicleImages.vehicleId, gp.vehicleId));

        if (imgs.length > 0) {
          await db.insert(vehicleCheckInPhotos).values(
            imgs.map((img) => ({
              vehicleCheckInId: gp.checkInId!,
              photoType: toPhotoTypeLocal(img.imageCategory),
              imageUrl: img.imagePath,
              // Carry compliance metadata across the archive so the audit
              // trail survives gate-release.
              gpsLat: img.gpsLat,
              gpsLng: img.gpsLng,
              gpsAccuracyM: img.gpsAccuracyM,
              capturedAt: img.capturedAt,
              deviceUserAgent: img.deviceUserAgent,
              addressText: img.addressText,
            })),
          );
          await db.delete(vehicleImages).where(eq(vehicleImages.vehicleId, gp.vehicleId));
        }
      }
    }

    // Update the vehicle row status to 'Completed' so the security dashboard
    // / Vehicle 360 / queues no longer show this vehicle as still in workflow.
    // Without this, the legacy vehicles.status column stays on whatever it was
    // when the gate pass was issued (e.g. 'Job Card (Pending Cust. Approval)').
    if (gp.vehicleId) {
      await db
        .update(vehicles)
        .set({ status: 'Completed', updatedAt: now, updatedBy: actorId })
        .where(eq(vehicles.id, gp.vehicleId));
    }

    // Close the linked appointment too — otherwise the appointment dashboard
    // shows the booking as still 'CHECKED_IN' / 'IN_SERVICE' long after the
    // vehicle has actually left.
    if (gp.checkInId) {
      await db
        .update(appointments)
        .set({ status: 'COMPLETED', updatedAt: now })
        .where(and(
          eq(appointments.checkInId, gp.checkInId),
          // Only flip terminal — don't overwrite CANCELLED
          sql`${appointments.status} NOT IN ('COMPLETED', 'CANCELLED')`,
        ));
    }

    // Persist the odometer-out reading as the vehicle's last-known
    // odometer so the next visit's gate-entry pre-fills the new starting
    // value. Only update if the new reading is greater than the stored
    // one — guards against fat-finger typos that would otherwise reduce
    // the lifetime odometer.
    if (gp.vehicleId && body.odometerOut != null && body.odometerOut > 0) {
      await db
        .update(vehicles)
        .set({ odometerLast: body.odometerOut, updatedAt: now, updatedBy: actorId })
        .where(and(
          eq(vehicles.id, gp.vehicleId),
          gt(sql.raw(`${body.odometerOut}`), sql`COALESCE(${vehicles.odometerLast}, 0)`),
        ));
    }

    return success('Gate pass redeemed — vehicle released', { code, status: 'REDEEMED' });
  } catch (err) {
    console.log('redeem error', err);
    return serverError(err);
  }
}
