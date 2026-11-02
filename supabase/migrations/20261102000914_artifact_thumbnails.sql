alter table public.artifacts
  add column thumb_path text,
  add constraint artifacts_thumb_path_check
    check (thumb_path is null or thumb_path = user_id::text || '/' || id || '.jpg');

update storage.buckets
   set allowed_mime_types = array['text/html', 'application/pdf', 'image/jpeg']
 where id = 'artifacts';
