import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Minimize2 } from 'lucide-react';
import type { RobotEmotion, RobotProp } from '../types/robot';

interface RobotFaceProps {
  emotion: RobotEmotion;
  prop: RobotProp;
  gazeX: number;
  gazeY: number;
  isSpeaking: boolean;
  isThinking: boolean;
  isListening: boolean;
  isAwake: boolean;
  isBooting: boolean;
  fullScreen: boolean;
  caption: string;
  onWake: () => void;
  onPoke: (eyeSide: 'left' | 'right') => void;
  onPet: () => void;
  onPointerGaze: (x: number, y: number) => void;
  onExitFullScreen?: () => void;
}

interface FloatingParticle {
  id: number;
  x: number;
  y: number;
  kind: 'heart' | 'spark' | 'note' | 'zzz';
}

export const RobotFace: React.FC<RobotFaceProps> = ({
  emotion,
  prop,
  gazeX,
  gazeY,
  isSpeaking,
  isThinking,
  isListening,
  isAwake,
  isBooting,
  fullScreen,
  caption,
  onWake,
  onPoke,
  onPet,
  onPointerGaze,
  onExitFullScreen,
}) => {
  const [isBlinking, setIsBlinking] = useState(false);
  const [particles, setParticles] = useState<FloatingParticle[]>([]);
  const [flinchSide, setFlinchSide] = useState<'left' | 'right' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const petDragDistance = useRef(0);
  const lastPetTrigger = useRef(0);
  const particleIdRef = useRef(1);

  useEffect(() => {
    let timeoutId: number;
    const scheduleBlink = () => {
      const delay = 2100 + Math.random() * 3200;
      timeoutId = window.setTimeout(() => {
        setIsBlinking(true);
        window.setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 140);
      }, delay);
    };
    scheduleBlink();
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (
      emotion !== 'love' &&
      emotion !== 'singing' &&
      emotion !== 'sleepy' &&
      emotion !== 'excited'
    ) {
      return;
    }
    const kind: FloatingParticle['kind'] =
      emotion === 'love'
        ? 'heart'
        : emotion === 'singing'
          ? 'note'
          : emotion === 'sleepy'
            ? 'zzz'
            : 'spark';

    const spawn = () => {
      const id = particleIdRef.current++;
      setParticles((prev) => [
        ...prev.slice(-6),
        {
          id,
          x: 16 + Math.random() * 68,
          y: 22 + Math.random() * 36,
          kind,
        },
      ]);
      window.setTimeout(() => {
        setParticles((prev) => prev.filter((p) => p.id !== id));
      }, 1750);
    };

    spawn();
    const interval = window.setInterval(spawn, 850);
    return () => window.clearInterval(interval);
  }, [emotion]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const normY = ((e.clientY - rect.top) / rect.height) * 2 - 1;

    onPointerGaze(Math.max(-1, Math.min(1, normX)), Math.max(-1, Math.min(1, normY)));

    if (isAwake && normY < -0.35 && (e.buttons > 0 || e.pointerType === 'mouse')) {
      petDragDistance.current += Math.abs(e.movementX) + Math.abs(e.movementY);
      const now = Date.now();
      if (petDragDistance.current > 150 && now - lastPetTrigger.current > 3200) {
        petDragDistance.current = 0;
        lastPetTrigger.current = now;
        onPet();
      }
    }
  };

  const handleStageTap = () => {
    if (!isAwake) {
      onWake();
    }
  };

  const handleEyeTap = (side: 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAwake) {
      onWake();
      return;
    }
    setFlinchSide(side);
    window.setTimeout(() => setFlinchSide(null), 260);
    onPoke(side);
  };

  const tiltY = gazeX * 9;
  const tiltX = -gazeY * 6;
  const eyeOffsetX = gazeX * (fullScreen ? 32 : 20);
  const eyeOffsetY = gazeY * (fullScreen ? 20 : 12);

  const getEyeShape = (side: 'left' | 'right') => {
    const isFlinching = flinchSide === side;
    if (isBlinking || isFlinching) {
      return {
        scaleY: 0.08,
        scaleX: 1.08,
        borderRadius: '999px',
        rotate: 0,
        clipBottom: 0,
      };
    }

    if (!isAwake) {
      return {
        scaleY: 0.28,
        scaleX: 1.04,
        borderRadius: '44% 44% 50% 50%',
        rotate: side === 'left' ? -4 : 4,
        clipBottom: 0,
      };
    }

    switch (emotion) {
      case 'happy':
      case 'excited':
        return {
          scaleY: emotion === 'excited' ? 1.06 : 0.84,
          scaleX: 1.04,
          borderRadius: '50% 50% 42% 42%',
          rotate: 0,
          clipBottom: 18,
        };
      case 'annoyed':
        return {
          scaleY: 0.68,
          scaleX: 1.02,
          borderRadius: '44% 44% 50% 50%',
          rotate: side === 'left' ? 14 : -14,
          clipBottom: 0,
        };
      case 'curious':
        return {
          scaleY: side === 'left' ? 1.08 : 0.78,
          scaleX: side === 'left' ? 1.05 : 0.96,
          borderRadius: '48%',
          rotate: side === 'left' ? -4 : 6,
          clipBottom: 0,
        };
      case 'sleepy':
        return {
          scaleY: 0.34,
          scaleX: 1.05,
          borderRadius: '40% 40% 50% 50%',
          rotate: side === 'left' ? -6 : 6,
          clipBottom: 0,
        };
      case 'surprised':
        return {
          scaleY: 1.16,
          scaleX: 1.12,
          borderRadius: '50%',
          rotate: 0,
          clipBottom: 0,
        };
      case 'thinking':
        return {
          scaleY: 0.86,
          scaleX: 0.96,
          borderRadius: '48%',
          rotate: side === 'right' ? -8 : 0,
          clipBottom: 0,
        };
      case 'cool':
        return {
          scaleY: 0.56,
          scaleX: 1.12,
          borderRadius: '24% 24% 48% 48%',
          rotate: 0,
          clipBottom: 0,
        };
      case 'singing':
        return {
          scaleY: isSpeaking ? 0.84 : 0.94,
          scaleX: 1.05,
          borderRadius: '50% 50% 45% 45%',
          rotate: side === 'left' ? -5 : 5,
          clipBottom: 14,
        };
      case 'love':
      case 'eating':
      default:
        return {
          scaleY: isSpeaking ? 0.96 : 1,
          scaleX: 1,
          borderRadius: '48%',
          rotate: 0,
          clipBottom: 0,
        };
    }
  };

  const leftShape = getEyeShape('left');
  const rightShape = getEyeShape('right');

  const eyeFillClass =
    emotion === 'annoyed'
      ? 'from-sky-300 via-cyan-400 to-blue-600 shadow-[0_0_48px_rgba(56,189,248,0.6),inset_0_-12px_26px_rgba(29,78,216,0.85)]'
      : emotion === 'love'
        ? 'from-cyan-200 via-sky-400 to-indigo-500 shadow-[0_0_52px_rgba(96,165,250,0.7),inset_0_-12px_26px_rgba(37,99,235,0.8)]'
        : 'from-[#82E6FF] via-[#38C6FF] to-[#1D4ED8] shadow-[0_0_52px_rgba(56,198,255,0.58),inset_0_-12px_28px_rgba(29,78,216,0.92)]';

  return (
    <div
      ref={containerRef}
      onClick={handleStageTap}
      onPointerMove={handlePointerMove}
      className={`relative flex select-none flex-col items-center justify-center overflow-hidden bg-[#04060A] ${
        fullScreen
          ? 'fixed inset-0 z-50 h-dvh w-screen'
          : 'aspect-[19/10] w-full rounded-[28px] border-[5px] border-[#1E2432] shadow-[0_24px_60px_rgba(0,0,0,0.75),inset_0_0_0_1px_rgba(255,255,255,0.08)]'
      }`}
      style={{ perspective: '1000px' }}
    >
      {/* Ambient OLED cyan aura */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(56,189,248,0.09),transparent_62%)]" />

      {/* Exit Fullscreen control when docked fullscreen */}
      {fullScreen && onExitFullScreen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExitFullScreen();
          }}
          className="absolute right-5 top-5 z-30 flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-black/50 px-4 py-2 text-xs font-medium text-slate-200 backdrop-blur-md transition hover:bg-white/15"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          <span>Back to Website</span>
        </button>
      )}

      {/* Booting cyan scanline sweep */}
      <AnimatePresence>
        {isBooting && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#030508]"
          >
            <div className="h-[3px] w-4/5 bg-gradient-to-r from-transparent via-sky-400 to-transparent shadow-[0_0_28px_#38BDF8] animate-scanline" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main 3D tilted face stage */}
      <motion.div
        animate={{
          rotateY: tiltY,
          rotateX: tiltX,
          y: emotion === 'singing' ? [0, -7, 0, -5, 0] : isThinking ? -3 : 0,
        }}
        transition={{
          type: 'spring',
          stiffness: 150,
          damping: 18,
          y: emotion === 'singing' ? { repeat: Infinity, duration: 0.9, ease: 'easeInOut' } : undefined,
        }}
        className="relative flex h-full w-full flex-col items-center justify-center px-6"
      >
        {/* Floating mood particles */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {particles.map((p) => (
            <div
              key={p.id}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              className="animate-float-particle absolute text-sky-300 drop-shadow-[0_0_12px_rgba(56,189,248,0.8)]"
            >
              {p.kind === 'heart' && (
                <svg className="h-7 w-7 fill-sky-400" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              )}
              {p.kind === 'note' && (
                <svg className="h-7 w-7 fill-cyan-300" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              )}
              {p.kind === 'spark' && (
                <svg className="h-5 w-5 fill-amber-300" viewBox="0 0 24 24">
                  <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
                </svg>
              )}
              {p.kind === 'zzz' && <span className="font-display text-xl font-bold text-sky-300/80">Z</span>}
            </div>
          ))}
        </div>

        {/* Eyes */}
        <motion.div
          animate={{ x: eyeOffsetX, y: eyeOffsetY }}
          transition={{ type: 'spring', stiffness: 210, damping: 22 }}
          className={`relative flex items-center justify-center ${
            fullScreen ? 'gap-12 sm:gap-20 md:gap-28' : 'gap-8 sm:gap-12'
          }`}
        >
          {emotion === 'annoyed' && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="pointer-events-none absolute -left-11 -top-3 text-sky-300"
            >
              <svg className="h-7 w-7 fill-current drop-shadow-[0_0_14px_rgba(56,189,248,0.8)]" viewBox="0 0 24 24">
                <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
              </svg>
            </motion.div>
          )}

          {/* Left Eye */}
          <motion.div
            role="presentation"
            onClick={(e) => handleEyeTap('left', e)}
            animate={{
              scaleX: leftShape.scaleX,
              scaleY: isSpeaking ? [leftShape.scaleY, leftShape.scaleY * 0.93, leftShape.scaleY] : leftShape.scaleY,
              rotate: leftShape.rotate,
              borderRadius: leftShape.borderRadius,
            }}
            transition={{
              type: 'spring',
              stiffness: 320,
              damping: 20,
              scaleY: isSpeaking ? { repeat: Infinity, duration: 0.34 } : undefined,
            }}
            className={`relative cursor-pointer bg-gradient-to-b ${eyeFillClass} ${
              fullScreen
                ? 'h-32 w-32 sm:h-44 sm:w-44 md:h-56 md:w-56'
                : 'h-20 w-20 sm:h-28 sm:w-28'
            }`}
          >
            {leftShape.clipBottom > 0 && (
              <div
                className="pointer-events-none absolute inset-x-[-10%] bottom-[-8%] rounded-t-[100%] bg-[#04060A]"
                style={{ height: `${leftShape.clipBottom + 18}%` }}
              />
            )}
            {emotion === 'love' && !isBlinking && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <svg className="h-1/2 w-1/2 fill-white/85" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </div>
            )}
            {!isBlinking && emotion !== 'sleepy' && isAwake && (
              <div className="pointer-events-none absolute left-[18%] top-[16%] h-[16%] w-[24%] rounded-full bg-white/45 blur-[1px]" />
            )}
          </motion.div>

          {/* Right Eye */}
          <motion.div
            role="presentation"
            onClick={(e) => handleEyeTap('right', e)}
            animate={{
              scaleX: rightShape.scaleX,
              scaleY: isSpeaking ? [rightShape.scaleY, rightShape.scaleY * 0.93, rightShape.scaleY] : rightShape.scaleY,
              rotate: rightShape.rotate,
              borderRadius: rightShape.borderRadius,
            }}
            transition={{
              type: 'spring',
              stiffness: 320,
              damping: 20,
              scaleY: isSpeaking ? { repeat: Infinity, duration: 0.34, delay: 0.06 } : undefined,
            }}
            className={`relative cursor-pointer bg-gradient-to-b ${eyeFillClass} ${
              fullScreen
                ? 'h-32 w-32 sm:h-44 sm:w-44 md:h-56 md:w-56'
                : 'h-20 w-20 sm:h-28 sm:w-28'
            }`}
          >
            {rightShape.clipBottom > 0 && (
              <div
                className="pointer-events-none absolute inset-x-[-10%] bottom-[-8%] rounded-t-[100%] bg-[#04060A]"
                style={{ height: `${rightShape.clipBottom + 18}%` }}
              />
            )}
            {emotion === 'love' && !isBlinking && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <svg className="h-1/2 w-1/2 fill-white/85" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </div>
            )}
            {!isBlinking && emotion !== 'sleepy' && isAwake && (
              <div className="pointer-events-none absolute left-[18%] top-[16%] h-[16%] w-[24%] rounded-full bg-white/45 blur-[1px]" />
            )}
          </motion.div>

          {emotion === 'annoyed' && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="pointer-events-none absolute -right-11 -top-3 text-sky-300"
            >
              <svg className="h-7 w-7 fill-current drop-shadow-[0_0_14px_rgba(56,189,248,0.8)]" viewBox="0 0 24 24">
                <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
              </svg>
            </motion.div>
          )}
        </motion.div>

        {/* Animated Props */}
        <AnimatePresence>
          {prop !== 'none' && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.85 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-none mt-4 flex items-center justify-center"
            >
              {prop === 'drink' && (
                <svg className="h-11 w-11 drop-shadow-[0_0_14px_rgba(251,146,60,0.65)]" viewBox="0 0 48 48">
                  <path d="M24 6l5-3" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" />
                  <path d="M14 14h20l-2.5 24h-15L14 14z" fill="#F59E0B" stroke="#FDE68A" strokeWidth="2" />
                  <path d="M13 14h22" stroke="#F8FAFC" strokeWidth="3.5" strokeLinecap="round" />
                </svg>
              )}

              {prop === 'burger' && (
                <svg className="h-11 w-11 drop-shadow-[0_0_14px_rgba(245,158,11,0.7)]" viewBox="0 0 48 48">
                  <path d="M10 21c0-7 6-11 14-11s14 4 14 11H10z" fill="#F59E0B" />
                  <rect x="8" y="22" width="32" height="4" rx="2" fill="#22C55E" />
                  <rect x="9" y="26" width="30" height="5" rx="2.5" fill="#78350F" />
                  <rect x="10" y="31" width="28" height="6" rx="3" fill="#D97706" />
                </svg>
              )}

              {prop === 'music' && (
                <div className="flex h-7 items-end gap-1.5">
                  {[0, 0.12, 0.25, 0.08, 0.18].map((delay, i) => (
                    <span
                      key={i}
                      style={{ animationDelay: `${delay}s` }}
                      className="animate-eq-bar h-6 w-1.5 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.8)]"
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Subtle status */}
        <div className="pointer-events-none absolute top-4 inset-x-0 flex justify-center">
          {!isAwake ? (
            <p className="text-xs font-medium tracking-wide text-slate-400">
              Tap face to wake MOXI
            </p>
          ) : isListening ? (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400/90">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Listening</span>
            </div>
          ) : isThinking ? (
            <div className="flex items-center gap-2 text-xs font-medium text-sky-400/80">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              <span>Thinking</span>
            </div>
          ) : null}
        </div>

        {/* Live Subtitle Captions */}
        <AnimatePresence mode="wait">
          {caption && (
            <motion.div
              key={caption}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-none absolute bottom-4 inset-x-5 flex justify-center sm:bottom-6"
            >
              <p className="max-w-xl rounded-xl bg-black/70 px-3.5 py-1.5 text-center text-xs font-medium leading-relaxed text-slate-100 backdrop-blur-sm sm:text-sm">
                {caption}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
