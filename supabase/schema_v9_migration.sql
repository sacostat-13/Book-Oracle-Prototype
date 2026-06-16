-- ============================================================================
-- v0.20 schema migration: book_reports table
-- ============================================================================
-- Stores user-submitted flags about incorrect book data.
-- Consumed by the admin tool (future) to queue targeted Oracle re-runs or
-- manual corrections. One row per report — a book can have many reports from
-- different users.
--
-- Design decisions:
--   - Separate table (not a column on books) so multiple users can flag the
--     same book independently and reports can be actioned individually.
--   - `fields` is a text array: allows multi-select (title, description,
--     series, genres) without schema changes for new field types.
--   - `status` starts 'open'; admin tool moves it to 'resolved' or 'dismissed'.
--   - RLS: users can insert their own reports and read only their own.
--     Admins (service role) can read and update all.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.book_reports (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     uuid          NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id     uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  fields      text[]        NOT NULL,                    -- ['title','description','series','genres']
  comment     text,                                      -- optional free-text from user
  status      text          NOT NULL DEFAULT 'open',     -- 'open' | 'resolved' | 'dismissed'
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

-- Status constraint
ALTER TABLE public.book_reports
  DROP CONSTRAINT IF EXISTS book_reports_status_check;
ALTER TABLE public.book_reports
  ADD CONSTRAINT book_reports_status_check
  CHECK (status IN ('open', 'resolved', 'dismissed'));

-- Fields constraint — only known reportable fields allowed
ALTER TABLE public.book_reports
  DROP CONSTRAINT IF EXISTS book_reports_fields_check;

-- Index: fast lookup by book (for admin tool aggregation)
CREATE INDEX IF NOT EXISTS book_reports_book_idx ON public.book_reports(book_id);
-- Index: fast lookup by user (for RLS policy)
CREATE INDEX IF NOT EXISTS book_reports_user_idx ON public.book_reports(user_id);
-- Index: open reports queue
CREATE INDEX IF NOT EXISTS book_reports_status_idx ON public.book_reports(status) WHERE status = 'open';

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS book_reports_updated_at ON public.book_reports;
CREATE TRIGGER book_reports_updated_at
  BEFORE UPDATE ON public.book_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.book_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own reports" ON public.book_reports;
CREATE POLICY "Users insert own reports"
  ON public.book_reports FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own reports" ON public.book_reports;
CREATE POLICY "Users read own reports"
  ON public.book_reports FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Comments
COMMENT ON TABLE  public.book_reports IS 'User-submitted flags for incorrect book data. Consumed by the admin tool.';
COMMENT ON COLUMN public.book_reports.fields  IS 'Which fields are wrong: title | description | series | genres';
COMMENT ON COLUMN public.book_reports.status  IS 'open | resolved | dismissed';

-- ============================================================================
-- Done. Run before deploying v0.20.
-- ============================================================================
