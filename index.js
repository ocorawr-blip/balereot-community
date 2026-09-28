const COOKIE = "brc_session";
const SESSION_TTL = 60 * 60 * 24 * 3;
const enc = new TextEncoder();

function json(data,status=200,extra={}) {
  return new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json",...extra}});
}
function cookie(name,value,maxAge=SESSION_TTL){
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function parseCookies(req){const out={};for(const p of (req.headers.get("Cookie")||"").split(";")){const i=p.indexOf("=");if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));}return out;}
async function hmacKey(secret){return crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"])}
function b64u(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
function unb64u(s){s=s.replaceAll("-","+").replaceAll("_","/");while(s.length%4)s+="=";return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function signSession(env,payload){const body=b64u(enc.encode(JSON.stringify(payload)));const sig=b64u(await crypto.subtle.sign("HMAC",await hmacKey(env.SESSION_SECRET),enc.encode(body)));return body+"."+sig}
async function verifySession(env,token){try{const [body,sig]=token.split(".");const ok=await crypto.subtle.verify("HMAC",await hmacKey(env.SESSION_SECRET),unb64u(sig),enc.encode(body));if(!ok)return null;const p=JSON.parse(new TextDecoder().decode(unb64u(body)));return p.exp>Date.now()/1000?p:null}catch{return null}}
async function requireSession(req,env,admin=false){const s=await verifySession(env,parseCookies(req)[COOKIE]);if(!s|| (admin&&!s.admin))return null;return s}

async function deriveEncKey(env){
  const raw=env.APP_ENCRYPTION_KEY;
  if(!raw) throw new Error("APP_ENCRYPTION_KEY belum dikonfigurasi.");
  return crypto.subtle.importKey("raw",unb64u(raw),{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encryptSecret(env,plain){
  const iv=crypto.getRandomValues(new Uint8Array(12));const key=await deriveEncKey(env);
  const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(plain));
  return b64u(iv)+"."+b64u(ct);
}
async function decryptSecret(env,data){
  const [ivS,ctS]=data.split(".");const key=await deriveEncKey(env);
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64u(ivS)},key,unb64u(ctS));
  return new TextDecoder().decode(pt);
}
async function robloxUser(username){
  const r=await fetch("https://users.roblox.com/v1/usernames/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({usernames:[username],excludeBannedUsers:false})});
  if(!r.ok) throw new Error("Roblox gagal memvalidasi username.");
  const d=await r.json();return d.data?.[0]||null;
}
async function getKey(env){
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='roblox_api_key'").first();
  return row?.value?await decryptSecret(env,row.value):null;
}
function mimeFor(type, file){
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  const known={fbx:"model/fbx",obj:"model/obj",gltf:"model/gltf",glb:"model/gltf-binary",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",mp3:"audio/mpeg",ogg:"audio/ogg",wav:"audio/wav",mp4:"video/mp4",mov:"video/quicktime"};
  return known[ext]||file.type||"application/octet-stream";
}
async function createAsset(env,form){
  const key=await getKey(env);if(!key)throw new Error("API Key Roblox belum diatur oleh admin.");
  const file=form.get("fileContent");if(!(file instanceof File))throw new Error("File tidak ditemukan.");
  if(file.size>20*1024*1024)throw new Error("File melebihi batas 20 MB.");
  const assetType=form.get("assetType"), displayName=(form.get("displayName")||"").trim(), description=(form.get("description")||"").trim();
  const creatorKind=form.get("creatorKind"), creatorId=(form.get("creatorId")||"").trim();
  if(!displayName||!creatorId)throw new Error("Nama asset dan Creator ID wajib diisi.");
  const creator=creatorKind==="groupId"?{groupId:creatorId}:{userId:creatorId};
  const request={assetType,displayName,description,creationContext:{creator}};
  const fd=new FormData();fd.append("request",JSON.stringify(request));fd.append("fileContent",file,file.name);
  const r=await fetch("https://apis.roblox.com/assets/v1/assets",{method:"POST",headers:{"x-api-key":key},body:fd});
  const text=await r.text();let d={};try{d=JSON.parse(text)}catch{}
  if(!r.ok)throw new Error(d.message||text||`Roblox HTTP ${r.status}`);
  return d;
}
async function pollOperation(env,opPath){
  const key=await getKey(env);if(!key)return null;
  const url=opPath.startsWith("http")?opPath:"https://apis.roblox.com/assets/v1/"+opPath.replace(/^\/+/,"");
  for(let i=0;i<10;i++){
    const r=await fetch(url,{headers:{"x-api-key":key}});if(!r.ok)return null;
    const d=await r.json();if(d.done)return d;
    await new Promise(x=>setTimeout(x,1500));
  } return null;
}

async function api(req,env,url){
  if(url.pathname==="/api/login"&&req.method==="POST"){
    const {username=""}=await req.json();const u=username.trim();if(!u)return json({allowed:false},400);
    const found=await robloxUser(u);if(!found)return json({allowed:false,message:"Username Roblox tidak ditemukan."},403);
    const norm=found.name.toLowerCase();const admin=norm==="vellord";
    const row=await env.DB.prepare("SELECT username,roblox_id FROM whitelist WHERE username=?").bind(norm).first();
    if(!admin&&!row)return json({allowed:false},403);
    const token=await signSession(env,{username:found.name,robloxId:String(found.id),admin,exp:Math.floor(Date.now()/1000)+SESSION_TTL});
    return json({allowed:true,admin,username:found.name},{status:200,headers:{"Set-Cookie":cookie(COOKIE,token)}});
  }
  if(url.pathname==="/api/logout"&&req.method==="POST")return json({ok:true},{status:200,headers:{"Set-Cookie":cookie(COOKIE,"",-1)}});
  if(url.pathname==="/api/upload"&&req.method==="POST"){
    const s=await requireSession(req,env);if(!s)return json({message:"Belum login."},401);
    const form=await req.formData();const d=await createAsset(env,form);
    let assetId=null;let operationId=d.path?.split("/").pop()||null;
    if(d.path){const result=await pollOperation(env,d.path);assetId=result?.response?.assetId||result?.assetId||null}
    await env.DB.prepare("INSERT INTO uploads(username,asset_id,operation_id,asset_type,display_name,status,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(s.username,assetId,operationId,form.get("assetType"),form.get("displayName"),assetId?"completed":"processing",new Date().toISOString()).run();
    return json({ok:true,message:assetId?"Upload berhasil.":"Upload diterima; operasi masih diproses.",assetId,operationId});
  }
  if(url.pathname.startsWith("/api/admin/")){
    const s=await requireSession(req,env,true);if(!s)return json({message:"Akses admin diperlukan."},403);
    if(url.pathname==="/api/admin/api-key"&&req.method==="GET"){
      const row=await env.DB.prepare("SELECT value FROM settings WHERE key='roblox_api_key'").first();return json({configured:!!row});
    }
    if(url.pathname==="/api/admin/api-key"&&req.method==="POST"){
      const {key=""}=await req.json();if(!key.trim())return json({message:"API Key kosong."},400);
      const encrypted=await encryptSecret(env,key.trim());
      await env.DB.prepare("INSERT INTO settings(key,value) VALUES('roblox_api_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(encrypted).run();
      return json({message:"API Key berhasil disimpan secara terenkripsi di server."});
    }
    if(url.pathname==="/api/admin/users"&&req.method==="GET"){
      const {results=[]}=await env.DB.prepare("SELECT username,roblox_id FROM whitelist ORDER BY username").all();return json({users:results});
    }
    if(url.pathname==="/api/admin/users"&&req.method==="POST"){
      const {username=""}=await req.json();const u=await robloxUser(username.trim());if(!u)return json({message:"Username Roblox tidak ditemukan."},400);
      await env.DB.prepare("INSERT OR REPLACE INTO whitelist(username,roblox_id,created_at) VALUES(?,?,?)").bind(u.name.toLowerCase(),String(u.id),new Date().toISOString()).run();
      return json({message:`${u.name} sekarang diizinkan.`});
    }
    if(url.pathname.startsWith("/api/admin/users/")&&req.method==="DELETE"){
      const u=decodeURIComponent(url.pathname.split("/").pop()).toLowerCase();await env.DB.prepare("DELETE FROM whitelist WHERE username=?").bind(u).run();return json({message:"Akses dihapus."});
    }
  }
  return null;
}
export default {
 async fetch(req,env){
  try{
   const url=new URL(req.url);const r=await api(req,env,url);if(r)return r;
   if(url.pathname.startsWith("/api/"))return json({message:"Not found"},404);
   return env.ASSETS.fetch(req);
  }catch(e){return json({message:e.message||"Server error"},500)}
 }
};