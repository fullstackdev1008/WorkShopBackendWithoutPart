import { FastifyRequest } from 'fastify';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { appointments, customers, jobCards, jobCardItems, vehicleCheckIns, vehicleImages, vehicles } from '../../db/models';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { vehicleImageParamSchema } from '../vehicle-images/dto';
import { sendVehicleEntryEmail } from '../../services/email.service';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { generateReceivingNo, setRoStatus } from '../../shared/utils/roStatus';
import {
  MAX_IMAGES_PER_VEHICLE,
  MIN_IMAGES_FOR_CONFIRM,
} from '../../shared/upload/upload';

// ─── Confirm Vehicle Entry ─────────────────────────────────────────────────────
export async function confirmVehicleEntry(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const body = (request.body ?? {}) as {
      odometerReading?: number;
      driverName?: string;
      driverPhone?: string;
      driverLicenceNo?: string;
      fuelLevel?: 'EMPTY' | 'QUARTER' | 'HALF' | 'THREE_QUARTER' | 'FULL';
      damagesNotes?: string;
      complaintText?: string;
      // Record-level shop marker chosen by Security/gate at entry. Nullable —
      // unset entries fall outside every scoped view (fail-closed) until backfilled.
      shop?: 'SERVICE' | 'MAJOR' | 'PDI';
    };
    const odometerReading = body.odometerReading;

    // Driver identity is mandatory on a gate entry — the record must say who
    // brought the vehicle in and how to reach them. Mirrors the client-side
    // validation so the rule holds for any caller, not just the UI.
    const driverName = body.driverName?.trim() ?? '';
    const driverPhone = body.driverPhone?.trim() ?? '';
    if (!driverName) {
      return error(HttpStatus.BAD_REQUEST, 'Driver name is required', 'driverName');
    }
    if (!driverPhone) {
      return error(HttpStatus.BAD_REQUEST, 'Driver phone is required', 'driverPhone');
    }
    // Local ("0831234567") or international ("+27 83 123 4567"): strip
    // separators and an optional leading '+', then require 9–15 digits (E.164).
    if (!/^\d{9,15}$/.test(driverPhone.replace(/[\s()-]/g, '').replace(/^\+/, ''))) {
      return error(HttpStatus.BAD_REQUEST, 'Enter a valid driver phone number (9–15 digits)', 'driverPhone');
    }

    const actorId = await resolveActorId(request);

    // Fetch vehicle + customer info
    const [row] = await db
      .select({
        vehicleId: vehicles.id,
        vin: vehicles.vin,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        status: vehicles.status,
        entryTime: vehicles.entryTime,
        odometerLast: vehicles.odometerLast,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerCompanyName: customers.companyName,
        customerEmail: customers.primaryEmail,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Count images
    const [{ total: imageCount }] = await db
      .select({ total: count() })
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, vehicleId));

    if (imageCount < MIN_IMAGES_FOR_CONFIRM) {
      return error(
        HttpStatus.BAD_REQUEST,
        `Minimum ${MIN_IMAGES_FOR_CONFIRM} images required before confirming entry. Currently ${imageCount} image(s) uploaded.`,
      );
    }

    // Duplicate-entry rule:
    //   - If vehicle has reached 'Full Cust. Approval', 'In Service', or
    //     'Ready for Billing', the prior visit is complete → silently close
    //     the old check-in so a new entry can be created.
    //   - If vehicle is still in the gate-keeper editable stage
    //     ('Entry (Draft)' / 'Vehicle IN') with an active check-in, the
    //     gate keeper is editing the same entry — update odometer in place
    //     and return success without creating a duplicate row.
    //   - Otherwise (Inspection started, Job Card stages, etc.) → 409.
    const ALLOW_REENTRY_STATUSES = new Set([
      'Job Card (Full Cust. Approval)',
      'In Service',
      'Ready for Billing',
    ]);
    const EDITABLE_STATUSES = new Set(['Entry (Draft)', 'Vehicle IN']);

    const [activeCheckIn] = await db
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

    if (activeCheckIn) {
      if (ALLOW_REENTRY_STATUSES.has(row.status as string)) {
        // Before auto-closing the prior check-in, refuse if any job item is
        // still incomplete. The technician needs to finish before a new
        // visit can begin.
        const [{ remaining }] = await db
          .select({ remaining: count() })
          .from(jobCardItems)
          .innerJoin(jobCards, eq(jobCards.id, jobCardItems.jobCardId))
          .where(
            and(
              eq(jobCards.vehicleCheckInId, activeCheckIn.id),
              sql`${jobCardItems.completedAt} IS NULL`,
            ),
          );
        if (Number(remaining) > 0) {
          return error(
            HttpStatus.CONFLICT,
            `Vehicle is still in the workshop (status: ${row.status}). ${remaining} job item${Number(remaining) === 1 ? '' : 's'} pending — wait for the technician to finish before creating a new entry.`,
          );
        }

        // Auto-close the prior check-in so the new entry can be created.
        // Stamp the check-in status with IN_SERVICE so the archived row
        // displays the post-service state ("In Service") rather than the
        // stale gate-arrival state ("Vehicle IN").
        await db
          .update(vehicleCheckIns)
          .set({
            isActive: false,
            status: 'IN_SERVICE',
            completedAt: new Date(),
            updatedAt: new Date(),
            updatedBy: actorId,
          })
          .where(eq(vehicleCheckIns.id, activeCheckIn.id));
      } else if (EDITABLE_STATUSES.has(row.status as string)) {
        // Idempotent edit of the same entry: update odometer + Phase 1 capture
        // fields (driver, fuel, damages, complaint) on the active check-in.
        // No new check-in is created. Receiving No and RO status are NOT
        // changed — those are stamped once at first arrival.
        const editNow = new Date();
        // Build a partial update so only the fields the FE actually sent are
        // touched; passing `undefined` would otherwise wipe existing values.
        const checkInPatch: Record<string, unknown> = {
          updatedAt: editNow,
          updatedBy: actorId,
        };
        if (odometerReading != null) checkInPatch.odometerReading = odometerReading;
        if (body.driverName !== undefined) checkInPatch.driverName = body.driverName?.trim() || null;
        if (body.driverPhone !== undefined) checkInPatch.driverPhone = body.driverPhone?.trim() || null;
        if (body.driverLicenceNo !== undefined) checkInPatch.driverLicenceNo = body.driverLicenceNo?.trim() || null;
        if (body.fuelLevel !== undefined) checkInPatch.fuelLevel = body.fuelLevel || null;
        if (body.damagesNotes !== undefined) checkInPatch.damagesNotes = body.damagesNotes?.trim() || null;
        if (body.complaintText !== undefined) checkInPatch.complaintText = body.complaintText?.trim() || null;
        // Shop was previously set only on the initial insert, so re-routing a
        // vehicle during an entry edit silently did nothing. Patch it here too.
        if (body.shop !== undefined) checkInPatch.shop = body.shop ?? null;

        await db.transaction(async (tx: any) => {
          if (odometerReading != null) {
            await tx
              .update(vehicles)
              .set({ odometerLast: odometerReading, updatedAt: editNow })
              .where(eq(vehicles.id, vehicleId));
          }
          await tx
            .update(vehicleCheckIns)
            .set(checkInPatch)
            .where(eq(vehicleCheckIns.id, activeCheckIn.id));
        });

        // Notification email already sent at original confirm — skip resend.
        return success('Vehicle entry updated', {
          registration: row.registrationNumber || row.vin,
          owner: `${row.customerFirstName ?? ''} ${row.customerLastName ?? ''}`.trim(),
          photosCaptured: `${imageCount}/${MAX_IMAGES_PER_VEHICLE}`,
          entryTime: editNow.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
          checkInId: activeCheckIn.id,
        });
      } else {
        const entryTime = new Date(activeCheckIn.checkInTime).toLocaleString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: 'short',
          hour12: true,
        });
        return error(
          HttpStatus.CONFLICT,
          `Vehicle ${row.registrationNumber || row.vin} is already inside the workshop (entered ${entryTime}, status: ${activeCheckIn.status}). Cancel or complete the existing entry before creating a new one.`,
        );
      }
    }

    // Update vehicle status + create check-in with READY status
    const now = new Date();

    const entryTimeFormatted = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    // Auto-fill complaint from any open appointment if the gate keeper
    // didn't type one in.
    let complaintText = body.complaintText?.trim() || null;
    if (!complaintText) {
      const [appt] = await db
        .select({ complaints: appointments.complaints })
        .from(appointments)
        .where(
          and(
            eq(appointments.vehicleId, vehicleId),
            inArray(appointments.status, ['BOOKED', 'CONFIRMED']),
          ),
        )
        .limit(1);
      const list = appt?.complaints as string[] | null | undefined;
      if (list && list.length > 0) complaintText = list.join('; ');
    }

    const receivingNo = await generateReceivingNo();

    const [newCheckIn] = await db.transaction(async (tx: any) => {
      // Update vehicle status to "Vehicle IN" — legacy column stays in step
      // with the canonical ro_status (set via setRoStatus below).
      await tx
        .update(vehicles)
        .set({
          status: 'Vehicle IN',
          entryTime: now,
          updatedAt: now,
          ...(odometerReading != null && { odometerLast: odometerReading }),
        })
        .where(eq(vehicles.id, vehicleId));

      // Create a new check-in in queue (vehicle just entered, awaiting QC).
      // Capture all Phase 1 fields up front so the gate keeper never has to
      // come back to fill them in.
      const inserted = await tx
        .insert(vehicleCheckIns)
        .values({
          vehicleId,
          odometerReading: odometerReading ?? row.odometerLast,
          status: 'IN_QUEUE',
          checkInTime: now,
          confirmedAt: now,
          receivingNo,
          driverName: body.driverName?.trim() || null,
          driverPhone: body.driverPhone?.trim() || null,
          driverLicenceNo: body.driverLicenceNo?.trim() || null,
          fuelLevel: body.fuelLevel ?? null,
          damagesNotes: body.damagesNotes?.trim() || null,
          complaintText,
          shop: body.shop ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning();

      // Advance any pending appointment for this vehicle to CHECKED_IN
      // and link it to the check-in we just created (so QC inspection can
      // surface the customer complaints captured during booking).
      await tx
        .update(appointments)
        .set({ status: 'CHECKED_IN', checkInId: inserted[0].id, updatedAt: now })
        .where(
          and(
            eq(appointments.vehicleId, vehicleId),
            inArray(appointments.status, ['BOOKED', 'CONFIRMED']),
          ),
        );

      return inserted;
    });

    // Canonical RO status — `ARRIVED` is the first state and gets recorded
    // in ro_status_history for the audit trail. Downstream phases (QC,
    // workshop allocation, technician work, vehicle out, release) all call
    // setRoStatus() the same way, so the timeline never drifts.
    await setRoStatus(newCheckIn.id, 'ARRIVED', actorId, 'Vehicle arrival confirmed');

    // Notify customer that the vehicle has been checked in (transparency).
    // Look up the booking ref from the appointment we just linked, if any.
    const [linkedAppt] = await db
      .select({ bookingRef: appointments.bookingRef })
      .from(appointments)
      .where(eq(appointments.checkInId, newCheckIn.id))
      .limit(1);

    if (row.customerEmail) {
      await sendVehicleEntryEmail({
        customerName: row.customerCompanyName || `${row.customerFirstName ?? ''} ${row.customerLastName ?? ''}`.trim() || 'Customer',
        customerEmail: row.customerEmail,
        vehicleInfo: `${row.brand} ${row.model} (${row.registrationNumber || row.vin})`,
        bookingRef: linkedAppt?.bookingRef ?? null,
      });
    }

    return success('Vehicle ready for confirmation', {
      registration: row.registrationNumber || row.vin,
      owner: `${row.customerFirstName ?? ''} ${row.customerLastName ?? ''}`.trim(),
      photosCaptured: `${imageCount}/${MAX_IMAGES_PER_VEHICLE}`,
      entryTime: entryTimeFormatted,
      checkInId: newCheckIn.id,
      receivingNo: newCheckIn.receivingNo,
      roStatus: 'ARRIVED',
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
