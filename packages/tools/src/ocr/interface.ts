/**
 * OCR 策略接口
 * ---------------------------------------------
 * PHASE3：本文件仅为接口骨架。真正的实现（Tesseract.js / 多模态 LLM）见 docs/ROADMAP.md §3。
 *
 * 当前不安装 tesseract.js（ESLint 强约束）。
 */

export interface OCRInput {
  /** 图像数据：可以是 data URL / Blob / ImageData */
  image: string | Blob | ImageData;
  /** 可选：语言提示 */
  lang?: 'chi_sim' | 'chi_tra' | 'eng' | 'jpn' | 'kor';
}

export interface OCRResult {
  text: string;
  confidence: number;
  /** 识别耗时（ms） */
  elapsedMs: number;
}

export interface OCRStrategy {
  readonly name: string;
  readonly priority: number;
  /** PHASE3: Tesseract.js / 多模态 LLM / 云 OCR 三种实现 */
  recognize(input: OCRInput): Promise<OCRResult>;
}

// PHASE3: OCR 实现（见 docs/ROADMAP.md §3）
