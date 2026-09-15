import { loadConfig } from './loadConfig';
import type { AppConfig } from './schema';

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) _config = loadConfig();
  return _config;
}

export type { AppConfig };
