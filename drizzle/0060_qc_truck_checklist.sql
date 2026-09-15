-- QC-In checklist → truck Preventative-Maintenance sheet (dynamic categories).
--
-- 1) Widen qc_inspection_items.category from the qc_category enum to varchar so
--    categories can be any mechanical section. HISTORY-PRESERVING: existing rows
--    keep their text values (EXTERIOR/INTERIOR/BRAKE) and completed inspections
--    are untouched. The qc_category enum type is kept (still used by QC-Out).
-- 2) Remove the old car checklist master rows and seed the new truck checklist.
--    Master-only: past inspections snapshot their items, so this never alters
--    historical inspection records.
--
-- Idempotent & production-safe: the ALTER is a no-op if already varchar; the
-- INSERT uses ON CONFLICT (item_code) DO NOTHING so a re-run won't duplicate or
-- clobber later edits to the TODO placeholders.

ALTER TABLE "qc_inspection_items"
  ALTER COLUMN "category" TYPE varchar(100) USING "category"::text;

-- Remove the old EXTERIOR / INTERIOR / BRAKE master rows.
DELETE FROM "qc_checklist_templates"
  WHERE "category" IN ('EXTERIOR', 'INTERIOR', 'BRAKE');

-- Seed the new truck checklist (readable items + TODO placeholders for redacted rows).
INSERT INTO "qc_checklist_templates" ("category","item_code","item_label","sort_order","is_active") VALUES
  ('Engine','ENG_OIL_LEAKS','Oil Leaks',1,true),
  ('Engine','ENG_FUEL_PIPES','Fuel Pipes Condition and Leaks',2,true),
  ('Engine','TODO_3','TODO - Verify from original checklist',3,true),
  ('Engine','ENG_EXHAUST','Exhaust System',4,true),
  ('Engine','ENG_AIR_INTAKE','Air Intake System',5,true),
  ('Engine','TODO_6','TODO - Verify from original checklist',6,true),
  ('Engine','TODO_7','TODO - Verify from original checklist',7,true),
  ('Engine','TODO_8','TODO - Verify from original checklist',8,true),
  ('Engine','TODO_9','TODO - Verify from original checklist',9,true),
  ('Engine','ENG_CLAMPS_HOSES','All Clamps & Hoses',10,true),
  ('Engine','ENG_MOUNTINGS','Engine Mountings',11,true),
  ('Cooling System','TODO_12','TODO - Verify from original checklist',12,true),
  ('Cooling System','TODO_13','TODO - Verify from original checklist',13,true),
  ('Cooling System','COOL_HEADER_TANK','Header Tank and Cap',14,true),
  ('Cooling System','COOL_FAN_HUB','Fan Hub, Blades and Cowl',15,true),
  ('Cooling System','COOL_RADIATOR','Radiator / Intercooler Condition',16,true),
  ('Rear of Cab','CAB_BATTERY_BOX','Battery Box and Supports',17,true),
  ('Rear of Cab','TODO_18','TODO - Verify from original checklist',18,true),
  ('Rear of Cab','CAB_JACK','Cab Jack System',19,true),
  ('Rear of Cab','CAB_AIR_DRIER','Air Drier System',20,true),
  ('Rear of Cab','CAB_CAT_WALK','Cat Walk',21,true),
  ('Steering System','STR_DROP_ARM_NUT','Drop Arm Nut',22,true),
  ('Steering System','STR_TIE_ROD_ENDS','Tie Rod Ends',23,true),
  ('Steering System','STR_DRAG_LINK','Drag Link Joints',24,true),
  ('Steering System','TODO_25','TODO - Verify from original checklist',25,true),
  ('Steering System','STR_PS_PIPES','Power Steering Pipes and Connections',26,true),
  ('Front Axle & Suspension','FA_HUB_OIL','Hub Oil (L/R)',27,true),
  ('Front Axle & Suspension','FA_BRAKE_BOOSTERS','Brake Boosters and Pipes (L/R)',28,true),
  ('Front Axle & Suspension','FA_U_BOLTS','U Bolts (L/R)',29,true),
  ('Front Axle & Suspension','FA_SPRINGS','Springs (L/R)',30,true),
  ('Front Axle & Suspension','FA_SPRING_HANGER','Spring Hanger & Pins (L/R)',31,true),
  ('Front Axle & Suspension','FA_SHOCKS','Shocks & Mountings (L/R)',32,true),
  ('Front Axle & Suspension','FA_KING_PIN','King Pin Play (L/R)',33,true),
  ('Front Axle & Suspension','TODO_34','TODO - Verify from original checklist',34,true),
  ('Front Axle & Suspension','FA_BRAKE_LINING','Brake Lining/Disc Thickness (L/R)',35,true),
  ('Gearbox','TODO_36','TODO - Verify from original checklist',36,true),
  ('Gearbox','TODO_37','TODO - Verify from original checklist',37,true),
  ('Gearbox','TODO_38','TODO - Verify from original checklist',38,true),
  ('Gearbox','GBX_BELL_HOUSING','Bell Housing Bolts',39,true),
  ('Gearbox','GBX_OIL_LEAKS','Oil Leaks',40,true),
  ('Gearbox','GBX_OUTPUT_SHAFT','Output Shaft Play',41,true),
  ('Gearbox','TODO_42','TODO - Verify from original checklist',42,true),
  ('Gearbox','TODO_43','TODO - Verify from original checklist',43,true),
  ('Gearbox','TODO_44','TODO - Verify from original checklist',44,true),
  ('Propshaft','TODO_45','TODO - Verify from original checklist',45,true),
  ('Propshaft','PS_SLIP_JOINTS','Slip Joints (F/R)',46,true),
  ('Propshaft','PS_U_JOINTS','U Joints (F/R)',47,true),
  ('Propshaft','TODO_48','TODO - Verify from original checklist',48,true),
  ('Forward Rear Axle & Diff','TODO_49','TODO - Verify from original checklist',49,true),
  ('Forward Rear Axle & Diff','FRAD_INPUT_SHAFT','Input Shaft Play',50,true),
  ('Forward Rear Axle & Diff','FRAD_OUTPUT_SHAFT','Output Shaft Play',51,true),
  ('Forward Rear Axle & Diff','FRAD_OIL_LEAKS','Oil Leaks',52,true),
  ('Forward Rear Axle & Diff','FRAD_SHOCKS','Shocks & Mountings (L/R)',53,true),
  ('Forward Rear Axle & Diff','FRAD_BRAKE_BOOSTERS','Brake Boosters and Pipes (L/R)',54,true),
  ('Forward Rear Axle & Diff','FRAD_S_CAM','"S" Cam System (L/R)',55,true),
  ('Forward Rear Axle & Diff','TODO_56','TODO - Verify from original checklist',56,true),
  ('Forward Rear Axle & Diff','TODO_57','TODO - Verify from original checklist',57,true),
  ('Forward Rear Axle & Diff','FRAD_TORQUE_RODS','Torque Rods (L/R)',58,true),
  ('Forward Rear Axle & Diff','FRAD_SPRINGS_AIRBAGS','Springs / Air Bags (L/R)',59,true),
  ('Forward Rear Axle & Diff','FRAD_LINING','Lining/Disc Thickness (L/R)',60,true),
  ('Rear Rear Axle & Diff / Tag Axle','RRAD_INPUT_SHAFT','Input Shaft Play',61,true),
  ('Rear Rear Axle & Diff / Tag Axle','RRAD_OIL_LEAKS','Oil Leaks',62,true),
  ('Rear Rear Axle & Diff / Tag Axle','TODO_63','TODO - Verify from original checklist',63,true),
  ('Rear Rear Axle & Diff / Tag Axle','RRAD_SHOCKS','Shocks & Mountings (L/R)',64,true),
  ('Rear Rear Axle & Diff / Tag Axle','RRAD_BRAKE_BOOSTERS','Brake Boosters and Pipes (L/R)',65,true),
  ('Rear Rear Axle & Diff / Tag Axle','RRAD_S_CAM','"S" Cam Systems (L/R)',66,true),
  ('Rear Rear Axle & Diff / Tag Axle','TODO_67','TODO - Verify from original checklist',67,true),
  ('Rear Rear Axle & Diff / Tag Axle','RRAD_TORQUE_RODS','Torque Rods (L/R)',68,true),
  ('Rear Rear Axle & Diff / Tag Axle','RRAD_SPRINGS_AIRBAGS','Springs / Air Bags (L/R)',69,true),
  ('Rear Rear Axle & Diff / Tag Axle','TODO_70','TODO - Verify from original checklist',70,true),
  ('Rear Rear Axle & Diff / Tag Axle','TODO_71','TODO - Verify from original checklist',71,true),
  ('Rear Rear Axle & Diff / Tag Axle','TODO_72','TODO - Verify from original checklist',72,true),
  ('Rear Rear Axle & Diff / Tag Axle','RRAD_LINING','Lining/Disc Thickness (L/R)',73,true),
  ('5th Wheel','FW_MOUNTING_BOLTS','Mounting Bolts',74,true),
  ('5th Wheel','TODO_75','TODO - Verify from original checklist',75,true),
  ('5th Wheel','TODO_76','TODO - Verify from original checklist',76,true),
  ('5th Wheel','TODO_77','TODO - Verify from original checklist',77,true),
  ('Air System','TODO_78','TODO - Verify from original checklist',78,true),
  ('Air System','TODO_79','TODO - Verify from original checklist',79,true),
  ('Air System','TODO_80','TODO - Verify from original checklist',80,true),
  ('Air System','AIR_DRAIN_TANKS','Drain Air Tanks',81,true),
  ('Air System','AIR_PIPES_CLAMPS','Pipes, Clamps & Air Leaks',82,true),
  ('Other','OTH_FUEL_TANK_BRACKETS','Fuel Tank Brackets',83,true),
  ('Other','TODO_84','TODO - Verify from original checklist',84,true),
  ('Other','TODO_85','TODO - Verify from original checklist',85,true),
  ('Other','TODO_86','TODO - Verify from original checklist',86,true),
  ('Other','TODO_87','TODO - Verify from original checklist',87,true),
  ('Electrical','ELEC_INSTRUMENT_CLUSTER','Check Instrument Cluster',88,true),
  ('Electrical','ELEC_ALL_LIGHTS','Check All Lights',89,true)
ON CONFLICT ("item_code") DO NOTHING;
