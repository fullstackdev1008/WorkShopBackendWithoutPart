import { z } from 'zod';

const optStr = (max: number) => z.string().max(max).nullish();
const optInt = () => z.coerce.number().int().nullish();
const optBool = () => z.boolean().nullish();
const optDate = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .nullish();

// ─── Address Schema ──────────────────────────────────────────────────────────
export const addressSchema = z.object({
  addressType: z
    .string({ required_error: 'Address type is required' })
    .min(1)
    .max(20),
  addressLine1: optStr(100),
  addressLine2: optStr(100),
  addressLine3: optStr(100),
  city: optStr(50),
  provinceId: optInt(),
  areaCode: optStr(10),
  country: optStr(50),
});

// ─── Contact Schema ─────────────────────────────────────────────────────────
export const contactSchema = z.object({
  contactType: z
    .string({ required_error: 'Contact type is required' })
    .min(1)
    .max(20),
  countryCode: optStr(10),
  contactNumber: optStr(20),
});

// ─── Accounts Receivable Schema ─────────────────────────────────────────────
// Declared alongside addresses/contacts/profile, which createCustomerSchema
// already lists — `ar` was the only nested block missing, so a future wiring-up
// of validation would have silently stripped it. Lengths match the customer_ar
// columns. No field is required: AR data is dealer configuration and a customer
// may legitimately have none.
export const arSchema = z.object({
  dbArSeqId: optStr(40),
  arAccountNumber: optStr(40),
  arAccountType: optStr(10),
  arTypeDescrip: optStr(100),
  inactiveAccount: optBool(),
  stopCredit: optBool(),
  creditLimitAmount: z.coerce.number().nullish(),
  creditAvailableAmount: z.coerce.number().nullish(),
  // A code, not a quantity — see migration 0069 for why it is not an integer.
  termsCode: optStr(10),
});

// ─── Profile Schema ─────────────────────────────────────────────────────────
export const profileSchema = z.object({
  occupation: optStr(50),
  receiveEmail: optBool(),
  receiveSms: optBool(),
  receivePost: optBool(),
  receiveTelemarketing: optBool(),
  primaryContact: optStr(1),
  secondaryContact: optStr(1),
  receiveMarketingAll: optBool(),
  receiveMarketingVehicle: optBool(),
  receiveMarketingService: optBool(),
  receiveMarketingParts: optBool(),
  csiConsentService: optBool(),
  csiConsentVehicles: optBool(),
  csiConsentSurveys: optBool(),
  csiConsentBulkSms: optBool(),
});

// ─── Create Customer Schema ─────────────────────────────────────────────────
export const createCustomerSchema = z.object({
  crmReferenceNo: z
    .string({ required_error: 'CRM reference number is required' })
    .min(1)
    .max(50),
  custSequenceId: z
    .string({ required_error: 'Customer sequence ID is required' })
    .min(1)
    .max(20),
  customerType: z
    .string({ required_error: 'Customer type is required' })
    .min(1)
    .max(1),
  activeCustomer: z.boolean({
    required_error: 'Active customer flag is required',
  }),
  leadType: z
    .string({ required_error: 'Lead type is required' })
    .min(1)
    .max(50),
  leadSource: z
    .string({ required_error: 'Lead source is required' })
    .min(1)
    .max(50),
  title: optStr(20),
  initial: optStr(10),
  firstName: optStr(50),
  lastName: optStr(50),
  companyName: optStr(100),
  tradingAs: optStr(100),
  idNumber: optStr(20),
  birthDate: optDate(),
  gender: optStr(1),
  maritalStatus: optInt(),
  language: optStr(1),
  citizen: optBool(),
  internalCustomer: optBool(),
  locked: optBool(),
  customerPersonal: optStr(1),
  status: optInt(),
  financeInstitution: optStr(1),
  customerSalesType: optStr(1),
  primaryEmail: optStr(100),
  secondaryEmail: optStr(100),
  webAddress: optStr(100),
  regNo: optStr(30),
  taxNo: optStr(30),
  ficNo: optStr(30),
  currencyCode: optStr(3),
  defaultTaxCode: optInt(),
  fleetNo: optStr(30),
  notes: z.string().nullish(),
  sellingDealer: optStr(100),
  sellingDate: optDate(),
  addresses: z.array(addressSchema).optional(),
  contacts: z.array(contactSchema).optional(),
  profile: profileSchema.optional(),
  ar: arSchema.optional(),
});

// ─── Update Customer Schema ─────────────────────────────────────────────────
export const updateCustomerSchema = z
  .object({
    customerType: z.string().max(1).optional(),
    activeCustomer: z.boolean().optional(),
    leadType: z.string().max(50).optional(),
    leadSource: z.string().max(50).optional(),
    title: optStr(20),
    initial: optStr(10),
    firstName: optStr(50),
    lastName: optStr(50),
    companyName: optStr(100),
    tradingAs: optStr(100),
    idNumber: optStr(20),
    birthDate: optDate(),
    gender: optStr(1),
    maritalStatus: optInt(),
    language: optStr(1),
    citizen: optBool(),
    internalCustomer: optBool(),
    locked: optBool(),
    customerPersonal: optStr(1),
    status: optInt(),
    financeInstitution: optStr(1),
    customerSalesType: optStr(1),
    primaryEmail: optStr(100),
    secondaryEmail: optStr(100),
    webAddress: optStr(100),
    regNo: optStr(30),
    taxNo: optStr(30),
    ficNo: optStr(30),
    currencyCode: optStr(3),
    defaultTaxCode: optInt(),
    fleetNo: optStr(30),
    notes: z.string().nullish(),
    sellingDealer: optStr(100),
    sellingDate: optDate(),
    addresses: z.array(addressSchema).optional(),
    contacts: z.array(contactSchema).optional(),
    profile: profileSchema.optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided to update',
  });

// ─── Search / Params ─────────────────────────────────────────────────────────
export const searchCustomerSchema = z.object({
  q:     z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
}).refine((d) => d.q || d.phone, { message: 'Provide q or phone' });

export const customerIdParamSchema = z.object({
  id: z.string().uuid('Invalid customer ID format'),
});

// ─── Types ──────────────────────────────────────────────────────────────────
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type SearchCustomerInput = z.infer<typeof searchCustomerSchema>;
export type CustomerIdParam = z.infer<typeof customerIdParamSchema>;
