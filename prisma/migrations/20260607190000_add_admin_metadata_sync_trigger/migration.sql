-- Sync User.isAdmin to auth.users.raw_user_meta_data so the middleware
-- can pre-filter admin routes from the JWT without hitting the database.
CREATE OR REPLACE FUNCTION public.sync_admin_metadata()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."isAdmin" IS DISTINCT FROM OLD."isAdmin" THEN
    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('isAdmin', NEW."isAdmin")
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_admin_changed
  AFTER UPDATE OF "isAdmin" ON "User"
  FOR EACH ROW EXECUTE FUNCTION public.sync_admin_metadata();
