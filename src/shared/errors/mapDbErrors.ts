// ─── PostgreSQL Constraint Name → User-Friendly Message ──────────────────────
const PG_CONSTRAINT_MESSAGES: Record<string, string> = {
  uq_vehicles_vin: 'A vehicle with this VIN already exists',
  uq_customers_crm_and_sequence:
    'A customer with this CRM reference and sequence ID already exists',
  uq_vehicle_accessory:
    'This accessory code already exists for the vehicle',
  uq_customer_contact_type_per_customer:
    'This contact type already exists for the customer',
  uq_qc_inspection_item:
    'This inspection item already exists for the inspection',
  uq_vehicle_makes_name: 'This vehicle make already exists',
  uq_vehicle_model_per_make: 'This model already exists for the selected make',
  uq_users_email: 'A user with this email already exists',
  uq_users_username: 'A user with this username already exists',
  uq_roles_slug: 'A role with this slug already exists',
  uq_permissions_role_resource_action: 'This permission already exists for the role',
};

export function getUniqueConstraintMessage(error: any): string {
  const constraint: string = error.constraint || '';
  if (PG_CONSTRAINT_MESSAGES[constraint]) {
    return PG_CONSTRAINT_MESSAGES[constraint];
  }

  const detail: string = error.detail || '';
  if (detail.includes('vin')) return 'VIN already exists';
  if (detail.includes('crm_reference_no'))
    return 'CRM reference already exists';
  if (detail.includes('accessory_code'))
    return 'Accessory code already exists for this vehicle';

  return 'A record with this value already exists';
}
