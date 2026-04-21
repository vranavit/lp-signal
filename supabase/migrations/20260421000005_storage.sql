-- Storage bucket for ingested PDFs (board minutes, press releases, etc.)
-- Private bucket — only the service-role key (server) can read/write.
-- Signed URLs are used for in-app linking.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = excluded.public;
