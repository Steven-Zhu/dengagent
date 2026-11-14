import { readFile,readdir,writeFile,mkdir,rm,stat } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('..',import.meta.url));
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
const supplement=JSON.parse(await readFile(join(root,'licenses/upstream/sources.json'),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
for(const source of supplement){
  if(sha(await readFile(join(root,'licenses/upstream',source.file)))!==source.sha256)throw new Error('Supplemental license checksum changed: '+source.id);
}
const destination=join(root,'licenses/packages');await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
const inventory=[],totals={};
for(const [location,entry]of Object.entries(lock.packages)){
  if(!location)continue;
  const folder=resolve(root,location),manifest=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));
  if(manifest.version!==entry.version||manifest.license!==entry.license)throw new Error('Installed package metadata differs from lockfile: '+location);
  const id=location.replaceAll('node_modules/','').replaceAll('/','__')+'-'+entry.version;
  const target=join(destination,id);await mkdir(target);
  const texts=[];
  for(const name of (await readdir(folder)).sort()){
    if(!/^(licen[cs]e|copying|notice|copyright)(\.|$|-)/i.test(name)||!(await stat(join(folder,name))).isFile())continue;
    const value=await readFile(join(folder,name));await writeFile(join(target,name),value);
    texts.push({file:`packages/${id}/${name}`,source:`${location}/${name}`,sha256:sha(value)});
  }
  if(!texts.length&&manifest.name==='data-uri-to-buffer'&&entry.version==='4.0.1'){
    const readme=await readFile(join(folder,'README.md'),'utf8');const section=readme.match(/\(The MIT License\)[\s\S]*?(?=\n\[rfc\])/);
    if(!section)throw new Error('Expected embedded MIT text missing: '+location);
    const value=section[0].replaceAll('&lt;','<').replaceAll('&gt;','>').trim()+'\n';
    await writeFile(join(target,'LICENSE-from-README.txt'),value);
    texts.push({file:`packages/${id}/LICENSE-from-README.txt`,source:`${location}/README.md#license`,sha256:sha(value)});
  }
  if(!texts.length){
    const source=supplement.find(item=>item.packages.includes(manifest.name)&&item.versions[manifest.name]===entry.version);
    if(!source)throw new Error('No reviewed license text for '+manifest.name+' '+entry.version);
    const value=await readFile(join(root,'licenses/upstream',source.file));await writeFile(join(target,'LICENSE-upstream.txt'),value);
    // Preserve the distributed package's own author/license declaration too,
    // especially where upstream omits a package-specific license file.
    await writeFile(join(target,'package-metadata.json'),JSON.stringify({name:manifest.name,version:manifest.version,license:manifest.license,author:manifest.author,repository:manifest.repository},null,2)+'\n');
    texts.push({file:`packages/${id}/LICENSE-upstream.txt`,source:source.url,sha256:sha(value),...(source.note?{provenance_note:source.note}:{})});
  }
  totals[entry.license]=(totals[entry.license]??0)+1;
  inventory.push({name:manifest.name,version:entry.version,location,license:entry.license,repository:manifest.repository??null,integrity:entry.integrity,legal_texts:texts});
}
await writeFile(join(root,'licenses/dependencies.json'),JSON.stringify({lockfile_sha256:sha(await readFile(join(root,'package-lock.json'))),packages:inventory},null,2)+'\n');
const lines=['# Third-party notices','','DengAgent source uses MIT. Third-party components retain their own licenses; the source LICENSE does not replace them. This inventory includes every locked package location, including transitive dependencies.','',
  `Reviewed package locations: **${inventory.length}**. Declared licenses: ${Object.entries(totals).sort().map(([license,count])=>`${license} (${count})`).join(', ')}. No copyleft declaration appears in this lockfile. Metadata review is not a source-level authorship audit or legal clearance.`,
  '', 'The full copyright/permission/NOTICE texts are retained under [licenses/packages](licenses/packages). Supplemental missing texts and their provenance are in [licenses/upstream/sources.json](licenses/upstream/sources.json). Regenerate with `npm run licenses` after `npm ci`; new versions require another review.',
  '', 'Pi Agent Core, Pi AI and Pi Telemetry 1.3.0 declare MIT; their upstream LICENSE names Mario Zechner (2025). Standard Webhooks uses its library-level MIT license, independently of the repository-level Apache-2.0 license.',
  '', 'The proxy-agent-negotiate package declares MIT and names Nathan Rajlich, but its release tag omits a package-specific LICENSE. Its package metadata is preserved with an additional same-repository MIT notice from proxy-agent; see the explicit provenance note in the inventory. This supplemental attribution is not presented as a recovered package-specific original.',
  '', 'Standalone installers also redistribute Node.js. Its upstream LICENSE, including notices for bundled components, is required at runtime/LICENSE. Source-only exports do not include the Node binary. Provider APIs and host products are not relicensed by DengAgent.',
  '', '| Package | Version | Declared license | Legal texts |','| --- | --- | --- | --- |'];
for(const item of inventory)lines.push(`| ${item.name} | ${item.version} | ${item.license} | ${item.legal_texts.map(text=>`[text](licenses/${text.file})`).join(', ')} |`);
await writeFile(join(root,'THIRD_PARTY_NOTICES.md'),lines.join('\n')+'\n');
process.stdout.write(JSON.stringify({packages:inventory.length,licenses:totals,network_requests:0})+'\n');
