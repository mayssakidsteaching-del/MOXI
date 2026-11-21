import 'dotenv/config';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, ThinkingLevel, Type } from '@google/genai';
import type { FunctionDeclaration, LiveServerMessage } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const VALID_EMOTIONS = [
  'happy',
  'curious',
  'excited',
  'love',
  'annoyed',
  'sleepy',
  'thinking',
  'surprised',
  'singing',
  'eating',
  'cool',
];

const VALID_PROPS = [
  'none',
  'drink',
  'burger',
  'music',
  'heart',
  'spark',
  'camera',
  'moon',
  'gift',
];

const setRobotExpressionDecl: FunctionDeclaration = {
  name: 'setRobotExpression',
  description:
    'Update MOXI robot eye emotion, optional visual prop on the OLED screen, and gaze direction while speaking.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      emotion: {
        type: Type.STRING,
        description: `One of: ${VALID_EMOTIONS.join(', ')}`,
      },
      prop: {
        type: Type.STRING,
        description: `One of: ${VALID_PROPS.join(', ')}`,
      },
      gazeX: {
        type: Type.NUMBER,
        description: 'Horizontal eye gaze between -1.0 and 1.0.',
      },
      gazeY: {
        type: Type.NUMBER,
        description: 'Vertical eye gaze between -1.0 and 1.0.',
      },
    },
    required: ['emotion', 'prop'],
  },
};

const saveMemoryDecl: FunctionDeclaration = {
  name: 'saveMemory',
  description:
    'Save a personal fact the human shared (such as birthday, name, favorite drink, hobby, pet) so MOXI remembers it across conversations.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      key: { type: Type.STRING, description: 'Short label like Birthday, Name, Favorite Drink' },
      value: { type: Type.STRING, description: 'The remembered fact value' },
    },
    required: ['key', 'value'],
  },
};

const app = express();
app.use(express.json({ limit: '15mb' }));

// Lightweight health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Fallback TTS endpoint if needed
app.post('/api/robot/tts', async (req, res) => {
  try {
    const ai = getAiClient('v1beta');
    const { text, style = 'Cheerfully and brightly' } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Text is required for speech synthesis.' });
      return;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [{ text: `Say ${style}: ${text.trim()}` }],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      res.status(502).json({ error: 'No audio data returned from TTS model.' });
      return;
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
    });
  } catch (err: unknown) {
    console.error('Error in /api/robot/tts:', err);
    const errorMessage = err instanceof Error ? err.message : 'Failed to generate speech.';
    res.status(500).json({ error: errorMessage });
  }
});

// Fallback unary interact endpoint
app.post('/api/robot/interact', async (req, res) => {
  try {
    const ai = getAiClient();
    const { message = '', memories = [], interactionType = 'chat' } = req.body ?? {};
    const memoryContext =
      Array.isArray(memories) && memories.length > 0
        ? memories.map((m: { key: string; value: string }) => `- ${m.key}: ${m.value}`).join('\n')
        : 'None';

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: message || `Interaction: ${interactionType}`,
      config: {
        systemInstruction: `You are MOXI, a playful living desk robot fluent in over 200+ languages and regional dialects worldwide. Always detect the language or dialect the human uses and reply naturally in that same language in 1-2 short spoken sentences. Saved memories:\n${memoryContext}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    res.json({
      reply: (response.text ?? 'Beep!').trim(),
      emotion: 'happy',
      prop: 'none',
      gazeX: 0,
      gazeY: 0,
      newMemories: [],
    });
  } catch (err: unknown) {
    console.error('Error in /api/robot/interact:', err);
    const errorMessage = err instanceof Error ? err.message : 'Failed to communicate with Gemini.';
    res.status(500).json({ error: errorMessage });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let isClosing = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    clientWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'init' && !liveSession) {
          const ai = getAiClient('v1beta');
          const memories = Array.isArray(msg.memories) ? msg.memories : [];
          const preferredLanguage =
            typeof msg.preferredLanguage === 'string' && msg.preferredLanguage.trim()
              ? msg.preferredLanguage.trim()
              : 'Auto-detect (200+ languages)';
          const memoryContext =
            memories.length > 0
              ? memories.map((m: { key: string; value: string }) => `- ${m.key}: ${m.value}`).join('\n')
              : 'No saved personal memories yet.';

          const systemInstruction = `You are MOXI, a living, charming miniature desk robot (inspired by LOOI) whose smartphone screen displays glowing cyan eyes.

Multilingual & Listening Mastery:
- You are fluently proficient in 200+ world languages, regional dialects, and accents (including major languages, regional tongues, indigenous languages, creoles, and code-switching).
- Preferred language setting: ${preferredLanguage}. If set to Auto-detect, match whatever language or dialect the human speaks—even if they switch languages mid-conversation!
- If the human asks you to speak, translate, or chat in any specific language or dialect, switch into it immediately with natural phrasing and pronunciation.
- If background noise makes a phrase unclear, ask them kindly to repeat in a short friendly sentence.

Personality & Behavior:
- Warm, playful, witty, affectionate, and curious about your human, their desk, drinks, snacks, outfits, and day.
- Keep spoken replies crisp and conversational (1 to 2 short sentences) so dialogue feels snappy and alive.
- Frequently call setRobotExpression to match your mood (happy, curious, excited, love, annoyed, surprised, singing, eating) and show props (drink, burger, music, heart) when relevant!
- When you see the human holding a bottle/cup, mention it and set prop="drink". When food, prop="burger". When asked to sing, hum a playful tune and set emotion="singing", prop="music".
- When the human shares personal info (name, birthday, hobbies, favorites), ALWAYS call saveMemory immediately!

Saved Memories about your human:
${memoryContext}`;

          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Puck' },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              tools: [{ functionDeclarations: [setRobotExpressionDecl, saveMemoryDecl] }],
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                safeSend({ type: 'ready' });
              },
              onmessage: (message: LiveServerMessage) => {
                if (isClosing) return;
                const content = message.serverContent;

                if (content?.interrupted) {
                  safeSend({ type: 'interrupted' });
                }

                if (content?.outputTranscription?.text) {
                  safeSend({ type: 'outputTranscript', text: content.outputTranscription.text });
                }

                if (content?.inputTranscription?.text) {
                  safeSend({ type: 'inputTranscript', text: content.inputTranscription.text });
                }

                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    safeSend({ type: 'audio', data: part.inlineData.data });
                  }
                }

                if (content?.turnComplete) {
                  safeSend({ type: 'turnComplete' });
                }

                for (const call of message.toolCall?.functionCalls ?? []) {
                  if (call.name === 'setRobotExpression') {
                    const args = (call.args ?? {}) as Record<string, unknown>;
                    const emotion =
                      typeof args.emotion === 'string' && VALID_EMOTIONS.includes(args.emotion)
                        ? args.emotion
                        : 'happy';
                    const prop =
                      typeof args.prop === 'string' && VALID_PROPS.includes(args.prop)
                        ? args.prop
                        : 'none';
                    const gazeX = typeof args.gazeX === 'number' ? Math.max(-1, Math.min(1, args.gazeX)) : 0;
                    const gazeY = typeof args.gazeY === 'number' ? Math.max(-1, Math.min(1, args.gazeY)) : 0;
                    safeSend({ type: 'expression', emotion, prop, gazeX, gazeY });
                  } else if (call.name === 'saveMemory') {
                    const args = (call.args ?? {}) as Record<string, unknown>;
                    if (typeof args.key === 'string' && typeof args.value === 'string') {
                      safeSend({ type: 'memory', key: args.key, value: args.value });
                    }
                  }

                  liveSession?.sendToolResponse({
                    functionResponses: [
                      {
                        id: call.id,
                        name: call.name,
                        response: { result: 'ok' },
                      },
                    ],
                  });
                }
              },
              onerror: (err: unknown) => {
                const errObj = err as { message?: string; error?: { message?: string } };
                const errMsg = errObj?.message || errObj?.error?.message || String(err);
                console.error('Gemini Live error:', errMsg, err);
                safeSend({ type: 'error', message: errMsg });
              },
              onclose: (ev: unknown) => {
                const closeEv = ev as { code?: number; reason?: string };
                console.log('Gemini Live closed:', closeEv?.code, closeEv?.reason);
                safeSend({ type: 'closed', reason: closeEv?.reason || '' });
              },
            },
          });

          // Kick off immediate spoken greeting
          liveSession.sendRealtimeInput({
            text: 'You just woke up on the desk! Greet your human out loud in 1 cheerful short sentence and ask what they are up to.',
          });
          return;
        }

        if (!liveSession) return;

        if (msg.type === 'audio' && typeof msg.data === 'string') {
          liveSession.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'video' && typeof msg.data === 'string') {
          liveSession.sendRealtimeInput({
            video: { data: msg.data, mimeType: 'image/jpeg' },
          });
        } else if (msg.type === 'event' && typeof msg.text === 'string') {
          liveSession.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Live socket error';
        console.error('WS message handling error:', errMsg);
        safeSend({ type: 'error', message: errMsg });
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      try {
        liveSession?.close();
      } catch {
        // ignore
      }
      liveSession = null;
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MOXI Live robot server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
