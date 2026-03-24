-- Enable trigram similarity for duplicate detection
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index to accelerate similarity() lookups on company+role
CREATE INDEX idx_application_trgm_company_role
    ON "Application" USING gin ((lower(company || ' ' || role)) gin_trgm_ops);
