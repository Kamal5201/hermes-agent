/**
 * Voice Controller
 * 
 * Hermes Companion - 语音控制模块
 * 支持语音识别和语音合成
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

// 语音识别 API 类型
interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

interface VoiceCommand {
  pattern: RegExp | string;
  action: (transcript: string) => Promise<void> | void;
  description: string;
}

// 语音合成配置
interface TTSConfig {
  voice?: string;
  rate: number;       // 0.1 - 10
  pitch: number;      // 0.1 - 2
  volume: number;     // 0 - 1
}

export class VoiceController extends EventEmitter {
  private isListening: boolean = false;
  private recognition: any = null;
  private commands: VoiceCommand[] = [];
  private ttsConfig: TTSConfig = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
  };
  
  constructor() {
    super();
    this.initSpeechRecognition();
  }
  
  /**
   * 初始化语音识别
   */
  private initSpeechRecognition(): void {
    // 使用 Web Speech API
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || 
                                (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'zh-CN';
        
        this.recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result: SpeechRecognitionResult = {
              transcript: event.results[i][0].transcript,
              confidence: event.results[i][0].confidence,
              isFinal: event.results[i].isFinal,
            };
            
            this.emit('speech', result);
            
            if (result.isFinal) {
              this.processCommand(result.transcript);
            }
          }
        };
        
        this.recognition.onerror = (event: any) => {
          log.error('[VoiceController] Error:', event.error);
          this.emit('error', event.error);
        };
        
        this.recognition.onend = () => {
          if (this.isListening) {
            // 自动重新开始
            this.recognition.start();
          }
        };
      }
    }
  }
  
  /**
   * 注册语音命令
   */
  public registerCommand(pattern: RegExp | string, action: (transcript: string) => Promise<void> | void, description: string): void {
    this.commands.push({ pattern, action, description });
    log.info(`[VoiceController] Registered command: ${description}`);
  }
  
  /**
   * 处理语音命令
   */
  private async processCommand(transcript: string): Promise<void> {
    log.info(`[VoiceController] Processing: ${transcript}`);
    
    for (const cmd of this.commands) {
      const matched = typeof cmd.pattern === 'string'
        ? transcript.includes(cmd.pattern)
        : cmd.pattern.test(transcript);
      
      if (matched) {
        try {
          await cmd.action(transcript);
          this.emit('commandExecuted', cmd.description);
        } catch (error) {
          log.error('[VoiceController] Command error:', error);
          this.emit('commandError', error);
        }
        return;
      }
    }
    
    // 没有匹配的命令，发送给 AI 处理
    this.emit('unknownCommand', transcript);
  }
  
  /**
   * 开始监听
   */
  public startListening(): void {
    if (this.recognition && !this.isListening) {
      this.recognition.start();
      this.isListening = true;
      this.emit('listeningStart');
      log.info('[VoiceController] Started listening');
    }
  }
  
  /**
   * 停止监听
   */
  public stopListening(): void {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
      this.isListening = false;
      this.emit('listeningStop');
      log.info('[VoiceController] Stopped listening');
    }
  }
  
  /**
   * 语音合成 - 说话
   */
  public async speak(text: string, config?: Partial<TTSConfig>): Promise<void> {
    const cfg = { ...this.ttsConfig, ...config };
    
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('TTS only available in renderer'));
        return;
      }
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = cfg.rate;
      utterance.pitch = cfg.pitch;
      utterance.volume = cfg.volume;
      
      // 选择中文语音
      const voices = speechSynthesis.getVoices();
      const chineseVoice = voices.find(v => v.lang.includes('zh'));
      if (chineseVoice) {
        utterance.voice = chineseVoice;
      }
      
      utterance.onend = () => resolve();
      utterance.onerror = (e: any) => reject(e);
      
      speechSynthesis.speak(utterance);
    });
  }
  
  /**
   * 获取可用语音列表
   */
  public getAvailableVoices(): SpeechSynthesisVoice[] {
    if (typeof window === 'undefined') return [];
    return speechSynthesis.getVoices();
  }
  
  /**
   * 设置唤醒词检测
   */
  public setWakeWordDetection(callback: (wakeWord: string) => void): void {
    // 使用连续识别检测唤醒词
    this.on('speech', (result: SpeechRecognitionResult) => {
      if (!result.isFinal) {
        const wakeWords = ['嘿德谟', '你好德谟', '德谟', 'hey hermes', 'hi hermes'];
        for (const word of wakeWords) {
          if (result.transcript.toLowerCase().includes(word.toLowerCase())) {
            this.emit('wakeWordDetected', word);
            callback(word);
            break;
          }
        }
      }
    });
  }
  
  public isActive(): boolean {
    return this.isListening;
  }
}

export default VoiceController;
