const ALLOWED = new Set(['explain','consistency','summary','suggest','translate','risk']);
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  const task=String(req.query.task||'');
  if (!ALLOWED.has(task)) return res.status(404).json({error:'UNKNOWN_TASK'});
  const token=(req.headers.authorization||'').replace('Bearer ','').trim();
  if (!token) return res.status(401).json({error:'UNAUTHENTICATED'});
  const SB_URL=process.env.SUPABASE_URL;
  const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (SB_URL&&SB_KEY){
    const a=await fetch(SB_URL+'/auth/v1/user',{headers:{'Authorization':'Bearer '+token,'apikey':SB_KEY}}).catch(()=>null);
    if (!a||!a.ok) return res.status(401).json({error:'INVALID_TOKEN'});
  }
  const KEY=process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(503).json({_fallback:true,message:'AI not configured.'});
  const body=req.body||{};
  const SYSTEM='You are a legal assistant for Mithaq, a UAE marriage contract platform covering Sharia (Federal Law 28/2005) and Civil (Abu Dhabi Law 14/2021) contracts. Respond ONLY with a single valid JSON object. Always include not_legal_advice:true. Be bilingual (English + Arabic) where schema requests it.';
  const P={
    explain:'Explain clause "'+body.clause_id+'" plainly. JSON: {"clause_id":"...","explanation_en":"...","explanation_ar":"...","risk_note":"...","not_legal_advice":true}',
    consistency:'Check clauses for conflicts, session "'+body.session_id+'". JSON: {"has_conflict":false,"description_en":"...","description_ar":"...","affected_clauses":[],"severity":"none|warning|fatal","not_legal_advice":true}',
    summary:'Summarize contract for session "'+body.session_id+'". JSON: {"summary_en":"...","summary_ar":"...","risk_level":"low|medium|high","key_points":[],"not_legal_advice":true}',
    suggest:'Suggest clauses for session "'+body.session_id+'" type "'+( body.contract_type||'sharia')+'". JSON: {"suggestions":[{"id":"...","reason_en":"...","reason_ar":"..."}],"not_legal_advice":true}',
    translate:'Translate clause "'+body.clause_id+'" to '+(body.target_language||'Arabic')+'. JSON: {"clause_id":"...","language":"...","translation":"...","not_legal_advice":true}',
    risk:'Assess risk score '+(body.risk_score||0)+'/100 for session "'+body.session_id+'". JSON: {"risk_score":'+(body.risk_score||0)+',"summary_en":"...","summary_ar":"...","drivers":[],"not_legal_advice":true}',
  };
  try {
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1024,temperature:0,system:SYSTEM,messages:[{role:'user',content:P[task]}]}),
      signal:AbortSignal.timeout(28000),
    });
    const d=await r.json();
    const txt=(d.content?.[0]?.text||'{}').replace(/^```json\s*/i,'').replace(/\s*```$/,'').trim();
    let parsed;try{parsed=JSON.parse(txt);}catch{parsed={raw:txt};}
    return res.status(200).json({...parsed,_task:task,_model:'claude-sonnet-4-20250514',_ts:new Date().toISOString()});
  } catch(e){
    return res.status(503).json({_fallback:true,message:'AI temporarily unavailable.'});
  }
}