window.GinAudio = (function(){
  const KEY='gin_audio_v1';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY)!=='0'; } catch(e){}
  const cache={};
  let ctx=null;
  // Assume mp3 assets are served. A probe flips this to false when the host
  // cannot deliver our .mp3 files (e.g. a static preview snapshot that 404s
  // audio) so we fall back to procedural WebAudio synthesis instead of silence.
  let mp3ok = true;

  try {
    const probe = fetch('assets/audio/sfx_merge.mp3', { method:'GET', headers:{'Range':'bytes=0-0'} });
    if (probe && probe.then) {
      probe.then(function(r){ if(!r.ok){ mp3ok=false; } }).catch(function(){ mp3ok=false; });
    }
  } catch(e){ mp3ok=false; }

  function ac(){
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx) return null;
      if(!ctx) ctx=new Ctx();
      if(ctx.state==='suspended'){ try{ctx.resume();}catch(e){} }
      return ctx;
    }catch(e){ return null; }
  }
  function el(name){
    if(!cache[name]){
      const a=new Audio('assets/audio/'+name+'.mp3');
      a.preload='auto';
      a.addEventListener('error', function(){ a.__failed=true; mp3ok=false; });
      cache[name]=a;
    }
    return cache[name];
  }
  function setEnabled(v){ enabled=!!v; try{localStorage.setItem(KEY, enabled?'1':'0');}catch(e){} if(!enabled){ for(const k in cache){ try{cache[k].pause();}catch(e){} } } }
  function isEnabled(){ return enabled; }

  // ---- procedural fallbacks (used when mp3 is unavailable) ----
  function synthSfx(name){
    if(name==='sfx_unlock'){ unlock(); return; }
    if(name==='sfx_merge'){ note(880,0.06,0,'square',0.05); note(1320,0.05,0.05,'square',0.04); return; }
    if(name==='sfx_settle'){ note(300,0.10,0,'sine',0.05); return; }
    blip();
  }
  function synthVoice(){
    // a short "talk" blip so characters are never fully silent in preview
    note(520,0.05,0,'triangle',0.05);
    note(660,0.05,0.06,'triangle',0.045);
    note(440,0.05,0.12,'triangle',0.045);
  }

  function playSfx(name){
    if(!enabled) return;
    if(!mp3ok){ synthSfx(name); return; }
    try{ const a=el(name); a.currentTime=0; const p=a.play(); if(p&&p.catch)p.catch(function(){ a.__failed=true; mp3ok=false; synthSfx(name); }); }catch(e){ mp3ok=false; synthSfx(name); }
  }
  function playVoice(name){
    if(!enabled) return;
    if(!mp3ok){ synthVoice(); return; }
    try{ const a=el('voice_'+name); a.currentTime=0; const p=a.play(); if(p&&p.catch)p.catch(function(){ a.__failed=true; mp3ok=false; synthVoice(); }); }catch(e){ mp3ok=false; synthVoice(); }
  }
  function note(freq,dur,delay,type,vol){
    if(!enabled) return;
    try{
      const c=ac(); if(!c) return;
      const t=c.currentTime+(delay||0);
      const o=c.createOscillator(); const g=c.createGain();
      o.type=type||'triangle'; o.frequency.value=freq;
      g.gain.setValueAtTime(vol||0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+(dur||0.05));
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t+(dur||0.05)+0.02);
    }catch(e){}
  }
  function beep(freq,dur){ note(freq, dur||0.05, 0); }
  function sweep(f1,f2,dur,vol){
    if(!enabled) return;
    try{
      const c=ac(); if(!c) return;
      const t=c.currentTime, d=dur||0.15;
      const o=c.createOscillator(); const g=c.createGain();
      o.type='triangle';
      o.frequency.setValueAtTime(f1||300, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1,f2||800), t+d);
      g.gain.setValueAtTime(vol||0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+d);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t+d+0.02);
    }catch(e){}
  }
  function blip(){ beep(720,0.05); }
  function click(){ note(1245,0.035,0,'square',0.03); note(1660,0.03,0.02,'square',0.022); }
  function jump(){ sweep(320,780,0.16); }
  function hit(){ note(180,0.07,0,'square',0.07); sweep(500,140,0.08,0.04); }
  function unlock(){ [523,659,784,1047].forEach(function(f,i){ note(f,0.09,i*0.07); }); }
  function locked(){ note(160,0.12,0,'square',0.05); note(140,0.14,0.12,'square',0.05); }
  function fanfare(){ [523,659,784,1047].forEach(function(f,i){ note(f,0.12,i*0.09); }); }
  function lose(){ [392,330,262,196].forEach(function(f,i){ note(f,0.16,i*0.13); }); }
  return { setEnabled:setEnabled, isEnabled:isEnabled, playSfx:playSfx, playVoice:playVoice, beep:beep, sweep:sweep, blip:blip, click:click, jump:jump, hit:hit, unlock:unlock, locked:locked, fanfare:fanfare, lose:lose, KEY:KEY };
})();
