/**
 * Translator - Hermes Companion 翻译模块
 */

import log from 'electron-log/main.js';

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  confidence?: number;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
];

export class Translator {
  private cache: Map<string, TranslationResult> = new Map();
  private apiEndpoint: string = '';
  private apiKey: string = '';
  
  public configure(endpoint: string, apiKey: string): void {
    this.apiEndpoint = endpoint;
    this.apiKey = apiKey;
    log.info('[Translator] Configured');
  }
  
  public async detectLanguage(text: string): Promise<string> {
    const chineseRegex = /[\u4e00-\u9fff]/;
    const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/;
    const koreanRegex = /[\uac00-\ud7af]/;
    
    if (chineseRegex.test(text)) return 'zh';
    if (japaneseRegex.test(text)) return 'ja';
    if (koreanRegex.test(text)) return 'ko';
    return 'en';
  }
  
  public async translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResult> {
    const cacheKey = `${text}:${targetLang}:${sourceLang || 'auto'}`;
    
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;
    
    if (!sourceLang) sourceLang = await this.detectLanguage(text);
    if (sourceLang === targetLang) {
      const result: TranslationResult = { sourceText: text, translatedText: text, sourceLang, targetLang };
      this.cache.set(cacheKey, result);
      return result;
    }
    
    if (!this.apiEndpoint) {
      const result: TranslationResult = { sourceText: text, translatedText: `[${sourceLang}→${targetLang}] ${text}`, sourceLang, targetLang, confidence: 0.5 };
      this.cache.set(cacheKey, result);
      return result;
    }
    
    // API 调用
    try {
      const response = await fetch(`${this.apiEndpoint}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body: JSON.stringify({ text, source: sourceLang, target: targetLang }),
      });
      const data = await response.json();
      const result: TranslationResult = { sourceText: text, translatedText: data.translation, sourceLang, targetLang, confidence: data.confidence };
      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      log.error('[Translator] Error:', error);
      throw error;
    }
  }
  
  public async translateBatch(texts: string[], targetLang: string, sourceLang?: string): Promise<TranslationResult[]> {
    return Promise.all(texts.map(t => this.translate(t, targetLang, sourceLang)));
  }
  
  public getSupportedLanguages(): Language[] { return [...SUPPORTED_LANGUAGES]; }
  public clearCache(): void { this.cache.clear(); }
}

export default Translator;
