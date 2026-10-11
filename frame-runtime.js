// One pending animation frame, no polling while the scene is unchanged.
export function createFramePump(tick,{request=requestAnimationFrame,cancel=cancelAnimationFrame,later=setTimeout,clear=clearTimeout}={}){
 let frame=0,timer=0,disposed=false,wakes=0,ticks=0;
 function wake(){if(disposed||frame)return;wakes++;frame=request(now=>{frame=0;ticks++;if(tick(now))wake();});}
 function settle(ms){if(timer)clear(timer);timer=later(()=>{timer=0;wake();},ms);}
 return {wake,settle,pause(){if(frame)cancel(frame);frame=0;if(timer)clear(timer);timer=0;},dispose(){this.pause();disposed=true;},stats:()=>({wakes,ticks,pending:!!frame})};
}

// OrbitControls accumulates angular/pan/zoom deltas. Apply them once at the next
// frame, retaining the complete movement instead of discarding intermediate input.
export function deferControlUpdates(controls,wake){
 const update=controls.update.bind(controls);let pending=false,requested=0,executed=0;
 controls.update=()=>{
  requested++;
  // In the bundled OrbitControls, pinch+pan uses the current zoom distance for
  // each pan step. Keep multi-touch synchronous so batching cannot alter it.
  if(controls._pointers?.length>1){pending=false;executed++;return update();}
  pending=true;wake();return false;
 };
 return {flush(delta){pending=false;executed++;return update(delta);},pending:()=>pending,stats:()=>({requested,executed}),restore(){controls.update=update;}};
}
