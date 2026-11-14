// Explicit application preferences. Providers still enforce their own limits.
export const recommendedGeneration=Object.freeze({context_window:262144,max_output_tokens:32768,timeout_ms:300000,thinking:'enabled',reasoning_effort:'low'});
export const maxTotalTokens=16_000_000;
export const recommendedTotalTokens=maxTotalTokens;

export function generationOptions(options){
  const result=options.recommended?{...recommendedGeneration,max_total_tokens:recommendedTotalTokens,max_model_calls:null,reasoning_format:'auto'}:{};
  for(const [option,name]of [['context-window','context_window'],['max-output-tokens','max_output_tokens'],['timeout-ms','timeout_ms'],['max-total-tokens','max_total_tokens']])if(options[option]!==undefined)result[name]=Number(options[option]);
  for(const [option,name]of [['thinking','thinking'],['reasoning-effort','reasoning_effort'],['reasoning-format','reasoning_format']])if(options[option]!==undefined)result[name]=options[option];
  if(options['max-model-calls']!==undefined)result.max_model_calls=options['max-model-calls']==='unlimited'?null:Number(options['max-model-calls']);
  return result;
}

export function reasoningSettings(profile){
  if(profile.reasoning_effort===undefined&&profile.compat?.reasoning_format===undefined){
    return {thinking:profile.thinking??'provider-default',reasoning_effort:null,reasoning_format:'legacy',wire_reasoning_effort:null,
      parameters:profile.thinking?{thinking:{type:profile.thinking}}:{}};
  }
  const thinking=profile.thinking??'provider-default';
  const requested=profile.reasoning_effort??'low';
  const format=profile.compat?.reasoning_format??'auto';
  const resolved=format==='auto'?(/^deepseek(?:[/-]|$)/i.test(profile.model)?'deepseek':'openai'):format;
  // Missing fields on historical task snapshots retain their original behavior.
  if(thinking==='provider-default'||resolved==='none')return {thinking,reasoning_effort:requested,reasoning_format:resolved,wire_reasoning_effort:null,parameters:{}};
  if(thinking==='disabled')return {thinking,reasoning_effort:requested,reasoning_format:resolved,wire_reasoning_effort:null,
    parameters:resolved==='deepseek'?{thinking:{type:'disabled'}}:{reasoning_effort:'none'}};
  const effort=resolved==='deepseek'&&requested==='medium'?'high':requested;
  return {thinking,reasoning_effort:requested,reasoning_format:resolved,wire_reasoning_effort:effort,
    parameters:resolved==='deepseek'?{thinking:{type:'enabled'},reasoning_effort:effort}:{reasoning_effort:effort}};
}

export const applyReasoning=(payload,profile)=>{
  // Override Pi's inferred provider knobs with the selected explicit policy.
  delete payload.thinking;delete payload.reasoning_effort;
  return Object.assign(payload,reasoningSettings(profile).parameters);
};
