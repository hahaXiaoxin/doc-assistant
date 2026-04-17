/**
 * Content 提取器注册入口
 * ---------------------------------------------
 * PHASE2: 域名级自学习提取器作为优先级 100+ 注册项注入。
 */
import { Registry } from '../../registry';
import type { ContentExtractor } from '../types';
import { ReadabilityExtractor } from './readability';
import { SemanticTagExtractor } from './semantic';
import { SelectionExtractor } from './selection';
import { FullBodyExtractor } from './full-body';

export const contentRegistry = new Registry<ContentExtractor>();

export function registerDefaultContentExtractors(): void {
  contentRegistry.clear();
  contentRegistry.register(SelectionExtractor);
  contentRegistry.register(ReadabilityExtractor);
  contentRegistry.register(SemanticTagExtractor);
  contentRegistry.register(FullBodyExtractor);
}

registerDefaultContentExtractors();

export { ReadabilityExtractor, SemanticTagExtractor, SelectionExtractor, FullBodyExtractor };
