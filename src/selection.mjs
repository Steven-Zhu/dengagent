import { z } from 'zod';
import { DengError } from './config.mjs';
import {reasoningSettings} from './model-options.mjs';

export const modelId = z.string().min(1).max(256).regex(/^\S+$/, 'Model ID cannot contain whitespace');
export const selectionSchema = z.object({
  model: modelId,
  profile: z.string().min(1).max(256).optional(),
  task_id: z.string().uuid().optional(),
  expected_revision: z.number().int().positive().optional(),
}).strict();

// Only public routing metadata leaves the engine. Credentials remain in the profile snapshot.
export const modelInfo = (profile, name, provider) => ({
  profile: name ?? null, model: profile.model, base_url: profile.base_url,
  api: profile.api, thinking:profile.thinking??'provider-default',reasoning_effort:profile.reasoning_effort??null,
  wire_reasoning_effort:reasoningSettings(profile).wire_reasoning_effort,reasoning_format:reasoningSettings(profile).reasoning_format,
  context_window:profile.context_window,max_output_tokens:profile.max_output_tokens,timeout_ms:profile.timeout_ms,provider_mode: provider,
});

export function resolveSelection(config, selector, baseName, explicitProfile) {
  modelId.parse(selector);
  let name = explicitProfile;
  let model = selector;
  if (Object.hasOwn(config.models.profiles, selector)) {
    if (name && name !== selector) throw new DengError('MODEL_PROFILE_CONFLICT', 'Selected profile conflicts with the explicit profile; use one profile name or a model ID');
    name = selector; model = config.models.profiles[name].model;
  } else if (!name) {
    const matches = Object.entries(config.models.profiles).filter(([, value]) => value.model === selector);
    if (matches.length > 1) throw new DengError('MODEL_AMBIGUOUS', 'Model ID matches multiple profiles; specify a profile');
    name = matches[0]?.[0] ?? baseName;
  }
  if (!Object.hasOwn(config.models.profiles, name)) throw new DengError('MODEL_PROFILE', 'Model profile does not exist; configure its endpoint and credentials first');
  return { profile_name: name, profile: { ...config.models.profiles[name], model } };
}
