import { useEffect, useRef, useState, useCallback } from 'react';
import * as Tone from 'tone';

export interface AudioData {
  waveform: Float32Array;
  fft: Float32Array;
  volume: number;
  bass: number;
  mid: number;
  high: number;
}

export function useAudioAnalyzer(audioUrl: string | null) {
  const playerRef = useRef<Tone.Player | null>(null);
  const analyzerRef = useRef<Tone.Analyser | null>(null);
  const fftRef = useRef<Tone.FFT | null>(null);
  const meterRef = useRef<Tone.Meter | null>(null);
  const startTimeRef = useRef<number>(0);
  const toneStartedRef = useRef<boolean>(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isToneReady, setIsToneReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loopCount, setLoopCount] = useState(0);

  // Initialize audio nodes
  useEffect(() => {
    if (!audioUrl) return;

    const player = new Tone.Player({
      url: audioUrl,
      loop: true, // Enable infinite looping
      onload: () => {
        const exactDuration = player.buffer.duration;
        console.log(`[AUDIO] Loaded! Exact duration: ${exactDuration.toFixed(6)}s`);
        setIsLoaded(true);
        setDuration(exactDuration);
      },
    });

    // Create analyzers
    const waveformAnalyzer = new Tone.Analyser('waveform', 256);
    const fftAnalyzer = new Tone.FFT(256);
    const meter = new Tone.Meter();

    // Connect: player -> analyzers -> destination
    player.connect(waveformAnalyzer);
    player.connect(fftAnalyzer);
    player.connect(meter);
    player.toDestination();

    playerRef.current = player;
    analyzerRef.current = waveformAnalyzer;
    fftRef.current = fftAnalyzer;
    meterRef.current = meter;

    return () => {
      player.stop();
      player.dispose();
      waveformAnalyzer.dispose();
      fftAnalyzer.dispose();
      meter.dispose();
    };
  }, [audioUrl]);

  // Update current time while playing (with loop tracking)
  useEffect(() => {
    if (!isPlaying || !duration) return;

    const interval = setInterval(() => {
      if (playerRef.current && playerRef.current.state === 'started') {
        const totalElapsed = Tone.now() - startTimeRef.current;
        const loopTime = totalElapsed % duration; // Time within current loop
        const loops = Math.floor(totalElapsed / duration);

        setCurrentTime(loopTime);
        setLoopCount(loops);
      }
    }, 50); // Update more frequently for smoother transitions

    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  // Ensure Tone.js audio context is started (requires user gesture)
  const ensureToneStarted = useCallback(async (): Promise<boolean> => {
    if (toneStartedRef.current && Tone.context.state === 'running') {
      console.log('[AUDIO] Tone already running');
      return true;
    }

    try {
      console.log('[AUDIO] Starting Tone.js context...');
      await Tone.start();

      // Verify it actually started
      if (Tone.context.state === 'running') {
        console.log('[AUDIO] Tone.js context started successfully');
        toneStartedRef.current = true;
        setIsToneReady(true);
        return true;
      } else {
        console.warn('[AUDIO] Tone.start() called but state is:', Tone.context.state);
        return false;
      }
    } catch (err) {
      console.error('[AUDIO] Failed to start Tone.js:', err);
      return false;
    }
  }, []);

  const play = useCallback(async () => {
    if (!playerRef.current || !isLoaded) {
      console.log('[AUDIO] play() - not ready:', { hasPlayer: !!playerRef.current, isLoaded });
      return;
    }

    // Start audio context (required for browser autoplay policy)
    const started = await ensureToneStarted();
    if (!started) {
      console.warn('[AUDIO] play() - Tone.js failed to start, needs user gesture');
      return;
    }

    startTimeRef.current = Tone.now();
    playerRef.current.start();
    setIsPlaying(true);
    setLoopCount(0);
    console.log('[AUDIO] Playback started');
  }, [isLoaded, ensureToneStarted]);

  // Play starting at a specific time (for multiplayer sync)
  const playAt = useCallback(async (startOffset: number, serverLoopCount: number = 0): Promise<boolean> => {
    console.log('[AUDIO] playAt called:', { startOffset, serverLoopCount, isLoaded, duration, hasPlayer: !!playerRef.current });

    if (!playerRef.current || !isLoaded || duration <= 0) {
      console.warn('[AUDIO] playAt: not ready, falling back to regular play');
      // Fall back to regular play if sync isn't possible
      if (playerRef.current && isLoaded) {
        const started = await ensureToneStarted();
        if (started) {
          playerRef.current.start();
          setIsPlaying(true);
          console.log('[AUDIO] playAt: started with fallback (no offset)');
          return true;
        }
      }
      return false;
    }

    // Start audio context - this is critical and may fail without user gesture
    const started = await ensureToneStarted();
    if (!started) {
      console.warn('[AUDIO] playAt: Tone.js failed to start, needs user gesture');
      return false;
    }

    // Stop if already playing
    if (playerRef.current.state === 'started') {
      playerRef.current.stop();
      console.log('[AUDIO] Stopped existing playback');
    }

    // Clamp offset to valid range
    const validOffset = Math.max(0, Math.min(startOffset, duration - 0.01));
    console.log('[AUDIO] Calculated validOffset:', validOffset, 'from startOffset:', startOffset, 'duration:', duration);

    // Adjust start time reference so currentTime calculation works
    startTimeRef.current = Tone.now() - validOffset - (serverLoopCount * duration);

    // Start playback at offset
    playerRef.current.start(undefined, validOffset);
    setIsPlaying(true);
    setLoopCount(serverLoopCount);

    console.log(`[AUDIO] Synced: starting at ${validOffset.toFixed(2)}s (loop ${serverLoopCount}), player state: ${playerRef.current.state}`);
    return true;
  }, [isLoaded, duration, ensureToneStarted]);

  const pause = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.stop();
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isPlaying, play, pause]);

  const getAudioData = useCallback((): AudioData => {
    const waveform = analyzerRef.current?.getValue() as Float32Array || new Float32Array(256);
    const fft = fftRef.current?.getValue() as Float32Array || new Float32Array(256);
    const volume = typeof meterRef.current?.getValue() === 'number'
      ? meterRef.current.getValue() as number
      : -60;

    // Calculate frequency bands from FFT
    const bassRange = fft.slice(0, 10);
    const midRange = fft.slice(10, 100);
    const highRange = fft.slice(100);

    const avg = (arr: Float32Array) => {
      if (arr.length === 0) return -60;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };

    // Normalize from dB (-100 to 0) to 0-1 range
    const normalize = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));

    return {
      waveform,
      fft,
      volume: normalize(volume),
      bass: normalize(avg(bassRange)),
      mid: normalize(avg(midRange)),
      high: normalize(avg(highRange)),
    };
  }, []);

  return {
    isPlaying,
    isLoaded,
    isToneReady,
    duration,
    currentTime,
    loopCount,
    play,
    playAt,
    pause,
    toggle,
    getAudioData,
    ensureToneStarted,
  };
}
