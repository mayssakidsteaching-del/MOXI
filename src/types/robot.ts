export type RobotEmotion =
  | 'happy'
  | 'curious'
  | 'excited'
  | 'love'
  | 'annoyed'
  | 'sleepy'
  | 'thinking'
  | 'surprised'
  | 'singing'
  | 'eating'
  | 'cool';

export type RobotProp =
  | 'none'
  | 'drink'
  | 'burger'
  | 'music'
  | 'heart'
  | 'spark'
  | 'camera'
  | 'moon'
  | 'gift';

export type InteractionType =
  | 'chat'
  | 'vision_scan'
  | 'poke'
  | 'pet'
  | 'force_gesture'
  | 'idle_wander'
  | 'sing'
  | 'snack';

export interface RobotMemory {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'robot';
  text: string;
  emotion?: RobotEmotion;
  prop?: RobotProp;
  imagePreview?: string;
  detectedSummary?: string;
  timestamp: string;
}

export interface RobotInteractRequest {
  message?: string;
  imageBase64?: string;
  mimeType?: string;
  memories?: Array<{ key: string; value: string }>;
  history?: Array<{ role: 'user' | 'robot'; text: string }>;
  interactionType?: InteractionType;
  pokeCount?: number;
}

export interface RobotInteractResponse {
  reply: string;
  emotion: RobotEmotion;
  prop: RobotProp;
  gazeX: number;
  gazeY: number;
  newMemories: Array<{ key: string; value: string }>;
  detectedSummary?: string;
}
