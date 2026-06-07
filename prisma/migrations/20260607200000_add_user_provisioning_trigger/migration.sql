-- Auto-provision a public.User row when a new auth.users row is created.
-- Idempotent (ON CONFLICT) so re-firing the trigger is safe.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."User" (id, email, nickname, emoji, "isAdmin")
  VALUES (NEW.id, NEW.email, '', '⚽', false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
