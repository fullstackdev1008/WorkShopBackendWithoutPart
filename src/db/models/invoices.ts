import { pgTable, uuid, varchar, text, timestamp, numeric, integer, boolean, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { jobCards } from './jobCards';
import { vehicleCheckIns } from './vehicleCheckIns';
import { vehicles } from './vehicles';
import { customers } from './customers';
import { users } from './users';
import { invoiceStatusEnum, invoiceLineSourceEnum, paymentModeEnum } from './enums';

// One invoice per non-void run of a job card. Re-issue allowed only after VOID.
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceNo: varchar('invoice_no', { length: 30 }).notNull().unique(),
    jobCardId: uuid('job_card_id').notNull().references(() => jobCards.id, { onDelete: 'restrict' }),
    checkInId: uuid('check_in_id').references(() => vehicleCheckIns.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    status: invoiceStatusEnum('status').notNull().default('DRAFT'),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
    taxLabel: varchar('tax_label', { length: 20 }).notNull().default('GST'),
    taxPercentage: numeric('tax_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    currencyCode: varchar('currency_code', { length: 3 }).notNull().default('ZAR'),
    notes: text('notes'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    generatedBy: uuid('generated_by').references(() => users.id, { onDelete: 'set null' }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jcIdx: index('idx_invoices_job_card').on(t.jobCardId),
    checkInIdx: index('idx_invoices_check_in').on(t.checkInId),
    statusIdx: index('idx_invoices_status').on(t.status),
    customerIdx: index('idx_invoices_customer').on(t.customerId),
  }),
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    source: invoiceLineSourceEnum('source').notNull(),
    refId: uuid('ref_id'),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull().default('0'),
    isWarranty: boolean('is_warranty').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    invIdx: index('idx_invoice_lines_invoice').on(t.invoiceId),
  }),
);

export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    mode: paymentModeEnum('mode').notNull(),
    referenceNo: varchar('reference_no', { length: 120 }),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    capturedBy: uuid('captured_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    invIdx: index('idx_invoice_payments_invoice').on(t.invoiceId),
  }),
);

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  jobCard: one(jobCards, { fields: [invoices.jobCardId], references: [jobCards.id] }),
  checkIn: one(vehicleCheckIns, { fields: [invoices.checkInId], references: [vehicleCheckIns.id] }),
  vehicle: one(vehicles, { fields: [invoices.vehicleId], references: [vehicles.id] }),
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  lines: many(invoiceLines),
  payments: many(invoicePayments),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
}));

export const invoicePaymentsRelations = relations(invoicePayments, ({ one }) => ({
  invoice: one(invoices, { fields: [invoicePayments.invoiceId], references: [invoices.id] }),
}));

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type InvoicePayment = typeof invoicePayments.$inferSelect;
