import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Camera,
  Eye,
  Globe,
  Hand,
  LogOut,
  Maximize2,
  Mic,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { RobotFace } from './components/RobotFace';
import {
  auth,
  deleteMemoryDoc,
  ensureUserProfile,
  saveHighlightDoc,
  signInWithGoogle,
  signOutUser,
  subscribeHighlights,
  subscribeMemories,
  updateUserPreferences,
  upsertMemoryDoc,
  type RobotHighlightDoc,
} from './firebase';
import { soundFx } from '../utils/soundFx';
import type { RobotEmotion, RobotMemory, RobotProp } from './types/robot';

const STORAGE_MEMORIES_KEY = 'moxi_memories_v1';

const LANGUAGE_OPTIONS = [
  'Auto-detect (200+ languages)',
  'English',
  'French',
  'Spanish',
  'Arabic',
  'Japanese',
  'Korean',
  'Mandarin Chinese',
  'Hindi',
  'Portuguese',
  'German',
];

function loadGuestMemories(): RobotMemory[] {
  try {
    const raw = localStorage.getItem(STORAGE_MEMORIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm24kToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(new ArrayBuffer(int16.length * 4));
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export default function App() {
  // Auth & Firestore user state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState('Auto-detect (200+ languages)');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [memories, setMemories] = useState<RobotMemory[]>(loadGuestMemories);
  const [highlights, setHighlights] = useState<RobotHighlightDoc[]>([]);

  // Memory form inputs
  const [memKey, setMemKey] = useState('');
  const [memValue, setMemValue] = useState('');

  // Robot live state
  const [emotion, setEmotion] = useState<RobotEmotion>('sleepy');
  const [prop, setProp] = useState<RobotProp>('none');
  const [gazeX, setGazeX] = useState(0);
  const [gazeY, setGazeY] = useState(0);
  const [isAwake, setIsAwake] = useState(false);
  const [isBooting, setIsBooting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [caption, setCaption] = useState('');

  // Refs for WebSocket & Web Audio streaming
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);

  const activeAudioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const transcriptBufferRef = useRef('');
  const inputTranscriptRef = useRef('');
  const captionTimerRef = useRef<number | null>(null);
  const propTimerRef = useRef<number | null>(null);
  const isAwakeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const voiceEnabledRef = useRef(voiceEnabled);
  const emotionRef = useRef<RobotEmotion>(emotion);
  const userRef = useRef<User | null>(user);
  const memoriesRef = useRef<RobotMemory[]>(memories);
  const preferredLanguageRef = useRef(preferredLanguage);
  const pokeCountRef = useRef(0);
  const pokeResetTimerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    soundFx.muted = !voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    emotionRef.current = emotion;
  }, [emotion]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    preferredLanguageRef.current = preferredLanguage;
  }, [preferredLanguage]);

  useEffect(() => {
    memoriesRef.current = memories;
    if (!user) {
      try {
        localStorage.setItem(STORAGE_MEMORIES_KEY, JSON.stringify(memories));
      } catch {
        // ignore
      }
    }
  }, [memories, user]);

  // Firebase Auth & Firestore Subscriptions
  useEffect(() => {
    let unsubMemories: (() => void) | undefined;
    let unsubHighlights: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);

      if (unsubMemories) unsubMemories();
      if (unsubHighlights) unsubHighlights();

      if (currentUser) {
        try {
          const profile = await ensureUserProfile(currentUser);
          setPreferredLanguage(profile.preferredLanguage);
          setVoiceEnabled(profile.voiceEnabled);

          unsubMemories = subscribeMemories(
            currentUser.uid,
            (items) => {
              setMemories(items);
            },
            (err) => setAuthError(err.message)
          );
          unsubHighlights = subscribeHighlights(
            currentUser.uid,
            (items) => {
              setHighlights(items);
            },
            (err) => setAuthError(err.message)
          );
        } catch (err) {
          setAuthError(err instanceof Error ? err.message : 'Failed to load profile.');
        }
      } else {
        setMemories(loadGuestMemories());
        setHighlights([]);
      }
    });

    return () => {
      unsubAuth();
      if (unsubMemories) unsubMemories();
      if (unsubHighlights) unsubHighlights();
    };
  }, []);

  // Escape key exits Fullscreen OLED mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullScreen) {
        setFullScreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullScreen]);

  const scheduleCaptionClear = useCallback((delayMs = 5500) => {
    if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
    captionTimerRef.current = window.setTimeout(() => {
      setCaption('');
      transcriptBufferRef.current = '';
    }, delayMs);
  }, []);

  const mergeMemory = useCallback(async (key: string, value: string) => {
    const cleanKey = key.trim().slice(0, 80);
    const cleanVal = value.trim().slice(0, 400);
    if (!cleanKey || !cleanVal) return;

    if (userRef.current) {
      await upsertMemoryDoc(userRef.current.uid, cleanKey, cleanVal);
    } else {
      setMemories((prev) => {
        const next = [...prev];
        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const idx = next.findIndex((m) => m.key.toLowerCase() === cleanKey.toLowerCase());
        if (idx >= 0) {
          next[idx] = { ...next[idx], value: cleanVal, updatedAt: nowStr };
        } else {
          next.unshift({
            id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            key: cleanKey,
            value: cleanVal,
            updatedAt: nowStr,
          });
        }
        return next;
      });
    }
  }, []);

  const stopQueuedOutputAudio = useCallback(() => {
    for (const src of activeAudioSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore
      }
    }
    activeAudioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const scheduleOutputAudioChunk = useCallback(
    (base64Pcm: string) => {
      if (!voiceEnabledRef.current) return;
      const ctx = outputAudioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const float32 = base64Pcm24kToFloat32(base64Pcm);
      if (float32.length === 0) return;

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const startAt = Math.max(ctx.currentTime + 0.02, nextStartTimeRef.current);
      nextStartTimeRef.current = startAt + buffer.duration;

      activeAudioSourcesRef.current.add(source);
      isSpeakingRef.current = true;
      setIsSpeaking(true);
      setIsThinking(false);
      lastActivityRef.current = Date.now();

      source.onended = () => {
        activeAudioSourcesRef.current.delete(source);
        if (activeAudioSourcesRef.current.size === 0) {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          lastActivityRef.current = Date.now();
          scheduleCaptionClear(4500);
        }
      };

      source.start(startAt);
    },
    [scheduleCaptionClear]
  );

  const sendLiveEvent = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'event', text }));
      lastActivityRef.current = Date.now();
    }
  }, []);

  // Optical-flow Force Control tracking from camera
  useEffect(() => {
    if (!isAwake) return;
    const canvas = document.createElement('canvas');
    const w = 64;
    const h = 48;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const interval = window.setInterval(() => {
      const video = hiddenVideoRef.current;
      if (!video || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const prev = prevFrameRef.current;

      if (prev) {
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const diff =
              Math.abs(data[idx] - prev[idx]) +
              Math.abs(data[idx + 1] - prev[idx + 1]) +
              Math.abs(data[idx + 2] - prev[idx + 2]);
            if (diff > 82) {
              sumX += x;
              sumY += y;
              count++;
            }
          }
        }
        if (count > 16 && count < w * h * 0.6) {
          const normX = -((sumX / count / w) * 2 - 1);
          const normY = (sumY / count / h) * 2 - 1;
          setGazeX(Math.max(-1, Math.min(1, normX)));
          setGazeY(Math.max(-1, Math.min(1, normY)));
        }
      }
      prevFrameRef.current = new Uint8ClampedArray(data);
    }, 100);

    return () => window.clearInterval(interval);
  }, [isAwake]);

  // Stream video frames at 0.5 FPS when camera is active
  useEffect(() => {
    if (!isAwake) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const videoInterval = window.setInterval(() => {
      const video = hiddenVideoRef.current;
      const ws = wsRef.current;
      if (
        !video ||
        video.readyState < 2 ||
        !video.videoWidth ||
        !ws ||
        ws.readyState !== WebSocket.OPEN ||
        !ctx
      ) {
        return;
      }
      const targetWidth = 384;
      const scale = targetWidth / video.videoWidth;
      canvas.width = targetWidth;
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        ws.send(JSON.stringify({ type: 'video', data: base64 }));
      }
    }, 2000);

    return () => window.clearInterval(videoInterval);
  }, [isAwake]);

  // Autonomous idle glances
  useEffect(() => {
    if (!isAwake) return;
    const glance = window.setInterval(() => {
      if (!isSpeakingRef.current) {
        setGazeX((Math.random() - 0.5) * 1.1);
        setGazeY((Math.random() - 0.5) * 0.5);
      }
    }, 3200);

    const idleChatter = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > 28000 && !isSpeakingRef.current) {
        sendLiveEvent(
          'It has been quiet for a bit. Make one brief, playful observation about what you see or ask your human a quick question.'
        );
      }
    }, 10000);

    return () => {
      window.clearInterval(glance);
      window.clearInterval(idleChatter);
    };
  }, [isAwake, sendLiveEvent]);

  const handleSleep = useCallback(() => {
    isAwakeRef.current = false;
    setIsAwake(false);
    setIsListening(false);
    setIsThinking(false);
    setEmotion('sleepy');
    setProp('none');
    setCaption('');
    stopQueuedOutputAudio();

    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;
    processorRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, [stopQueuedOutputAudio]);

  const handleWake = useCallback(async () => {
    if (isAwakeRef.current) return;
    isAwakeRef.current = true;
    setIsAwake(true);
    setIsBooting(true);

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (AudioCtx) {
      if (!inputAudioCtxRef.current) {
        inputAudioCtxRef.current = new AudioCtx();
      }
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
      }
      await Promise.all([
        inputAudioCtxRef.current.resume().catch(() => {}),
        outputAudioCtxRef.current.resume().catch(() => {}),
      ]);
    }

    soundFx.playBoot();

    window.setTimeout(() => {
      setIsBooting(false);
      setEmotion('happy');
    }, 950);

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        stream = null;
      }
    }

    if (!isAwakeRef.current) {
      stream?.getTracks().forEach((t) => t.stop());
      return;
    }

    if (stream) {
      mediaStreamRef.current = stream;
      if (hiddenVideoRef.current && stream.getVideoTracks().length > 0) {
        hiddenVideoRef.current.srcObject = stream;
        hiddenVideoRef.current.play().catch(() => {});
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/live`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'init',
          preferredLanguage: preferredLanguageRef.current,
          memories: memoriesRef.current.map((m) => ({ key: m.key, value: m.value })),
        })
      );

      if (stream && stream.getAudioTracks().length > 0 && inputAudioCtxRef.current) {
        const ctx = inputAudioCtxRef.current;
        const audioStream = new MediaStream(stream.getAudioTracks());
        const source = ctx.createMediaStreamSource(audioStream);

        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 85;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -32;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.2;

        const processor = ctx.createScriptProcessor(2048, 1, 1);
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;

        source.connect(highpass);
        highpass.connect(compressor);
        compressor.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(ctx.destination);

        sourceNodeRef.current = source;
        processorRef.current = processor;
        setIsListening(true);

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const channel = e.inputBuffer.getChannelData(0);
          const resampled = downsampleTo16k(channel, ctx.sampleRate);
          const base64 = float32ToPcm16Base64(resampled);
          ws.send(JSON.stringify({ type: 'audio', data: base64 }));
        };
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'audio' && msg.data) {
          scheduleOutputAudioChunk(msg.data);
        } else if (msg.type === 'interrupted') {
          stopQueuedOutputAudio();
          transcriptBufferRef.current = '';
        } else if (msg.type === 'outputTranscript' && msg.text) {
          transcriptBufferRef.current += msg.text;
          setCaption(transcriptBufferRef.current);
          if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
        } else if (msg.type === 'inputTranscript' && msg.text) {
          lastActivityRef.current = Date.now();
          inputTranscriptRef.current += msg.text;
          transcriptBufferRef.current = '';
          setIsThinking(true);
        } else if (msg.type === 'turnComplete') {
          setIsThinking(false);
          scheduleCaptionClear(5500);
          // Persist spoken highlights to Firestore when signed in
          if (userRef.current) {
            const spokenUser = inputTranscriptRef.current.trim();
            const spokenMoxi = transcriptBufferRef.current.trim();
            if (spokenUser) {
              saveHighlightDoc(userRef.current.uid, 'user', spokenUser, 'happy').catch(() => {});
              inputTranscriptRef.current = '';
            }
            if (spokenMoxi) {
              saveHighlightDoc(
                userRef.current.uid,
                'moxi',
                spokenMoxi,
                emotionRef.current
              ).catch(() => {});
              transcriptBufferRef.current = '';
            }
          }
        } else if (msg.type === 'expression') {
          setEmotion(msg.emotion);
          setProp(msg.prop);
          if (typeof msg.gazeX === 'number') setGazeX(msg.gazeX);
          if (typeof msg.gazeY === 'number') setGazeY(msg.gazeY);
          if (msg.prop && msg.prop !== 'none') {
            if (propTimerRef.current) window.clearTimeout(propTimerRef.current);
            propTimerRef.current = window.setTimeout(() => setProp('none'), 7000);
          }
        } else if (msg.type === 'memory' && msg.key && msg.value) {
          mergeMemory(msg.key, msg.value).catch(() => {});
        } else if (msg.type === 'error' && msg.message) {
          setCaption(msg.message);
          scheduleCaptionClear(8000);
          setIsThinking(false);
        }
      } catch {
        // ignore malformed packets
      }
    };

    ws.onclose = () => {
      setIsListening(false);
      setIsThinking(false);
    };
  }, [mergeMemory, scheduleCaptionClear, scheduleOutputAudioChunk, stopQueuedOutputAudio]);

  useEffect(() => {
    return () => {
      handleSleep();
    };
  }, [handleSleep]);

  const handlePoke = (side: 'left' | 'right') => {
    pokeCountRef.current += 1;
    if (pokeResetTimerRef.current) window.clearTimeout(pokeResetTimerRef.current);
    pokeResetTimerRef.current = window.setTimeout(() => {
      pokeCountRef.current = 0;
    }, 6000);

    const annoyed = pokeCountRef.current >= 2;
    soundFx.playPoke(annoyed);
    setEmotion(annoyed ? 'annoyed' : 'surprised');
    setGazeX(side === 'left' ? -0.45 : 0.45);
    sendLiveEvent(
      `The human just poked your ${side} eye (poke streak: ${pokeCountRef.current}). React out loud playfully!`
    );
  };

  const handlePet = () => {
    soundFx.playPurr();
    setEmotion('love');
    setProp('heart');
    sendLiveEvent('The human is gently petting your forehead! React warmly out loud.');
  };

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    }
  };

  const handleAddMemorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memKey.trim() || !memValue.trim()) return;
    setAuthError(null);
    try {
      await mergeMemory(memKey, memValue);
      setMemKey('');
      setMemValue('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to save memory.');
    }
  };

  const handleDeleteMemory = async (id: string) => {
    setAuthError(null);
    try {
      if (user) {
        await deleteMemoryDoc(user.uid, id);
      } else {
        setMemories((prev) => prev.filter((m) => m.id !== id));
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to delete memory.');
    }
  };

  const handleLanguageChange = async (lang: string) => {
    setPreferredLanguage(lang);
    setAuthError(null);
    if (user) {
      try {
        await updateUserPreferences(user.uid, {
          displayName: user.displayName || 'Friend',
          preferredLanguage: lang,
          voiceEnabled,
        });
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to update language preference.');
      }
    }
    if (isAwake) {
      sendLiveEvent(
        `The user set preferred language to ${lang}. Acknowledge warmly in that language!`
      );
    }
  };

  const handleVoiceToggle = async () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    setAuthError(null);
    if (!next) {
      stopQueuedOutputAudio();
    }
    if (user) {
      try {
        await updateUserPreferences(user.uid, {
          displayName: user.displayName || 'Friend',
          preferredLanguage,
          voiceEnabled: next,
        });
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to update voice preference.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100">
      <video ref={hiddenVideoRef} muted playsInline className="hidden" />

      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#090B10]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-8 px-5 sm:px-8">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#overview"
            className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            MOXI
          </a>

          {/* Zone 2: 4 Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
            <a
              href="#overview"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Overview
            </a>
            <a
              href="#capabilities"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#memory"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Cloud Memory
            </a>
            <button
              type="button"
              onClick={() => {
                setFullScreen(true);
                if (!isAwake) handleWake();
              }}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Dock Mode
            </button>
          </nav>

          {/* Zone 3: Single Primary Action (Google Auth) */}
          <div className="flex items-center shrink-0">
            {!authReady ? (
              <span className="text-xs text-slate-500">Loading...</span>
            ) : user ? (
              <button
                type="button"
                onClick={() => signOutUser()}
                className="flex min-h-[40px] items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/[0.08] whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5 text-slate-400" />
                <span>Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="min-h-[40px] rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 whitespace-nowrap shrink-0"
              >
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        {/* Hero Proposition & Live Robot Stage */}
        <section
          id="overview"
          className="grid grid-cols-1 items-center gap-10 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-20"
        >
          <div className="flex flex-col items-start">
            <p className="text-xs font-medium text-sky-400">
              Living Desk Robot · 200+ Languages · Google Cloud Memory
            </p>
            <h1
              className="mt-3 font-display font-bold tracking-tight text-white"
              style={{ fontSize: 'clamp(2.25rem, 4vw, 3.75rem)', lineHeight: 1.08, textWrap: 'balance' }}
            >
              Turn any screen into a living desk robot
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400">
              MOXI listens hands-free in over 200 languages, sees your desk through the camera, reacts when you poke or pet its screen, and remembers your personal details securely in your Google account.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={isAwake ? handleSleep : handleWake}
                className={`flex min-h-[46px] items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold transition whitespace-nowrap shrink-0 ${
                  isAwake
                    ? 'border border-white/15 bg-white/[0.06] text-white hover:bg-white/10'
                    : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                }`}
              >
                <Mic className="h-4 w-4" />
                <span>{isAwake ? 'Put MOXI to Sleep' : 'Wake & Talk to MOXI'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFullScreen(true);
                  if (!isAwake) handleWake();
                }}
                className="flex min-h-[46px] items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06] whitespace-nowrap shrink-0"
              >
                <Maximize2 className="h-4 w-4 text-sky-400" />
                <span>Full-Screen Dock Mode</span>
              </button>
            </div>

            {authError && (
              <p className="mt-4 text-xs text-rose-300">{authError}</p>
            )}
          </div>

          {/* Right Column: Live Interactive MOXI Robot Display */}
          <div className="flex flex-col items-center">
            <RobotFace
              emotion={emotion}
              prop={prop}
              gazeX={gazeX}
              gazeY={gazeY}
              isSpeaking={isSpeaking}
              isThinking={isThinking}
              isListening={isListening}
              isAwake={isAwake}
              isBooting={isBooting}
              fullScreen={fullScreen}
              caption={caption}
              onWake={handleWake}
              onPoke={handlePoke}
              onPet={handlePet}
              onPointerGaze={(x, y) => {
                setGazeX(x);
                setGazeY(y);
              }}
              onExitFullScreen={() => setFullScreen(false)}
            />

            {/* Minimal Rover Stand Pedestal */}
            <div className="flex w-56 flex-col items-center">
              <div className="h-3 w-16 border-x border-white/10 bg-[#1B2230]" />
              <div className="flex h-10 w-full items-center justify-between rounded-2xl border border-white/10 bg-[#151A25] px-4 shadow-lg">
                <span className="h-5 w-5 rounded-md bg-[#0B0E14] border border-white/10" />
                <span
                  className={`h-1.5 w-16 rounded-full transition-colors ${
                    isSpeaking
                      ? 'bg-sky-300 shadow-[0_0_12px_#38BDF8]'
                      : isListening
                        ? 'bg-emerald-400 shadow-[0_0_12px_#34D399]'
                        : 'bg-sky-500/50'
                  }`}
                />
                <span className="h-5 w-5 rounded-md bg-[#0B0E14] border border-white/10" />
              </div>
            </div>
          </div>
        </section>

        {/* Core Capabilities Bento Grid */}
        <section id="capabilities" className="border-t border-white/8 py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Built to feel alive on your desk
              </h2>
              <p className="mt-2 max-w-xl text-sm text-slate-400">
                Real-time audio, camera vision, touch physics, and persistent cloud memory working together in one lightweight web app.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['happy', 'curious', 'love', 'singing', 'annoyed'] as RobotEmotion[]).map((mood) => (
                <button
                  key={mood}
                  type="button"
                  onClick={() => {
                    setEmotion(mood);
                    setProp(mood === 'love' ? 'heart' : mood === 'singing' ? 'music' : 'none');
                    soundFx.playChirp(mood === 'happy');
                  }}
                  className={`min-h-[40px] rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
                    emotion === mood
                      ? 'border-sky-400/60 bg-sky-500/15 text-sky-200'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
                  }`}
                >
                  {mood}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <article className="rounded-2xl border border-white/8 bg-[#11151E] p-7 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-white">
                  01. Real-Time Voice & Camera Vision
                </h3>
                <Camera className="h-5 w-5 text-sky-400" />
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
                Streams low-latency 16kHz voice input and periodic camera frames directly over a live WebSocket so MOXI recognizes drinks, snacks, desk gear, and natural interruptions mid-sentence.
              </p>
            </article>

            <article className="rounded-2xl border border-white/8 bg-[#11151E] p-7">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-white">
                  02. 200+ Languages
                </h3>
                <Globe className="h-5 w-5 text-sky-400" />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                High-pass rumble filtering and voice compression clarify soft speech while MOXI responds fluently in over 200 world languages and dialects.
              </p>
            </article>

            <article className="rounded-2xl border border-white/8 bg-[#11151E] p-7">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-white">
                  03. Touch & Force Control
                </h3>
                <Hand className="h-5 w-5 text-sky-400" />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Tap an eye to poke, stroke the upper forehead to pet, or wave in front of the lens to steer MOXI&apos;s gaze with optical motion tracking.
              </p>
            </article>

            <article className="rounded-2xl border border-white/8 bg-[#11151E] p-7 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-white">
                  04. Synced Cloud Memory with Firebase
                </h3>
                <Eye className="h-5 w-5 text-sky-400" />
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
                Tell MOXI your birthday, favorite drink, or hobbies once—facts are stored privately under your Google account in Cloud Firestore and recalled every time you reconnect.
              </p>
            </article>
          </div>
        </section>

        {/* Cloud Memory & Preferences Hub */}
        <section id="memory" className="border-t border-white/8 py-16">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.2fr]">
            {/* Left: Account & Preferences */}
            <div className="rounded-2xl border border-white/8 bg-[#11151E] p-7">
              <h2 className="font-display text-xl font-semibold text-white">
                Account & Companion Settings
              </h2>

              {user ? (
                <div className="mt-5 flex flex-col gap-5">
                  <div className="flex items-center gap-3 border-b border-white/8 pb-4">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'User avatar'}
                        referrerPolicy="no-referrer"
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-300">
                        {(user.displayName || user.email || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {user.displayName || 'Google User'}
                      </p>
                      <p className="truncate text-xs text-slate-400">{user.email}</p>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="lang-select"
                      className="block text-xs font-medium text-slate-300"
                    >
                      Spoken & Listening Language
                    </label>
                    <select
                      id="lang-select"
                      value={preferredLanguage}
                      onChange={(e) => handleLanguageChange(e.target.value)}
                      className="mt-2 min-h-[44px] w-full rounded-xl border border-white/10 bg-[#090B10] px-3.5 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
                    >
                      {LANGUAGE_OPTIONS.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleVoiceToggle}
                    className="flex min-h-[44px] items-center justify-between rounded-xl border border-white/10 bg-[#090B10] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.04]"
                  >
                    <span className="flex items-center gap-2.5 font-medium">
                      {voiceEnabled ? (
                        <Volume2 className="h-4 w-4 text-sky-400" />
                      ) : (
                        <VolumeX className="h-4 w-4 text-slate-500" />
                      )}
                      MOXI Voice Output
                    </span>
                    <span className="text-xs text-slate-400">
                      {voiceEnabled ? 'Enabled' : 'Muted'}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-4">
                  <p className="text-sm leading-relaxed text-slate-400">
                    Sign in with Google to persist MOXI&apos;s memories, language preference, and conversation highlights securely in Cloud Firestore across all your devices.
                  </p>
                  <button
                    type="button"
                    onClick={handleSignIn}
                    className="flex min-h-[44px] w-fit items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
                  >
                    <span>Sign in with Google</span>
                  </button>
                </div>
              )}
            </div>

            {/* Right: Synced Memory Bank & Recent Highlights */}
            <div className="rounded-2xl border border-white/8 bg-[#11151E] p-7">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-display text-xl font-semibold text-white">
                  {user ? 'Synced Cloud Memory Bank' : 'Local Memory Bank'}
                </h2>
                <span className="font-mono text-xs text-slate-400">
                  {memories.length} saved
                </span>
              </div>

              <form onSubmit={handleAddMemorySubmit} className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                <input
                  type="text"
                  value={memKey}
                  onChange={(e) => setMemKey(e.target.value)}
                  maxLength={80}
                  placeholder="Label (e.g. Birthday)"
                  className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-[#090B10] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                />
                <input
                  type="text"
                  value={memValue}
                  onChange={(e) => setMemValue(e.target.value)}
                  maxLength={400}
                  placeholder="Detail (e.g. September 20th)"
                  className="min-h-[44px] flex-[1.4] rounded-xl border border-white/10 bg-[#090B10] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!memKey.trim() || !memValue.trim()}
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-white/[0.08] px-4 text-sm font-medium text-white transition hover:bg-white/15 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                  <span>Save</span>
                </button>
              </form>

              <div className="mt-5 divide-y divide-white/8 border-t border-white/8">
                {memories.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    No saved memories yet. Tell MOXI your name or birthday, or add one above.
                  </p>
                ) : (
                  memories.map((mem) => (
                    <div key={mem.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="font-medium text-sky-300">{mem.key}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {mem.updatedAt}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-sm font-medium text-slate-100">
                          {mem.value}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete ${mem.key}`}
                        onClick={() => handleDeleteMemory(mem.id)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {user && highlights.length > 0 && (
                <div className="mt-6 border-t border-white/8 pt-5">
                  <h3 className="text-xs font-medium text-slate-400">
                    Recent Spoken Highlights
                  </h3>
                  <div className="mt-3 flex max-h-44 flex-col gap-2 overflow-y-auto pr-1">
                    {highlights.slice(0, 8).map((h) => (
                      <div key={h.id} className="text-xs leading-relaxed text-slate-300">
                        <span className="font-semibold text-sky-300">
                          {h.speaker === 'user' ? 'You' : 'MOXI'}
                        </span>
                        <span aria-hidden="true" className="mx-1.5 text-slate-600">
                          ·
                        </span>
                        <span>{h.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-white/8 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center sm:px-8">
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span className="font-display font-bold text-white">MOXI</span>
            <span aria-hidden="true">·</span>
            <span>Living Desk Robot Website</span>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs text-slate-400">
            <a href="#overview" className="hover:text-white transition-colors">
              Overview
            </a>
            <a href="#capabilities" className="hover:text-white transition-colors">
              Capabilities
            </a>
            <a href="#memory" className="hover:text-white transition-colors">
              Cloud Memory
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
