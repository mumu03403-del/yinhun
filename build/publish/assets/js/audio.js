window.GinAudio = (function(){
  const KEY='gin_audio_v1';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY)!=='0'; } catch(e){}
  const cache={};
  let ctx=null;
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
    if(!cache[name]){ const a=new Audio('assets/audio/'+name+'.mp3'); a.preload='auto'; cache[name]=a; }
    return cache[name];
  }
  function setEnabled(v){ enabled=!!v; try{localStorage.setItem(KEY, enabled?'1':'0');}catch(e){} if(!enabled){ for(const k in cache){ try{cache[k].pause();}catch(e){} } } }
  function isEnabled(){ return enabled; }
  function playSfx(name){ if(!enabled) return; try{ const a=el(name); a.currentTime=0; const p=a.play(); if(p&&p.catch)p.catch(function(){}); }catch(e){} }
  function playVoice(name){ if(!enabled) return; try{ const a=el('voice_'+name); a.currentTime=0; const p=a.play(); if(p&&p.catch)p.catch(function(){}); }catch(e){} }
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
