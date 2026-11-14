import assert from 'node:assert/strict';
import {readdir,readFile,stat} from 'node:fs/promises';
import {dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const files=[];
for(const name of await readdir(root)){
  if(name.endsWith('.md')&&!['WORKLOG.md','THIRD_PARTY_NOTICES.md'].includes(name))files.push(resolve(root,name));
}
async function walk(folder){
  for(const item of await readdir(folder,{withFileTypes:true})){
    const path=resolve(folder,item.name);
    if(item.isDirectory())await walk(path);
    else if(item.name.endsWith('.md'))files.push(path);
  }
}
for(const folder of ['docs','skills','.github'])await walk(resolve(root,folder));

function destinations(markdown){
  const prose=markdown.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm,'');
  const links=[...prose.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*)?\s*\)/g)].map(m=>m[1]??m[2]);
  for(const match of prose.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g))links.push(match[1]);
  return links;
}
const readmeLinks=new Map();let links=0;
for(const file of files){
  const text=await readFile(file,'utf8'),local=new Set();
  for(const url of destinations(text)){
    if(/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url))continue;
    const part=decodeURIComponent(url.split(/[?#]/)[0]);if(!part)continue;
    const path=part.startsWith('/')?resolve(root,part.slice(1)):resolve(dirname(file),part);
    const label=relative(root,path);
    assert.ok(label!=='..'&&!label.startsWith('..'+sep),'Documentation link escapes source root: '+url);
    try{await stat(path);}catch{throw new Error(relative(root,file)+': missing destination '+url);}
    local.add(label.split(sep).join('/'));links++;
  }
  if(['README.md','README.zh-CN.md'].includes(relative(root,file)))readmeLinks.set(relative(root,file),[...local].sort());
}
assert.ok(readmeLinks.get('README.md').includes('README.zh-CN.md'),'English README must link to Chinese');
assert.ok(readmeLinks.get('README.zh-CN.md').includes('README.md'),'Chinese README must link to English');
const guides=links=>links.filter(path=>!['README.md','README.zh-CN.md'].includes(path));
assert.deepEqual(guides(readmeLinks.get('README.md')),guides(readmeLinks.get('README.zh-CN.md')),'Both READMEs must link to the same local guides/assets');
for(const name of ['README.md','README.zh-CN.md']){
  const text=await readFile(resolve(root,name),'utf8');
  assert.ok(readmeLinks.get(name).includes('docs/npm-installation.md'),'README must link to the installation guide: '+name);
  assert.ok(!/0\.2\.0-alpha\.\d+|\balpha\.\d+/i.test(text),'Keep internal build versions out of the product introduction: '+name);
}
process.stdout.write(JSON.stringify({passed:true,markdown_files:files.length,local_destinations_checked:links,note:'Checks first-party file destinations and README destination parity; excludes external URLs, fragments and visual rendering.'})+'\n');
