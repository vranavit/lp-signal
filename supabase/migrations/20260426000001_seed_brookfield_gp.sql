-- Day 6: seed Brookfield into gps. Additive; on-conflict no-op if already
-- present.

insert into public.gps (name, homepage_url, press_releases_url)
values (
  'Brookfield',
  'https://bam.brookfield.com',
  'https://bam.brookfield.com/press-releases'
)
on conflict do nothing;
