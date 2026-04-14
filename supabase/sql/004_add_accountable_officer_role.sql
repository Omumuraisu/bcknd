-- Add Accountable Officer as a distinct AdminRole enum value.
-- Safe to run multiple times.

do $$
begin
  alter type public."AdminRole" add value if not exists 'Accountable_Officer';
exception
  when duplicate_object then
    null;
end $$;
