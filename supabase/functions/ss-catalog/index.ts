const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const asRecord=(value:unknown):Record<string,any>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,any>:{};
const normalizedBrand=(value:unknown)=>String(value??"").toLowerCase().replace(/[^a-z0-9]/g,"");
const isSanMarBrand=(value:unknown)=>{const name=normalizedBrand(value);return name.includes("district")||name==="bellacanvas"||name==="bellaandcanvas"};
const isRichardsonCap=(style:Record<string,any>)=>{const category=String(style.baseCategory??style.BaseCategory??"").toLowerCase();return normalizedBrand(style.brandName??style.BrandName)==="richardson"&&/(cap|hat|headwear)/i.test(category)};
const isApparelStyle=(style:Record<string,any>)=>{const category=String(style.baseCategory??style.BaseCategory??"").toLowerCase();return !isSanMarBrand(style.brandName??style.BrandName)&&!/(cap|hat|headwear)/i.test(category)};
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(request.method!=="POST")return json(405,{error:"Method not allowed."});
 const supabaseUrl=Deno.env.get("SUPABASE_URL"),anonKey=Deno.env.get("SUPABASE_ANON_KEY");
 const accountNumber=Deno.env.get("SS_ACCOUNT_NUMBER"),apiKey=Deno.env.get("SS_API_KEY");
 if(!supabaseUrl||!anonKey||!accountNumber||!apiKey)return json(503,{error:"S&S catalog access is not configured."});
 const authorization=request.headers.get("Authorization");
 if(!authorization?.startsWith("Bearer "))return json(401,{error:"Sign in is required."});
 try{
  const userResponse=await fetch(supabaseUrl+"/auth/v1/user",{headers:{apikey:anonKey,Authorization:authorization}});
  if(!userResponse.ok)return json(401,{error:"Your sign-in has expired. Sign in again and retry."});
  const user=asRecord(await userResponse.json());
  const profileResponse=await fetch(supabaseUrl+"/rest/v1/profiles?user_id=eq."+encodeURIComponent(String(user.id||""))+"&select=user_id,organization_id",{headers:{apikey:anonKey,Authorization:authorization}});
  if(!profileResponse.ok)return json(403,{error:"Your shop profile could not be verified."});
  const profiles=await profileResponse.json();
  if(!Array.isArray(profiles)||profiles.length!==1||!profiles[0]?.organization_id)return json(403,{error:"An AddiSon Designs profile is required."});
  const body=asRecord(await request.json()),action=String(body.action||"");
  let endpoint="";
  if(action==="search"){
   const query=String(body.query||"").trim();
   if(query.length<2||query.length>80)return json(400,{error:"Enter at least 2 characters to search S&S."});
   endpoint="https://api.ssactivewear.com/v2/styles/?search="+encodeURIComponent(query);
  }else if(action==="products"){
   const partNumber=String(body.partNumber||"").trim(),catalog=String(body.catalog||"apparel");
   if(!/^[A-Za-z0-9-]{2,20}$/.test(partNumber))return json(400,{error:"Choose a valid S&S style first."});
   if(catalog!=="apparel"&&catalog!=="richardson-cap")return json(400,{error:"Unsupported S&S catalog type."});
   endpoint="https://api.ssactivewear.com/v2/products/?partnumber="+encodeURIComponent(partNumber)+"&fields=Sku,BrandName,StyleName,ColorName,SizeName,CustomerPrice,Qty,Warehouses";
  }else return json(400,{error:"Unsupported S&S catalog request."});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  let upstream:Response;
  try{upstream=await fetch(endpoint,{headers:{Authorization:"Basic "+btoa(accountNumber+":"+apiKey),Accept:"application/json"},signal:controller.signal})}finally{clearTimeout(timeout)}
  if(upstream.status===401||upstream.status===403)return json(502,{error:"S&S rejected the saved account credentials. Check the account number and API key."});
  if(!upstream.ok)return json(502,{error:"S&S could not complete the catalog lookup ("+upstream.status+")."});
  const payload=await upstream.json(),rows=Array.isArray(payload)?payload:[];
  if(action==="search"){
   const catalog=String(body.catalog||"apparel");
   if(catalog!=="apparel"&&catalog!=="richardson-cap")return json(400,{error:"Unsupported S&S catalog type."});
   const styles=rows.filter((row:unknown)=>catalog==="richardson-cap"?isRichardsonCap(asRecord(row)):isApparelStyle(asRecord(row))).slice(0,20).map((value:unknown)=>{
    const row=asRecord(value);
    return{partNumber:String(row.partNumber??row.PartNumber??""),brandName:String(row.brandName??row.BrandName??""),styleName:String(row.styleName??row.StyleName??""),title:String(row.title??row.Title??""),baseCategory:String(row.baseCategory??row.BaseCategory??"")};
   }).filter((row:Record<string,string>)=>row.partNumber&&row.brandName);
   return json(200,{styles});
  }
  const catalog=String(body.catalog||"apparel"),requestedBrand=normalizedBrand(body.brandName);
  const products=rows.filter((row:unknown)=>{const brand=asRecord(row).brandName??asRecord(row).BrandName;return catalog==="richardson-cap"?normalizedBrand(brand)==="richardson"&&(!requestedBrand||requestedBrand==="richardson"):!isSanMarBrand(brand)}).slice(0,500).map((value:unknown)=>{
   const row=asRecord(value),warehouses=Array.isArray(row.warehouses??row.Warehouses)?(row.warehouses??row.Warehouses):[];
   return{sku:String(row.sku??row.Sku??""),brandName:String(row.brandName??row.BrandName??""),styleName:String(row.styleName??row.StyleName??""),colorName:String(row.colorName??row.ColorName??""),sizeName:String(row.sizeName??row.SizeName??""),customerPrice:Number(row.customerPrice??row.CustomerPrice??0),qty:Number(row.qty??row.Qty??0),warehouses:warehouses.map((entry:unknown)=>{const warehouse=asRecord(entry);return{warehouseAbbr:String(warehouse.warehouseAbbr??warehouse.WarehouseAbbr??""),qty:Number(warehouse.qty??warehouse.Qty??0)}})};
  }).filter((row:Record<string,unknown>)=>row.sku&&row.sizeName);
  return json(200,{products});
 }catch(error){
  if(error instanceof Error&&error.name==="AbortError")return json(504,{error:"S&S took too long to respond. Please try again."});
  return json(500,{error:error instanceof Error?error.message:"S&S catalog lookup failed."});
 }
});
