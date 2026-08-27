-- Patch (spec-3-4 review 2026-08-27, P-L2-22 / BH-02): add an
-- index on Alert(ruleId) so Story 3.5's "list alerts grouped by
-- rule" query (planned for the alert manager seam) is not a full
-- table scan as the Alert table grows. The Alert_debounce
-- migration introduced the table without this index because
-- the FK-only access pattern at the time was `findOpenAlert`
-- (deviceId, metric, severity), which is already covered by the
-- partial unique index `Alert_open_unique_idx`. After Story
-- 3.5 lands the ruleId-based queries, the existing index is
-- insufficient and Postgres reverts to a seq scan. Pre-creating
-- the index now is a forward-only, additive change.

CREATE INDEX "Alert_ruleId_idx" ON "Alert" ("ruleId");
