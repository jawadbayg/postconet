-- Local folder/request sort keys use Date.now() (ms). integer overflows; bigint does not.
alter table public.projects alter column sort_order type bigint;
alter table public.folders alter column sort_order type bigint;
alter table public.requests alter column sort_order type bigint;
