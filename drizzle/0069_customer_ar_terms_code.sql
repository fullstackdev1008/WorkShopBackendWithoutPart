-- customer_ar.terms_code — the only Accounts Receivable field from Evolve's
-- Customer Maintenance contract that had no local storage.
--
-- 04a_CustomerMaintenance_Request.xml carries <TermsCode>30</TermsCode> inside
-- <AccountsReceivable>, and 36b_GetARAccounts_Response returns the same value
-- back as <Terms>30</Terms>. Every other field in that block already had a
-- home: ar_account_type, ar_account_number, credit_limit_amount, stop_credit
-- and inactive_account on this table; currency_code and default_tax_code on
-- customers (the read contract returns those two inside <CustomerDetail>, which
-- is why they live there — see customerEvolveSync.service.ts for the mapping).
--
-- TYPE — varchar(10), not an integer, for two reasons:
--   1. It is a CODE, not a quantity. Nothing adds or compares terms codes, and
--      every other Evolve code on this table (ar_account_type) and on customers
--      (currency_code, language, gender) is stored as varchar.
--   2. An integer column cannot represent a zero-padded code. That is exactly
--      the trap default_tax_code already sits in: it is integer(1) locally while
--      the contract sample shows '01'. Using varchar here keeps whatever Evolve
--      sends round-trippable without a padding rule.
--
-- Nullable with no default: dealer terms are configuration, not something this
-- migration may invent. A customer without one simply has none, and the Evolve
-- payload builder omits the element rather than sending a blank.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "customer_ar"
  ADD COLUMN IF NOT EXISTS "terms_code" varchar(10);
