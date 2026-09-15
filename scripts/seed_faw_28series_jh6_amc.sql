-- Seed Model Service Type Assignments:
--   Make          = FAW
--   Model         = 28 SERIES
--   Series (code) = JH6 28.500FT A/T T/T C/C  → model_code 18667525
--   Service Type  = AMC  ·  Categories = B / C / D
--
-- Parts reused from src/scripts/seedJH6AmcAssignments.ts.
-- Matches vehicles by model_code 18667525 (confirmed on the live FAW fleet:
-- B011773, B082262, B0229971, B011779, B121600, NEWTIPPERTRAILER).
--
-- Swapped-column convention (see model-service-types/service.ts):
--   service_type_id     column stores the B/C/D category
--   service_category_id column stores the AMC service type
--
-- Idempotent: each category is skipped if it already exists for this
-- make + model + model_code + AMC combination. Safe to re-run.
DO $$
DECLARE
  v_make  uuid;
  v_model uuid;
  v_code  varchar := '18667525';
  v_amc   uuid;
  v_b     uuid;
  v_c     uuid;
  v_d     uuid;
BEGIN
  SELECT id INTO v_make  FROM vehicle_makes  WHERE name = 'FAW';
  SELECT id INTO v_model FROM vehicle_models WHERE make_id = v_make AND name = '28 SERIES';
  SELECT id INTO v_amc   FROM service_types  WHERE code = 'AMC_SERVICE';
  SELECT id INTO v_b     FROM service_types  WHERE code = 'B_SERVICE';
  SELECT id INTO v_c     FROM service_types  WHERE code = 'C_SERVICE';
  SELECT id INTO v_d     FROM service_types  WHERE code = 'D_SERVICE';

  IF v_make IS NULL OR v_model IS NULL OR v_amc IS NULL
     OR v_b IS NULL OR v_c IS NULL OR v_d IS NULL THEN
    RAISE EXCEPTION 'Lookup failed → make=% model(28 SERIES)=% amc=% b=% c=% d=%',
      v_make, v_model, v_amc, v_b, v_c, v_d;
  END IF;

  -- ── B SERVICE ──────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM model_service_type_assignments
    WHERE make_id = v_make AND model_id = v_model AND model_code = v_code
      AND service_type_id = v_b AND service_category_id = v_amc
  ) THEN
    INSERT INTO model_service_type_assignments
      (make_id, model_id, model_code, service_type_id, service_category_id, part_code, part_name, quantity, unit_price)
    SELECT v_make, v_model, v_code, v_b, v_amc, x.pc, x.pn, x.q, x.up
    FROM (VALUES
      ('LABOUR',          'LABOUR - B SERVICE',             8,  650.00),
      ('SARL3511AA039',   'AIR DRIER FILTER ELEMENT',       1,  263.93),
      ('11090702000C00',  'AIR FILTER ELEMENT INNER / PRI', 1,  449.76),
      ('11090602000C00',  'AIR FILTER ELEMENT OUTER / SEC', 1,  1424.76),
      ('PT3406',          'ENGINE OIL DIESEL',              38, 95.90),
      ('1117050M002060AA','FUEL FILTER DIESEL',             2,  533.69),
      ('1012010M18054W',  'OIL FILTER',                     2,  397.62),
      ('101701529DM',     'OIL FILTER SPINNER/ROTARY TYPE', 1,  582.99),
      ('9971239',         'SHOP SUPPLIES',                  1,  300.00),
      ('U00153',          'GREASE CHASSIS',                 3,  195.69),
      ('11050502007',     'FUEL FILTER DIESEL WATER TRAP',  1,  1352.85)
    ) AS x(pc, pn, q, up);
    RAISE NOTICE 'B SERVICE: inserted.';
  ELSE
    RAISE NOTICE 'B SERVICE: already present — skipped.';
  END IF;

  -- ── C SERVICE ──────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM model_service_type_assignments
    WHERE make_id = v_make AND model_id = v_model AND model_code = v_code
      AND service_type_id = v_c AND service_category_id = v_amc
  ) THEN
    INSERT INTO model_service_type_assignments
      (make_id, model_id, model_code, service_type_id, service_category_id, part_code, part_name, quantity, unit_price)
    SELECT v_make, v_model, v_code, v_c, v_amc, x.pc, x.pn, x.q, x.up
    FROM (VALUES
      ('LABOUR',          'LABOUR - C SERVICE',             6,  650.00),
      ('SARL3511AA039',   'AIR DRIER FILTER ELEMENT',       1,  263.93),
      ('11090702000C00',  'AIR FILTER ELEMENT INNER / PRI', 1,  449.76),
      ('11090602000C00',  'AIR FILTER ELEMENT OUTER / SEC', 1,  1424.76),
      ('PT3406',          'ENGINE OIL DIESEL',              38, 95.90),
      ('1117050M002060AA','FUEL FILTER DIESEL',             2,  533.69),
      ('1012010M18054W',  'OIL FILTER',                     2,  397.62),
      ('101701529DM',     'OIL FILTER SPINNER/ROTARY TYPE', 1,  582.99),
      ('9971239',         'SHOP SUPPLIES',                  1,  300.00),
      ('8113010B45C00',   'AIR CONDITIONER DUST FILTER',    1,  365.46),
      ('U00153',          'GREASE CHASSIS',                 3,  195.69),
      ('11050502007',     'FUEL FILTER DIESEL WATER TRAP',  1,  1352.85)
    ) AS x(pc, pn, q, up);
    RAISE NOTICE 'C SERVICE: inserted.';
  ELSE
    RAISE NOTICE 'C SERVICE: already present — skipped.';
  END IF;

  -- ── D SERVICE ──────────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM model_service_type_assignments
    WHERE make_id = v_make AND model_id = v_model AND model_code = v_code
      AND service_type_id = v_d AND service_category_id = v_amc
  ) THEN
    INSERT INTO model_service_type_assignments
      (make_id, model_id, model_code, service_type_id, service_category_id, part_code, part_name, quantity, unit_price)
    SELECT v_make, v_model, v_code, v_d, v_amc, x.pc, x.pn, x.q, x.up
    FROM (VALUES
      ('LABOUR',          'LABOUR - MAJOR SERVICE',         12, 650.00),
      ('SARL3511AA039',   'AIR DRIER FILTER ELEMENT',       1,  263.93),
      ('P00345',          'ANTI FREEZE',                    48, 72.05),
      ('11090702000C00',  'AIR FILTER ELEMENT INNER / PRI', 1,  449.76),
      ('11090602000C00',  'AIR FILTER ELEMENT OUTER / SEC', 1,  1424.76),
      ('1023022M5002000', 'V-BELT ALTERNATOR',              1,  704.27),
      ('1023021M5002000', 'V-BELT AIR CONDITIONER',         1,  489.69),
      ('PT3406',          'ENGINE OIL DIESEL',              38, 95.90),
      ('1117050M002060A', 'FUEL FILTER DIESEL',             2,  533.69),
      ('1012010M18054W',  'OIL FILTER',                     2,  397.62),
      ('101701529DM',     'OIL FILTER SPINNER/ROTARY TYPE', 1,  582.99),
      ('P05201',          'POWERSTEERING OIL / FLUID',      4,  75.38),
      ('3408015716',      'POWERSTEERING OIL FILTER',       1,  134.20),
      ('0009971239',      'SHOP SUPPLIES (ALT)',            1,  300.00),
      ('GT5905',          'TRANSMISSION FLUID 1 LITRE',     19, 283.36),
      ('1017010AM500000', 'OIL FILTER (BYPASS)',            1,  1999.88),
      ('GT4645',          'DIFF OIL REAR',                  40, 64.74),
      ('PT6621',          'BRAKE FLUID',                    2,  114.75),
      ('8113010B45C00',   'AIR CONDITIONER DUST FILTER',    1,  365.46),
      ('U00153',          'GREASE CHASSIS',                 3,  195.69),
      ('1530002741',      'RETARDER OIL FILTER',            1,  3727.27),
      ('11050502007',     'FUEL FILTER DIESEL WATER TRAP',  1,  1352.85)
    ) AS x(pc, pn, q, up);
    RAISE NOTICE 'D SERVICE: inserted.';
  ELSE
    RAISE NOTICE 'D SERVICE: already present — skipped.';
  END IF;
END $$;

-- Verify
SELECT st.code AS category, COUNT(*) AS parts
FROM model_service_type_assignments a
JOIN service_types st ON st.id = a.service_type_id
WHERE a.model_code = '18667525'
GROUP BY st.code ORDER BY st.code;
