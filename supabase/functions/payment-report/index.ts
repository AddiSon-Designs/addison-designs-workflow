export const SALES_CATEGORIES=['Apparel · Embroidery','Apparel · Screen Print','Apparel · DTF','Caps · Leather','Caps · Embroidery','Caps · UV DTF','Other work','Shipping / fees / discounts'];
export function categoryAmounts(inv:any):number[]{
 const cents=Array(8).fill(0);
 for(const line of inv.lines||[]){
  const parts=String(line.detail||'').split('·').map((s:string)=>s.trim().toLowerCase());
  const key=parts.slice(0,2).join('|');
  const keys=['apparel|embroidery','apparel|screen print','apparel|dtf','caps|leather','caps|embroidery','caps|uv dtf'];
  const found=keys.indexOf(key),index=found<0?6:found;
  const n=Number(line.amount||0);if(!Number.isFinite(n))throw new Error('Invoice line amount is invalid.');
  cents[index]+=Math.round(n*100);
 }
 cents[7]=Math.round(Number(inv.total||0)*100)-cents.slice(0,7).reduce((a:number,b:number)=>a+b,0);
 return cents.map((n:number)=>n/100);
}

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-setup-token','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:cors});
const ORDERS_FOLDER='1T0ztNT8EUulug_KsI607MuqLQxYbQ1Y9';
const TEMPLATE='138tCDTvWYv0rm_bY4Hg8_-L-Ou9NNP70fHye-Gx2yzI';
const q=(s:string)=>s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
const safe=(e:unknown)=>e instanceof Error?e.message:'Payment export failed.';
export function paymentRow(record:any):any[]{
 const x=record.snapshot,inv=x.invoice,lines=inv.lines||[];
 const date=(v:any)=>{if(!v||!/^\d{4}-\d{2}-\d{2}/.test(String(v)))return '';const d=String(v).slice(0,10).split('-').map(Number);return Date.UTC(d[0],d[1]-1,d[2])/86400000+25569};
 return [record.order_id,inv.number,x.orderNumber,date(inv.invoiceDate||inv.createdAt),date(x.paymentDate),x.customer,x.contact,x.phone,x.email,x.invoiceEmail,record.payment_method,Number(inv.subtotal||0),Number(inv.shipping||0),Number(inv.rushFee||0),Number(inv.discount||0),Number(inv.total||0),[...new Set(lines.map((l:any)=>String(l.detail||'').split(' · ')[0]).filter(Boolean))].join(', '),date(inv.dueDate),lines.map((l:any)=>[l.description,l.detail,'Qty '+l.quantity,'$'+Number(l.amount||0).toFixed(2)].filter(Boolean).join(' · ')).join('\n'),inv.driveArchive?.fileId?'https://drive.google.com/file/d/'+inv.driveArchive.fileId+'/view':'',...categoryAmounts(inv)];
}
export async function handlePaymentRequest(request:Request):Promise<Response>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
 const root=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,allowed=Deno.env.get('GOOGLE_DRIVE_ORGANIZATION_ID');
 let authorization=request.headers.get('Authorization')||'';
 try{
  const body=await request.json();let organizationId:string;
  
  {
   const userResponse=await fetch(root+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization}});if(!userResponse.ok)return json(401,{error:'Sign in again before recording payment.'});
   const user=await userResponse.json();
   const profileResponse=await fetch(root+'/rest/v1/profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=organization_id,role',{headers:{apikey:anon,Authorization:authorization}});
   const profiles=await profileResponse.json();if(!profileResponse.ok||profiles.length!==1||profiles[0].role!=='admin')return json(403,{error:'Administrator access is required.'});organizationId=profiles[0].organization_id;
  }
  if(organizationId!==allowed)return json(403,{error:'The payment report is not configured for this shop.'});
  const db=async(path:string,init:RequestInit={})=>{
   const r=await fetch(root+'/rest/v1/'+path,{...init,headers:{apikey:anon,Authorization:authorization,'Content-Type':'application/json',...init.headers}});
   const value=await r.json().catch(()=>null);if(!r.ok)throw new Error(value?.message||'The payment could not be saved.');return value;
  };
  let record:any=null;
  if(body.action==='record_payment'||body.action==='retry_export'){
   if(!/^[0-9a-f-]{36}$/i.test(String(body.orderId||'')))return json(400,{error:'Choose a saved invoice.'});
   if(body.action==='record_payment'&&!['Check','Cash','Direct deposit','Venmo','PayPal','Cash App','Square'].includes(body.paymentMethod))return json(400,{error:'Select a payment method before marking paid.'});
   record=await db('rpc/record_order_payment',{method:'POST',body:JSON.stringify({p_order_id:body.orderId,p_payment_method:body.action==='record_payment'?body.paymentMethod:null,p_mark_paid:body.action==='record_payment'})});
  }else if(body.action!=='sync_pending')return json(400,{error:'Unsupported payment request.'});
  let token:string|null=null;
  const google=async(url:string,init:RequestInit={})=>{
   if(!token){
    const clientId=Deno.env.get('GOOGLE_DRIVE_CLIENT_ID'),secret=Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET'),refresh=Deno.env.get('GOOGLE_DRIVE_REFRESH_TOKEN');
    if(!clientId||!secret||!refresh)throw new Error('Google Drive authorization is not configured.');
    const t=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(12000),body:new URLSearchParams({client_id:clientId,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'})});
    const value=await t.json();if(!t.ok||!value.access_token)throw new Error('Google authorization failed. Reconnect the invoice archive account.');token=value.access_token;
   }
   const r=await fetch(url,{...init,signal:AbortSignal.timeout(15000),headers:{...init.headers,Authorization:'Bearer '+token}});
   const result=await r.json().catch(()=>({}));
   if(!r.ok){
    if(result?.error?.errors?.some((e:any)=>e.reason==='accessNotConfigured')||String(result?.error?.message||'').includes('has not been used')){const link=result?.error?.details?.find((detail:any)=>detail?.metadata?.activationUrl)?.metadata?.activationUrl||String(result?.error?.message||'').match(/https:\/\/console[^\s]+/)?.[0];throw new Error('Enable Google Sheets API'+(link?': '+link:' in the Google Cloud project used for invoice saving')+', then retry the report.');}
    if(r.status===403)throw new Error('Google Sheets permission is missing. Reconnect Google with Drive and Sheets access, then retry the report.');
    if(r.status===404)throw new Error('Google cannot access the Orders workbook. Check the connected account and folder access.');
    throw new Error('Google could not update the yearly report ('+r.status+'). Retry the report.');
   }
   return result;
  };
  const folders=new Map<number,string>();
  const report=async(year:number)=>{
   const known=await db('annual_payment_reports?organization_id=eq.'+organizationId+'&payment_year=eq.'+year+'&select=spreadsheet_id');if(known[0]?.spreadsheet_id)return known[0].spreadsheet_id;
   await db('annual_payment_reports?on_conflict=organization_id,payment_year',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({organization_id:organizationId,payment_year:year,spreadsheet_id:''})});
   const lease=crypto.randomUUID(),now=new Date().toISOString();
   const claimed=await db('annual_payment_reports?organization_id=eq.'+organizationId+'&payment_year=eq.'+year+'&spreadsheet_id=eq.&create_lease_until=lt.'+encodeURIComponent(now),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({create_lease_token:lease,create_lease_until:new Date(Date.now()+120000).toISOString()})});
   if(!claimed.length)throw new Error('The yearly workbook is being prepared. Retry the report shortly.');
   const files='https://www.googleapis.com/drive/v3/files',name=String(year);
   const found=await google(files+'?'+new URLSearchParams({q:"'"+q(ORDERS_FOLDER)+"' in parents and name='"+q(name)+"' and mimeType='application/vnd.google-apps.folder' and trashed=false",fields:'files(id)',pageSize:'2'}));
   let folder=found.files?.[0]?.id;
   if(!folder)folder=(await google(files+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[ORDERS_FOLDER]})})).id;
   const existing=await google(files+'?'+new URLSearchParams({q:"'"+q(folder)+"' in parents and name='AddiSon Designs Orders "+year+"' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",fields:'files(id)',pageSize:'2'}));
   let id=existing.files?.[0]?.id;
   if(!id){
    id=(await google(files+'/'+TEMPLATE+'/copy?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'AddiSon Designs Orders '+year,parents:[folder]})})).id;
    await google('https://sheets.googleapis.com/v4/spreadsheets/'+id+'/values/Orders!A2:AB10001:clear',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    await google('https://sheets.googleapis.com/v4/spreadsheets/'+id+'/values/Dashboard!B4?valueInputOption=RAW',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:[[year]]})});
   }
   await db('annual_payment_reports?organization_id=eq.'+organizationId+'&payment_year=eq.'+year+'&create_lease_token=eq.'+lease,{method:'PATCH',body:JSON.stringify({spreadsheet_id:id,create_lease_until:'1970-01-01T00:00:00Z',create_lease_token:null})});
   const winner=await db('annual_payment_reports?organization_id=eq.'+organizationId+'&payment_year=eq.'+year+'&select=spreadsheet_id');
   return winner[0]?.spreadsheet_id||id;
  };
  const exportOne=async(row:any)=>{
   const lease=crypto.randomUUID(),base='order_payment_records?organization_id=eq.'+organizationId+'&order_id=eq.'+row.order_id;
   let claimed=false;
   try{
    const claim=await db(base+'&export_lease_until=lt.'+encodeURIComponent(new Date().toISOString()),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({export_lease_token:lease,export_lease_until:new Date(Date.now()+120000).toISOString()})});
    if(!claim.length)return {saved:false,error:'This payment report is already syncing. Retry shortly.'};
    claimed=true;row=claim[0];
    const id=folders.get(row.payment_year)||await report(row.payment_year);folders.set(row.payment_year,id);
    const api='https://sheets.googleapis.com/v4/spreadsheets/'+id+'/values/';
    const keys=await google(api+'Orders!A2:A10001');const values=keys.values||[];
    const found=values.findIndex((value:any)=>String(value[0]||'')===row.order_id);
    if(found>=0){
     const target=found+2;
     await google(api+'Orders!A'+target+':AB'+target+'?valueInputOption=RAW',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:[paymentRow(row)]})});
    }else{
     if(values.length>=10000)throw new Error('The yearly report reached its row limit. Extend the report before exporting more payments.');
     await google(api+'Orders!A1:AB10001:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:[paymentRow(row)]})});
    }
    await db(base+'&updated_at=eq.'+encodeURIComponent(row.updated_at)+'&export_lease_token=eq.'+lease,{method:'PATCH',body:JSON.stringify({export_status:'synced',spreadsheet_id:id,export_error:null})});
    return {saved:true,url:'https://docs.google.com/spreadsheets/d/'+id+'/edit',year:row.payment_year};
   }catch(error){
    const message=safe(error);
    if(claimed)await db(base+'&export_lease_token=eq.'+lease,{method:'PATCH',body:JSON.stringify({export_status:'pending',export_error:message})}).catch(()=>{});
    return {saved:false,error:message};
   }finally{
    if(claimed)await db(base+'&export_lease_token=eq.'+lease,{method:'PATCH',body:JSON.stringify({export_lease_until:'1970-01-01T00:00:00Z',export_lease_token:null})}).catch(()=>{});
   }
  };
  if(record){const exported=await exportOne(record);return json(200,{paid:true,invoice:record.snapshot.invoice,report:exported})}
  const rows=await db('order_payment_records?organization_id=eq.'+organizationId+'&export_status=eq.pending&select=*&order=payment_year,sheet_row&limit=50');
  let saved=0,failed=0,last:any=null;const results:any[]=[];
  for(const row of rows){const result=await exportOne(row);last=result;results.push({orderId:row.order_id,report:result});if(result.saved)saved++;else{failed++;break}}
  return json(200,{saved,failed,last,results});
 }catch(error){return json(400,{error:safe(error)})}
}
if(import.meta.main)Deno.serve(handlePaymentRequest);
