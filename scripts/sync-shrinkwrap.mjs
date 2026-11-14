import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const text=await readFile(new URL('package-lock.json',root),'utf8');
const lock=JSON.parse(text),manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
if(lock.version!==manifest.version||lock.packages[''].version!==manifest.version)throw new Error('Version mismatch; update the lockfile before synchronizing');
await writeFile(new URL('npm-shrinkwrap.json',root),text);
process.stdout.write('Published CLI dependency lock synchronized.\n');
