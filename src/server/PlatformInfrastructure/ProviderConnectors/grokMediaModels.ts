// Grok（xAI）圖片、影片、語音的模型偵測結果與可調參數：參數依 xAI 官方文件內建（spec：非 LLM 的參數由平台內建），
// 聲音清單即時查詢。不自動帶入價格（spec：只有 LLM 自動帶入）。

import {
  MEDIA_PARAM_KEYS,
  type DetectedModel,
  type ParamDefinition,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { asArray, asString } from './chatHelpers.ts';
import { toContentKinds } from './mediaHelpers.ts';

// 語音沒有模型清單，平台用這個名稱代表 xAI 的 /tts
export const GROK_TTS_MODEL_ID = 'grok-tts';
export const GROK_DEFAULT_VOICE = 'eve';
// 這個舊模型的影片最高 720p（xAI 官方文件）
const VIDEO_MODEL_WITHOUT_1080P = 'grok-imagine-video';

const IMAGE_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '2:3',
  '3:2',
  '9:19.5',
  '19.5:9',
  '9:20',
  '20:9',
  '1:2',
  '2:1',
  '21:9',
  '5:2',
];
const IMAGE_RESOLUTIONS = ['1k', '1.5k', '2k'];
const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'];
const SPEECH_LANGUAGES = [
  'auto',
  'en',
  'zh',
  'ja',
  'ko',
  'ar-EG',
  'ar-SA',
  'ar-AE',
  'bn',
  'fr',
  'de',
  'hi',
  'id',
  'it',
  'pt-BR',
  'pt-PT',
  'ru',
  'es-MX',
  'es-ES',
  'tr',
  'vi',
];

type JsonObject = Record<string, unknown>;

// ===== 偵測到的模型 =====

export function toGrokMediaModel(type: 'image' | 'video', model: JsonObject): DetectedModel {
  const id = asString(model.id);
  return {
    id,
    displayName: id,
    type,
    params: type === 'image' ? imageParams() : videoParams(id),
    inputKinds: toContentKinds(asArray(model.input_modalities).map(asString)),
    outputKinds: toContentKinds(asArray(model.output_modalities).map(asString)),
  };
}

export function grokSpeechModel(): DetectedModel {
  return {
    id: GROK_TTS_MODEL_ID,
    displayName: 'Grok TTS',
    type: 'audio',
    params: speechParams(),
    inputKinds: ['text'],
    outputKinds: ['audio'],
  };
}

// ===== 可調參數（xAI 官方文件） =====

function imageParams(): ParamDefinition[] {
  return [
    { key: MEDIA_PARAM_KEYS.count, kind: 'number', min: 1, max: 10, isInteger: true, default: 1 },
    {
      key: MEDIA_PARAM_KEYS.aspectRatio,
      kind: 'select',
      options: IMAGE_ASPECT_RATIOS,
      default: 'auto',
    },
    { key: MEDIA_PARAM_KEYS.resolution, kind: 'select', options: IMAGE_RESOLUTIONS, default: '1k' },
  ];
}

function videoParams(model: string): ParamDefinition[] {
  const resolutions =
    model === VIDEO_MODEL_WITHOUT_1080P ? ['480p', '720p'] : ['480p', '720p', '1080p'];
  return [
    {
      key: MEDIA_PARAM_KEYS.duration,
      kind: 'number',
      min: 1,
      max: 15,
      isInteger: true,
      default: 8,
    },
    {
      key: MEDIA_PARAM_KEYS.aspectRatio,
      kind: 'select',
      options: VIDEO_ASPECT_RATIOS,
      default: '16:9',
    },
    { key: MEDIA_PARAM_KEYS.resolution, kind: 'select', options: resolutions, default: '480p' },
  ];
}

function speechParams(): ParamDefinition[] {
  return [
    {
      key: MEDIA_PARAM_KEYS.voice,
      kind: 'select',
      options: [],
      default: GROK_DEFAULT_VOICE,
      hasLiveOptions: true,
    },
    { key: MEDIA_PARAM_KEYS.language, kind: 'select', options: SPEECH_LANGUAGES, default: 'auto' },
    { key: MEDIA_PARAM_KEYS.speed, kind: 'number', min: 0.7, max: 1.5, default: 1 },
  ];
}
