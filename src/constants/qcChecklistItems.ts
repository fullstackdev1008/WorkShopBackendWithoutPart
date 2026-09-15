export interface QcChecklistTemplate {
  category: 'EXTERIOR' | 'INTERIOR' | 'BRAKE';
  itemCode: string;
  itemLabel: string;
  sortOrder: number;
}

export const QC_CHECKLIST_ITEMS: QcChecklistTemplate[] = [
  // ─── EXTERIOR (Step 1) ──────────────────────────────
  { category: 'EXTERIOR', itemCode: 'EXT_BODY_PANELS',  itemLabel: 'Body Panels Condition',      sortOrder: 1 },
  { category: 'EXTERIOR', itemCode: 'EXT_PAINT',        itemLabel: 'Paint condition & scratches', sortOrder: 2 },
  { category: 'EXTERIOR', itemCode: 'EXT_WINDSHIELD',   itemLabel: 'Windshield & windows',       sortOrder: 3 },
  { category: 'EXTERIOR', itemCode: 'EXT_HEADLIGHTS',   itemLabel: 'Headlights & tail lights',   sortOrder: 4 },
  { category: 'EXTERIOR', itemCode: 'EXT_TYRES',        itemLabel: 'Tyres & wheel condition',    sortOrder: 5 },
  { category: 'EXTERIOR', itemCode: 'EXT_SIDE_MIRRORS', itemLabel: 'Side mirrors',               sortOrder: 6 },

  // ─── INTERIOR (Step 2) ──────────────────────────────
  { category: 'INTERIOR', itemCode: 'INT_DASHBOARD',    itemLabel: 'Dashboard condition',         sortOrder: 1 },
  { category: 'INTERIOR', itemCode: 'INT_SEATS',        itemLabel: 'Seat condition',              sortOrder: 2 },
  { category: 'INTERIOR', itemCode: 'INT_AC_VENTS',     itemLabel: 'AC vents & controls',         sortOrder: 3 },
  { category: 'INTERIOR', itemCode: 'INT_STEERING',     itemLabel: 'Steering & gear lever',       sortOrder: 4 },
  { category: 'INTERIOR', itemCode: 'INT_INFOTAINMENT', itemLabel: 'Infotainment system',         sortOrder: 5 },
  { category: 'INTERIOR', itemCode: 'INT_ENGINE_BAY',   itemLabel: 'Engine bay inspection',       sortOrder: 6 },

  // ─── BRAKE (Step 3) ────────────────────────────────
  { category: 'BRAKE', itemCode: 'BRK_PEDAL_RESPONSE',  itemLabel: 'Brake pedal response',        sortOrder: 1 },
  { category: 'BRAKE', itemCode: 'BRK_HANDBRAKE',       itemLabel: 'Handbrake function',          sortOrder: 2 },
  { category: 'BRAKE', itemCode: 'BRK_FLUID_LEVEL',     itemLabel: 'Brake fluid level',           sortOrder: 3 },
  { category: 'BRAKE', itemCode: 'BRK_PAD_WEAR',        itemLabel: 'Brake pad wear',              sortOrder: 4 },
];
