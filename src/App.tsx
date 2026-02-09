import { useState, useEffect, useCallback, useRef } from 'react';
import { Visualizer } from './components/Visualizer';
import { useAudioAnalyzer } from './hooks/useAudioAnalyzer';
import { useMultiplayer } from './hooks/useMultiplayer';
import { useKonamiCode } from './hooks/useKonamiCode';
import './App.css';

const AUDIO_URL = '/audio/song.mp3';
const DRIFT_THRESHOLD = 0.15; // Re-sync if drift exceeds 150ms

// Konami code message templates - {count} will be replaced with the number
const KONAMI_MESSAGES = [
  "You found the secret! You're visitor #{count}",
  "Konami legend! #{count} people have discovered this",
  "Secret unlocked by #{count} curious souls",
  "Easter egg hunter #{count} reporting for duty",
  "Nice work! You're the #{count} person to find this",
  "Welcome to the secret club, member #{count}",
];

function App() {
  const hasTriggeredAudioRef = useRef(false);

  // Konami code / secret mode
  const [secretModeActive, setSecretModeActive] = useState(false);
  const [showKonamiToast, setShowKonamiToast] = useState(false);
  const [konamiMessage, setKonamiMessage] = useState('');

  const {
    isPlaying,
    isLoaded,
    duration,
    currentTime,
    loopCount,
    playAt,
    getAudioData,
    ensureToneStarted,
  } = useAudioAnalyzer(AUDIO_URL);

  // Pass actual audio duration to multiplayer for accurate sync
  const {
    isConnected,
    userColor,
    userCount,
    sendCursorPosition,
    getOtherUsers,
    getCurrentSyncTime,
    setOnDrift,
    activateKonami,
    konamiCount,
  } = useMultiplayer(duration);

  // Track server elapsed time for visual sync
  const [serverElapsedTime, setServerElapsedTime] = useState<number | null>(null);

  // Konami code handler - TOGGLES secret mode on/off
  const handleKonamiActivate = useCallback(() => {
    setSecretModeActive(prev => {
      const newState = !prev;
      console.log(`[KONAMI] Code entered! Secret mode: ${newState ? 'ON' : 'OFF'}`);

      if (newState) {
        // Turning ON - notify server, pick random message, show toast
        activateKonami();
        const randomMessage = KONAMI_MESSAGES[Math.floor(Math.random() * KONAMI_MESSAGES.length)];
        setKonamiMessage(randomMessage);
        setShowKonamiToast(true);
        setTimeout(() => setShowKonamiToast(false), 4000);
      }

      return newState;
    });
  }, [activateKonami]);

  // Initialize Konami code listener
  useKonamiCode(handleKonamiActivate);

  // Track last re-sync to avoid too frequent corrections
  const lastResyncRef = useRef<number>(0);

  // Start playback with sync - called on first user interaction
  const startWithSync = useCallback(async () => {
    if (!isLoaded || !duration) {
      console.log('[AUDIO] Not ready yet:', { isLoaded, duration });
      return false;
    }

    // Ensure Tone.js is started (requires user gesture)
    const toneStarted = await ensureToneStarted();
    if (!toneStarted) {
      console.log('[AUDIO] Tone.js failed to start');
      return false;
    }

    // Get fresh sync time from server
    const freshSync = getCurrentSyncTime();

    if (freshSync && isConnected) {
      console.log(`[AUDIO] Syncing to ${freshSync.songTime.toFixed(2)}s (loop ${freshSync.loopCount})`);
      setServerElapsedTime(freshSync.elapsedTime);

      try {
        await playAt(freshSync.songTime, freshSync.loopCount);
        lastResyncRef.current = Date.now();
        console.log('[AUDIO] Playback started (synced)');
        return true;
      } catch (err) {
        console.error('[AUDIO] playAt failed:', err);
        return false;
      }
    } else {
      // No server - start from beginning
      console.log('[AUDIO] No server, starting from 0');
      try {
        await playAt(0, 0);
        return true;
      } catch (err) {
        console.error('[AUDIO] playAt(0,0) failed:', err);
        return false;
      }
    }
  }, [isLoaded, duration, ensureToneStarted, getCurrentSyncTime, isConnected, playAt]);

  // Track if user has interacted (so we can start audio when loaded)
  const userHasInteractedRef = useRef(false);

  // Handle ANY user interaction - triggers audio start
  const handleFirstInteraction = useCallback(async () => {
    if (isPlaying) return;

    // Mark that user has interacted
    userHasInteractedRef.current = true;

    // If audio isn't loaded yet, just wait - we'll start when it loads
    if (!isLoaded || !duration) {
      console.log('[AUDIO] User interacted, waiting for audio to load...');
      return;
    }

    // Already triggered successfully? Skip
    if (hasTriggeredAudioRef.current) return;

    console.log('[AUDIO] Starting audio on user interaction...');
    const success = await startWithSync();

    if (success) {
      hasTriggeredAudioRef.current = true;
      console.log('[AUDIO] Audio started successfully');
    }
  }, [isPlaying, isLoaded, duration, startWithSync]);

  // When audio loads, if user already interacted, start immediately
  useEffect(() => {
    if (!isLoaded || !duration || isPlaying || hasTriggeredAudioRef.current) return;

    if (userHasInteractedRef.current) {
      console.log('[AUDIO] Audio loaded and user already interacted, starting...');
      handleFirstInteraction();
    }
  }, [isLoaded, duration, isPlaying, handleFirstInteraction]);

  // Listen for ANY user gesture to start audio (mouse, touch, keyboard)
  useEffect(() => {
    if (isPlaying) return;

    const events = ['mousedown', 'mousemove', 'touchstart', 'touchmove', 'keydown', 'click'];

    const handler = () => {
      handleFirstInteraction();
    };

    events.forEach(event => {
      window.addEventListener(event, handler, { passive: true });
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handler);
      });
    };
  }, [isPlaying, handleFirstInteraction]);

  // Handle drift detection and correction
  useEffect(() => {
    if (!isPlaying || !duration) return;

    setOnDrift((expectedTime: number) => {
      const now = Date.now();
      // Don't re-sync too frequently (minimum 3 seconds between re-syncs)
      if (now - lastResyncRef.current < 3000) return;

      // Calculate drift
      const drift = Math.abs(expectedTime - currentTime);

      // Also check for loop boundary issues (if we're near 0 or duration)
      const adjustedDrift = Math.min(drift, duration - drift);

      if (adjustedDrift > DRIFT_THRESHOLD) {
        console.log(`[DRIFT] ${(adjustedDrift * 1000).toFixed(0)}ms - resyncing`);

        // Get fresh sync and re-sync
        const freshSync = getCurrentSyncTime();
        if (freshSync) {
          lastResyncRef.current = now;
          playAt(freshSync.songTime, freshSync.loopCount);
        }
      }
    });
  }, [isPlaying, duration, currentTime, setOnDrift, getCurrentSyncTime, playAt]);

  // Track mouse movement and send to server
  useEffect(() => {
    if (!isConnected) return;

    let lastSend = 0;
    const throttleMs = 100;

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastSend < throttleMs) return;
      lastSend = now;

      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      sendCursorPosition(x, y);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isConnected, sendCursorPosition]);

  // Always show the visualizer - no loading screens, no prompts
  // Audio starts on first interaction, visualization runs immediately
  return (
    <div className="app">
      <Visualizer
        getAudioData={getAudioData}
        isPlaying={isPlaying}
        currentTime={currentTime}
        loopCount={loopCount}
        userColor={userColor}
        getOtherUsers={getOtherUsers}
        serverElapsedTime={serverElapsedTime}
        secretModeActive={secretModeActive}
      />

      {/* Konami code toast */}
      {showKonamiToast && konamiCount && (
        <div className="konami-toast">
          <div className="konami-toast-content">
            <div className="konami-emoji">🕺</div>
            <div className="konami-text" dangerouslySetInnerHTML={{
              __html: konamiMessage.replace('#{count}', `<strong>${konamiCount}</strong>`)
            }} />
          </div>
        </div>
      )}

      {/* User count indicator */}
      <div className="user-count">
        <span className="dot" style={{ background: userColor }} />
        {userCount} {userCount === 1 ? 'listener' : 'listeners'}
      </div>

      {/* Footer credit */}
      <div className="footer-credit">
        a toy by <a href="https://jasondotcom.com" target="_blank" rel="noopener noreferrer">jasondotcom.com</a>
      </div>
    </div>
  );
}

export default App;
