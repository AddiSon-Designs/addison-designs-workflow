-- Shop inventory schema, applied through migration add_shop_inventory.
create table public.shop_inventory (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 category text not null check (category in ('caps','apparel','thread')),
 brand text not null default '',
 model text not null default '',
 color text not null,
 size text not null default '',
 length text not null default '',
 quantity integer not null default 0 check (quantity >= 0),
 updated_at timestamptz not null default now()
);
create index shop_inventory_org_category_idx on public.shop_inventory(organization_id,category);
alter table public.shop_inventory enable row level security;
create policy "Shop members read inventory" on public.shop_inventory for select to authenticated using (public.is_org_member(organization_id));
create policy "Shop members add inventory" on public.shop_inventory for insert to authenticated with check (public.is_org_member(organization_id));
create policy "Shop members update inventory" on public.shop_inventory for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "Shop admins delete inventory" on public.shop_inventory for delete to authenticated using (public.is_org_admin(organization_id));
grant select,insert,update,delete on public.shop_inventory to authenticated;