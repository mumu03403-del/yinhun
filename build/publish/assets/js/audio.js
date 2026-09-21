window.GinAudio = (function(){
  const KEY='gin_audio_v1';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY)!=='0'; } catch(e){}
  const cache={};
  function el(name){
    if(!cache[name]){ const a=new Audio('assets/audio/'+name+'.mp3'); a.preload='auto'; cache[name]=a; }
    return cache[name];
  }
  function setEnabled(v){ enabled=!!v; try{localStorage.setItem(KEY, enabled?'1':'0');}catch(e){} if(!enabled){ for(const k in cache){ try{cache[k].pause();}catch(e){} } } }
  function isEnabled(){ return enabled; }
  function playSfx(name){ if(!enabled) return; try{ const a=el(name); a.currentTime=0; const p=a.play(); if(p&&p.catch)p.catch(function(){}); }catch(e){} }
  function playVoice(name){ if(!enabled) return; try{ const a=el('voice_'+name); a.currentTime=0; const p=a.play(); if(p&&p.catch)p.catch(function(){}); }catch(e){} }
  function beep(freq,dur){ if(!enabled) return; try{ const Ctx=window.AudioContext||window.webkitAudioContext; if(!Ctx) return; const c=new Ctx(); const o=c.createOscillator(); const g=c.createGain(); o.type='triangle'; o.frequency.value=freq||720; g.gain.value=0.06; o.connect(g); g.connect(c.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+(dur||0.05)); o.stop(c.currentTime+(dur||0.05)); setTimeout(function(){try{c.close();}catch(e){}}, ((dur||0.05)*1000)+60); }catch(e){} }
  function blip(){ beep(720,0.05); }
  function fanfare(){ if(!enabled) return; [523,659,784,1047].forEach(function(f,i){ setTimeout(function(){beep(f,0.12);}, i*90); }); }
  return { setEnabled:setEnabled, isEnabled:isEnabled, playSfx:playSfx, playVoice:playVoice, blip:blip, fanfare:fanfare, KEY:KEY };
})();
