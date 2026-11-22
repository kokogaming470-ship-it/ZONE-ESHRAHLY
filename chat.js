// Vercel serverless proxy: keeps GEMINI_API_KEY on the server (never in the site code)
const MODELS=[process.env.GEMINI_MODEL,"gemini-3.8-flash","gemini-3.7-flash","gemini-2.5-flash"].filter(Boolean);
const HANDOFF="[HANDOFF]";
const hits=new Map();
function limited(ip){const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<60000);a.push(n);hits.set(ip,a);if(hits.size>500)hits.clear();return a.length>20}
function part(d){const m=/^data:([^;,]+)[^,]*;base64,(.+)$/s.exec(d||"");return m?{inlineData:{mimeType:m[1],data:m[2]}}:null}
function call(model,key,body){return fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify(body)})}
module.exports=async(req,res)=>{
  if(req.method!=="POST")return res.status(405).json({error:"POST only"});
  const key=process.env.GEMINI_API_KEY;
  if(!key)return res.status(500).json({error:"missing GEMINI_API_KEY"});
  const ip=String(req.headers["x-forwarded-for"]||"x").split(",")[0];
  if(limited(ip))return res.status(429).json({error:"slow down"});
  const b=req.body||{};
  const q=String(b.message||"").slice(0,4000),sys=String(b.prompt||"").slice(0,30000),tr=String(b.transcript||"").slice(0,2000);
  const img=part(b.image),aud=part(b.audio);
  const mk=wa=>{const p=[{text:q||"مرحبا"}];if(img)p.push(img);if(aud&&wa)p.push(aud);else if(tr)p.push({text:"(نص الرسالة الصوتية: "+tr+")"});
    return{systemInstruction:{parts:[{text:sys}]},contents:[{role:"user",parts:p}],generationConfig:{temperature:.6,maxOutputTokens:2048}}};
  let wa=!!aud;
  for(const m of MODELS){
    for(let t=0;t<2;t++){
      let r;try{r=await call(m,key,mk(wa))}catch(e){break}
      if(r.ok){
        const d=await r.json(),c=d.candidates&&d.candidates[0];
        const txt=c&&c.content&&c.content.parts?c.content.parts.map(x=>x.text||"").join("").trim():"";
        const fr=c&&c.finishReason;
        if((d.promptFeedback&&d.promptFeedback.blockReason)||fr==="SAFETY"||fr==="PROHIBITED_CONTENT"||!txt)return res.status(200).json({reply:HANDOFF});
        return res.status(200).json({reply:txt});
      }
      if(r.status===400&&wa){wa=false;continue}
      if(r.status===404)break;
      return res.status(502).json({error:"gemini "+r.status});
    }
  }
  return res.status(502).json({error:"no model worked"});
};
