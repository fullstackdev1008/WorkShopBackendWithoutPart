import { describe, it, expect } from 'vitest';
import { mapEvolveVehicleFields } from '../evolveCustomerPersist.service';

// Evolve <Vehicles>/<RowDetails> node exactly as returned for reg QWE313GP
// (test customer 10EC0003276) in the real IRM_Customer_VehicleLookup response.
const evolveVehicle = {
  RegistrationNo: 'QWE313GP',
  VehVinNumber: 'TEST313',
  EngineNumber: '',
  ModelCode: '28515455',
  Make: 'IVECO',
  Series: 'DAILY',
  ModelDescription: '50C15HE5A8 V 22+1 B/S A/T',
  RegistrationDate: '',
  RegistrationYear: '',
  SellingDate: '',
  SellingDealer: '',
  Colour: '',
};

describe('mapEvolveVehicleFields — Series is the model (not ModelDescription)', () => {
  const mapped = mapEvolveVehicleFields(evolveVehicle);

  it('maps Make → brand', () => {
    expect(mapped.brand).toBe('IVECO');
  });

  it('maps Series → model (the bug fix: was ModelDescription)', () => {
    // Frontend "Model" dropdown lists Series names (DAILY/STRALIS/…). Storing
    // the Series here lets the edit-prefill cascade match the series, which in
    // turn loads the Model Code dropdown.
    expect(mapped.model).toBe('DAILY');
  });

  it('keeps Series verbatim in seriesDescription', () => {
    expect(mapped.seriesDescription).toBe('DAILY');
  });

  it('keeps the variant text in modelDescription', () => {
    expect(mapped.modelDescription).toBe('50C15HE5A8 V 22+1 B/S A/T');
  });

  it('keeps the numeric Evolve code in modelCode (what the Model Code picker matches on)', () => {
    // The picker matches saved modelCode against option.code and DISPLAYS
    // option.description → so the field shows "50C15HE5A8 V 22+1 B/S A/T".
    expect(mapped.modelCode).toBe('28515455');
  });
});

describe('mapEvolveVehicleFields — fallbacks & regressions', () => {
  it('falls back to ModelDescription for model when Series is absent', () => {
    const m = mapEvolveVehicleFields({ Make: 'IVECO', ModelDescription: 'SOME VARIANT' });
    expect(m.model).toBe('SOME VARIANT');
  });

  it('uses UNKNOWN when neither Series nor ModelDescription is present', () => {
    const m = mapEvolveVehicleFields({ Make: 'IVECO' });
    expect(m.model).toBe('UNKNOWN');
  });

  it('uses UNKNOWN brand when Make is absent', () => {
    const m = mapEvolveVehicleFields({ Series: 'DAILY' });
    expect(m.brand).toBe('UNKNOWN');
    expect(m.model).toBe('DAILY');
  });

  it('does not confuse model with modelCode (they are distinct fields)', () => {
    const m = mapEvolveVehicleFields(evolveVehicle);
    expect(m.model).not.toBe(m.modelCode);
    expect(m.model).not.toBe(m.modelDescription);
  });
});
