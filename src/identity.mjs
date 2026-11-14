import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {VERSION} from './version.mjs';
export const HOST_PROTOCOL=2;
export async function installedIdentity(){
 const digest=createHash('sha256');for(const name of(await readdir(new URL('.',import.meta.url))).filter(n=>/\.(?:mjs|html)$/.test(n)).sort()){digest.update(name+'\0');digest.update(await readFile(new URL(name,import.meta.url)));}
 return{version:VERSION,protocol:HOST_PROTOCOL,build_id:digest.digest('hex')};
}
// Captured on load, so replacing installed files cannot disguise an old process.
export const loadedIdentity=await installedIdentity();
