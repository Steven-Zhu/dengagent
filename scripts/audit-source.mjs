import assert from 'node:assert/strict';
import { readFile,readdir,lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configSchema,taskSchema } from '../src/config.mjs';
import { VERSION } from '../src/version.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
assert.equal(manifest.version,VERSION);assert.equal(lock.version,VERSION);assert.equal(lock.packages[''].version,VERSION);
assert.equal(manifest.license,'MIT');assert.equal(lock.packages[''].license,'MIT');assert.notEqual(manifest.private,true);
assert.equal(manifest.publishConfig.access,'public');assert.equal(manifest.publishConfig.tag,'latest');
assert.deepEqual([...manifest.bundleDependencies].sort(),Object.keys(manifest.dependencies).sort(),'Bundle every reviewed runtime dependency');
for(const lifecycle of ['preinstall','install','postinstall','prepare'])assert.equal(manifest.scripts[lifecycle],undefined,'No automatic project or credential setup during npm installation');
assert.equal(await readFile(join(root,'npm-shrinkwrap.json'),'utf8'),await readFile(join(root,'package-lock.json'),'utf8'),'Publishable dependency lock drift');
const files=['README.md','README.zh-CN.md','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','CHANGELOG.md','CONTRIBUTING.md','SECURITY.md','CODE_OF_CONDUCT.md','.gitignore','.gitattributes','.editorconfig','.github/workflows/ci.yml','.github/PULL_REQUEST_TEMPLATE.md','.github/ISSUE_TEMPLATE/bug_report.yml','docs/configuration.md','docs/model-settings.md','docs/releasing.md','docs/licensing.md','licenses/dependencies.json'];
for(const name of files)assert.ok((await readFile(join(root,name))).length>0,'Required file: '+name);
for(const name of ['SUPPORT.md','ROADMAP.md','docs/README.md','docs/troubleshooting.md','docs/demo-plan.md','docs/media/README.md','docs/github-launch.md','.github/ISSUE_TEMPLATE/question.yml','.github/RELEASE_TEMPLATE.md','scripts/check-docs.mjs'])assert.ok((await readFile(join(root,name))).length>0,'Required project documentation: '+name);
configSchema.parse(JSON.parse(await readFile(join(root,'examples/config.tencent.json'),'utf8')));
configSchema.parse(JSON.parse(await readFile(join(root,'examples/config.compatible.json'),'utf8')));
taskSchema.parse(JSON.parse(await readFile(join(root,'examples/implementation.task.json'),'utf8')));
const excluded=new Set(['node_modules','releases','.git','.dengagent','work','outputs','WORKLOG.md','tasks']);let checked=0;
async function walk(folder,relative=''){
  for(const name of await readdir(folder)){
    if(!relative&&excluded.has(name))continue;
    const path=join(folder,name),label=join(relative,name),info=await lstat(path);
    if(label==='docs/mcp-app-codex-check.json')continue;
    assert.ok(!info.isSymbolicLink(),'Unexpected source symlink: '+label);
    if(info.isDirectory()){await walk(path,label);continue;}
    assert.ok(!/\.credential$|\.sqlite(?:-wal|-shm)?$|\.env(?:\.|$)|\.log$/.test(name),'Private/runtime file: '+label);
    if(/\.(?:png|jpe?g|gif|webp|mp4|webm|ico|gz|tgz|command)$/.test(name))continue;
    const text=await readFile(path,'utf8');
    assert.ok(!/\/Users\/[A-Za-z0-9_.-]+\/|\/home\/[A-Za-z0-9_.-]+\//.test(text),'Personal path: '+label);
    assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text),'Private key: '+label);
    assert.ok(!/\b(?:sk-[A-Za-z0-9]{24,}|AKIA[A-Z0-9]{16})\b/.test(text),'Credential-shaped text: '+label);
    checked++;
  }
}
await walk(root);process.stdout.write(JSON.stringify({passed:true,checked_text_files:checked,version:VERSION,note:'Pattern/manifest hygiene checks, not proof of absence of all secrets or vulnerabilities.'})+'\n');
