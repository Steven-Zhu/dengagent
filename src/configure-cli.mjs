import { createInterface } from 'node:readline/promises';
import { ensureHost,request } from './host.mjs';
import { DengError } from './config.mjs';
import {generationOptions} from './model-options.mjs';

export async function configureCli(config,options,{secretPrompt}){
  await ensureHost(config);
  const settings=await request(config,'/connection');
  const profile=settings.profiles.find(p=>p.profile===(options.profile??settings.default_profile));
  if(!profile)throw new DengError('MODEL_PROFILE','Choose an existing profile with --profile');
  if(options.show)return settings;
  const interactive=Boolean(process.stdin.isTTY);
  const explicit=options['base-url']!==undefined||options['model-id']!==undefined||options['key-stdin']||options['reuse-credential']||options['context-window']||options['max-output-tokens']||options.probe||options.recommended||options.thinking||options['reasoning-effort']||options['reasoning-format']||options['timeout-ms']||options['max-total-tokens']||options['max-model-calls'];
  if(!interactive&&!explicit)return {...settings,next:'Run deng configure in a terminal, or provide --base-url / --model-id and --key-stdin. Keys are never accepted as command-line arguments.'};
  // Reading a form does not otherwise touch the engine. Keep this local session
  // alive while a person types, without changing the project's idle timeout.
  let pingPending=false;
  const keepalive=setInterval(()=>{
    if(pingPending)return;pingPending=true;
    void request(config,'/health').catch(()=>{}).finally(()=>{pingPending=false;});
  },Math.max(200,Math.min(10000,Math.floor(config.idle_shutdown_ms/3))));
  keepalive.unref();
  try{
  const changes={profile:profile.profile,base_url:options['base-url']??profile.base_url,model:options['model-id']??profile.model,expected_revision:settings.revision,reuse_credential:options['reuse-credential']??false};
  Object.assign(changes,generationOptions(options));
  if(options['key-stdin']){
    if(interactive)throw new DengError('KEY_INPUT','--key-stdin requires redirected standard input; use the hidden terminal prompt interactively');
    let value='';for await(const chunk of process.stdin){value+=chunk;if(Buffer.byteLength(value)>8192)throw new DengError('KEY_INPUT','Key input exceeds 8 KB');}
    changes.api_key=value.trim();
  }
  if(interactive){
    process.stdout.write(`${config.scope==='global'?'全局连接设置':'项目连接设置'} · ${profile.profile}\nAPI Key：${profile.key_configured?'已配置（不显示）':'未配置'}\n只影响以后新建的任务，现有任务保留原连接。\n`);
    process.stdout.write(`生成参数：上下文 ${changes.context_window??profile.context_window} · 输出 ${changes.max_output_tokens??profile.max_output_tokens} · 超时 ${changes.timeout_ms??profile.timeout_ms} ms · thinking ${changes.thinking??profile.thinking} · effort ${changes.reasoning_effort??profile.reasoning_effort} · 未来任务累计 ${changes.max_total_tokens??settings.budget.max_total_tokens} token\n`);
    let rl=createInterface({input:process.stdin,output:process.stdout});
    try{
      if(options['base-url']===undefined)changes.base_url=(await rl.question(`API URL（留空保留）[${profile.base_url}]: `)).trim()||profile.base_url;
      if(options['model-id']===undefined)changes.model=(await rl.question(`模型 ID（留空保留）[${profile.model}]: `)).trim()||profile.model;
      if(options.advanced){
        for(const [name,label,current]of [['context_window','上下文上限',profile.context_window],['max_output_tokens','单次输出上限',profile.max_output_tokens],['timeout_ms','模型请求超时（毫秒）',profile.timeout_ms],['max_total_tokens','未来任务累计 token 上限',settings.budget.max_total_tokens]]){
          const value=changes[name]??current;changes[name]=Number((await rl.question(`${label} [${value}]: `)).trim()||value);
        }
        for(const [name,label,current]of [['thinking','thinking（enabled / disabled / provider-default）',profile.thinking],['reasoning_effort','reasoning_effort（low / medium / high / max）',profile.reasoning_effort],['reasoning_format','reasoning 格式（auto / deepseek / openai / none）',profile.reasoning_format]]){
          const value=changes[name]??current;changes[name]=(await rl.question(`${label} [${value}]: `)).trim()||value;
        }
      }
    }finally{rl.close();}
    changes.api_key=(await secretPrompt('API Key（不回显；留空保留现有 Key）: ')).trim();
    rl=createInterface({input:process.stdin,output:process.stdout});
    try{
      if(changes.base_url.replace(/\/+$/,'')!==profile.base_url.replace(/\/+$/,'')&&!changes.api_key&&!changes.reuse_credential){
        const answer=(await rl.question('地址已改变。是否将现有 Key 用于此地址？[y/N]: ')).trim().toLowerCase();
        if(!['y','yes'].includes(answer))return {cancelled:true,model_calls:0};
        changes.reuse_credential=true;
      }
      const answer=(await rl.question('保存连接设置？[Y/n]: ')).trim().toLowerCase();
      if(['n','no'].includes(answer))return {cancelled:true,model_calls:0};
    }finally{rl.close();}
  }
  let probe;
  if(options.probe){
    probe=await request(config,'/connection/probe','POST',{...changes,confirm_model_call:true});
    if(!probe.ok)return {saved:false,probe,model_calls:probe.model_calls};
  }
  let saved;
  try{saved=await request(config,'/connection','POST',changes);}catch(error){
    if(!(error instanceof DengError)&&['ENOENT','ECONNREFUSED'].includes(error.code))throw new DengError('CONNECTION_DISCONNECTED','本机配置服务已断开，保存请求未发送。请重新运行 deng configure；这不是模型服务或 Key 校验错误。');
    throw error;
  }
  return {...saved,key_updated:Boolean(changes.api_key),...(probe?{probe,model_calls:probe.model_calls}:{})};
  }finally{clearInterval(keepalive);}
}
