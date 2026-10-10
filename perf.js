// Explicit local benchmark only. rAF/GPU timings are not physical display FPS.
export function createPerf(renderer){
 const query=new URLSearchParams(location.search),enabled=query.has('bench')||query.has('measure'),scenario=query.get('bench');
 const gl=renderer.getContext(),ext=enabled?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;
 let active,begin=0,last=0,start=0,ended=false,renderStart=0,lastPublish=0;
 const pending=[],cpu=[],gpu=[],intervals=[],calls=[],triangles=[];
 const stats=a=>{const s=[...a].sort((x,y)=>x-y);return {n:s.length,median:s[Math.floor(s.length*.5)]||0,p95:s[Math.floor(s.length*.95)]||0,max:s.at(-1)||0};};
 function publish(done=false){if(!enabled)return;document.querySelector('#world').dataset.perf=JSON.stringify({scenario:scenario||'manual',done,cpu:stats(cpu),gpu:stats(gpu),intervals:stats(intervals),calls:stats(calls),triangles:stats(triangles),pixelRatio:renderer.getPixelRatio(),size:[innerWidth,innerHeight],gpuTimer:!!ext,physicalDisplayFPS:false});}
 return {
  scenario,
  drive(now,camera,controls,roots,invalidate){
   if(!scenario||ended)return;
   if(!start){start=now;return;}
   const seconds=(now-start)/1000;
   if(seconds>7){ended=true;publish(true);return;}
   if(scenario==='orbit'){const angle=.644+seconds*.16;camera.position.set(Math.sin(angle)*20,28,Math.cos(angle)*20);controls.target.set(0,.4,0);invalidate();}
   if(scenario==='shadow'){invalidate(true);}
  },
  begin(now){
   if(!enabled||ended)return;
   begin=now;renderStart=performance.now();
   if(last&&now-last<150&&(!scenario||now-start>1000))intervals.push(now-last);last=now;
   if(ext){for(let i=pending.length-1;i>=0;i--){const q=pending[i];if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT)&&(!scenario||now-start>1000))gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);pending.splice(i,1);}}if(pending.length<12){active=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,active);}}
  },
  end(){
   if(!enabled||ended)return;
   if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null;}
   if(!scenario||begin-start>1000){cpu.push(performance.now()-renderStart);calls.push(renderer.info.render.calls);triangles.push(renderer.info.render.triangles);}
   if(begin-lastPublish>500){publish();lastPublish=begin;}
  }
 };
}
