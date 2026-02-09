import { useEffect, useRef, useCallback, useState } from 'react';

// Konami code sequence
const KONAMI_SEQUENCE = [
  'ArrowUp', 'ArrowUp',
  'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight',
  'ArrowLeft', 'ArrowRight',
  'KeyB', 'KeyA'
];

// Mobile swipe directions
const SWIPE_SEQUENCE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'tap', 'tap'];

interface SwipeState {
  startX: number;
  startY: number;
  startTime: number;
}

export function useKonamiCode(onActivate: () => void) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const keySequenceRef = useRef<string[]>([]);
  const swipeSequenceRef = useRef<string[]>([]);
  const swipeStateRef = useRef<SwipeState | null>(null);
  const lastKeyTimeRef = useRef<number>(0);
  const lastSwipeTimeRef = useRef<number>(0);
  const lastActivationRef = useRef<number>(0); // Debounce activations

  // Reset sequence after timeout (2 seconds of inactivity)
  const SEQUENCE_TIMEOUT = 2000;
  const SWIPE_THRESHOLD = 50; // Minimum swipe distance
  const TAP_THRESHOLD = 10; // Maximum movement for a tap
  const ACTIVATION_DEBOUNCE = 500; // Prevent double activation

  const checkKeySequence = useCallback(() => {
    const sequence = keySequenceRef.current;
    const konamiStr = KONAMI_SEQUENCE.join(',');
    const currentStr = sequence.slice(-KONAMI_SEQUENCE.length).join(',');

    if (currentStr === konamiStr) {
      // Debounce - prevent double activation (React Strict Mode, etc.)
      const now = Date.now();
      if (now - lastActivationRef.current < ACTIVATION_DEBOUNCE) {
        console.log('[KONAMI] Debounced keyboard activation');
        return false;
      }
      lastActivationRef.current = now;

      console.log('[KONAMI] Code activated via keyboard!');
      keySequenceRef.current = [];
      setIsUnlocked(true);
      onActivate();
      return true;
    }
    return false;
  }, [onActivate]);

  const checkSwipeSequence = useCallback(() => {
    const sequence = swipeSequenceRef.current;
    const swipeStr = SWIPE_SEQUENCE.join(',');
    const currentStr = sequence.slice(-SWIPE_SEQUENCE.length).join(',');

    if (currentStr === swipeStr) {
      // Debounce - prevent double activation
      const now = Date.now();
      if (now - lastActivationRef.current < ACTIVATION_DEBOUNCE) {
        console.log('[KONAMI] Debounced touch activation');
        return false;
      }
      lastActivationRef.current = now;

      console.log('[KONAMI] Code activated via touch!');
      swipeSequenceRef.current = [];
      setIsUnlocked(true);
      onActivate();
      return true;
    }
    return false;
  }, [onActivate]);

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();

      // Reset if too much time passed
      if (now - lastKeyTimeRef.current > SEQUENCE_TIMEOUT) {
        keySequenceRef.current = [];
      }
      lastKeyTimeRef.current = now;

      // Add key to sequence
      keySequenceRef.current.push(e.code);

      // Keep only last N keys
      if (keySequenceRef.current.length > KONAMI_SEQUENCE.length) {
        keySequenceRef.current.shift();
      }

      checkKeySequence();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [checkKeySequence]);

  // Touch handlers for mobile
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      swipeStateRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
      };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!swipeStateRef.current) return;

      const touch = e.changedTouches[0];
      const { startX, startY } = swipeStateRef.current;
      const now = Date.now();

      // Reset if too much time passed since last gesture
      if (now - lastSwipeTimeRef.current > SEQUENCE_TIMEOUT) {
        swipeSequenceRef.current = [];
      }
      lastSwipeTimeRef.current = now;

      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      let gesture: string | null = null;

      // Determine gesture type
      if (absX < TAP_THRESHOLD && absY < TAP_THRESHOLD) {
        gesture = 'tap';
      } else if (absX > SWIPE_THRESHOLD || absY > SWIPE_THRESHOLD) {
        if (absX > absY) {
          gesture = deltaX > 0 ? 'right' : 'left';
        } else {
          gesture = deltaY > 0 ? 'down' : 'up';
        }
      }

      if (gesture) {
        swipeSequenceRef.current.push(gesture);

        // Keep only last N gestures
        if (swipeSequenceRef.current.length > SWIPE_SEQUENCE.length) {
          swipeSequenceRef.current.shift();
        }

        checkSwipeSequence();
      }

      swipeStateRef.current = null;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [checkSwipeSequence]);

  return { isUnlocked };
}
