import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {computeBoundsTree,acceleratedRaycast} from './vendor/three-mesh-bvh/index.module.js';

export function realtimeMaterial(material,anisotropy){
 if(material.map)material.map.anisotropy=anisotropy;
 // Transmission in glTF adds a full-scene refraction prepass, even for tiny cups.
 // Use explicit authored roles: a black glass cooktop must remain opaque.
 if(material.transmission>0)material.transmission=0;
 if(material.name==='Web | HL.玻璃'){
  material.transparent=true;material.opacity=.12;material.depthWrite=false;material.forceSinglePass=true;
 }else if(/轻薄亚麻纱|窗纱/.test(material.name)){
  material.transparent=true;material.opacity=.45;material.depthWrite=false;material.forceSinglePass=true;
 }else if(material.name.includes('黑晶玻璃灶面')){
  material.transparent=false;material.opacity=1;material.depthWrite=true;
 }
}
export function mergeStaticMeshes(model,meshes,rootOf){
 const groups=new Map(),retained=[],report={before:meshes.length,after:0,merged:0,triangles:0};
 model.updateMatrixWorld(true);const inverse=model.matrixWorld.clone().invert();
 for(const mesh of meshes){
  report.triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3;
  if(rootOf(mesh)||mesh.userData.web_roof||mesh.children.length||Array.isArray(mesh.material)||mesh.material.transparent){retained.push(mesh);continue;}
  const key=mesh.material.uuid+':'+Object.keys(mesh.geometry.attributes).sort().join(',');
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mesh);
 }
 for(const group of groups.values()){
  if(group.length<2){retained.push(...group);continue;}
  const geometries=group.map(m=>m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,m.matrixWorld)));
  const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
  if(!geometry){retained.push(...group);continue;}
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const batch=new THREE.Mesh(geometry,group[0].material);batch.name='展示合批｜'+group[0].material.name;batch.castShadow=true;batch.receiveShadow=true;
  batch.userData.web_sources=group.map(o=>o.userData.web_source_name||o.name);
  for(const old of group)old.removeFromParent();model.add(batch);retained.push(batch);report.merged+=group.length;
 }
 model.updateMatrixWorld(true);report.after=retained.length;report.afterTriangles=retained.reduce((n,m)=>n+(m.geometry.index?.count||m.geometry.attributes.position.count)/3,0);
 if(report.afterTriangles!==report.triangles)throw Error('Static batching changed triangle count');
 return {meshes:retained,report};
}
export function preparePicking(meshes){
 const built=new Set();
 for(const mesh of meshes){
  const g=mesh.geometry;g.computeBoundingBox();
  if(!built.has(g)&&g.attributes.position.count>300){computeBoundsTree.call(g,{targetLeafSize:12,indirect:true});built.add(g);}
  mesh.raycast=acceleratedRaycast;
 }
}
export function furnitureBounds(root){
 root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),box=new THREE.Box3(),part=new THREE.Box3(),matrix=new THREE.Matrix4();
 root.traverse(o=>{if(!o.isMesh)return;if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();matrix.multiplyMatrices(inverse,o.matrixWorld);part.copy(o.geometry.boundingBox).applyMatrix4(matrix);box.union(part);});
 return box;
}
