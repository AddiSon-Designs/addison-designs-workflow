
create table public.order_payment_records(
 organization_id uuid not null references public.organizations(id) on delete cascade,
 order_id uuid not null,
 payment_year integer not null,
 sheet_row integer not null check(sheet_row>=2),
 payment_method text not null,
 snapshot jsonb not null,
 export_status text not null default 'pending' check(export_status in ('pending','synced')),
 spreadsheet_id text,
 export_error text,
 updated_at timestamptz not null default now(),
 primary key(organization_id,order_id),
 unique(organization_id,payment_year,sheet_row)
);
alter table public.order_payment_records enable row level security;
create policy "Members read payments" on public.order_payment_records for select to authenticated using(public.is_org_member(organization_id));
create policy "Admins manage payments" on public.order_payment_records for all to authenticated using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id));
grant select,insert,update on public.order_payment_records to authenticated;
create table public.annual_payment_reports(
 organization_id uuid not null references public.organizations(id) on delete cascade,
 payment_year integer not null,
 spreadsheet_id text not null,
 primary key(organization_id,payment_year)
);
alter table public.annual_payment_reports enable row level security;
create policy "Members read payment reports" on public.annual_payment_reports for select to authenticated using(public.is_org_member(organization_id));
create policy "Admins manage payment reports" on public.annual_payment_reports for all to authenticated using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id));
grant select,insert,update on public.annual_payment_reports to authenticated;
create or replace function public.record_order_payment(p_order_id uuid,p_payment_method text default null,p_mark_paid boolean default true) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare org uuid; inv jsonb; meta jsonb; job record; paid_date text; method text; yr integer; row_no integer; result public.order_payment_records%rowtype; snap jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in before recording payment'; end if;
 select organization_id into org from public.jobs where source_job_id is null and custom_fields#>>'{addisonOrder,orderId}'=p_order_id::text limit 1;
 if org is null or not public.is_org_admin(org) then raise exception 'Administrator access is required to record payment'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-order:'||org::text||p_order_id::text,0));
 for job in select * from public.jobs where organization_id=org and source_job_id is null and custom_fields#>>'{addisonOrder,orderId}'=p_order_id::text order by id for update loop
  if inv is null and job.custom_fields#>>'{addisonOrder,invoice,number}' is not null then meta:=job.custom_fields->'addisonOrder';inv:=meta->'invoice'; end if;
 end loop;
 if inv is null or inv->>'status' not in ('Invoiced','Paid') then raise exception 'Invoice must be marked invoiced before payment'; end if;
 if not p_mark_paid and inv->>'status'<>'Paid' then raise exception 'Only paid invoices can be added to the payment report'; end if;
 method:=coalesce(nullif(p_payment_method,''),nullif(inv->>'paymentMethod',''),'Not recorded');
 if p_mark_paid and method not in ('Check','Cash','Direct deposit','Venmo','PayPal','Cash App','Square') then raise exception 'Select a payment method before marking paid'; end if;
 paid_date:=coalesce(nullif(inv->>'paidAt',''),to_char(now() at time zone 'America/Chicago','YYYY-MM-DD'));
 yr:=extract(year from paid_date::date)::integer;
 perform pg_advisory_xact_lock(hashtextextended('payment-year:'||org::text||yr::text,0));
 if p_mark_paid then
  inv:=inv||jsonb_build_object('status','Paid','paymentMethod',method,'paidAt',paid_date);
  update public.jobs set custom_fields=custom_fields||jsonb_build_object('addisonOrder',coalesce(custom_fields->'addisonOrder','{}')||jsonb_build_object('invoice',inv,'archived',true,'paidAt',paid_date)),invoice_status='Paid',updated_by=auth.uid()
  where organization_id=org and (custom_fields#>>'{addisonOrder,orderId}'=p_order_id::text or source_job_id in(select id from public.jobs where organization_id=org and source_job_id is null and custom_fields#>>'{addisonOrder,orderId}'=p_order_id::text));
 end if;
 snap:=jsonb_build_object('invoice',inv,'customer',coalesce(meta->>'customer',inv->>'customer',''),'contact',coalesce(meta->>'contact',inv->>'contact',''),'phone',coalesce(meta->>'phone',inv->>'phone',''),'email',coalesce(meta->>'email',inv->>'email',''),'invoiceEmail',coalesce(meta->>'invoiceEmail',inv->>'invoiceEmail',inv->>'email',''),'orderNumber',coalesce(meta->>'orderNumber',inv->>'orderNumber',''),'paymentDate',paid_date);
 select * into result from public.order_payment_records where organization_id=org and order_id=p_order_id;
 if result.order_id is null then
  select coalesce(max(sheet_row),1)+1 into row_no from public.order_payment_records where organization_id=org and payment_year=yr;
  insert into public.order_payment_records(organization_id,order_id,payment_year,sheet_row,payment_method,snapshot)
  values(org,p_order_id,yr,row_no,method,snap) returning * into result;
 elsif result.snapshot is distinct from snap or result.payment_method<>method then
  update public.order_payment_records set payment_method=method,snapshot=snap,export_status='pending',export_error=null,updated_at=now() where organization_id=org and order_id=p_order_id returning * into result;
 end if;
 return to_jsonb(result);
end $$;
revoke all on function public.record_order_payment(uuid,text,boolean) from public,anon;
grant execute on function public.record_order_payment(uuid,text,boolean) to authenticated;

alter table public.order_payment_records add column export_lease_until timestamptz not null default '1970-01-01', add column export_lease_token uuid;
alter table public.annual_payment_reports add column create_lease_until timestamptz not null default '1970-01-01', add column create_lease_token uuid;
create or replace function public.require_invoice_payment_method() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if (new.custom_fields#>>'{addisonOrder,invoice,status}'='Paid' or new.invoice_status='Paid')
 and (tg_op='INSERT' or (coalesce(old.custom_fields#>>'{addisonOrder,invoice,status}','')<>'Paid' and old.invoice_status<>'Paid'))
 and coalesce(new.custom_fields#>>'{addisonOrder,invoice,paymentMethod}','') not in ('Check','Cash','Direct deposit','Venmo','PayPal','Cash App','Square')
 then raise exception 'Select a payment method before marking paid'; end if;
 return new;
end $$;
revoke all on function public.require_invoice_payment_method() from public,anon;
-- AFTER avoids treating existing paid rows in ON CONFLICT upserts as new payments.
create trigger require_invoice_payment_method after insert or update on public.jobs for each row execute function public.require_invoice_payment_method();
grant select,insert,update on public.order_payment_records,public.annual_payment_reports to service_role;