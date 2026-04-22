export enum PredictionType {
  NEXT_APP = 'NEXT_APP',
  NEXT_OPERATION = 'NEXT_OPERATION',
  USER_INTENT = 'USER_INTENT',
  NEEDED_HELP = 'NEEDED_HELP',
  ATTENTION_CHANGE = 'ATTENTION_CHANGE',
}

export interface PredictionContext {
  timeOfDay: string; // morning/afternoon/evening/night
  currentApp: string;
  recentOperations: string[];
  attentionScore: number; // 0-1
  dayOfWeek: number; // 0-6
  currentWindow?: string;
  mouseSpeed?: number;
  keyStrokeRate?: number;
  idleTimeSeconds?: number;
}

export interface Prediction {
  type: PredictionType;
  value: string;
  confidence: number; // 0-1
  reasoning: string;
  autoExecute: boolean;
  suggestionText?: string;
  context: PredictionContext;
}
