/** Presentation clock only. A saved result is supplied by the caller; never draws. */
export function startOpeningSequence({reducedMotion=false,isActive=()=>true,startViewer,
  onModelStatus=()=>{},onFrame=()=>{},onReveal=()=>{},onFinish=()=>{},
  requestFrame=globalThis.requestAnimationFrame,cancelFrame=globalThis.cancelAnimationFrame}) {
  let disposed=false,finished=false,revealed=false,ready=false,frame=0,last=null,time=0;
  const active=()=>!disposed&&isActive();
  const reveal=()=>{if(!revealed&&active()){revealed=true;onReveal();}};
  const finish=()=>{
    if(!active()||finished)return;
    finished=true;cancelFrame(frame);frame=0;time=2600;onFrame(time);reveal();onFinish();
  };
  const tick=stamp=>{
    frame=0;if(!active()||finished)return;
    const delta=last===null?0:Math.min(64,Math.max(0,stamp-last));last=stamp;
    if(reducedMotion){
      time=ready?time+delta*13:Math.min(260,time+delta*13);
    }else time=ready?time+delta:Math.min(260,time+delta);
    onFrame(Math.min(2600,time));
    if(time>=2280)reveal();
    if(time>=2600){finish();return;}
    if(time<260||ready)frame=requestFrame(tick);
    else last=null; // Loading time is not performance time.
  };
  const report=kind=>{
    if(!active())return;
    ready=kind==='ready';onModelStatus(kind);
    if(kind==='error'||kind==='missing')reveal();
    if(!finished&&!frame){last=null;frame=requestFrame(tick);}
  };
  const controls={skip:finish,run(action){if(!active())return;finish();return action();},
    dispose(){disposed=true;cancelFrame(frame);frame=0;}};
  if(!active())return controls;
  onFrame(0);frame=requestFrame(tick);
  try{Promise.resolve(startViewer(report)).catch(()=>report('error'));}catch{report('error');}
  return controls;
}
