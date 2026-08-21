-- `abandoned`: Nexus gave up on a reservation it can never settle.
--
-- A submission whose response was lost leaves no upstream run id, so Nexus can
-- neither look the run up nor observe it end. The row must eventually stop
-- holding the conversation's single active slot, but calling it `failed` would
-- assert an upstream outcome Nexus never saw. `abandoned` says what actually
-- happened and stays terminal, so the partial unique index frees the slot.
--
-- No schema change is required: status is a text column, and the active-run
-- index in 20260819170000_career_ops_active_run_invariant enumerates only the
-- non-terminal statuses, which this is not. This migration exists so the
-- history records the new value and its meaning.
--
-- Verify the index still excludes it:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'CareerOpsRun_threadId_active_key'
      AND indexdef LIKE '%abandoned%'
  ) THEN
    RAISE EXCEPTION 'abandoned must stay outside the active-run index';
  END IF;
END $$;
