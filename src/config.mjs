import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import {recommendedGeneration,recommendedTotalTokens,maxTotalTokens} from './model-options.mjs';
import {WRITE_CHUNK_LIMIT,WRITE_BATCH_LIMIT} from './protocol.mjs';

export class DengError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const budgetBounds={
  max_no_progress_calls:z.number().int().min(1).max(20),
  max_model_calls:z.number().int().min(1).max(200).nullable(),
  max_total_tokens:z.number().int().min(1024).max(maxTotalTokens),
  max_duration_ms:z.number().int().min(1000).max(86_400_000),
  max_repair_rounds:z.number().int().min(0).max(10),
};
export const budgetSchema=z.object({
  max_no_progress_calls:budgetBounds.max_no_progress_calls.default(4),
  max_model_calls:budgetBounds.max_model_calls.default(null),
  max_total_tokens:budgetBounds.max_total_tokens.default(recommendedTotalTokens),
  max_duration_ms:budgetBounds.max_duration_ms.default(1800000),
  max_repair_rounds:budgetBounds.max_repair_rounds.default(3),
}).strict();
// null is an unlimited model-call allowance; omitted overrides inherit.
export function resolveBudget(configured,requested={}){
  return Object.fromEntries(Object.entries(configured).map(([key,value])=>{
    const candidate=requested[key]===undefined?value:requested[key];
    if(key==='max_model_calls')return [key,value===null?candidate:candidate===null?value:Math.min(value,candidate)];
    return [key,Math.min(value,candidate)];
  }));
}
export const generationBounds={
  context_window:z.number().int().min(4096).max(2_000_000),
  max_output_tokens:z.number().int().min(128).max(64000),
  timeout_ms:z.number().int().min(100).max(600000),
  thinking:z.enum(['disabled','enabled','provider-default']),
  reasoning_effort:z.enum(['low','medium','high','max']),
};
const profileSchema = z.object({
  api: z.literal('openai-completions').default('openai-completions'),
  base_url: z.string().url(), model: z.string().min(1).max(256),
  api_key_env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('TENCENT_TOKENHUB_API_KEY'),
  api_key_file: z.string().optional(),
  credential_source: z.enum(['auto','file','env']).default('auto'),
  context_window:generationBounds.context_window.default(recommendedGeneration.context_window),
  max_output_tokens:generationBounds.max_output_tokens.default(recommendedGeneration.max_output_tokens),
  timeout_ms:generationBounds.timeout_ms.default(recommendedGeneration.timeout_ms),
  thinking:generationBounds.thinking.default(recommendedGeneration.thinking),
  reasoning_effort:generationBounds.reasoning_effort.default(recommendedGeneration.reasoning_effort),
  compat: z.object({
    max_tokens_field: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens'),
    include_usage: z.boolean().default(true),
    reasoning_format:z.enum(['auto','deepseek','openai','none']).default('auto'),
  }).strict().prefault({}),
}).strict();
export const configSchema = z.object({
  schema_version: z.literal('0.1').default('0.1'),
  scope: z.enum(['project','global']).default('project'),
  defaults_file:z.string().optional(),defaults_revision:z.string().optional(),
  workspace_root: z.string().min(1), data_dir: z.string().optional(),
  retired_credential_files: z.array(z.string()).max(1000).default([]),
  provider: z.enum(['compatible', 'offline']).default('compatible'),
  models: z.object({ default: z.string(), profiles: z.record(z.string(),profileSchema),choices:z.array(z.object({profile:z.string().min(1),model:z.string().min(1).max(256).regex(/^\S+$/),name:z.string().min(1).max(100).optional()}).strict()).max(100).default([]) }).strict(),
  budget: budgetSchema.prefault({}),
  tools: z.object({
    write_chunk_chars: z.number().int().min(256).max(64000).default(WRITE_CHUNK_LIMIT),
    write_batch_chars: z.number().int().min(256).max(256000).default(WRITE_BATCH_LIMIT),
    max_command_timeout_ms: z.number().int().min(100).max(3600000).default(600000),
    max_discovery_calls: z.number().int().min(0).max(100).default(12),
    input_inline_chars: z.number().int().min(0).max(100000).default(12000),
    command_timeout_ms: z.number().int().min(100).max(600000).default(120000),
    max_output_bytes: z.number().int().min(1024).max(1000000).default(65536),
    isolation: z.enum(['macos', 'host']).default('macos'),
    child_env_allowlist: z.array(z.string()).default(['PATH', 'LANG', 'LC_ALL']),
  }).strict().prefault({}),
  idle_shutdown_ms: z.number().int().min(1000).max(3600000).default(60000),
}).strict();
export const commandSchema = z.object({
  argv: z.array(z.string().max(4096)).min(1).max(100),
  cwd: z.string().default('.'),
  timeout_ms: z.number().int().min(100).max(3600000).optional(),
  replay_safe: z.boolean().optional(),
}).strict();
export const taskSchema = z.object({
  goal: z.string().min(5).max(16000),
  inputs: z.array(z.string().min(1).max(1024)).max(100).default([]),
  scope: z.object({
    read: z.array(z.string().min(1)).min(1).default(['.']),
    write: z.array(z.string().min(1)).default([]),
    commands: z.array(commandSchema).max(20).default([]),
  }).strict().prefault({}),
  acceptance: z.object({
    commands: z.array(commandSchema).max(20).default([]),
    required_files: z.array(z.string()).max(100).default([]),
    protected_files: z.array(z.string().min(1)).max(100).default([]),
  }).strict().prefault({}),
  milestones:z.array(z.object({
    name:z.string().min(1).max(100),
    required_files:z.array(z.string()).max(20).default([]),
    commands:z.array(commandSchema).max(10).default([]),
  }).strict().refine(m=>m.required_files.length||m.commands.length,'A milestone needs at least one fixed check')).max(8).default([]),
  // Overrides have no field defaults: omitted task values inherit the project's
  // configured limits, rather than Zod 4 filling defaults inside optionals.
  budget: z.object(budgetBounds).strict().partial().prefault({}),
  request_id: z.string().min(1).max(200).optional(),
  // Deterministic scripted actions are only accepted with provider=offline.
  offline_script: z.array(z.object({ name: z.string(), arguments: z.record(z.string(),z.unknown()) }).strict()).max(100).optional(),
}).strict();

export function validateEndpoint(value){
  let url;try{url=new URL(value);}catch{throw new DengError('CONFIG','Enter a valid API base URL');}
  if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new DengError('CONFIG','Model endpoints require HTTPS, or loopback HTTP, without embedded credentials or query');
  return url;
}
export async function normalizeConfig(raw,path) {
  const absolute = resolve(path);
  const config = configSchema.parse(raw);
  if(config.tools.command_timeout_ms>config.tools.max_command_timeout_ms)throw new DengError('CONFIG','Default command timeout exceeds the configured maximum');
  config.path = absolute;
  config.workspace_root = await realpath(resolve(dirname(absolute), config.workspace_root));
  config.data_dir = resolve(dirname(absolute), config.data_dir ?? resolve(config.workspace_root, '.dengagent'));
  if(config.defaults_file)config.defaults_file=resolve(dirname(absolute),config.defaults_file);
  config.retired_credential_files=config.retired_credential_files.map(path=>resolve(dirname(absolute),path));
  if (!config.models.profiles[config.models.default]) throw new DengError('CONFIG', 'Default model profile does not exist');
  for(const choice of config.models.choices)if(!Object.hasOwn(config.models.profiles,choice.profile))throw new DengError('CONFIG','Model choice profile does not exist');
  for (const profile of Object.values(config.models.profiles)) {
    validateEndpoint(profile.base_url);
    if(profile.max_output_tokens>profile.context_window)throw new DengError('CONFIG','Output limit cannot exceed context window');
    if (profile.api_key_file) profile.api_key_file = resolve(dirname(absolute), profile.api_key_file);
  }
  return config;
}
export async function loadConfig(path) {
  const text=await readFile(resolve(path),'utf8');let raw;
  try{raw=JSON.parse(text);}catch{throw new DengError('CONFIG_JSON','项目连接配置不是有效的 JSON。请修复该配置文件后重试；原文件未被覆盖。');}
  return normalizeConfig(raw,path);
}
export async function getCredential(profile) {
  const inherited = process.env[profile.api_key_env]?.trim();
  if (profile.credential_source!=='file'&&inherited) return inherited;
  if (profile.credential_source!=='env'&&profile.api_key_file) {
    const info = await stat(profile.api_key_file);
    if (process.platform !== 'win32' && (info.mode & 0o077)) throw new DengError('CREDENTIAL_MODE', 'Credential file must be private (chmod 600)');
    const value = (await readFile(profile.api_key_file, 'utf8')).trim();
    if (value) return value;
  }
  throw new DengError('MISSING_CREDENTIAL', `Configure ${profile.api_key_env} or a private api_key_file`);
}
export const terminal = status => ['completed', 'failed', 'cancelled', 'budget_exceeded'].includes(status);
export const stopped = status => terminal(status) || ['paused', 'waiting_input', 'interrupted'].includes(status);
export function safeError(error) {
  if (error instanceof DengError) return { code: error.code, message: error.message,
    ...(error.phase?{phase:error.phase}:{}),...(typeof error.connection_saved==='boolean'?{connection_saved:error.connection_saved}:{}) };
  if (error instanceof z.ZodError) return { code: 'INVALID_INPUT', message: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0,2000) };
  const filesystem={
    EACCES:'当前账号没有所需的文件权限。请检查项目目录与 ~/.config/dengagent 的所有者和读写权限。',
    EPERM:'系统拒绝了文件操作。请检查目录权限及系统对该目录的访问限制。',
    EROFS:'目标目录位于只读文件系统，无法保存配置。',
    ENOSPC:'磁盘空间不足，无法保存配置。',
    EDQUOT:'磁盘配额已用尽，无法保存配置。',
    ENOENT:'所需的文件或目录不存在。请检查所选项目与配置路径。',
    ENOTDIR:'路径中的某一级是文件，不能作为目录使用。',
    EISDIR:'预期的配置文件路径实际是一个目录。',
    ELOOP:'配置路径存在无法解析的符号链接。',
    EEXIST:'目标路径已存在，无法创建所需文件或目录。',
  };
  if(Object.hasOwn(filesystem,error?.code))return {code:error.code,message:filesystem[error.code]};
  return { code: 'INTERNAL', message: 'Operation failed; inspect local configuration and task events' };
}
