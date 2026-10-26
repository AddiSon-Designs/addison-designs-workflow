const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const asRecord=(value:unknown):Record<string,any>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,any>:{};
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(request.method!=="POST")return json(405,{error:"Method not allowed."});
 const supabaseUrl=Deno.env.get("SUPABASE_URL"),anonKey=Deno.env.get("SUPABASE_ANON_KEY");
 const accountNumber=Deno.env.get("SS_ACCOUNT_NUMBER"),apiKey=Deno.env.get("SS_API_KEY");
 if(!supabaseUrl||!anonKey||!accountNumber||!apiKey)return json(503,{error:"S&S order access is not configured."});
 const authorization=request.headers.get("Authorization");
 if(!authorization?.startsWith("Bearer "))return json(401,{error:"Sign in is required."});
 try{
  const userResponse=await fetch(supabaseUrl+"/auth/v1/user",{headers:{apikey:anonKey,Authorization:authorization}});
  if(!userResponse.ok)return json(401,{error:"Your sign-in has expired. Sign in again and retry."});
  const user=asRecord(await userResponse.json());
  const profileResponse=await fetch(supabaseUrl+"/rest/v1/profiles?user_id=eq."+encodeURIComponent(String(user.id||""))+"&select=user_id,organization_id,role",{headers:{apikey:anonKey,Authorization:authorization}});
  if(!profileResponse.ok)return json(403,{error:"Your shop profile could not be verified."});
  const profiles=await profileResponse.json();
  if(!Array.isArray(profiles)||profiles.length!==1||!profiles[0]?.organization_id)return json(403,{error:"An AddiSon Designs profile is required."});
  if(profiles[0].role!=="admin")return json(403,{error:"Only a shop administrator can submit an S&S order."});
  const body=asRecord(await request.json()),rawLines=body.lines;
  if(!Array.isArray(rawLines)||rawLines.length<1||rawLines.length>100)return json(400,{error:"Add between 1 and 100 S&S items to the order."});
  const bySku=new Map<string,number>();
  for(const value of rawLines){
   const line=asRecord(value),identifier=String(line.identifier??"").trim(),qty=Number(line.qty);
   if(!/^[A-Za-z0-9-]{2,30}$/.test(identifier)||!Number.isSafeInteger(qty)||qty<1||qty>100000)return json(400,{error:"An S&S item or quantity is invalid."});
   bySku.set(identifier,(bySku.get(identifier)||0)+qty);
  }
  const a=asRecord(body.shippingAddress),shippingAddress={
   customer:String(a.customer??"").trim().slice(0,80),attn:String(a.attn??"").trim().slice(0,80),
   address:String(a.address??"").trim().slice(0,120),city:String(a.city??"").trim().slice(0,80),
   state:String(a.state??"").trim().toUpperCase(),zip:String(a.zip??"").trim()
  };
  const residential=Boolean(a.residential);
  if(!shippingAddress.customer||!shippingAddress.address||!shippingAddress.city||!/^[A-Z]{2}$/.test(shippingAddress.state)||!/^[0-9]{5}$/.test(shippingAddress.zip))return json(400,{error:"Enter the ship-to company, street address, city, two-letter state, and 5-digit ZIP code."});
  const shippingMethod=String(body.shippingMethod??"1");
  const allowedShippingMethods=new Set(["1","2","3","16","6","8","54","17","21","19","20","22","14","27","26","40","48"]);
  if(!allowedShippingMethods.has(shippingMethod))return json(400,{error:"Choose a valid S&S shipping method."});
  const emailConfirmation=String(body.emailConfirmation??"").trim();
  if(emailConfirmation&&!emailPattern.test(emailConfirmation))return json(400,{error:"Enter a valid S&S order confirmation email or leave it blank."});
  const payload={
   shippingAddress:{...shippingAddress,residential},
   shippingMethod,
   shipBlind:false,
   poNumber:String(body.poNumber??"").trim().slice(0,40),
   emailConfirmation,
   testOrder:false,
   autoselectWarehouse:true,
   AutoSelectWarehouse_Preference:"fewest",
   rejectLineErrors:true,
   lines:[...bySku].map(([identifier,qty])=>({identifier,qty}))
  };
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  let upstream:Response;
  try{upstream=await fetch("https://api.ssactivewear.com/v2/orders/",{method:"POST",headers:{Authorization:"Basic "+btoa(accountNumber+":"+apiKey),Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal})}finally{clearTimeout(timeout)}
  const upstreamText=await upstream.text();let result:unknown;
  try{result=JSON.parse(upstreamText)}catch{result=null}
  if(!upstream.ok){
   const details=asRecord(result),message=String(details.message??details.error??"S&S rejected the order. Check the shipping details and items.");
   return json(502,{error:message});
  }
  const orders=Array.isArray(result)?result:result?[result]:[];
  if(!orders.length)return json(502,{error:"S&S did not return an order confirmation. Check S&S order history before retrying."});
  return json(200,{orders:orders.map(value=>{const order=asRecord(value);return{orderNumber:String(order.orderNumber??""),guid:String(order.guid??""),orderStatus:String(order.orderStatus??""),warehouseAbbr:String(order.warehouseAbbr??""),subtotal:Number(order.subtotal??0),shipping:Number(order.shipping??0),total:Number(order.total??0),totalPieces:Number(order.totalPieces??0),lines:Array.isArray(order.lines)?order.lines.map((raw:unknown)=>{const line=asRecord(raw);return{sku:String(line.sku??""),qtyOrdered:Number(line.qtyOrdered??0)}}):[]}})});
 }catch(error){
  if(error instanceof Error&&error.name==="AbortError")return json(504,{error:"S&S did not respond in time. Check S&S order history before retrying to avoid a duplicate."});
  return json(500,{error:error instanceof Error?error.message:"S&S order submission failed."});
 }
});
