const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const escapeHtml=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]||char));
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
import { archiveInvoice } from './google-drive.ts';
import { createInvoicePdf, decodeDisplayedInvoicePdf, type Invoice } from './invoice-pdf.ts';
import { toBase64 } from './email-pdf.ts';
export async function handleCustomerEmailRequest(request: Request): Promise<Response> {
 if(request.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(request.method!=="POST")return json(405,{error:"Method not allowed."});
 const supabaseUrl=Deno.env.get("SUPABASE_URL"),anonKey=Deno.env.get("SUPABASE_ANON_KEY"),resendKey=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("EMAIL_FROM");
 if(!supabaseUrl||!anonKey)return json(503,{error:"Customer email delivery has not been configured yet."});
 const authorization=request.headers.get("Authorization");
 if(!authorization?.startsWith("Bearer "))return json(401,{error:"Sign in is required."});
 try{
  const userResponse=await fetch(supabaseUrl+"/auth/v1/user",{headers:{apikey:anonKey,Authorization:authorization}});
  if(!userResponse.ok)return json(401,{error:"Your sign-in has expired. Sign in again and retry."});
  const user=await userResponse.json();
  const profileResponse=await fetch(supabaseUrl+"/rest/v1/profiles?user_id=eq."+encodeURIComponent(user.id)+"&select=user_id,organization_id,role",{headers:{apikey:anonKey,Authorization:authorization}});
  if(!profileResponse.ok)return json(403,{error:"Your shop profile could not be verified."});
  const profiles=await profileResponse.json();
  if(!Array.isArray(profiles)||profiles.length!==1||!profiles[0].organization_id)return json(403,{error:"An AddiSon Designs profile is required."});
  const body=await request.json(),meta=body.meta||{},kind=body.kind,email=String(meta.email||"").trim();
  if(kind!=="invoice_archive"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(400,{error:"Enter a valid customer email address."});
  const permitted=(kind==="job_status_update"&&meta.emailJobStatusUpdates===true)||((kind==="invoice"||kind==="invoice_archive")&&profiles[0].role==="admin");
  if(!permitted)return json(403,{error:"This customer email was not enabled for the order."});
  let suppliedPdf:Uint8Array|undefined;
  if((kind==="invoice"||kind==="invoice_archive")&&body.invoicePdf!==undefined){
   try{suppliedPdf=await decodeDisplayedInvoicePdf(body.invoicePdf)}catch{return json(400,{error:"The invoice PDF could not be read. Reopen the invoice and retry."})}
  }
  if(kind==="invoice_archive"){
   if(!body.invoice?.number||!Array.isArray(body.invoice.lines))return json(400,{error:"Invoice details are missing."});
   return json(200,{drive:await archiveInvoice(body.invoice as Invoice,profiles[0].organization_id,suppliedPdf)});
  }
  if(!resendKey||!from)return json(503,{error:"Customer email delivery has not been configured yet."});
  const orderLabel=meta.orderNumber?"Order "+meta.orderNumber:"your order";
  let subject="",content="",pdf:Uint8Array|undefined;let attachments:Record<string,unknown>[]=[];
  if(kind==="job_status_update"){
   const status=body.status||{};
   if(!status.stage)return json(400,{error:"Job status details are missing."});
   subject=orderLabel+" update: "+String(status.stage);
   content="<p>Hi "+escapeHtml(meta.contact||meta.customer||"there")+",</p><p>There is an update on your order.</p><p><strong>"+escapeHtml(status.title||status.board||"Job")+"</strong><br>"+escapeHtml(status.board||"")+" · "+escapeHtml(status.stage)+"</p>"+(status.previousStage?"<p>Previous step: "+escapeHtml(status.previousStage)+"</p>":"")+(status.dueDate?"<p>Target date: "+escapeHtml(status.dueDate)+"</p>":"")+"<p>"+escapeHtml(orderLabel)+"</p>";
  }else if(kind==="invoice"){
   const invoice=body.invoice||{};
   if(!invoice.number||!Array.isArray(invoice.lines))return json(400,{error:"Invoice details are missing."});
   subject="Invoice "+invoice.number+" from AddiSon Designs";
   const safeNumber=String(invoice.number).replace(/[^A-Za-z0-9_-]/g,"");
   pdf=suppliedPdf||await createInvoicePdf(invoice as Invoice,meta);
   attachments=[{filename:"Invoice-"+safeNumber+".pdf",content:toBase64(pdf),content_type:"application/pdf"}];
   content="<p>Hi "+escapeHtml(meta.contact||meta.customer||"there")+",</p><p>Thanks for entrusting us with your order. We appreciate the opportunity. Your invoice is attached. Please reach out if you need anything, and thanks for using AddiSon Designs.</p>";
  }else return json(400,{error:"Unsupported customer email type."});
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],...(kind==="invoice"?{bcc:["sales@addisondesigns.us"]}:{}),subject,html:"<div style='font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172235;line-height:1.55'><div style='font-weight:700;font-size:20px;margin-bottom:20px'>AddiSon Designs</div>"+content+"<p style='color:#667085'>Bringing your ideas to life</p></div>",...(attachments.length?{attachments}:{})})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)return json(502,{error:result?.message||"The email provider could not send this message."});
  const drive=kind==="invoice"?await archiveInvoice(body.invoice as Invoice,profiles[0].organization_id,pdf):undefined;
  return json(200,{sent:true,id:result.id||null,...(drive?{drive}:{})});
 }catch(error){return json(500,{error:error instanceof Error?error.message:"Customer email request failed."})}
}
