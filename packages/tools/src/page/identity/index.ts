/**
 * Identity 策略注册入口
 * ---------------------------------------------
 * - 维护一个默认注册的 Registry 实例
 * - PHASE2: 动态识别器通过 `identityRegistry.register(...)` 注入，priority 100+ 即可覆盖内置策略。
 */
import { Registry } from '../../registry';
import type { IdentityStrategy } from '../types';
import { UrlParamStrategy } from './url-param';
import { OpenGraphStrategy } from './open-graph';
import { JsonLdStrategy } from './json-ld';
import { HeadingStrategy } from './heading';
import { UrlFallbackStrategy } from './url-fallback';

export const identityRegistry = new Registry<IdentityStrategy>();

export function registerDefaultIdentityStrategies(): void {
  identityRegistry.clear();
  identityRegistry.register(UrlParamStrategy);
  identityRegistry.register(OpenGraphStrategy);
  identityRegistry.register(JsonLdStrategy);
  identityRegistry.register(HeadingStrategy);
  identityRegistry.register(UrlFallbackStrategy);
}

// 首次 import 时自动注册默认策略
registerDefaultIdentityStrategies();

export {
  UrlParamStrategy,
  OpenGraphStrategy,
  JsonLdStrategy,
  HeadingStrategy,
  UrlFallbackStrategy,
};
