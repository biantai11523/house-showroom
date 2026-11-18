// All budgets refer to physical drawing-buffer pixels, independent of CSS layout.
export function renderScales(width,height,dpr,mobile,maxSide){
 const pixels=Math.max(1,width*height);
 const side=maxSide/Math.max(1,width,height);
 const scale=(density,limit)=>Math.min(density,Math.sqrt(limit/pixels),side);
 const base=scale(Math.min(dpr,mobile?1.25:1.5),mobile?750000:2400000);
 const fast=scale(Math.min(dpr,mobile?1.8:2),mobile?1450000:3400000);
 const still=scale(Math.min(Math.max(dpr,mobile?1.5:1.25),mobile?3:2.5),mobile?3200000:5800000);
 return {base,fast,still};
}

// Promote only after repeated GPU headroom at the *measured* render scale.
export function motionDetail(){
 let boosted=false,fastSamples=0,slowGpu=0,slowFrames=0,retryAt=0;
 let lastFrame=null,baseMedian=0,baseP90=0;
 const intervals=[];
 function pause(){
  intervals.length=0;lastFrame=null;slowFrames=0;
 }
 function reset(){
  boosted=false;fastSamples=0;slowGpu=0;retryAt=0;baseMedian=0;baseP90=0;pause();
 }
 function stepUp(){boosted=true;fastSamples=0;slowGpu=0;pause();}
 function stepDown(now){reset();retryAt=now+4000;}
 function ratio(plan){return boosted?plan.fast:plan.base;}
 function observe(ms,measuredRatio,now,plan){
  if(!Number.isFinite(ms)||ms<=0||measuredRatio!==ratio(plan)||plan.fast<=plan.base)return;
  if(boosted){
   const limit=baseMedian?Math.min(10.5,baseMedian*.94):10.5;
   slowGpu=ms>limit?slowGpu+1:0;
   if(slowGpu>=2)stepDown(now);
   return;
  }
  if(now<retryAt)return;
  // Geometry and draw submission need not scale with pixel count. Try the
  // higher tier with measured headroom, then use its actual time to retain it.
  const headroom=baseMedian?Math.min(7.2,baseMedian*.72):5;
  fastSamples=ms<headroom?fastSamples+1:0;
  if(fastSamples>=3)stepUp();
 }
 // Browsers without GPU timers can try a higher scale after a stable run, then
 // compare frame intervals against their own baseline. Never sample idle gaps.
 function observeFrame(now,plan,allowUntimedTrial=true){
  if(plan.fast<=plan.base)return;
  const elapsed=lastFrame===null?0:now-lastFrame;
  lastFrame=now;
  if(elapsed>100&&boosted){stepDown(now);return;}
  if(elapsed<=0||elapsed>100){intervals.length=0;slowFrames=0;return;}
  if(boosted&&baseMedian){
   slowFrames=elapsed>Math.max(17,baseMedian*1.65)?slowFrames+1:0;
   if(slowFrames>=3){stepDown(now);return;}
  }
  if(now<retryAt)return;
  intervals.push(elapsed);
  if(intervals.length<24)return;
  intervals.sort((a,b)=>a-b);
  const median=intervals[12],p90=intervals[21];
  intervals.length=0;
  if(!boosted){
   baseMedian=median;baseP90=p90;
   if(allowUntimedTrial&&median<=18.5&&p90<=22)stepUp();
  }else if(baseMedian&&(median>baseMedian*1.18+1||p90>baseP90*1.25+1)){
   stepDown(now);
  }
 }
 return {ratio,observe,observeFrame,pause,reset};
}
