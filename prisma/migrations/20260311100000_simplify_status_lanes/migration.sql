-- Consolidate removed status lanes into remaining ones
UPDATE "Application" SET status = 'applied' WHERE status IN ('waiting', 'draft');
UPDATE "Application" SET status = 'rejected' WHERE status = 'ghost';
