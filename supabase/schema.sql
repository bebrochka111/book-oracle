-- Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  author text not null default '',
  storage_path text not null unique,
  page_count integer not null check (page_count > 0),
  status text not null default 'processing' check (status in ('processing','ready')),
  created_at timestamptz not null default now()
);
create table if not exists public.sentences (
  book_id uuid not null references public.books(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  sentence_number integer not null check (sentence_number > 0),
  content text not null,
  primary key (book_id, page_number, sentence_number)
);
create index if not exists idx_books_ready on public.books(status, created_at desc);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.admin_users enable row level security;
alter table public.books enable row level security;
alter table public.sentences enable row level security;

create policy "Public can list ready books" on public.books for select to anon, authenticated
using (status = 'ready' or public.is_admin());
create policy "Admins insert books" on public.books for insert to authenticated
with check (public.is_admin() and status = 'processing');
create policy "Admins update books" on public.books for update to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete books" on public.books for delete to authenticated
using (public.is_admin());

create policy "Public can read ready book sentences" on public.sentences for select to anon, authenticated
using (exists (select 1 from public.books b where b.id = book_id and b.status = 'ready') or public.is_admin());
create policy "Admins insert sentences" on public.sentences for insert to authenticated
with check (public.is_admin() and exists (select 1 from public.books b where b.id = book_id and b.status = 'processing'));
create policy "Admins delete sentences" on public.sentences for delete to authenticated
using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('books', 'books', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf'];

create policy "Admins upload PDF" on storage.objects for insert to authenticated
with check (bucket_id = 'books' and public.is_admin());
create policy "Admins delete PDF" on storage.objects for delete to authenticated
using (bucket_id = 'books' and public.is_admin());
create policy "Admins view PDF" on storage.objects for select to authenticated
using (bucket_id = 'books' and public.is_admin());

-- After creating your admin user in Authentication > Users, run separately:
-- insert into public.admin_users (user_id) values ('PASTE_AUTH_USER_UUID');
