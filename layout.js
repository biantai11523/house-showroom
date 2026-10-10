export const STORAGE_KEY='hualin-showroom-layout-v1';
export function overlap(a,b){return Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));}
export function validTransform(t){return !!t&&Array.isArray(t.position)&&t.position.length===3&&t.position.every(v=>Number.isFinite(v)&&Math.abs(v)<100)&&Array.isArray(t.quaternion)&&t.quaternion.length===4&&t.quaternion.every(Number.isFinite)&&Math.abs(Math.hypot(...t.quaternion)-1)<.01;}
export function reconcileLayout(saved,ids){const transforms={};if(saved?.schema!==1)return transforms;for(const id of ids){if(validTransform(saved.transforms?.[id]))transforms[id]=saved.transforms[id];}return transforms;}
export function hourLabel(hour){const m=Math.round(Math.min(24,Math.max(0,hour))*60);return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
