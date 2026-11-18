import {createPerf} from './perf.js?v=clarity2';
import {renderScales,motionDetail} from './display-resolution.js?v=2';
import {createFramePump,deferControlUpdates} from './frame-runtime.js?v=04';
import {realtimeMaterial,mergeStaticMeshes,preparePicking,furnitureBounds} from './scene-performance.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import * as SunCalc from '../vendor/suncalc/index.js';
import {STORAGE_KEY,overlap,reconcileLayout,hourLabel} from './layout.js';
const $=s=>document.querySelector(s),world=$('#world');
const query=new URLSearchParams(location.search),logicOptimized=query.get('logic')!=='baseline',qa=query.has('qa');
let pump=null,queuedTime=null,sceneSyncs=0;
let layoutStorageKey=STORAGE_KEY;
let roomFov=null;
function applyRoomLens(){
 const scale=Math.max(1,1.52/camera.aspect);
 camera.fov=roomFov===null?35:Math.min(113,THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(roomFov/2))*scale)));
 camera.updateProjectionMatrix();
}
const mobile=new URLSearchParams(location.search).get('quality')==='mobile'||matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('mobile-render',mobile);
const scene=new THREE.Scene();scene.background=new THREE.Color('#eeeae3');
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.05,200);
const renderer=new THREE.WebGLRenderer({antialias:!mobile,powerPreference:'high-performance'});
const gl=renderer.getContext();
const maxSide=Math.min(renderer.capabilities.maxTextureSize,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
const detail=motionDetail();
let displayDpr=devicePixelRatio;
let scales=renderScales(innerWidth,innerHeight,displayDpr,mobile,maxSide);
let bufferWidth=0,bufferHeight=0,bufferRatio=0,bufferChanges=0,qualityPhase='motion';
function applyDrawScale(ratio){
 const w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);
 if(bufferWidth===w&&bufferHeight===h&&bufferRatio===ratio)return;
 renderer.setDrawingBufferSize(w,h,ratio);
 bufferWidth=w;bufferHeight=h;bufferRatio=ratio;bufferChanges++;
}
applyDrawScale(scales.base);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
renderer.info.autoReset=false;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;
world.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=!mobile;controls.dampingFactor=.18;controls.rotateSpeed=.6;controls.zoomSpeed=.9;
function homeScale(){return Math.max(1,1/camera.aspect);}
function fitOrbitRange(){controls.maxDistance=Math.max(55,35*homeScale()+2);}
controls.minDistance=1.5;fitOrbitRange();controls.maxPolarAngle=Math.PI*.485;controls.minPolarAngle=.08;controls.screenSpacePanning=true;
const hemi=new THREE.HemisphereLight('#fff9ed','#998a72',2);scene.add(hemi);
const sun=new THREE.DirectionalLight('#ffdfaf',3);sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:1,far:65});sun.shadow.bias=-.0003;sun.shadow.normalBias=.025;sun.shadow.radius=2;scene.add(sun,sun.target);
const fill=new THREE.DirectionalLight('#dce5ed',1);fill.position.set(-10,12,8);scene.add(fill);
const pmrem=new THREE.PMREMGenerator(renderer);const env=new RoomEnvironment();scene.environment=pmrem.fromScene(env,.04).texture;env.dispose();pmrem.dispose();scene.environmentIntensity=.4;
const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#e9e4db',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.16;ground.receiveShadow=true;scene.add(ground);
const composer=mobile?null:new EffectComposer(renderer);
const ao=composer?new GTAOPass(scene,camera,innerWidth,innerHeight):null;
let postWidth=0,postHeight=0;
function fitPostTargets(){
 if(!composer)return;
 const {width,height}=renderer.domElement;
 if(postWidth===width&&postHeight===height)return;
 composer.setSize(width,height);
 // Keep full-resolution colour and SMAA. The softer contact term has its own target.
 ao.setSize(Math.min(width,Math.max(1,Math.floor(innerWidth*scales.base))),
            Math.min(height,Math.max(1,Math.floor(innerHeight*scales.base))));
 postWidth=width;postHeight=height;
}
if(composer){
 composer.setPixelRatio(1);
 composer.addPass(new RenderPass(scene,camera));
 ao.output=GTAOPass.OUTPUT.Default;ao.updateGtaoMaterial({radius:.22,distanceExponent:1,thickness:.3,distanceFallOff:1,scale:1,samples:16});
 ao.blendIntensity=.35;composer.addPass(ao);composer.addPass(new OutputPass());composer.addPass(new SMAAPass());
 fitPostTargets();
}
let model,manifest,center=new THREE.Vector3(),bounds,roots=[],meshes=[],roofs=[],walls=[],lamps=[],ready=false,editing=false,selected=null,drag=null,tween=null,dirty=true,lastInteraction=performance.now(),draws=0,renderIntervals=[],lastRender=0,needsSharp=true;
const original=new Map(),undoStack=[];let storageOK=true;
const localBounds=new Map();let controlActive=false,shadowDirty=true,lastShadow=0,pendingPointer=null,batchReport=null,pickMs=0,dragMs=0;
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hitPoint=new THREE.Vector3();
const selectionRing=new THREE.Mesh(new THREE.RingGeometry(.48,.5,72),new THREE.MeshBasicMaterial({color:'#aa8155',transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide}));selectionRing.rotation.x=-Math.PI/2;selectionRing.visible=false;scene.add(selectionRing);
function invalidate(shadows=false){dirty=true;lastInteraction=performance.now();needsSharp=true;if(shadows)shadowDirty=true;pump?.wake();pump?.settle(320);}
const controlBatch=logicOptimized?deferControlUpdates(controls,()=>pump?.wake()):null;
const updateControls=()=>controlBatch?controlBatch.flush():controls.update();
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),2500);}
function transform(o){return {position:o.position.toArray(),quaternion:o.quaternion.toArray()};}
function snapshot(){return Object.fromEntries(roots.map(o=>[o.userData.furniture_id,transform(o)]));}
function applyTransforms(transforms){for(const o of roots){const t=transforms[o.userData.furniture_id];if(t){o.position.fromArray(t.position);o.quaternion.fromArray(t.quaternion);}}model.updateMatrixWorld(true);updateSelection();invalidate(true);}
function commit(before){if(JSON.stringify(before)!==JSON.stringify(snapshot())){undoStack.push(before);if(undoStack.length>40)undoStack.shift();$('#undo').disabled=false;persist();}}
function persist(){const overrides=Object.fromEntries(Object.entries(snapshot()).filter(([id,t])=>JSON.stringify(t)!==JSON.stringify(original.get(id))));try{localStorage.setItem(layoutStorageKey,JSON.stringify({schema:1,source:manifest.source_sha256,transforms:overrides,saved:new Date().toISOString()}));$('#save-status').innerHTML='<i></i> 布局已在本机保存';}catch{storageOK=false;$('#save-status').textContent='请下载布局保存';}invalidate(true);}
function undo(){if(!undoStack.length)return;applyTransforms(undoStack.pop());$('#undo').disabled=!undoStack.length;persist();toast('已撤销上一步');}
function rootOf(o){while(o){if(o.userData.furniture_id)return o;o=o.parent;}return null;}
function worldBounds(o){o.updateWorldMatrix(true,false);return localBounds.has(o)?localBounds.get(o).clone().applyMatrix4(o.matrixWorld):new THREE.Box3().setFromObject(o);}
function box2(o){const b=worldBounds(o);return [b.min.x+.03,b.min.z+.03,b.max.x-.03,b.max.z-.03];}
function obstacleList(o){return [...walls,...roots.filter(r=>r!==o).map(box2)];}
function penetration(o,obstacles){const b=box2(o);return obstacles.map(w=>overlap(b,w));}
function validPlacement(o,obstacles,baseline){const b=box2(o);if(b[0]<bounds.min.x+.1||b[2]>bounds.max.x-.1||b[1]<bounds.min.z+.1||b[3]>bounds.max.z-.1)return false;return obstacles.every((w,i)=>overlap(b,w)<=Math.max(.004,baseline[i]+.003));}
function updateSelection(){if(!selected){selectionRing.visible=false;return;}const b=worldBounds(selected),sz=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3());selectionRing.position.set(c.x,.025,c.z);selectionRing.scale.set(Math.max(sz.x,sz.z)+.2,Math.max(sz.x,sz.z)+.2,1);selectionRing.visible=editing;selectionRing.updateMatrixWorld(true);}
function select(o){selected=o;$('#selected').hidden=!o;if(o){$('#selected-name').textContent=o.userData.web_source_name||o.name;$('#help-panel').hidden=true;}updateSelection();invalidate();}
function setEditing(value){if(drag)finishDrag(true);editing=value;document.body.classList.toggle('edit',value);$('#mode-edit').classList.toggle('active',value);$('#mode-look').classList.toggle('active',!value);$('#hint').textContent=value?'拖动家具 · Shift 对齐 · Esc 取消':'拖动旋转 · 滚轮靠近';if(value){showRoof(false);if(camera.position.y<3)goView('home');toast('直接拖动家具，空白处仍可旋转');}else select(null);invalidate();}
function showRoof(value){roofs.forEach(o=>o.visible=value);document.body.classList.toggle('interior',value);$('#scene-status').textContent=value?'室内近看 · 完整封顶':'真实空间 · 完整墙体';invalidate(true);}
const presets={living:{target:[8.0,1.1,-3.1],position:[8.1,1.7,-.7]},dining:{target:[8.5,1.1,-7.2],position:[10.4,1.75,-5.25]},study:{target:[3.4,1.1,-7.8],position:[5.6,1.7,-6.2]},bedroom:{target:[10.6,1.0,-9.3],position:[8.9,1.6,-8.0]}};
function goView(name){if(!ready)return;let p,t;
 if(name==='home'){showRoof(false);t=new THREE.Vector3(0,.4,0);p=new THREE.Vector3(12,28,16).multiplyScalar(homeScale());controls.maxPolarAngle=Math.PI*.485;roomFov=null;}
 else{if(editing)setEditing(false);showRoof(true);const labels={living:'客厅',dining:'餐厨',study:'书房',bedroom:'主卧'};const cameraKey={entry:'细节｜玄关拱窗',espresso:'细节｜餐边咖啡吧',child:'细节｜儿童房衣柜'}[name]||'呈现｜室内'+labels[name];const v=manifest.cameras?.[cameraKey]||presets[name];p=new THREE.Vector3(...v.position).sub(center);t=new THREE.Vector3(...v.target).sub(center);controls.maxPolarAngle=Math.PI*.82;roomFov=manifest.asset_file&&v.fov?v.fov:null;}
 controls.minDistance=manifest.asset_file && name!=='home' ? 0.18 : 1.5;
 applyRoomLens();
 tween={start:performance.now(),from:camera.position.clone(),targetFrom:controls.target.clone(),p,t};$('.view.active')?.classList.remove('active');$(`[data-view="${name}"]`)?.classList.add('active');invalidate();}
controls.addEventListener('start',()=>{controlActive=true;tween=null;invalidate();});controls.addEventListener('end',()=>{controlActive=false;invalidate();});controls.addEventListener('change',()=>invalidate());
function setRay(e){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);}
function floorPoint(e){setRay(e);return ray.ray.intersectPlane(plane,hitPoint);}
function finishDrag(cancel=false){if(!drag)return;if(pendingPointer&&!cancel)moveFurniture(pendingPointer);pendingPointer=null;const d=drag;drag=null;document.body.classList.remove('dragging');controls.enabled=true;
 if(cancel){applyTransforms(d.before);toast('已取消摆放');}else commit(d.before);
 try{renderer.domElement.releasePointerCapture(d.pointerId);}catch{}updateSelection();invalidate(true);
}
renderer.domElement.addEventListener('pointerdown',e=>{
 if(!ready||e.button!==0||!editing||drag)return;const start=performance.now();setRay(e);model.updateMatrixWorld(true);ray.firstHitOnly=true;
 const hits=ray.intersectObjects(meshes.filter(o=>o.visible&&!o.userData.web_roof),false);pickMs=performance.now()-start;const chosen=hits.length?rootOf(hits[0].object):null;
 if(!chosen){select(null);return;}const point=floorPoint(e);if(!point)return;
 select(chosen);const wp=chosen.getWorldPosition(new THREE.Vector3());const obs=obstacleList(chosen);
 drag={object:chosen,pointerId:e.pointerId,before:snapshot(),offset:wp.clone().sub(point),last:chosen.position.clone(),obstacles:obs,baseline:penetration(chosen,obs),x:e.clientX,y:e.clientY};
 controls.enabled=false;tween=null;e.stopImmediatePropagation();renderer.domElement.setPointerCapture(e.pointerId);document.body.classList.add('dragging');invalidate();
},true);
function moveFurniture(e){
 const start=performance.now();const p=floorPoint(e);if(!p)return;
 const d=drag,pos=p.clone().add(d.offset);d.object.parent.worldToLocal(pos);pos.y=d.last.y;
 if(e.shiftKey){pos.x=Math.round(pos.x*10)/10;pos.z=Math.round(pos.z*10)/10;}
 const from=d.last.clone(),steps=Math.max(1,Math.ceil(from.distanceTo(pos)/.06));let blocked=false;
 for(let i=1;i<=Math.min(steps,200);i++){
  d.object.position.lerpVectors(from,pos,i/steps);
  if(!validPlacement(d.object,d.obstacles,d.baseline)){
   blocked=true;const desired=d.object.position.clone(),candidates=[];
   // Slide along the unobstructed wall axis instead of sticking on diagonal input.
   d.object.position.set(desired.x,d.last.y,d.last.z);if(validPlacement(d.object,d.obstacles,d.baseline))candidates.push(d.object.position.clone());
   d.object.position.set(d.last.x,d.last.y,desired.z);if(validPlacement(d.object,d.obstacles,d.baseline))candidates.push(d.object.position.clone());
   candidates.sort((a,b)=>b.distanceToSquared(d.last)-a.distanceToSquared(d.last));
   if(!candidates.length)break;d.object.position.copy(candidates[0]);
  }
  d.last.copy(d.object.position);
 }
 d.object.position.copy(d.last);d.object.updateMatrixWorld(true);
 if(!blocked){$('#placement-status').textContent=e.shiftKey?'已按 10cm 网格对齐':'松手放好 · Esc 取消';selectionRing.material.color.set('#aa8155');}
 else{$('#placement-status').textContent='这里靠近墙体或其他家具';selectionRing.material.color.set('#b86451');}
 updateSelection();invalidate(true);dragMs=performance.now()-start;
}
renderer.domElement.addEventListener('pointermove',e=>{
 if(!drag||e.pointerId!==drag.pointerId)return;e.stopImmediatePropagation();pendingPointer={clientX:e.clientX,clientY:e.clientY,shiftKey:e.shiftKey};dirty=true;pump?.wake();
},true);
renderer.domElement.addEventListener('pointerup',e=>{if(drag&&e.pointerId===drag.pointerId){e.stopImmediatePropagation();finishDrag();}},true);
renderer.domElement.addEventListener('pointercancel',()=>finishDrag(true));window.addEventListener('blur',()=>{controlActive=false;finishDrag(true);invalidate();});
function rotatePiece(angle){if(!selected)return;const before=snapshot(),obs=obstacleList(selected),baseline=penetration(selected,obs);selected.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle));selected.updateMatrixWorld(true);if(!validPlacement(selected,obs,baseline)){applyTransforms(before);toast('旋转空间不足');return;}commit(before);updateSelection();invalidate(true);}
$('#rotate-left').onclick=()=>rotatePiece(Math.PI/12);$('#rotate-right').onclick=()=>rotatePiece(-Math.PI/12);$('#deselect').onclick=()=>select(null);
$('#reset-piece').onclick=()=>{if(!selected)return;const before=snapshot();applyTransforms({[selected.userData.furniture_id]:original.get(selected.userData.furniture_id)});commit(before);};
$('#mode-look').onclick=()=>setEditing(false);$('#mode-edit').onclick=()=>setEditing(true);$('#undo').onclick=undo;
$('#reset-all').onclick=()=>{if(!ready)return;const before=snapshot();applyTransforms(Object.fromEntries(original));commit(before);toast('已恢复设计布局，可以撤销');};
$('#home').onclick=()=>goView('home');document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>goView(b.dataset.view));
$('#help').onclick=()=>{$('#help-panel').hidden=!$('#help-panel').hidden;if(!$('#help-panel').hidden)$('#selected').hidden=true;else $('#selected').hidden=!selected;};
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('可在浏览器中放大展示窗口');}};
$('#save-layout').onclick=()=>{if(!ready)return;const content=JSON.stringify({schema:1,source:manifest.source_sha256,source_file:manifest.source,transforms:snapshot(),saved:new Date().toISOString()},null,2),u=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='华林1402_家具布局.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);toast('布局已导出，原设计文件保持不变');};
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA'].includes(e.target.tagName))return;if(e.key==='Escape'){if(drag)finishDrag(true);else select(null);$('#help-panel').hidden=true;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}if(e.key.toLowerCase()==='r')goView('home');if(e.key===',')rotatePiece(Math.PI/12);if(e.key==='.')rotatePiece(-Math.PI/12);});
function setTime(hour){$('#clock').textContent=hourLabel(hour);const d=new Date(new Date((manifest?.sun_date||'2026-09-30')+'T00:00:00+08:00').getTime()+hour*3600000);const p=SunCalc.getPosition(d,26.0745,119.2965);const a=p.azimuth*Math.PI/180,h=p.altitude*Math.PI/180;
 sun.position.set(Math.sin(a)*Math.cos(h)*25,Math.sin(h)*25,-Math.cos(a)*Math.cos(h)*25);sun.target.position.set(0,0,0);const day=THREE.MathUtils.smoothstep(p.altitude,-4,15);sun.intensity=Math.max(0,day*3.2);sun.color.setHSL(.09,.15+(1-day)*.35,.85);hemi.intensity=.7+day*1.5;fill.intensity=.45+day*.55;scene.environmentIntensity=.3+day*.15;
 if(manifest?.asset_file){hemi.intensity=.34+day*1.13;fill.intensity=.18+day*.46;scene.environmentIntensity=.24+day*.2;}
 const nightLamps=day<.999;
 if(lamps.length&&lamps[0].visible!==nightLamps)detail.reset();
 for(const light of lamps){light.intensity=light.userData.nightIntensity*(1-day);light.visible=nightLamps;}
 scene.background.set('#eeeae3').lerp(new THREE.Color('#b4b4b8'),1-day);ground.material.color.copy(scene.background);document.body.classList.toggle('night',day<.2);sun.updateMatrixWorld();sun.target.updateMatrixWorld();sceneSyncs++;invalidate(true);
}
$('#time').oninput=e=>{if(!logicOptimized)return setTime(Number(e.target.value));queuedTime=Number(e.target.value);$('#clock').textContent=hourLabel(queuedTime);pump?.wake();};
let densityQuery=null;
function watchDensity(){
 densityQuery?.removeEventListener('change',resize);
 densityQuery=matchMedia('(resolution: '+displayDpr+'dppx)');
 densityQuery.addEventListener('change',resize);
}
function resize(){
 camera.aspect=innerWidth/Math.max(1,innerHeight);applyRoomLens();fitOrbitRange();
 if(displayDpr!==devicePixelRatio){displayDpr=devicePixelRatio;watchDensity();}
 scales=renderScales(innerWidth,innerHeight,displayDpr,mobile,maxSide);
 detail.reset();invalidate();
}
function syncDisplayDensity(){if(displayDpr!==devicePixelRatio)resize();}
window.addEventListener('resize',resize);
window.addEventListener('focus',syncDisplayDensity);
watchDensity();
async function loadModelFile(file,digest,bytes){
 const transport=manifest.gzip?.[file];
 const url='./assets/'+(transport?.file||file)+'?v='+(transport?.sha256||digest);
 function progress(e){
  const ratio=Math.min(1,e.loaded/(transport?.bytes||bytes||e.total||Infinity));
  $('#load-progress').style.width=`${5+ratio*70}%`;
  $('#load-text').textContent=ratio?`载入空间与材质 · ${Math.round(ratio*100)}%`:'正在载入空间…';
 }
 const loader=new GLTFLoader();
 if(!transport)return loader.loadAsync(url,progress);
 let data=await new THREE.FileLoader().setResponseType('arraybuffer').loadAsync(url,progress);
 const magic=new Uint8Array(data,0,2);
 if(magic[0]===31&&magic[1]===139){
  if(typeof DecompressionStream==='function'){
   const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
   data=await new Response(stream).arrayBuffer();
  }else{
   const {gunzipSync}=await import('three/addons/libs/fflate.module.js');
   const unpacked=gunzipSync(new Uint8Array(data));data=unpacked.buffer.slice(unpacked.byteOffset,unpacked.byteOffset+unpacked.byteLength);
  }
 }
 if(data.byteLength!==bytes)throw Error('模型传输长度不符');
 return loader.parseAsync(data,'./assets/');
}
async function load(){try{
 manifest=await (await fetch('./assets/manifest.json',{cache:'no-cache'})).json();
 if(manifest.asset_file)layoutStorageKey=STORAGE_KEY+'-'+manifest.asset_file;
 const initialHour=manifest.initial_hour??13;$('#time').value=initialHour;
 for(const [id,label,key] of [['child','儿童房','细节｜儿童房衣柜'],['espresso','咖啡区','细节｜餐边咖啡吧'],['entry','玄关','细节｜玄关拱窗']]){
  if(!manifest.cameras?.[key])continue;
  const button=document.createElement('button');button.className='view';button.dataset.view=id;button.textContent=label;button.onclick=()=>goView(id);$('.view-line').before(button);
 }
 if(manifest.asset_file)document.body.classList.add('new-scheme');
 if(manifest.gallery_source_sha256===manifest.source_sha256){const album=document.createElement('a');album.className='render-album';album.href='./assets/gallery/index.html?v='+manifest.source_sha256.slice(0,12);album.textContent='效果图';$('.header-actions').prepend(album);}
 if(manifest.edition){$('.edition').textContent=manifest.edition;$('.intro .eyebrow').textContent='华林 · 2号楼 1402';$('.intro h1').textContent=manifest.title;$('.intro p').textContent=manifest.subtitle;document.title='华林 1402 · '+manifest.title;}
 let asset=mobile&&manifest.mobile?.source_asset_sha256===manifest.asset_sha256?manifest.mobile:null;
 const ordered=manifest.gpu?.[asset?'mobile':'full'];if(logicOptimized&&ordered?.source_asset_sha256===(asset?.sha256||manifest.asset_sha256))asset=ordered;
 const gltf=await loadModelFile(asset?.file||manifest.asset_file||'house-v24.glb',asset?.sha256||manifest.asset_sha256,asset?.bytes||manifest.asset_bytes);
 model=gltf.scene;model.updateMatrixWorld(true);bounds=new THREE.Box3().setFromObject(model);center=bounds.getCenter(new THREE.Vector3());center.y=0;model.position.sub(center);scene.add(model);model.updateMatrixWorld(true);bounds.setFromObject(model);
 model.traverse(o=>{if(o.userData.furniture_id){roots.push(o);original.set(o.userData.furniture_id,transform(o));}if(o.isMesh){meshes.push(o);o.castShadow=true;o.receiveShadow=true;if(o.userData.web_roof)roofs.push(o);const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms)realtimeMaterial(m,Math.min(4,renderer.capabilities.getMaxAnisotropy()));}});
 if(manifest.asset_file){for(const mesh of meshes){const m=mesh.material;if(!Array.isArray(m)&&m.transparent&&m.opacity<.5)mesh.castShadow=false;}}
 const batched=mergeStaticMeshes(model,meshes,rootOf);meshes=batched.meshes;batchReport=batched.report;preparePicking(meshes);for(const root of roots)localBounds.set(root,furnitureBounds(root));
 walls=manifest.walls.map(w=>[w[0]-center.x,w[1]-center.z,w[2]-center.x,w[3]-center.z]);
 for(const data of manifest.lights||[]){const light=new THREE.PointLight(new THREE.Color(...data.color),0,6,2);light.position.set(...data.position).sub(center);light.userData.nightIntensity=Math.min(30,data.night_energy*.18);lamps.push(light);scene.add(light);}
 if(!manifest.asset_file){const size=bounds.getSize(new THREE.Vector3());const base=new THREE.Mesh(new THREE.BoxGeometry(size.x+.15,.11,size.z+.15),new THREE.MeshStandardMaterial({color:'#827462',roughness:.8}));base.position.y=-.085;base.receiveShadow=true;base.castShadow=true;scene.add(base);}
 try{const saved=JSON.parse(localStorage.getItem(layoutStorageKey)||'null');applyTransforms(reconcileLayout(saved,roots.map(o=>o.userData.furniture_id)));if(saved?.source&&saved.source!==manifest.source_sha256)toast('模型已更新，已保留匹配家具的布局');}catch{toast('本机布局未能读取，已使用设计原位');}
 showRoof(false);setTime(initialHour);controls.target.set(0,.4,0);camera.position.set(12,28,16).multiplyScalar(homeScale());updateControls();$('#load-text').textContent='整理光线与材质…';$('#load-progress').style.width='88%';await renderer.compileAsync(scene,camera);renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);composer?.render();for(const lamp of lamps)lamp.visible=true;await renderer.compileAsync(scene,camera);renderer.render(scene,camera);composer?.render();setTime(initialHour);renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);composer?.render();if(logicOptimized){model.traverse(o=>{if(!roots.includes(o)){o.updateMatrix();o.matrixAutoUpdate=false;}});scene.updateMatrixWorld(true);scene.matrixWorldAutoUpdate=false;}ready=true;$('#load-progress').style.width='100%';$('#loading').classList.add('done');setTimeout(()=>$('#loading').hidden=true,600);invalidate(true);const firstView=query.get('view');if(manifest.asset_file&&firstView&&document.querySelector('.view[data-view="'+CSS.escape(firstView)+'"]'))goView(firstView);
 }catch(e){console.error(e);$('#load-text').textContent='载入失败，请通过“打开房屋展示”入口重新打开。';$('#loading h2').textContent='暂时没能打开房屋';}}
const perf=createPerf(renderer,(ms,ratio,now)=>detail.observe(ms,ratio,now,scales));
function frame(now){if(document.hidden||!ready)return false;
 syncDisplayDensity();
 perf.beginFrame(now);
 if(queuedTime!==null){setTime(queuedTime);queuedTime=null;}
 if(pendingPointer&&drag){const e=pendingPointer;pendingPointer=null;moveFurniture(e);}
 perf.drive(now,camera,controls,roots,invalidate);if(tween){const t=Math.min(1,(now-tween.start)/650),k=1-Math.pow(1-t,3);camera.position.lerpVectors(tween.from,tween.p,t===1?1:k);controls.target.lerpVectors(tween.targetFrom,tween.t,k);dirty=true;if(t===1)tween=null;}
 const moved=updateControls();if(moved)dirty=true;
 if(dirty||needsSharp&&!controlActive&&!drag&&!tween&&now-lastInteraction>300){
  const moving=!!(controlActive||drag||tween||now-lastInteraction<300);
  qualityPhase=moving?'motion':'still';
  if(manifest.asset_file){
   if(moving)detail.observeFrame(now,scales,!perf.gpuTimer);else detail.pause();
  }
  const ratio=manifest.asset_file?(moving?detail.ratio(scales):scales.still):scales.base;
  applyDrawScale(ratio);
  if(!moving)fitPostTargets();
  renderer.info.reset();perf.begin(now,moving&&manifest.asset_file?ratio:0);
  if(shadowDirty&&(!moving||now-lastShadow>(mobile?120:66))){renderer.shadowMap.needsUpdate=true;shadowDirty=false;lastShadow=now;}
  if(moving||mobile){renderer.render(scene,camera);if(!moving)needsSharp=false;}else{composer.render();needsSharp=false;}
  perf.end();draws++;if(lastRender&&now-lastRender<200)renderIntervals.push(now-lastRender);if(renderIntervals.length>240)renderIntervals.shift();lastRender=now;dirty=false;
  if(qa)world.dataset.qa=JSON.stringify({state:window.hualinShowroom.getState(),diagnostics:window.hualinShowroom.getDiagnostics(),furniture:window.hualinShowroom.getFurnitureScreen()});
 }
 perf.endFrame();
 const running=!logicOptimized||perf.running||!!tween||!!pendingPointer||!!controlBatch?.pending()||!!(controls.enableDamping&&moved);
 if(!running&&needsSharp&&!controlActive&&!drag){
  // A queued frame can carry an earlier rAF timestamp than the settle timer.
  pump.settle(Math.max(1,lastInteraction+310-performance.now()));
 }
 return running;
}
pump=createFramePump(frame);pump.wake();load();
document.addEventListener('visibilitychange',()=>{if(document.hidden)pump.pause();else invalidate();});
if(qa)setInterval(()=>{world.dataset.runtime=JSON.stringify({pump:pump.stats(),controls:controlBatch?.stats(),sceneSyncs});},500);
setInterval(async()=>{if(!ready||document.hidden)return;syncDisplayDensity();try{const next=await(await fetch('./assets/manifest.json',{cache:'no-store'})).json();if(next.asset_sha256!==manifest.asset_sha256&&!$('#model-update')){const b=document.createElement('button');b.id='model-update';b.textContent='方案已更新 · 载入';b.style.cssText='font-size:11px;color:#97734f;padding:7px;border:1px solid #97734f44;border-radius:5px';b.onclick=()=>location.reload();$('.header-actions').prepend(b);}}catch{}},15000);
// Read-only diagnostics for local QA. No user-facing engineering controls.
window.hualinShowroom={getState:()=>({ready,editing,selected:selected?.userData.furniture_id,source:manifest?.source_sha256,transforms:ready?snapshot():{},roof:roofs.some(o=>o.visible),camera:camera.position.toArray(),target:controls.target.toArray(),storageOK,undo:undoStack.length}),getDiagnostics:()=>({draws,meshes:meshes.length,furniture:roots.length,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,intervalMedian:renderIntervals.length?[...renderIntervals].sort((a,b)=>a-b)[Math.floor(renderIntervals.length/2)]:null,logicOptimized,pump:pump?.stats(),controls:controlBatch?.stats(),sceneSyncs,mobile,pixelRatio:renderer.getPixelRatio(),resolution:{phase:qualityPhase,buffer:[renderer.domElement.width,renderer.domElement.height],base:scales.base,motion:detail.ratio(scales),still:scales.still,bufferChanges,post:composer?[postWidth,postHeight]:null,occlusion:ao?[ao.width,ao.height]:null},batch:batchReport,activeLights:lamps.filter(l=>l.visible).length,pickMs,dragMs,physicalDisplayFPS:false}),getFurnitureScreen:()=>roots.map(o=>{const b=worldBounds(o),p=b.getCenter(new THREE.Vector3()).project(camera);return {id:o.userData.furniture_id,name:o.userData.web_source_name,x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};})};
