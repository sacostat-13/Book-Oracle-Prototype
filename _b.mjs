import { build } from 'vite';
build({ root: process.cwd() }).then(()=>console.log('BUILD OK'))
 .catch(e=>{ console.error('MSG:', e.message); console.error('PLUGIN:', e.plugin, 'ID:', e.id); console.error('FRAME:', e.frame); });
