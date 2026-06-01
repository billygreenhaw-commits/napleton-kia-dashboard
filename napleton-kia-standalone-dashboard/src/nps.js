
export const REGION_NPS = 83.2
export function npsStatus(score){ if(score==null) return 'red'; if(score>=REGION_NPS) return 'green'; if(score>=REGION_NPS-10) return 'orange'; return 'red' }
export function npsClass(score){ const s=npsStatus(score); return s==='green'?'green':s==='orange'?'orange':'red' }
export function fmt(score){ return score==null ? '—' : Number(score).toFixed(2) }
