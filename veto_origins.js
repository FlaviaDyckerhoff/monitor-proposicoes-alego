'use strict';
const ORIGIN='https://alegodigital.al.go.leg.br';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function text(s){return String(s||'').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10))).replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,n)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[n])).replace(/\s+/g,' ').trim();}
function field(html,id){const match=String(html).match(new RegExp('<([a-z0-9]+)\\b[^>]*\\bid=["\']'+id+'["\'][^>]*>([\\s\\S]*?)<\\/\\1>','i'));return match?text(match[2]):'';}
function processRef(s){const m=String(s||'').replace(/\s+/g,'').match(/^(\d+)\/(20\d{2})$/);return m?m[1]+'/'+m[2]:'';}
function references(ementa){
 const refs=[];const re=/(ANEXO\s+)?PROCESSO\s*N[º°o.]?\s*([\d.]+)(?:\s*\/\s*(20\d{2}))?/gi;
 for(const m of String(ementa||'').matchAll(re)){
  const number=m[2].replace(/\./g,'');const year=m[3]||(/^20\d{8}$/.test(number)?number.slice(0,4):'');
  if(!year)continue;
  const ref={role:m[1]?'anexo':'principal',number,year};
  if(!refs.some(x=>x.number===number&&x.year===year))refs.push(ref);
 }
 return refs;
}
async function readHtml(url,fetchFn){
 const u=new URL(url);if(u.origin!==ORIGIN)throw new Error('fonte fora do domínio oficial');
 const response=await fetchFn(u.href,{headers:{'User-Agent':'Mozilla/5.0 MonitorLegislativo'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('fonte oficial HTTP '+response.status);
 if(response.url&&new URL(response.url).origin!==ORIGIN)throw new Error('redirecionamento fora da fonte oficial');
 return response.text();
}
async function resolve(ref,parse,fetchFn){
 const url=ORIGIN+'/spl/consulta-producao.aspx?processo='+encodeURIComponent(ref.number)+'&ano='+ref.year;
 const html=await readHtml(url,fetchFn);
 const matches=parse(html).filter(p=>processRef(p.processo)===ref.number+'/'+ref.year&&/^projeto de lei (ordinaria|complementar)$/.test(norm(p.tipo)));
 if(matches.length!==1)throw new Error('processo de origem sem correspondência única');
 const candidate=matches[0];const detailUrl=new URL(candidate.url,ORIGIN).href;
 const detail=await readHtml(detailUrl,fetchFn);
 const process=field(detail,'ContentPlaceHolder1_sp_numero_processo');
 const title=field(detail,'ContentPlaceHolder1_h3_processo');
 const ementa=field(detail,'ContentPlaceHolder1_p_ementa');
 const id=new URL(detailUrl).searchParams.get('id');
 const titleMatch=title.match(/^(Projeto de Lei (?:Ordinária|Complementar))\s+(\d+)\/(20\d{2})$/i);
 if(processRef(process)!==ref.number+'/'+ref.year||!titleMatch||!ementa||!id)throw new Error('ficha original não confirmou identidade ou ementa');
 if(norm(titleMatch[1])!==norm(candidate.tipo)||titleMatch[2]!==String(candidate.numero))throw new Error('tipo/número divergente na ficha original');
 return {role:ref.role,processo:process,tipo:titleMatch[1],numero:titleMatch[2],ano:titleMatch[3],titulo:title,ementa,url:detailUrl,id};
}
async function enrich(items,parse,fetchFn=fetch){
 const cache=new Map();
 for(const p of items){
  if(!/^veto(?:\b|\s|-)/i.test(String(p.tipo||'')))continue;
  p.veto_origens=[];p.veto_origem_pendencias=[];
  const refs=references(p.ementa);
  if(!refs.length){p.veto_origem_pendencias.push('Projeto original não identificado na referência oficial do veto.');continue;}
  for(const ref of refs){
   const key=ref.number+'/'+ref.year;
   try{
    if(!cache.has(key))cache.set(key,resolve(ref,parse,fetchFn));
    p.veto_origens.push({...await cache.get(key),role:ref.role});
   }catch(err){p.veto_origem_pendencias.push('Processo '+key+': '+err.message+'. Conferir origem na fonte oficial.');}
  }
 }
 return items;
}
function render(p){
 if(!/^veto(?:\b|\s|-)/i.test(String(p.tipo||'')))return '';
 let html='';
 for(const origin of p.veto_origens||[]){
  const short=norm(origin.tipo).includes('complementar')?'PLC':'PL';
  html+='<div style="margin-top:8px;padding:8px;border-left:3px solid #003366;background:#f4f7fb"><b>'+(origin.role==='anexo'?'Projeto anexado':'Projeto original')+': <a href="'+esc(origin.url)+'">'+short+' '+esc(origin.numero)+'/'+esc(origin.ano)+'</a></b><br><b>Ementa do '+(origin.role==='anexo'?'anexado':'original')+':</b> '+esc(origin.ementa)+'</div>';
 }
 for(const warning of p.veto_origem_pendencias||[])html+='<div style="margin-top:6px;color:#92400e"><b>Origem a conferir:</b> '+esc(warning)+'</div>';
 return html;
}
module.exports={references,enrich,render,field};
