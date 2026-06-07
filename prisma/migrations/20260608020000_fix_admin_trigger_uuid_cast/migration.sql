-- Fix the admin sync trigger. public."User".id is a text column (Prisma
-- String without @db.Uuid), but auth.users.id is uuid. The previous
-- trigger did `WHERE id = NEW.id` which Postgres rejects as
-- "operator does not exist: uuid = text". Cast NEW.id to uuid to match.
--
-- The provisioning trigger (handle_new_user) inserts the other way and
-- works because Postgres implicitly casts uuid -> text. Update it too
-- for symmetry — explicit casts in both directions.

CREATE OR REPLACE FUNCTION public.sync_admin_metadata()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."isAdmin" IS DISTINCT FROM OLD."isAdmin" THEN
    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('isAdmin', NEW."isAdmin")
    WHERE id = NEW.id::uuid;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."User" (id, email, nickname, emoji, "isAdmin")
  VALUES (NEW.id::text, NEW.email, '', '⚽', false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
