import { z } from 'zod';

/**
 * Estimated workshop time, in minutes. Single source of truth shared by
 * appointment creation and rescheduling so both enforce identical bounds —
 * 15 minutes to a full 8-hour day.
 */
export const estimatedDurationMinutesField = z
  .number({ invalid_type_error: 'Estimated duration must be a number' })
  .int('Estimated duration must be a whole number of minutes')
  .min(15, 'Estimated duration must be at least 15 minutes')
  .max(480, 'Estimated duration cannot exceed 480 minutes');

export const APPOINTMENT_STATUSES = [
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_SERVICE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

export const APPOINTMENT_SERVICE_TYPES = [
  'PERIODIC',
  'GENERAL_REPAIR',
  'BREAKDOWN',
  'INSURANCE',
  'BODYSHOP',
  'INSPECTION_ONLY',
] as const;

// Default estimated duration in minutes per service type
export const SERVICE_DURATION_MAP: Record<string, number> = {
  PERIODIC: 150,
  GENERAL_REPAIR: 180,
  BREAKDOWN: 120,
  INSURANCE: 240,
  BODYSHOP: 480,
  INSPECTION_ONLY: 60,
};

// ─── Create Appointment ───────────────────────────────────────────────────────
export const createAppointmentSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID').optional(),
  vehicleId: z.string().uuid('Invalid vehicle ID').optional(),
  // Optional in Phase A: accepted + validated + logged only (not persisted,
  // not yet required). Becomes required for new customer/vehicle in Phase D.
  companyId: z.string().uuid('Invalid company ID').optional(),

  newCustomer: z
    .object({
      // 'I' = individual, 'C' = company — the same one-char encoding Evolve uses
      // (see evolveCustomerPersist.service.ts, which infers 'C' when Evolve
      // returns a CompanyName and 'I' otherwise). Defaults to 'C' because that
      // is what this path hardcoded before the selector existed, so an older
      // client that omits the field keeps its previous behaviour exactly.
      customerType: z.enum(['I', 'C']).default('C'),
      firstName: z.string().max(100).optional().default(''),
      lastName: z.string().max(100).optional().default(''),
      // Conditionally required — see the superRefine below. It cannot be
      // `.min(1)` here any more: an individual has no company name.
      companyName: z.string().max(100).optional(),
      // Type-specific identifiers. Each is REQUIRED for its own customer type
      // and absent for the other, so neither can be required here — both are
      // enforced in the superRefine below.
      //
      // An ID number is a 13-digit code, so it is validated on shape rather
      // than just capped: exactly 13 digits, no spaces or separators. That is
      // well inside the contract's <IDNumber> x(16) and the varchar(20) column.
      idNumber: z
        .string()
        .regex(/^\d{13}$/, 'ID number must be exactly 13 digits')
        .optional(),
      // RegNo has no fixed shape, so length is all we can enforce. It follows
      // the Evolve contract (<RegNo> x(20)) rather than our wider varchar(30)
      // column: accepting more than Evolve takes would only defer the failure
      // to the push, where it is far harder to explain to whoever typed it.
      regNo: z.string().max(20).optional(),
      // Individual only, and required for one — see the superRefine. Evolve
      // carries <Title> and <Initial> solely on the person branch and documents
      // both as *x(8) M — mandatory — which is why the form requires them too.
      title: z.string().max(8).optional(),
      initial: z.string().max(8).optional(),
      // ── Accounts Receivable (all optional) ──────────────────────────────
      // Booking is a fast reception path, so nothing here is ever required and
      // none of it appears in the superRefine below. A booking with no AR data
      // behaves exactly as it did before this block existed.
      //
      // currencyCode / defaultTaxCode sit at this level rather than inside
      // `ar` because they are columns on `customers`, not customer_ar — the
      // Evolve READ contract returns them inside <CustomerDetail>. Only the
      // WRITE contract nests them under <AccountsReceivable>, and that remap
      // happens once, in customerEvolveSync.service.ts.
      currencyCode: z.string().length(3).optional(),
      defaultTaxCode: z.coerce.number().int().optional(),
      ar: z
        .object({
          arAccountType: z.string().max(10).optional(),
          arAccountNumber: z.string().max(12).optional(),
          termsCode: z.string().max(10).optional(),
          creditLimitAmount: z.coerce.number().min(0).optional(),
          stopCredit: z.boolean().optional(),
          inactiveAccount: z.boolean().optional(),
        })
        .optional(),
      // A mobile number is 10 digits starting 06, 07 or 08. Validated on the
      // digit-stripped value so "082 123 4567" and "082-123-4567" both pass,
      // and the already-normalised international form ("27821234567", which
      // toEvolvePhone produces) is accepted too — this same endpoint serves
      // clients that may send either shape, and rejecting the canonical form
      // would be a regression. The value itself is left untouched: the insert
      // canonicalises it via splitEvolvePhone.
      contactNumber: z
        .string({ required_error: 'Phone number is required' })
        .min(7)
        .max(20)
        .refine(
          (v) => {
            const d = v.replace(/\D/g, '');
            return /^0[678]\d{8}$/.test(d) || /^27[678]\d{8}$/.test(d);
          },
          'Phone number must be 10 digits starting 06, 07 or 08',
        ),
      primaryEmail: z.string().email('Invalid email').max(100).optional(),
      address: z.string().max(500).optional(),
      crmReferenceNo: z.string().max(50).optional(),
      custSequenceId: z.string().max(50).optional(),
    })
    // Which fields identify a customer depends on the type, so none of them can
    // be required unconditionally:
    //   company    → companyName + regNo   (no person name, no title)
    //   individual → title + initial + firstName + lastName + idNumber
    // Enforced here as well as in the UI so a direct API call cannot create a
    // customer with no name or no identifier.
    .superRefine((nc, ctx) => {
      const require = (field: 'companyName' | 'regNo' | 'title' | 'initial' | 'firstName' | 'lastName' | 'idNumber', label: string, forType: string) => {
        if (nc[field]?.trim()) return;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${label} is required for ${forType} customer`,
        });
      };

      if (nc.customerType === 'C') {
        require('companyName', 'Company name', 'a company');
        require('regNo', 'Company registration number', 'a company');
        return;
      }
      require('title', 'Title', 'an individual');
      require('initial', 'Initial', 'an individual');
      require('firstName', 'First name', 'an individual');
      require('lastName', 'Last name', 'an individual');
      require('idNumber', 'ID number', 'an individual');
    })
    .optional(),

  newVehicle: z
    .object({
      brand: z.string({ required_error: 'Make is required' }).min(1).max(100),
      model: z.string({ required_error: 'Model is required' }).min(1).max(100),
      manufacturingYear: z
        .number()
        .int()
        .min(0)
        .max(new Date().getFullYear() + 1)
        .default(0),
      registrationNumber: z
        .string({ required_error: 'Registration number is required' })
        .min(1)
        .max(50)
        .transform((v) => v.trim().toUpperCase()),
      vin: z.string().max(50).default('').transform((v) => v.trim().toUpperCase()),
      fuelType: z.string().max(50).optional(),
      transmissionType: z.string().max(50).optional(),
      odometerLast: z.number().int().min(0).default(0),
      engineNumber: z.string().max(100).optional(),
      seriesDescription: z.string().max(150).optional(),
      modelDescription: z.string().max(150).optional(),
      modelCode: z.string().max(50).optional(),
      extColour: z.string().max(100).optional(),
      registrationDate: z.string().max(20).optional(),
      registrationYear: z.number().int().min(1900).max(2100).optional().nullable(),
      sellingDate: z.string().max(20).optional(),
    })
    .optional(),

  serviceAdvisorId: z.string().uuid('Invalid service advisor ID').optional(),

  serviceType: z.string({ required_error: 'Service type is required' }).min(1, 'Service type is required'),
  complaints: z.array(z.string().max(200)).default([]),
  estimatedDurationMinutes: estimatedDurationMinutesField.optional(),

  // Optional physical bay reservation (Bay & Time-Slot scheduling). When set,
  // the server validates the full [start, start+duration) interval against the
  // bay's existing bookings + operating hours instead of the capacity-slot rule.
  bayId: z.string().uuid('Invalid bay ID').optional(),

  appointmentDate: z
    .string({ required_error: 'Appointment date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  appointmentTime: z
    .string({ required_error: 'Appointment time is required' })
    .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),

  pickupRequired: z.boolean().default(false),
  pickupAddress: z.string().max(500).optional(),

  internalNotes: z.string().max(2000).optional(),
  sendWhatsApp: z.boolean().default(true),
  sendEmail: z.boolean().default(true),
});

// ─── Update Appointment Status ────────────────────────────────────────────────
export const updateAppointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES, {
    required_error: 'Status is required',
    invalid_type_error: `Status must be one of: ${APPOINTMENT_STATUSES.join(', ')}`,
  }),
  cancellationReason: z.string().max(1000).optional(),
});

// ─── Link Check-In ────────────────────────────────────────────────────────────
export const linkCheckInSchema = z.object({
  checkInId: z.string({ required_error: 'Check-in ID is required' }).uuid('Invalid check-in ID'),
});

// ─── Param Schemas ────────────────────────────────────────────────────────────
export const appointmentIdParamSchema = z.object({
  id: z.string().uuid('Invalid appointment ID'),
});

export const vehicleIdParamSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle ID'),
});

// ─── List / Query Schemas ─────────────────────────────────────────────────────
export const appointmentListQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  serviceAdvisorId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

export const slotAvailabilityQuerySchema = z.object({
  date: z
    .string({ required_error: 'Date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

export const irmSearchQuerySchema = z.object({
  phone: z.string().min(1).max(30).optional(),
  reg: z.string().min(1).max(30).optional(),
  vin: z.string().min(1).max(50).optional(),
}).refine((d) => d.phone || d.reg || d.vin, {
  message: 'Provide at least phone, reg, or vin to search',
});

// ─── Reschedule Appointment ───────────────────────────────────────────────────
export const rescheduleAppointmentSchema = z.object({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  newTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  reason: z.string().max(1000).optional(),
  /**
   * New estimated workshop time. OPTIONAL for backward compatibility: omitted
   * → the appointment keeps its stored duration (previous behaviour). Supplied
   * → it becomes the duration used for bay-interval conflict validation AND is
   * persisted, so the client's slot filtering and the server's authoritative
   * check always agree. Same bounds as creation.
   */
  estimatedDurationMinutes: estimatedDurationMinutesField.optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────
// Foreman bay reallocation / displacement swap (Model A). `replacementBayId` is
// only needed when the target bay is occupied; the backend determines the
// displaced appointment itself. No override in this version.
export const reallocateAppointmentBaySchema = z.object({
  targetBayId: z.string().uuid('Invalid target bay ID'),
  replacementBayId: z.string().uuid('Invalid replacement bay ID').optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type ReallocateAppointmentBayInput = z.infer<typeof reallocateAppointmentBaySchema>;
export type UpdateAppointmentStatusInput = z.infer<typeof updateAppointmentStatusSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type LinkCheckInInput = z.infer<typeof linkCheckInSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
