import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export interface User {
  id: string;
  color: string;
  x: number;
  y: number;
}

export interface SyncData {
  serverStartTime: number;  // Unix timestamp when server started
  serverNow: number;        // Server's current time when message was sent
  songDuration: number;     // Loop duration in seconds
  songTime: number;         // Current position (at time of sync message)
  loopCount: number;        // Current loop count (at time of sync message)
  userId: string;
  userColor: string;
  users: User[];
  userCount: number;
}

export interface SyncTime {
  songTime: number;
  loopCount: number;
  elapsedTime: number;
  latency: number;
}

export function useMultiplayer(clientAudioDuration?: number) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userColor, setUserColor] = useState<string>('#ffffff');
  const [userCount, setUserCount] = useState(0);
  const [syncData, setSyncData] = useState<SyncData | null>(null);

  // Use client's actual audio duration if provided, otherwise fall back to server's
  const actualDurationRef = useRef<number>(21.0);
  if (clientAudioDuration && clientAudioDuration > 0) {
    actualDurationRef.current = clientAudioDuration;
  }

  // Latency tracking
  const latencyRef = useRef<number>(0);
  const latencyHistoryRef = useRef<number[]>([]);

  // Konami code
  const [konamiCount, setKonamiCount] = useState<number | null>(null);

  // Use ref for users to avoid re-renders on cursor updates
  const usersRef = useRef<Map<string, User>>(new Map());
  const userIdRef = useRef<string | null>(null);

  // Drift callback - set by App to handle re-sync
  const onDriftRef = useRef<((drift: number) => void) | null>(null);

  // Calculate smoothed latency from history
  const updateLatency = (newLatency: number) => {
    latencyHistoryRef.current.push(newLatency);
    // Keep last 10 measurements
    if (latencyHistoryRef.current.length > 10) {
      latencyHistoryRef.current.shift();
    }
    // Use median to filter outliers
    const sorted = [...latencyHistoryRef.current].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    latencyRef.current = median;
  };

  // Connect to server
  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to sync server');
      setIsConnected(true);

      // Start measuring latency
      measureLatency();
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from sync server');
      setIsConnected(false);
    });

    // Initial sync data from server
    socket.on('sync', (data: SyncData) => {
      const clientNow = Date.now();
      const oneWayLatency = (clientNow - data.serverNow) / 2;
      updateLatency(Math.max(0, oneWayLatency));

      console.log(`[SYNC] Received sync, latency: ${latencyRef.current.toFixed(0)}ms`);
      setSyncData(data);
      setUserId(data.userId);
      userIdRef.current = data.userId;
      setUserColor(data.userColor);
      setUserCount(data.userCount);

      // Build users map
      const newUsers = new Map<string, User>();
      data.users.forEach((user) => {
        newUsers.set(user.id, user);
      });
      usersRef.current = newUsers;
    });

    // Pong response for latency measurement
    socket.on('pong', (data: { clientTime: number; serverTime: number; songTime: number }) => {
      const clientNow = Date.now();
      const roundTrip = clientNow - data.clientTime;
      const oneWayLatency = roundTrip / 2;
      updateLatency(oneWayLatency);
      console.log(`[LATENCY] RTT: ${roundTrip}ms, One-way: ${oneWayLatency.toFixed(0)}ms, Smoothed: ${latencyRef.current.toFixed(0)}ms`);
    });

    // Heartbeat for drift detection
    socket.on('heartbeat', (data: { serverNow: number; serverStartTime: number; songTime: number; loopCount: number }) => {
      const clientNow = Date.now();
      const latency = (clientNow - data.serverNow) / 2;
      updateLatency(Math.max(0, latency));

      // Calculate what our position should be using CLIENT's actual duration
      const duration = actualDurationRef.current;
      const elapsedWithLatency = (clientNow - data.serverStartTime) / 1000;
      const expectedSongTime = elapsedWithLatency % duration;

      // Notify of drift if callback is set
      if (onDriftRef.current && syncData) {
        onDriftRef.current(expectedSongTime);
      }
    });

    // New user joined
    socket.on('userJoined', (data: { user: User; userCount: number }) => {
      console.log(`[USERS] User joined: ${data.user.id}, total users in map: ${usersRef.current.size + 1}`);
      usersRef.current.set(data.user.id, data.user);
      setUserCount(data.userCount);
    });

    // User left
    socket.on('userLeft', (data: { userId: string; userCount: number }) => {
      console.log('User left:', data.userId);
      usersRef.current.delete(data.userId);
      setUserCount(data.userCount);
    });

    // Konami code count response
    socket.on('konamiCount', (data: { count: number }) => {
      console.log(`[KONAMI] You're #${data.count} to unlock this!`);
      setKonamiCount(data.count);
    });

    // Cursor update from other user
    let lastCursorLog = 0;
    socket.on('cursorUpdate', (data: { userId: string; x: number; y: number }) => {
      const user = usersRef.current.get(data.userId);
      if (user) {
        user.x = data.x;
        user.y = data.y;
        // Log every 2 seconds
        const now = Date.now();
        if (now - lastCursorLog > 2000) {
          lastCursorLog = now;
          console.log(`[CURSOR UPDATE] User ${data.userId.slice(0, 8)} moved to (${(data.x * 100).toFixed(0)}%, ${(data.y * 100).toFixed(0)}%)`);
        }
      } else {
        console.warn(`[CURSOR] Received update for unknown user: ${data.userId}, map has ${usersRef.current.size} users`);
      }
    });

    // Measure latency periodically
    const latencyInterval = setInterval(() => {
      measureLatency();
    }, 5000);

    return () => {
      clearInterval(latencyInterval);
      socket.disconnect();
    };
  }, [syncData?.songDuration]);

  // Measure latency via ping-pong
  const measureLatency = () => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('ping', Date.now());
    }
  };

  // Send cursor position
  const sendCursorPosition = useCallback((x: number, y: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('cursorMove', { x, y });
    }
  }, []);

  // Request re-sync
  const requestSync = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('requestSync');
    }
  }, []);

  // Get other users (excluding self)
  const getOtherUsers = useCallback((): User[] => {
    const currentUserId = userIdRef.current;
    const allUsers = Array.from(usersRef.current.values());
    const others = allUsers.filter((u) => u.id !== currentUserId);
    return others;
  }, []);

  // Set drift callback
  const setOnDrift = useCallback((callback: (expectedTime: number) => void) => {
    onDriftRef.current = callback;
  }, []);

  // Calculate current sync position with latency compensation
  const getCurrentSyncTime = useCallback((): SyncTime | null => {
    if (!syncData) return null;

    const clientNow = Date.now();
    const latency = latencyRef.current;
    const duration = actualDurationRef.current;

    // Calculate elapsed time since server started, accounting for latency
    // The server's "now" was actually (latency) ms ago, so we add latency to compensate
    const elapsedTime = (clientNow - syncData.serverStartTime + latency) / 1000;
    // Use CLIENT's actual audio duration for accurate looping
    const songTime = elapsedTime % duration;
    const loopCount = Math.floor(elapsedTime / duration);

    console.log(`[SYNC CALC] Duration: ${duration.toFixed(3)}s, Elapsed: ${elapsedTime.toFixed(2)}s, Position: ${songTime.toFixed(2)}s`);

    return { songTime, loopCount, elapsedTime, latency };
  }, [syncData]);

  // Get current latency
  const getLatency = useCallback(() => latencyRef.current, []);

  // Activate Konami code
  const activateKonami = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('konamiActivated');
    }
  }, []);

  return {
    isConnected,
    userId,
    userColor,
    userCount,
    syncData,
    sendCursorPosition,
    requestSync,
    getOtherUsers,
    getCurrentSyncTime,
    getLatency,
    setOnDrift,
    measureLatency,
    activateKonami,
    konamiCount,
  };
}
