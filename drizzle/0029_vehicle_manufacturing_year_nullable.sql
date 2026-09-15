-- manufacturing_year was NOT NULL, which forced the Evolve-persist path to
-- invent a value (current year) when Evolve sent no RegistrationYear. Make it
-- nullable so we can store the real year or nothing — never a fabricated one.

ALTER TABLE "vehicles" ALTER COLUMN "manufacturing_year" DROP NOT NULL;
