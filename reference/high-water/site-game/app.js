// High Water — spectator client. Polls the snapshot; paints ledger / dispatches /
// gauge; draws a live engraved contour amphitheater (height-field + marching
// squares) with warm translucent water; and stages the Unsealing as a full beat.
(() => {
  const API = '/game/api/v1';
  const $ = (id) => document.getElementById(id);
  let S = null, seenSeq = 0, seenUnseal = 0;
  const C = { paper:'#faf7ef', paperDeep:'#f3efe2', ink:'#141413', inkSoft:'#3d3d3a', muted:'#6f6b60', hair:'#e3ddcc', gold:'#efdfa7', goldDeep:'#b8933b', orange:'#fb651e', water:'#4a3f2e' };
  const esc = s => String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  async function poll(){ try{ const r=await fetch(`${API}/state`,{cache:'no-store'}); if(r.ok) onState(await r.json()); }catch{} setTimeout(poll,1500); }
  function onState(s){
    const first=!S; const prevSunk=S?S.town.districts.filter(d=>d.status==='sunken').length:-1; S=s;
    renderTop(); renderLedger(); renderDisp(); renderGauge();
    const nowSunk=s.town.districts.filter(d=>d.status==='sunken').length;
    if(nowSunk!==prevSunk) terrainDirty=true;
    const fresh=(s.ledger||[]).filter(x=>x.seq>seenSeq).reverse();
    const lu=s.storm&&s.storm.lastUnseal;
    if(lu&&lu.seq){                       // backend-driven Unsealing beat (preferred)
      if(lu.seq!==seenUnseal){ if(!first) unsealBeat(null,fresh,lu); seenUnseal=lu.seq; }
    } else if(!first){                    // fallback: derive the beat from the ledger
      const beat=fresh.find(x=>x.verb==='unseal'||x.verb==='drown'||x.verb==='crest');
      if(beat) unsealBeat(beat, fresh);
    }
    seenSeq=Math.max(seenSeq,...(s.ledger||[]).map(x=>x.seq),0);
  }

  // ── top bar ────────────────────────────────────────────────────────────────
  function renderTop(){
    const st=S.storm;
    $('townName').textContent=S.town.name; $('stormN').textContent=st.n;
    // tide as pips
    let pips=''; for(let i=1;i<=st.of;i++) pips+=`<span class="pip${i<=st.tide&&st.status!=='intermission'?' on':''}"></span>`;
    $('tide').innerHTML=st.status==='intermission'?'<span class="mono">—</span>':pips;
    const a=st.arithmetic, ar=$('arith');
    if(st.status==='intermission') ar.innerHTML=`<span class="serif big">The waters recede. The next storm gathers.</span>`;
    else if(a) ar.innerHTML=`<b>${a.needed}</b>&nbsp;exposed &nbsp;·&nbsp; only&nbsp;<b>${a.granted}</b>&nbsp;saved &nbsp;·&nbsp; the river takes&nbsp;<span class="doom">${a.doomed}</span>`;
    else ar.textContent='the river is rising…';
    const cd=$('countdown'), sec=st.secondsLeft||0, mm=Math.floor(sec/60), ss=String(sec%60).padStart(2,'0');
    cd.textContent=st.status==='intermission'?`NEXT ${mm}:${ss}`:st.phase==='court'?'COURT':`${mm}:${ss}`;
    cd.className='countdown'+(st.phase==='court'?' court':'');
  }

  // ── ledger ─────────────────────────────────────────────────────────────────
  function renderLedger(){
    const el=$('ledger'); el.innerHTML='';
    S.standings.forEach((a,i)=>{
      const d=document.createElement('div'); d.className='led'+(a.alive?'':' dead');
      d.innerHTML=`<div class="rank">${i+1}</div><div class="who"><div class="nm">${esc(a.name)}</div>
      <div class="ro">${esc(a.role)}${a.pactsBroken?' · <span class="br">'+a.pactsBroken+' broken</span>':''}</div>
      <div class="rep"><i style="width:${Math.round(a.reputation)}%"></i></div></div>
      <div class="gold">${a.banked}<small> +${a.onHand}</small></div>${a.isBot?'<div class="bot">'+(a.isSteward?'STEWARD':'BOT')+'</div>':''}`;
      el.appendChild(d);
    });
    const dry=S.town.districts.filter(d=>d.status==='dry').length, ref=S.standings.filter(a=>!a.alive).length, tot=S.standings.reduce((s,a)=>s+a.banked,0);
    $('ledFoot').innerHTML=`<span>${tot}<em>gold in play</em></span><span>${dry}<em>wards left</em></span><span>${ref}<em>refugees</em></span>`;
  }

  // ── dispatches ─────────────────────────────────────────────────────────────
  const KLASS={say:'say',break:'break',drown:'drown',crest:'crest',court:'court',unseal:'unseal',move:'gain',join:'join',letter:'gain',owner:'gain'};
  function renderDisp(){
    const el=$('disp'); const atTop=el.scrollTop<8; el.innerHTML='';
    (S.ledger||[]).filter(r=>r.verb!=='hesitate').slice(0,44).forEach(r=>{
      const d=document.createElement('div'); d.className='disp '+(KLASS[r.verb]||'');
      const hh=new Date(r.ts).toTimeString().slice(0,8);
      const flag=r.verb==='break'?'<span class="flag">⚡ Betrayal</span>':(r.sealed?'<span class="flag ink">Sealed</span>':'');
      const nm=r.actorName&&r.actorName!=='The River'?`<div class="nm">${esc(r.actorName)}</div>`:'';
      d.innerHTML=`<div class="ts">${hh}</div>${nm}<div class="tx">${flag}${esc(r.text)}</div>`;
      el.appendChild(d);
    });
    if(atTop) el.scrollTop=0;
  }

  // ── gauge ──────────────────────────────────────────────────────────────────
  function renderGauge(){
    const w=S.town.waterline||0, crest=S.storm.forecast?.crest||18, maxE=18;
    const wh=Math.max(4,Math.min(100,(w/maxE)*100));
    $('gwater').style.height=wh+'%';
    $('gmark').style.bottom=wh+'%';
    $('gmark').textContent=`◄ ${w.toFixed(1)}`;
    const cy=100-Math.min(100,(crest/maxE)*100);
    $('gcrest').style.top=cy+'%';
    $('gcur').innerHTML=`${w.toFixed(1)}<small>feet · crest ~${crest}</small>`;
  }

  // ── the map ────────────────────────────────────────────────────────────────
  const cv=$('map'), ctx=cv.getContext('2d');
  let terrain=null, terrainDirty=true, TW=0, TH=0;
  function resize(){ const r=cv.getBoundingClientRect(); const dpr=Math.min(devicePixelRatio||1,2); cv.width=r.width*dpr; cv.height=r.height*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); cv._w=r.width; cv._h=r.height; terrainDirty=true; }
  addEventListener('resize',resize);
  // re-measure after the flex column settles (mobile stage has no window 'resize' cue)
  try{ const stg=document.querySelector('.stage'); if(stg&&window.ResizeObserver) new ResizeObserver(()=>resize()).observe(stg); }catch(e){}
  const yForElev=e=>0.93-(e/22)*0.86;

  function fieldZ(nx,ny,ds){
    let z=(1-ny)*0.72 + 0.10*Math.sin(nx*7+1)+0.08*Math.cos(ny*6+0.5)+0.05*Math.sin(nx*15+ny*9);
    for(const d of ds){ if(d.status==='sunken')continue; const dx=nx-d.x,dy=ny-d.y,s=0.12; z+=0.30*Math.exp(-(dx*dx+dy*dy)/(2*s*s)); }
    return z;
  }
  function buildTerrain(W,H){
    const t=document.createElement('canvas'); t.width=W; t.height=H; const g=t.getContext('2d');
    g.fillStyle=C.paper; g.fillRect(0,0,W,H);
    const ds=S.town.districts;
    const cols=Math.max(24,Math.round(W/13)), rows=Math.max(18,Math.round(H/13));
    const z=[]; for(let j=0;j<=rows;j++){ z[j]=[]; for(let i=0;i<=cols;i++) z[j][i]=fieldZ(i/cols,j/rows,ds); }
    const lv=(v,idx)=>{ // marching squares at level v
      g.beginPath();
      for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
        const a=z[j][i],b=z[j][i+1],c=z[j+1][i+1],dd=z[j+1][i];
        let m=(a>v?8:0)|(b>v?4:0)|(c>v?2:0)|(dd>v?1:0); if(m===0||m===15)continue;
        const x0=i/cols*W,x1=(i+1)/cols*W,y0=j/rows*H,y1=(j+1)/rows*H;
        const T=(p,q,zp,zq)=>{const t=(v-zp)/(zq-zp||1e-6);return p+(q-p)*t;};
        const top=[T(x0,x1,a,b),y0], rt=[x1,T(y0,y1,b,c)], bt=[T(x0,x1,dd,c),y1], lf=[x0,T(y0,y1,a,dd)];
        const seg=(p,q)=>{g.moveTo(p[0],p[1]);g.lineTo(q[0],q[1]);};
        switch(m){case 1:case 14:seg(lf,bt);break;case 2:case 13:seg(bt,rt);break;case 3:case 12:seg(lf,rt);break;
          case 4:case 11:seg(top,rt);break;case 6:case 9:seg(top,bt);break;case 7:case 8:seg(lf,top);break;
          case 5:seg(lf,top);seg(bt,rt);break;case 10:seg(top,rt);seg(lf,bt);break;}
      }
      g.lineWidth=idx?1.15:0.7; g.strokeStyle=idx?'rgba(58,48,33,0.36)':'rgba(83,74,55,0.20)'; g.stroke();
    };
    const levels=[]; for(let v=0.06;v<1.02;v+=0.033) levels.push(v);
    levels.forEach((v,k)=>lv(v,k%5===0));
    // hypsometric tint — warm vertical relief so the open plate isn't blank cream
    const hyp=g.createLinearGradient(0,0,0,H); hyp.addColorStop(0,'rgba(239,223,167,0)'); hyp.addColorStop(1,'rgba(184,147,59,0.10)');
    g.fillStyle=hyp; g.fillRect(0,0,W,H);
    // plate furniture
    g.strokeStyle='rgba(58,48,33,0.35)'; g.lineWidth=1; g.strokeRect(8,8,W-16,H-16); g.strokeRect(12,12,W-24,H-24);
    [[8,8],[W-8,8],[8,H-8],[W-8,H-8]].forEach(([x,y])=>{g.beginPath();g.moveTo(x-6,y);g.lineTo(x+6,y);g.moveTo(x,y-6);g.lineTo(x,y+6);g.stroke();});
    return t;
  }

  function drawMap(ts){
    requestAnimationFrame(drawMap);
    if(!S)return; if(!cv._w)resize();
    const W=cv._w,H=cv._h;
    if(terrainDirty||TW!==W||TH!==H){ terrain=buildTerrain(W,H); TW=W;TH=H; terrainDirty=false; }
    ctx.clearRect(0,0,W,H); ctx.drawImage(terrain,0,0);

    // water — translucent warm-dark over the terrain (contours ghost through)
    const wl=S.town.waterline||0, wy=yForElev(wl)*H;
    const grd=ctx.createLinearGradient(0,wy,0,H); grd.addColorStop(0,'rgba(120,98,60,0.26)'); grd.addColorStop(1,'rgba(58,46,30,0.66)');
    ctx.fillStyle=grd; ctx.fillRect(0,wy,W,H-wy);
    for(let i=0;i<10;i++){ const yy=wy+(H-wy)*(i/10); ctx.beginPath(); ctx.strokeStyle=`rgba(46,36,22,${0.16-i*0.01})`; ctx.lineWidth=1;
      for(let x=0;x<=W;x+=10){const y=yy+Math.sin(x/70+i+ts/1300)*(2+i*0.2);x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);} ctx.stroke(); }
    ctx.beginPath(); ctx.strokeStyle=C.goldDeep; ctx.lineWidth=1.6; ctx.shadowColor='rgba(184,147,59,0.5)'; ctx.shadowBlur=6;
    for(let x=0;x<=W;x+=8){const y=wy+Math.sin(x/60+ts/900)*2; x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);} ctx.stroke(); ctx.shadowBlur=0;

    // pact threads (curved, dotted)
    const pos={}; S.town.districts.forEach(d=>{ if(d.holder) pos[d.holder.handle]={x:d.x*W,y:d.y*H}; });
    (S.pacts||[]).forEach(p=>{ const A=pos[p.a],B=pos[p.b]; if(A&&B){ ctx.beginPath(); ctx.setLineDash([2,4]); ctx.strokeStyle='rgba(184,147,59,0.55)'; ctx.lineWidth=1.2;
      const mx=(A.x+B.x)/2,my=(A.y+B.y)/2-24; ctx.moveTo(A.x,A.y); ctx.quadraticCurveTo(mx,my,B.x,B.y); ctx.stroke(); ctx.setLineDash([]); } });

    // vault (strongbox)
    const vx=S.town.vault.x*W, vy=S.town.vault.y*H;
    ctx.save(); ctx.shadowColor='rgba(184,147,59,0.55)'; ctx.shadowBlur=8+Math.sin(ts/700)*3;
    ctx.fillStyle=C.goldDeep; roundRect(ctx,vx-11,vy-8,22,16,3); ctx.fill(); ctx.restore();
    ctx.fillStyle=C.paper; ctx.beginPath(); ctx.arc(vx,vy,2.4,0,7); ctx.fill();
    lab('THE VAULT',vx,vy+20,C.muted,'10px ui-monospace','center');

    // districts
    const lead=S.standings.find(a=>a.alive)?.name;
    S.town.districts.forEach(d=>{
      const x=d.x*W,y=d.y*H,h=d.holder;
      if(d.status==='sunken'){ ctx.strokeStyle='rgba(20,26,30,0.6)'; ctx.lineWidth=1.5; ctx.beginPath();
        ctx.moveTo(x-5,y-5);ctx.lineTo(x+5,y+5);ctx.moveTo(x+5,y-5);ctx.lineTo(x-5,y+5);ctx.stroke();
        lab(d.name,x,y+15,'rgba(230,240,245,0.55)','italic 10px Sentient,Georgia,serif','center'); return; }
      // parcel: faint gold wash + nested rings
      ctx.fillStyle='rgba(239,223,167,0.16)'; ctx.beginPath(); ctx.arc(x,y,15,0,7); ctx.fill();
      ctx.strokeStyle='rgba(87,80,63,0.28)'; ctx.lineWidth=0.8; ctx.beginPath(); ctx.arc(x,y,13,0,7); ctx.stroke();
      if(d.onBallot){ for(let k=0;k<3;k++){ const pr=10+((ts/13+k*420)%1260)/1260*22; const al=0.5*(1-((ts/13+k*420)%1260)/1260);
        ctx.beginPath(); ctx.strokeStyle=`rgba(251,101,30,${al})`; ctx.lineWidth=1.4; ctx.arc(x,y,pr,0,7); ctx.stroke(); } }
      const isLead=h&&h.name===lead;
      ctx.beginPath(); ctx.fillStyle=isLead?C.goldDeep:C.ink; ctx.arc(x,y,5,0,7); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle=isLead?C.goldDeep:C.gold; ctx.lineWidth=1.4; ctx.arc(x,y,8,0,7); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle=isLead?C.goldDeep:'rgba(20,20,19,0.5)'; ctx.lineWidth=1; ctx.moveTo(x-11,y);ctx.lineTo(x+11,y);ctx.moveTo(x,y-11);ctx.lineTo(x,y+11); ctx.stroke();
      lab(d.name.toUpperCase(),x,y-15,C.inkSoft,'italic 10.5px Sentient,Georgia,serif','center');
      if(h){ const nm=h.name.split(' ')[0]; ctx.font='11px General Sans,sans-serif'; const tw=ctx.measureText(nm).width;
        ctx.fillStyle='rgba(250,247,239,0.92)'; roundRect(ctx,x-tw/2-5,y+11,tw+10,15,2); ctx.fill();
        ctx.strokeStyle=C.hair; ctx.lineWidth=1; roundRect(ctx,x-tw/2-5,y+11,tw+10,15,2); ctx.stroke();
        lab(nm,x,y+22,h.alive?C.ink:C.muted,'11px General Sans,sans-serif','center'); }
    });
  }
  function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
  function lab(t,x,y,color,font,align){ctx.fillStyle=color;ctx.font=font;ctx.textAlign=align||'left';ctx.fillText(t,x,y);}

  // ── the Unsealing (full board beat) ──────────────────────────────────────────
  let unsealT;
  function breachLine(name, br){
    if(br==null) return '';
    if(typeof br==='string') return `⚑ ${esc(br)}`;
    const dist=esc(br.district||br.ward||br.name||'a ward');
    const st=(br.stones!=null?br.stones:(br.cast!=null?br.cast:0));
    return `⚑ ${esc(name||'An owner')} said save ${dist} — cast ${esc(st)} stones there.`;
  }
  function unsealBeat(beat, fresh, lu){
    const ov=$('unseal');
    let kicker, title, body='', extras='';
    if(lu){                                  // backend Unsealing — hero the drowned district
      const drowned=(lu.drowned&&lu.drowned.length)?lu.drowned:[];
      kicker=`TIDE ${lu.tide||S.storm.tide} · THE UNSEALING`;
      title=drowned.length?drowned[0]:'THE WATERS HELD';
      const bits=[];
      if(lu.crest!=null) bits.push(`The water crested at ${Number(lu.crest).toFixed(1)} ft.`);
      if(drowned.length>1) bits.push(`Also lost: ${drowned.slice(1).map(esc).join(', ')}.`);
      body=bits.join(' ');
      const bl=[]; (lu.reveal||[]).forEach(r=>{ (r.breaches||[]).forEach(br=>{ const t=breachLine(r.name,br); if(t&&bl.length<3) bl.push(t); }); });
      extras=bl.map(t=>`<div class="ubreak">${t}</div>`).join('');
    } else {                                 // fallback — derive the beat from the ledger
      kicker=beat.verb==='crest'?'STORM '+S.storm.n:'TIDE '+S.storm.tide+' / '+S.storm.of;
      title=beat.verb==='crest'?'THE CREST':'THE LEVEE COURT';
      body=beat.text;
      extras=(fresh||[]).filter(x=>x.verb==='break').slice(0,3).map(b=>`<div class="ubreak">⚡ ${esc(b.text)}</div>`).join('');
    }
    ov.innerHTML=`<div class="ubox"><div class="useal"></div><div class="umono">${esc(kicker)}</div>
      <h2>${esc(title)}</h2>${body?`<p>${esc(body)}</p>`:''}${extras}</div>`;
    ov.classList.remove('on'); void ov.offsetWidth; ov.classList.add('on');
    const dur=(!lu&&beat&&beat.verb==='crest')?5200:4500;
    clearTimeout(unsealT); unsealT=setTimeout(()=>ov.classList.remove('on'), dur);
  }

  // first-visit "how to watch" intro — isolated overlay, shown once (localStorage), ?intro forces it.
  (function(){
    try{
      const intro=document.getElementById('intro'); if(!intro) return;
      const force=/[?&]intro\b/.test(location.search);
      if(force || !localStorage.getItem('hw-intro-seen')) intro.classList.add('on');
      const dismiss=()=>{ intro.classList.remove('on'); try{localStorage.setItem('hw-intro-seen','1');}catch(e){} };
      const go=document.getElementById('introGo'); if(go) go.addEventListener('click',dismiss);
      intro.addEventListener('click',(e)=>{ if(e.target===intro) dismiss(); });
      document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') dismiss(); });
    }catch(e){}
  })();

  resize(); requestAnimationFrame(drawMap); poll();
})();
