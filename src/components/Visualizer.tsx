import { useEffect, useRef } from 'react';
import p5 from 'p5';
import type { AudioData } from '../hooks/useAudioAnalyzer';
import type { User } from '../hooks/useMultiplayer';

interface VisualizerProps {
  getAudioData: () => AudioData;
  isPlaying: boolean;
  currentTime: number;
  loopCount: number;
  userColor?: string;
  getOtherUsers?: () => User[];
  serverElapsedTime?: number | null; // Seconds since server started - for visual sync
  secretModeActive?: boolean; // Konami code activated - toggles on/off
}

// Modes - particles morph between these formations
const MODES = ['circles', 'waves', 'smileyBeard', 'particles', 'geometric', 'sneaker', 'breathing', 'pizza', 'orbital', 'boombox', 'fractals', 'coffeeCup', 'rubberDuck'] as const;

export function Visualizer({ getAudioData, isPlaying, userColor: _userColor = '#ffffff', getOtherUsers, serverElapsedTime = null, secretModeActive = false }: VisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Ref = useRef<p5 | null>(null);
  const serverElapsedTimeRef = useRef<number | null>(serverElapsedTime);
  const getOtherUsersRef = useRef(getOtherUsers);
  const secretModeActiveRef = useRef(secretModeActive);

  // Keep refs updated
  useEffect(() => {
    getOtherUsersRef.current = getOtherUsers;
  }, [getOtherUsers]);

  useEffect(() => {
    serverElapsedTimeRef.current = serverElapsedTime;
  }, [serverElapsedTime]);

  useEffect(() => {
    secretModeActiveRef.current = secretModeActive;
  }, [secretModeActive]);

  useEffect(() => {
    if (!containerRef.current) return;

    const sketch = (p: p5) => {
      // Audio smoothing
      let smoothedBass = 0;
      let smoothedMid = 0;
      let smoothedHigh = 0;
      let smoothedVolume = 0;
      let bassPeak = 0;
      let midPeak = 0;

      // KICK DETECTION - more aggressive
      let kickDetected = false;
      let kickIntensity = 0;
      let lastKickFrame = 0;
      let kickDecay = 0; // For visual decay after kick

      // SCREEN ZOOM effect
      let zoomPulse = 0;

      // DEBUG mode
      const DEBUG = false;

      // ========== CURSOR INTERACTION ==========
      const CURSOR_RADIUS = 150; // Attraction radius in pixels
      const CURSOR_STRENGTH = 0.08; // How strongly particles are attracted (0-1)
      const REPULSION_STRENGTH = 300; // Click/tap repulsion force
      const REPULSION_DECAY = 0.92; // How fast repulsion fades

      let mouseX = 0;
      let mouseY = 0;
      let isMouseActive = false; // True if mouse moved recently
      let lastMouseMove = 0;
      let repulsionForce = 0; // Current repulsion strength (decays over time)
      let repulsionX = 0; // Where the repulsion originated
      let repulsionY = 0;

      // ========== MUSIC-DRIVEN TRANSITION SYSTEM ==========
      // Rolling energy averages for detecting significant changes
      let rollingBassAvg = 0;
      let rollingMidAvg = 0;
      let rollingEnergyAvg = 0;

      // Transition state
      let currentModeIndex = 0;
      let transitionProgress = 1; // 1 = fully in current mode, 0 = transitioning
      let transitionSpeed = 0; // How fast to transition (set by intensity of trigger)
      let lastTransitionFrame = 0;
      let minTransitionCooldown = 540; // Minimum frames between transitions (~9 seconds at 60fps)
      let maxFramesWithoutTransition = 1080; // Force transition after 18 seconds max

      // Frame offset for server sync - simulates frames that would have passed
      let frameOffset = 0;
      let hasInitializedSync = false;

      // Synced frame count - accessible to all functions
      // This is the "virtual" frame count that accounts for server elapsed time
      let syncedFrame = 0;

      // Energy tracking for detecting drops/builds
      let energyHistory: number[] = [];
      const ENERGY_HISTORY_SIZE = 30;

      // Transition trigger thresholds (with randomness)
      let nextTriggerThreshold = 0.10 + Math.random() * 0.08;

      // ========== UNIFIED PARTICLE SYSTEM ==========
      const PARTICLE_COUNT = 120;
      interface Particle {
        x: number;
        y: number;
        targetX: number;
        targetY: number;
        size: number;
        targetSize: number;
        hue: number;
        baseAngle: number;
        index: number;
        // For organic motion
        noiseOffsetX: number;
        noiseOffsetY: number;
      }
      let particles: Particle[] = [];

      // Ball anchors for particle clustering
      interface BallAnchor {
        x: number;
        y: number;
        vx: number;
        vy: number;
        baseSize: number;
      }
      let ballAnchors: BallAnchor[] = [];

      // Gravity points for orbital
      const gravityPoints = [
        { x: 0.35, y: 0.5 },
        { x: 0.65, y: 0.5 },
      ];

      // Background color (morphs between modes)
      let bgHue = 220;
      let bgSat = 80;
      let bgBright = 12;
      let targetBgHue = 220;
      let targetBgSat = 80;
      let targetBgBright = 12;

      p.setup = () => {
        const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
        canvas.style('display', 'block');
        p.colorMode(p.HSB, 360, 100, 100, 1);

        // Initialize particles
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const angle = (i / PARTICLE_COUNT) * p.TWO_PI;
          const radius = Math.min(p.width, p.height) * 0.25;
          particles.push({
            x: p.width / 2 + p.cos(angle) * radius,
            y: p.height / 2 + p.sin(angle) * radius,
            targetX: p.width / 2 + p.cos(angle) * radius,
            targetY: p.height / 2 + p.sin(angle) * radius,
            size: 8,
            targetSize: 8,
            hue: (i / PARTICLE_COUNT) * 360,
            baseAngle: angle,
            index: i,
            noiseOffsetX: Math.random() * 1000,
            noiseOffsetY: Math.random() * 1000,
          });
        }

        // Ball anchors for clustering mode
        ballAnchors = [
          { x: p.width * 0.25, y: p.height * 0.4, vx: 3, vy: 2.5, baseSize: 100 },
          { x: p.width * 0.75, y: p.height * 0.6, vx: -2.5, vy: 3, baseSize: 120 },
          { x: p.width * 0.5, y: p.height * 0.35, vx: 2, vy: -2, baseSize: 90 },
          { x: p.width * 0.4, y: p.height * 0.65, vx: -2, vy: 2.5, baseSize: 85 },
          { x: p.width * 0.6, y: p.height * 0.5, vx: 2.5, vy: -2, baseSize: 95 },
        ];
      };

      p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
      };

      // Track mouse/touch movement
      p.mouseMoved = () => {
        mouseX = p.mouseX;
        mouseY = p.mouseY;
        isMouseActive = true;
        lastMouseMove = p.frameCount;
      };

      p.mouseDragged = () => {
        mouseX = p.mouseX;
        mouseY = p.mouseY;
        isMouseActive = true;
        lastMouseMove = p.frameCount;
      };

      (p as unknown as { touchMoved: () => boolean }).touchMoved = () => {
        if (p.touches.length > 0) {
          const touch = p.touches[0] as { x: number; y: number };
          mouseX = touch.x;
          mouseY = touch.y;
          isMouseActive = true;
          lastMouseMove = p.frameCount;
        }
        return false; // Prevent default
      };

      // Click/tap creates repulsion burst
      p.mousePressed = () => {
        repulsionForce = REPULSION_STRENGTH;
        repulsionX = p.mouseX;
        repulsionY = p.mouseY;
      };

      (p as unknown as { touchStarted: () => boolean }).touchStarted = () => {
        if (p.touches.length > 0) {
          const touch = p.touches[0] as { x: number; y: number };
          repulsionForce = REPULSION_STRENGTH;
          repulsionX = touch.x;
          repulsionY = touch.y;
        }
        return false; // Prevent default
      };

      // ========== MODE TARGET FUNCTIONS ==========

      const setCircleTargets = (waveform: Float32Array, intensity: number) => {
        const centerX = p.width / 2;
        const centerY = p.height / 2;
        const baseRadius = Math.min(p.width, p.height) * 0.22;
        const pulseRadius = baseRadius + smoothedBass * 180 + bassPeak * 120 * intensity;

        targetBgHue = 220;
        targetBgSat = 80;
        targetBgBright = 12 + smoothedBass * 15;

        particles.forEach((particle, i) => {
          const angle = particle.baseAngle + syncedFrame * 0.002;
          const waveIdx = Math.floor((i / PARTICLE_COUNT) * waveform.length);
          const amp = waveform[waveIdx] || 0;
          const r = pulseRadius + amp * 200 * (smoothedVolume + 0.3) * intensity;

          particle.targetX = centerX + p.cos(angle) * r;
          particle.targetY = centerY + p.sin(angle) * r;
          particle.targetSize = 6 + smoothedBass * 8 + bassPeak * 8 * intensity;
        });
      };

      const setWaveTargets = (_intensity: number) => {
        targetBgHue = p.lerp(280, 330, smoothedMid);
        targetBgSat = 70;
        targetBgBright = 15 + smoothedBass * 20;

        particles.forEach((particle, i) => {
          const xPos = (i / PARTICLE_COUNT) * p.width;
          const layerIndex = i % 5;
          // Spread layers more vertically
          const baseY = p.height / 2 + (layerIndex - 2) * 100;

          // ========== SMOOTH BASE WAVE MOTION ==========
          // Only use smoothed values here - NO bassPeak (that comes from render layer)
          // This keeps the wave flowing smoothly at all times
          const phase = syncedFrame * 0.025; // Constant smooth speed
          const phaseOffset = layerIndex * 0.5; // Layers offset from each other

          // Amplitude responds to smoothed bass (gradual, not jerky)
          const amp = 150 * (1 + smoothedBass * 1.5 + smoothedMid * 0.5);

          // Pure smooth sine wave motion
          const y = baseY +
            p.sin(xPos * 0.008 + phase + phaseOffset) * amp * 0.8 +
            p.sin(xPos * 0.015 + phase * 0.7 + phaseOffset) * amp * 0.4;

          particle.targetX = xPos;
          particle.targetY = y;
          // Size also uses only smoothed values for base
          particle.targetSize = 6 + smoothedBass * 6;
        });
      };

      const setParticleTargets = (intensity: number) => {
        targetBgHue = p.lerp(5, 35, smoothedMid);
        targetBgSat = 80;
        targetBgBright = 12 + smoothedBass * 18;

        const speedMult = 1 + smoothedBass * 2 + bassPeak * 4 * intensity;
        ballAnchors.forEach(ball => {
          ball.x += ball.vx * speedMult;
          ball.y += ball.vy * speedMult;
          if (ball.x < 0 || ball.x > p.width) ball.vx *= -1;
          if (ball.y < 0 || ball.y > p.height) ball.vy *= -1;
          ball.x = p.constrain(ball.x, 0, p.width);
          ball.y = p.constrain(ball.y, 0, p.height);
        });

        particles.forEach((particle, i) => {
          const ballIndex = i % ballAnchors.length;
          const ball = ballAnchors[ballIndex];

          const orbitAngle = particle.baseAngle + syncedFrame * 0.02;
          const orbitRadius = 30 + (i % 20) * 3 + smoothedBass * 50 * intensity;

          particle.targetX = ball.x + p.cos(orbitAngle) * orbitRadius;
          particle.targetY = ball.y + p.sin(orbitAngle) * orbitRadius;
          particle.targetSize = ball.baseSize * 0.08 * (1 + smoothedBass * 2 + bassPeak * 2 * intensity);
        });
      };

      const setGeometricTargets = (intensity: number) => {
        const bgHue1 = (syncedFrame * 0.3) % 360;
        targetBgHue = bgHue1;
        targetBgSat = 70;
        targetBgBright = 12 + smoothedBass * 15;

        const centerX = p.width / 2;
        const centerY = p.height / 2;
        const rotation = syncedFrame * 0.008 + smoothedBass * 0.15 * intensity;

        particles.forEach((particle, i) => {
          const shapeSelector = i % 30;
          let targetX, targetY;

          if (shapeSelector < 18) {
            const hexSize = 180 + smoothedBass * 200 + bassPeak * 150 * intensity;
            const hexAngle = ((i % 18) / 18) * p.TWO_PI + rotation;
            targetX = centerX + p.cos(hexAngle) * hexSize;
            targetY = centerY + p.sin(hexAngle) * hexSize;
          } else if (shapeSelector < 27) {
            const triSize = 100 + smoothedMid * 150 + midPeak * 100 * intensity;
            const triAngle = ((i % 9) / 9) * p.TWO_PI - rotation * 2;
            targetX = centerX + p.cos(triAngle) * triSize;
            targetY = centerY + p.sin(triAngle) * triSize;
          } else {
            const centerSize = 30 + smoothedVolume * 60 + bassPeak * 50 * intensity;
            const angle = particle.baseAngle;
            targetX = centerX + p.cos(angle) * centerSize;
            targetY = centerY + p.sin(angle) * centerSize;
          }

          particle.targetX = targetX;
          particle.targetY = targetY;
          particle.targetSize = 8 + smoothedBass * 10 + bassPeak * 10 * intensity;
        });
      };

      const setBreathingTargets = (intensity: number) => {
        targetBgHue = (syncedFrame * 0.5) % 360;
        targetBgSat = 60;
        targetBgBright = 10 + smoothedBass * 20;

        const centerX = p.width / 2;
        const centerY = p.height / 2;
        const breathScale = 0.4 + smoothedBass * 1.4 * intensity + bassPeak * 0.8;
        const maxRadius = Math.max(p.width, p.height) * 0.5 * breathScale;

        particles.forEach((particle, i) => {
          const ringIndex = Math.floor(i / 24);
          const angleIndex = i % 24;
          const angle = (angleIndex / 24) * p.TWO_PI + syncedFrame * 0.003;
          const radius = (ringIndex / 5) * maxRadius + smoothedMid * 60;

          particle.targetX = centerX + p.cos(angle + ringIndex * 0.1) * radius;
          particle.targetY = centerY + p.sin(angle + ringIndex * 0.1) * radius;
          particle.targetSize = 10 + smoothedBass * 15 + bassPeak * 12 * intensity - ringIndex * 1.5;
        });
      };

      const setOrbitalTargets = (intensity: number) => {
        targetBgHue = 240;
        targetBgSat = 60;
        targetBgBright = 8 + smoothedBass * 10;

        particles.forEach((particle, i) => {
          const gravityIndex = i % gravityPoints.length;
          const gp = gravityPoints[gravityIndex];
          const gpX = gp.x * p.width;
          const gpY = gp.y * p.height;

          const orbitSpeed = 0.015 * (1 + smoothedMid * 2.5 * intensity + bassPeak * 1.5);
          const orbitAngle = particle.baseAngle + syncedFrame * orbitSpeed;
          const baseOrbitRadius = 80 + (i % 30) * 5;
          const orbitRadius = baseOrbitRadius * (1.3 - smoothedBass * 0.6 * intensity - bassPeak * 0.4);

          particle.targetX = gpX + p.cos(orbitAngle) * orbitRadius;
          particle.targetY = gpY + p.sin(orbitAngle) * orbitRadius;
          particle.targetSize = 8 + smoothedBass * 10 + bassPeak * 8 * intensity;
        });
      };

      const setFractalTargets = (intensity: number) => {
        const shiftHue = (syncedFrame * 2 + smoothedBass * 100 * intensity) % 360;
        targetBgHue = shiftHue;
        targetBgSat = 50;
        targetBgBright = 10 + smoothedBass * 12;

        const centerX = p.width / 2;
        const baseY = p.height * 0.85;
        const baseLength = 100 + smoothedVolume * 100 * intensity + bassPeak * 50;
        const angleSpread = p.PI / 4 + smoothedMid * 0.5 * intensity;

        const branchPositions: { x: number; y: number }[] = [];

        const calcBranches = (x: number, y: number, angle: number, len: number, depth: number) => {
          if (depth > 5 || len < 10) return;

          const endX = x + p.cos(angle) * len;
          const endY = y + p.sin(angle) * len;
          branchPositions.push({ x: endX, y: endY });

          const wobble = p.sin(syncedFrame * 0.08 + depth) * smoothedBass * 0.25 * intensity;
          calcBranches(endX, endY, angle - angleSpread + wobble, len * 0.7, depth + 1);
          calcBranches(endX, endY, angle + angleSpread - wobble, len * 0.7, depth + 1);
        };

        for (let t = 0; t < 3; t++) {
          const treeX = centerX + (t - 1) * 280;
          calcBranches(treeX, baseY, -p.HALF_PI, baseLength, 0);
        }

        particles.forEach((particle, i) => {
          if (branchPositions.length > 0) {
            const branchIdx = i % branchPositions.length;
            const pos = branchPositions[branchIdx];
            const spread = 15 + bassPeak * 25 * intensity;
            particle.targetX = pos.x + p.random(-spread, spread);
            particle.targetY = pos.y + p.random(-spread, spread);
          } else {
            particle.targetX = p.width / 2;
            particle.targetY = p.height / 2;
          }
          particle.targetSize = 6 + smoothedBass * 8 + bassPeak * 6 * intensity;
        });
      };

      // ========== DANCING OBJECTS MODES ==========
      // Fun recognizable objects made of particles that dance to the beat

      // SMILEY FACE WITH BEARD - bouncy happy guy
      const setSmileyBeardTargets = (_intensity: number) => {
        targetBgHue = 45; // Warm yellow-orange
        targetBgSat = 70;
        targetBgBright = 15 + smoothedBass * 15;

        const centerX = p.width / 2;
        const centerY = p.height / 2;
        const scale = Math.min(p.width, p.height) * 0.003;

        // Bounce and rotation
        const bounce = Math.sin(syncedFrame * 0.08) * (20 + bassPeak * 40) * scale;
        const rotation = Math.sin(syncedFrame * 0.03) * 0.15 + bassPeak * 0.1;
        const squash = 1 + bassPeak * 0.15; // Squash on beat

        const faceRadius = 80 * scale;
        const shapePoints: { x: number; y: number; size: number }[] = [];

        // Face outline (circle)
        for (let i = 0; i < 24; i++) {
          const angle = (i / 24) * Math.PI * 2 + rotation;
          const r = faceRadius * (1 + Math.sin(angle * 3 + syncedFrame * 0.1) * 0.05);
          shapePoints.push({
            x: centerX + Math.cos(angle) * r,
            y: centerY + Math.sin(angle) * r / squash + bounce,
            size: 10 + smoothedBass * 5,
          });
        }

        // Eyes - widen on beat
        const eyeSpread = 25 * scale * (1 + bassPeak * 0.3);
        const eyeY = centerY - 20 * scale + bounce;
        const eyeSize = 12 + bassPeak * 8;
        // Left eye
        shapePoints.push({ x: centerX - eyeSpread, y: eyeY, size: eyeSize });
        shapePoints.push({ x: centerX - eyeSpread - 5 * scale, y: eyeY - 3 * scale, size: eyeSize * 0.7 });
        // Right eye
        shapePoints.push({ x: centerX + eyeSpread, y: eyeY, size: eyeSize });
        shapePoints.push({ x: centerX + eyeSpread + 5 * scale, y: eyeY - 3 * scale, size: eyeSize * 0.7 });

        // Big smile - grows on beat
        const smileWidth = 40 * scale * (1 + bassPeak * 0.2);
        const smileY = centerY + 15 * scale + bounce;
        for (let i = 0; i < 10; i++) {
          const t = i / 9;
          const angle = Math.PI * 0.2 + t * Math.PI * 0.6;
          shapePoints.push({
            x: centerX + Math.cos(angle) * smileWidth,
            y: smileY + Math.sin(angle) * smileWidth * 0.5,
            size: 7 + smoothedBass * 3,
          });
        }

        // BEARD - flows and bounces
        const beardStartY = centerY + 35 * scale + bounce;
        for (let row = 0; row < 4; row++) {
          const rowY = beardStartY + row * 15 * scale;
          const rowWidth = (45 - row * 8) * scale;
          const beardWave = Math.sin(syncedFrame * 0.1 + row * 0.5) * 5 * scale;
          const numPoints = 6 - row;
          for (let i = 0; i < numPoints; i++) {
            const t = numPoints > 1 ? i / (numPoints - 1) : 0.5;
            const x = centerX + (t - 0.5) * 2 * rowWidth + beardWave;
            const hairWiggle = Math.sin(syncedFrame * 0.15 + i + row) * 3 * scale;
            shapePoints.push({
              x: x + hairWiggle,
              y: rowY + Math.abs(hairWiggle) + bassPeak * 10,
              size: 8 - row + smoothedBass * 4,
            });
          }
        }

        // Assign particles
        particles.forEach((particle, i) => {
          const point = shapePoints[i % shapePoints.length];
          const jitter = bassPeak * 5;
          particle.targetX = point.x + (Math.random() - 0.5) * jitter;
          particle.targetY = point.y + (Math.random() - 0.5) * jitter;
          particle.targetSize = point.size + bassPeak * 5;
        });
      };

      // COOL SNEAKER - bouncing shoe with flowing laces
      const setSneakerTargets = (_intensity: number) => {
        targetBgHue = 200; // Cool blue
        targetBgSat = 65;
        targetBgBright = 12 + smoothedBass * 15;

        const centerX = p.width / 2;
        const centerY = p.height / 2;
        const scale = Math.min(p.width, p.height) * 0.0035;

        // Bouncing and slight rotation
        const bounce = -Math.abs(Math.sin(syncedFrame * 0.1)) * 30 * scale * (1 + bassPeak * 0.5);
        const tilt = Math.sin(syncedFrame * 0.05) * 0.1;

        const shapePoints: { x: number; y: number; size: number }[] = [];

        // Sole - thick bottom
        const soleY = centerY + 40 * scale + bounce;
        for (let i = 0; i < 15; i++) {
          const t = i / 14;
          const x = centerX + (t - 0.5) * 140 * scale;
          const curve = Math.sin(t * Math.PI) * 8 * scale;
          shapePoints.push({
            x: x,
            y: soleY + curve + Math.cos(tilt) * (t - 0.5) * 20,
            size: 12 + smoothedBass * 4,
          });
        }

        // Upper shoe body
        for (let row = 0; row < 4; row++) {
          const rowY = soleY - (row + 1) * 15 * scale + bounce;
          const rowWidth = (65 - row * 10) * scale;
          const startX = centerX - 20 * scale; // Offset to left (toe area shorter)
          for (let i = 0; i < 8; i++) {
            const t = i / 7;
            shapePoints.push({
              x: startX + t * rowWidth,
              y: rowY + Math.sin(tilt) * t * 10,
              size: 9 + smoothedBass * 3,
            });
          }
        }

        // Toe cap - rounded front
        const toeX = centerX - 50 * scale;
        const toeY = centerY + 10 * scale + bounce;
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI * 0.5 + (i / 5) * Math.PI;
          shapePoints.push({
            x: toeX + Math.cos(angle) * 25 * scale,
            y: toeY + Math.sin(angle) * 20 * scale,
            size: 10 + smoothedBass * 4,
          });
        }

        // Heel counter
        const heelX = centerX + 55 * scale;
        for (let i = 0; i < 5; i++) {
          const t = i / 4;
          shapePoints.push({
            x: heelX,
            y: soleY - t * 35 * scale + bounce,
            size: 9 + smoothedBass * 3,
          });
        }

        // LACES - flowing and dancing!
        const laceStartX = centerX - 10 * scale;
        const laceY = centerY - 10 * scale + bounce;
        for (let lace = 0; lace < 2; lace++) {
          const laceWave = Math.sin(syncedFrame * 0.12 + lace * 2) * 15 * scale;
          const laceFloat = Math.cos(syncedFrame * 0.08 + lace) * 10 * scale;
          for (let i = 0; i < 8; i++) {
            const t = i / 7;
            const side = lace === 0 ? -1 : 1;
            shapePoints.push({
              x: laceStartX + side * 15 * scale + laceWave * t,
              y: laceY - t * 40 * scale + laceFloat * t + bassPeak * 20 * t,
              size: 6 + smoothedBass * 2,
            });
          }
        }

        // Swoosh logo
        const swooshY = centerY + 15 * scale + bounce;
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          const swooshX = centerX - 30 * scale + t * 70 * scale;
          const swooshCurve = Math.sin(t * Math.PI) * 15 * scale * (1 - t * 0.5);
          shapePoints.push({
            x: swooshX,
            y: swooshY - swooshCurve,
            size: 7 + bassPeak * 4,
          });
        }

        particles.forEach((particle, i) => {
          const point = shapePoints[i % shapePoints.length];
          particle.targetX = point.x;
          particle.targetY = point.y;
          particle.targetSize = point.size;
        });
      };

      // PIZZA SLICE - wobbling with stretchy cheese
      const setPizzaTargets = (_intensity: number) => {
        targetBgHue = 15; // Warm pizza orange-red
        targetBgSat = 75;
        targetBgBright = 14 + smoothedBass * 12;

        const centerX = p.width / 2;
        const centerY = p.height / 2;
        const scale = Math.min(p.width, p.height) * 0.003;

        // Wobble rotation
        const wobble = Math.sin(syncedFrame * 0.06) * 0.15;
        const bounce = Math.sin(syncedFrame * 0.08) * 10 * scale;

        const shapePoints: { x: number; y: number; size: number }[] = [];

        // Triangle slice shape
        const tipX = centerX;
        const tipY = centerY + 80 * scale + bounce;
        const leftX = centerX - 60 * scale;
        const rightX = centerX + 60 * scale;
        const topY = centerY - 60 * scale + bounce;

        // Crust (top arc)
        for (let i = 0; i < 12; i++) {
          const t = i / 11;
          const x = leftX + t * (rightX - leftX);
          const crustBump = Math.sin(t * Math.PI) * 15 * scale;
          const crustWave = Math.sin(syncedFrame * 0.1 + i) * 3 * scale;
          shapePoints.push({
            x: x + Math.sin(wobble) * (t - 0.5) * 20,
            y: topY - crustBump + crustWave,
            size: 12 + smoothedBass * 5,
          });
        }

        // Left edge
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          shapePoints.push({
            x: p.lerp(leftX, tipX, t) + Math.sin(wobble) * 10 * (1 - t),
            y: p.lerp(topY, tipY, t),
            size: 9 + smoothedBass * 3,
          });
        }

        // Right edge
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          shapePoints.push({
            x: p.lerp(rightX, tipX, t) - Math.sin(wobble) * 10 * (1 - t),
            y: p.lerp(topY, tipY, t),
            size: 9 + smoothedBass * 3,
          });
        }

        // Pepperoni! Bounce on beat
        const pepperoniPositions = [
          { x: -20, y: -20 }, { x: 25, y: -15 }, { x: 0, y: 15 },
          { x: -15, y: 25 }, { x: 20, y: 30 },
        ];
        pepperoniPositions.forEach((pep, idx) => {
          const pepBounce = bassPeak * 8 * Math.sin(syncedFrame * 0.2 + idx);
          const pepX = centerX + pep.x * scale + Math.sin(wobble) * pep.y * 0.1;
          const pepY = centerY + pep.y * scale + bounce + pepBounce;
          // Each pepperoni is a small circle
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            shapePoints.push({
              x: pepX + Math.cos(angle) * 8 * scale,
              y: pepY + Math.sin(angle) * 8 * scale,
              size: 8 + bassPeak * 4,
            });
          }
        });

        // STRETCHY CHEESE - dripping from the tip!
        const cheeseStretch = smoothedBass * 40 * scale + bassPeak * 30 * scale;
        for (let strand = 0; strand < 3; strand++) {
          const strandX = tipX + (strand - 1) * 12 * scale;
          for (let i = 0; i < 6; i++) {
            const t = i / 5;
            const wave = Math.sin(syncedFrame * 0.15 + strand + i) * 5 * scale;
            shapePoints.push({
              x: strandX + wave,
              y: tipY + t * cheeseStretch,
              size: 6 - t * 2 + smoothedBass * 3,
            });
          }
        }

        particles.forEach((particle, i) => {
          const point = shapePoints[i % shapePoints.length];
          particle.targetX = point.x;
          particle.targetY = point.y;
          particle.targetSize = point.size;
        });
      };

      // RETRO BOOMBOX - speakers pulse with the beat!
      const setBoomboxTargets = (_intensity: number) => {
        targetBgHue = 280; // Purple/magenta
        targetBgSat = 65;
        targetBgBright = 12 + smoothedBass * 18;

        const centerX = p.width / 2;
        const centerY = p.height / 2;
        const scale = Math.min(p.width, p.height) * 0.0025;

        // Slight bounce
        const bounce = Math.sin(syncedFrame * 0.1) * 8 * scale * (1 + bassPeak);

        const shapePoints: { x: number; y: number; size: number }[] = [];

        // Main body - rectangular
        const bodyWidth = 120 * scale;
        const bodyHeight = 70 * scale;

        // Top edge
        for (let i = 0; i < 15; i++) {
          const t = i / 14;
          shapePoints.push({
            x: centerX + (t - 0.5) * bodyWidth * 2,
            y: centerY - bodyHeight + bounce,
            size: 10 + smoothedBass * 3,
          });
        }
        // Bottom edge
        for (let i = 0; i < 15; i++) {
          const t = i / 14;
          shapePoints.push({
            x: centerX + (t - 0.5) * bodyWidth * 2,
            y: centerY + bodyHeight + bounce,
            size: 10 + smoothedBass * 3,
          });
        }
        // Sides
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          const y = centerY + (t - 0.5) * bodyHeight * 2 + bounce;
          shapePoints.push({ x: centerX - bodyWidth, y, size: 10 });
          shapePoints.push({ x: centerX + bodyWidth, y, size: 10 });
        }

        // LEFT SPEAKER - pulses with bass!
        const speakerRadius = 35 * scale * (1 + smoothedBass * 0.4 + bassPeak * 0.3);
        const leftSpeakerX = centerX - 55 * scale;
        for (let ring = 0; ring < 3; ring++) {
          const ringRadius = speakerRadius * (1 - ring * 0.25);
          const numPoints = 12 - ring * 3;
          for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2 + syncedFrame * 0.02 * (ring + 1);
            shapePoints.push({
              x: leftSpeakerX + Math.cos(angle) * ringRadius,
              y: centerY + Math.sin(angle) * ringRadius + bounce,
              size: 8 + bassPeak * 6 - ring * 2,
            });
          }
        }
        // Speaker center
        shapePoints.push({ x: leftSpeakerX, y: centerY + bounce, size: 12 + bassPeak * 10 });

        // RIGHT SPEAKER - pulses with bass!
        const rightSpeakerX = centerX + 55 * scale;
        for (let ring = 0; ring < 3; ring++) {
          const ringRadius = speakerRadius * (1 - ring * 0.25);
          const numPoints = 12 - ring * 3;
          for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2 - syncedFrame * 0.02 * (ring + 1);
            shapePoints.push({
              x: rightSpeakerX + Math.cos(angle) * ringRadius,
              y: centerY + Math.sin(angle) * ringRadius + bounce,
              size: 8 + bassPeak * 6 - ring * 2,
            });
          }
        }
        shapePoints.push({ x: rightSpeakerX, y: centerY + bounce, size: 12 + bassPeak * 10 });

        // Cassette deck in middle
        const deckY = centerY + bounce;
        const deckWidth = 30 * scale;
        const deckHeight = 20 * scale;
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          shapePoints.push({ x: centerX + (t - 0.5) * deckWidth * 2, y: deckY - deckHeight, size: 7 });
          shapePoints.push({ x: centerX + (t - 0.5) * deckWidth * 2, y: deckY + deckHeight, size: 7 });
        }

        // Spinning tape reels
        const reelRadius = 8 * scale;
        const reelSpin = syncedFrame * 0.1;
        [-1, 1].forEach(side => {
          const reelX = centerX + side * 12 * scale;
          for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + reelSpin;
            shapePoints.push({
              x: reelX + Math.cos(angle) * reelRadius,
              y: deckY + Math.sin(angle) * reelRadius,
              size: 5 + smoothedMid * 3,
            });
          }
        });

        // Handle on top
        const handleY = centerY - bodyHeight - 15 * scale + bounce;
        for (let i = 0; i < 10; i++) {
          const t = i / 9;
          const handleCurve = Math.sin(t * Math.PI) * 20 * scale;
          shapePoints.push({
            x: centerX + (t - 0.5) * 60 * scale,
            y: handleY - handleCurve,
            size: 8,
          });
        }

        // Antenna - bounces more
        const antennaX = centerX + 40 * scale;
        const antennaBounce = Math.sin(syncedFrame * 0.12) * 10 * scale;
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          shapePoints.push({
            x: antennaX + antennaBounce * t,
            y: centerY - bodyHeight - t * 40 * scale + bounce,
            size: 5 + (1 - t) * 3,
          });
        }

        particles.forEach((particle, i) => {
          const point = shapePoints[i % shapePoints.length];
          particle.targetX = point.x;
          particle.targetY = point.y;
          particle.targetSize = point.size;
        });
      };

      // COFFEE CUP - with dancing steam
      const setCoffeeCupTargets = (_intensity: number) => {
        targetBgHue = 25; // Warm brown
        targetBgSat = 50;
        targetBgBright = 12 + smoothedBass * 10;

        const centerX = p.width / 2;
        const centerY = p.height / 2 + 30;
        const scale = Math.min(p.width, p.height) * 0.003;

        // Gentle sway
        const sway = Math.sin(syncedFrame * 0.05) * 8 * scale;
        const bounce = Math.sin(syncedFrame * 0.08) * 5 * scale;

        const shapePoints: { x: number; y: number; size: number }[] = [];

        // Cup body - tapered
        const cupTopWidth = 45 * scale;
        const cupBottomWidth = 35 * scale;
        const cupHeight = 70 * scale;

        for (let row = 0; row < 10; row++) {
          const t = row / 9;
          const rowY = centerY - cupHeight / 2 + t * cupHeight + bounce;
          const rowWidth = p.lerp(cupTopWidth, cupBottomWidth, t);
          // Left edge
          shapePoints.push({ x: centerX - rowWidth + sway, y: rowY, size: 9 + smoothedBass * 3 });
          // Right edge
          shapePoints.push({ x: centerX + rowWidth + sway, y: rowY, size: 9 + smoothedBass * 3 });
        }

        // Cup rim (top)
        for (let i = 0; i < 10; i++) {
          const t = i / 9;
          shapePoints.push({
            x: centerX + (t - 0.5) * cupTopWidth * 2 + sway,
            y: centerY - cupHeight / 2 + bounce,
            size: 10 + smoothedBass * 4,
          });
        }

        // Cup bottom
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          shapePoints.push({
            x: centerX + (t - 0.5) * cupBottomWidth * 2 + sway,
            y: centerY + cupHeight / 2 + bounce,
            size: 10,
          });
        }

        // Handle
        const handleX = centerX + cupTopWidth + 10 * scale + sway;
        const handleY = centerY + bounce;
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          const angle = -Math.PI / 2 + t * Math.PI;
          const handleRadius = 20 * scale;
          shapePoints.push({
            x: handleX + Math.cos(angle) * handleRadius,
            y: handleY + Math.sin(angle) * handleRadius * 1.2,
            size: 7 + smoothedBass * 2,
          });
        }

        // DANCING STEAM - the star of the show!
        const steamBaseY = centerY - cupHeight / 2 - 10 * scale + bounce;
        for (let strand = 0; strand < 4; strand++) {
          const strandX = centerX + (strand - 1.5) * 15 * scale + sway;
          const strandPhase = strand * 1.5;
          for (let i = 0; i < 8; i++) {
            const t = i / 7;
            const steamWave = Math.sin(syncedFrame * 0.1 + strandPhase + t * 2) * 15 * scale;
            const steamRise = t * 60 * scale * (1 + smoothedBass * 0.5);
            const steamFade = 1 - t * 0.7;
            // Steam spreads out as it rises
            const spread = t * 10 * scale;
            shapePoints.push({
              x: strandX + steamWave + (strand - 1.5) * spread,
              y: steamBaseY - steamRise + Math.sin(syncedFrame * 0.15 + i) * 5,
              size: (8 + bassPeak * 6) * steamFade,
            });
          }
        }

        // Coffee surface (liquid)
        const coffeeY = centerY - cupHeight / 2 + 8 * scale + bounce;
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          const ripple = Math.sin(syncedFrame * 0.1 + t * 4) * 2 * scale;
          shapePoints.push({
            x: centerX + (t - 0.5) * cupTopWidth * 1.6 + sway,
            y: coffeeY + ripple,
            size: 7 + smoothedBass * 3,
          });
        }

        particles.forEach((particle, i) => {
          const point = shapePoints[i % shapePoints.length];
          particle.targetX = point.x;
          particle.targetY = point.y;
          particle.targetSize = point.size;
        });
      };

      // RUBBER DUCK - bobbing in water
      const setRubberDuckTargets = (_intensity: number) => {
        targetBgHue = 200; // Water blue
        targetBgSat = 60;
        targetBgBright = 20 + smoothedBass * 15;

        const centerX = p.width / 2;
        const centerY = p.height / 2;
        const scale = Math.min(p.width, p.height) * 0.003;

        // Bobbing motion
        const bob = Math.sin(syncedFrame * 0.06) * 15 * scale;
        const tilt = Math.sin(syncedFrame * 0.04) * 0.12;
        const sideMotion = Math.sin(syncedFrame * 0.03) * 20 * scale;

        const shapePoints: { x: number; y: number; size: number }[] = [];

        // Body - round
        const bodyRadius = 50 * scale;
        const bodyX = centerX + sideMotion;
        const bodyY = centerY + 20 * scale + bob;

        for (let i = 0; i < 20; i++) {
          const angle = (i / 20) * Math.PI * 2 + tilt;
          const squash = 0.8; // Slightly flattened
          shapePoints.push({
            x: bodyX + Math.cos(angle) * bodyRadius,
            y: bodyY + Math.sin(angle) * bodyRadius * squash,
            size: 10 + smoothedBass * 4,
          });
        }

        // Head - smaller circle attached
        const headRadius = 30 * scale;
        const headX = bodyX + 35 * scale;
        const headY = centerY - 15 * scale + bob;

        for (let i = 0; i < 14; i++) {
          const angle = (i / 14) * Math.PI * 2 + tilt;
          shapePoints.push({
            x: headX + Math.cos(angle) * headRadius,
            y: headY + Math.sin(angle) * headRadius,
            size: 9 + smoothedBass * 3,
          });
        }

        // Beak - opens on beat!
        const beakOpen = bassPeak * 8 * scale;
        const beakX = headX + headRadius * 0.8;
        const beakY = headY + 5 * scale;
        // Top beak
        for (let i = 0; i < 5; i++) {
          const t = i / 4;
          shapePoints.push({
            x: beakX + t * 20 * scale,
            y: beakY - 5 * scale - beakOpen * (1 - t),
            size: 7 + bassPeak * 3,
          });
        }
        // Bottom beak
        for (let i = 0; i < 5; i++) {
          const t = i / 4;
          shapePoints.push({
            x: beakX + t * 18 * scale,
            y: beakY + 5 * scale + beakOpen * (1 - t),
            size: 7 + bassPeak * 3,
          });
        }

        // Eye
        const eyeX = headX + 8 * scale;
        const eyeY = headY - 5 * scale;
        shapePoints.push({ x: eyeX, y: eyeY, size: 10 + bassPeak * 4 });
        shapePoints.push({ x: eyeX + 2 * scale, y: eyeY - 2 * scale, size: 5 }); // Highlight

        // Wing - flaps slightly
        const wingFlap = Math.sin(syncedFrame * 0.1) * 0.2 + bassPeak * 0.3;
        const wingX = bodyX - 10 * scale;
        const wingY = bodyY - 10 * scale + bob;
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          const wingAngle = -Math.PI * 0.3 - wingFlap;
          shapePoints.push({
            x: wingX + Math.cos(wingAngle) * t * 25 * scale,
            y: wingY + Math.sin(wingAngle) * t * 25 * scale,
            size: 8 - t * 2 + smoothedBass * 3,
          });
        }

        // Tail feathers
        const tailX = bodyX - bodyRadius * 0.9;
        const tailY = bodyY - 5 * scale;
        for (let i = 0; i < 4; i++) {
          const angle = Math.PI + (i - 1.5) * 0.3;
          const wiggle = Math.sin(syncedFrame * 0.12 + i) * 5 * scale;
          shapePoints.push({
            x: tailX + Math.cos(angle) * (15 * scale + wiggle),
            y: tailY + Math.sin(angle) * 10 * scale,
            size: 7 + smoothedBass * 2,
          });
        }

        // Water ripples around duck
        const waterY = centerY + 50 * scale + bob * 0.3;
        for (let ring = 0; ring < 2; ring++) {
          const ringRadius = (80 + ring * 40) * scale;
          const ringWave = Math.sin(syncedFrame * 0.08 - ring * 0.5);
          for (let i = 0; i < 12; i++) {
            const t = i / 11;
            const x = centerX + (t - 0.5) * ringRadius * 2 + sideMotion * 0.5;
            const wave = Math.sin(t * Math.PI * 2 + syncedFrame * 0.1) * 5 * scale;
            shapePoints.push({
              x: x,
              y: waterY + ring * 15 * scale + wave * ringWave,
              size: 6 + smoothedBass * 2,
            });
          }
        }

        particles.forEach((particle, i) => {
          const point = shapePoints[i % shapePoints.length];
          particle.targetX = point.x;
          particle.targetY = point.y;
          particle.targetSize = point.size;
        });
      };

      // ========== DANCING STICK FIGURE MODE (SECRET) ==========
      // Dance move state - changes every few seconds
      let currentDanceMove = 0;
      // Extended smooth state for full body control
      let danceMoveSmoothL = {
        armAngle: 0, armBend: 0,
        legAngle: Math.PI / 2, legBend: 0,
        footOffsetX: 0, footOffsetY: 0, // Side step and forward/back
        kneeLift: 0, // How high knee is lifted (0-1)
      };
      let danceMoveSmoothR = {
        armAngle: 0, armBend: 0,
        legAngle: Math.PI / 2, legBend: 0,
        footOffsetX: 0, footOffsetY: 0,
        kneeLift: 0,
      };
      // Hip drop for bouncing
      let smoothHipDrop = 0;

      const setStickFigureTargets = (_intensity: number) => {
        // Disco-inspired shifting background
        targetBgHue = (syncedFrame * 2 + smoothedBass * 60) % 360;
        targetBgSat = 75 + smoothedBass * 15;
        targetBgBright = 18 + smoothedBass * 20 + bassPeak * 15;

        const centerX = p.width / 2;
        const centerY = p.height / 2;

        // Time-based values for smooth animation
        const t = syncedFrame * 0.08; // Main dance tempo
        const slowT = syncedFrame * 0.04; // Half time for smooth moves

        // Beat reactivity
        const beatPunch = bassPeak * 1.5 + smoothedBass * 0.5;
        const midPunch = midPeak * 1.2 + smoothedMid * 0.4;

        // Cycle through dance moves every ~3 seconds (180 frames)
        currentDanceMove = Math.floor(syncedFrame / 180) % 8;

        // ========== FUNKY DANCE MOVE DEFINITIONS ==========
        // Each move defines: body lean, hip sway, arm poses (L/R), leg poses (L/R)

        let bodyLean = 0; // Side lean (-1 to 1)
        let bodyTilt = 0; // Forward/back tilt
        let hipSwayX = 0;
        let hipSwayY = 0;
        let shoulderTwist = 0;

        // Arm targets: angle from shoulder, bend amount
        let leftArmAngle = -Math.PI / 2;
        let leftArmBend = 0;
        let rightArmAngle = -Math.PI / 2;
        let rightArmBend = 0;

        // Leg targets: angle from hip, bend amount, foot position, knee lift
        let leftLegAngle = Math.PI / 2;
        let leftLegBend = 0;
        let leftFootOffsetX = 0; // Side step (-1 to 1, scaled later)
        let leftFootOffsetY = 0; // Forward/back step
        let leftKneeLift = 0; // Knee lift amount (0-1)

        let rightLegAngle = Math.PI / 2;
        let rightLegBend = 0;
        let rightFootOffsetX = 0;
        let rightFootOffsetY = 0;
        let rightKneeLift = 0;

        let hipDrop = 0; // How much hips drop (for bouncing)

        // Groove base - always present
        const groove = Math.sin(t * 2) * 0.15;
        const bounce = Math.abs(Math.sin(t * 2)) * (15 + beatPunch * 25);

        switch (currentDanceMove) {
          case 0: // CHA-CHA - side step left, together, side step right, together
            {
              const chaPhase = (t * 1.2) % 4; // 4-count pattern
              hipSwayX = Math.sin(t * 1.2 * Math.PI / 2) * 50;
              bodyLean = Math.sin(t * 1.2 * Math.PI / 2) * 0.25;

              // Foot positions for cha-cha - BIG STEPS
              if (chaPhase < 1) {
                // Step left with left foot
                leftFootOffsetX = -1.5; // Much bigger step
                rightFootOffsetX = 0;
                leftKneeLift = 0.15;
                rightKneeLift = 0.5; // Lift before step
              } else if (chaPhase < 2) {
                // Right foot joins left
                leftFootOffsetX = -0.8;
                rightFootOffsetX = -0.8;
                leftKneeLift = 0.4;
                rightKneeLift = 0.1;
              } else if (chaPhase < 3) {
                // Step right with right foot
                leftFootOffsetX = 0;
                rightFootOffsetX = 1.5;
                leftKneeLift = 0.5;
                rightKneeLift = 0.15;
              } else {
                // Left foot joins right
                leftFootOffsetX = 0.8;
                rightFootOffsetX = 0.8;
                leftKneeLift = 0.1;
                rightKneeLift = 0.4;
              }
              hipDrop = Math.abs(Math.sin(t * 2.4)) * 0.35;

              // Arms swing opposite to feet
              leftArmAngle = Math.PI * 0.3 + Math.sin(t * 1.2) * 0.7;
              rightArmAngle = Math.PI * 0.7 - Math.sin(t * 1.2) * 0.7;
              leftArmBend = 0.4;
              rightArmBend = 0.4;
            }
            break;

          case 1: // RUNNING MAN - classic hip-hop move
            {
              const runPhase = (t * 2) % 2; // 2-count alternating
              hipDrop = 0.35 + Math.abs(Math.sin(t * 4)) * 0.2;
              bodyTilt = 0.2; // Lean forward

              if (runPhase < 1) {
                // Left knee UP HIGH, right foot slides back
                leftKneeLift = 1.0 * (1 - (runPhase % 1) * 0.2); // FULL knee lift
                leftFootOffsetY = -0.6; // Forward
                leftLegBend = 0.8;
                rightKneeLift = 0;
                rightFootOffsetY = 1.0 * runPhase; // BIG slide back
                rightFootOffsetX = 0;
                rightLegBend = 0.15;
              } else {
                // Right knee UP HIGH, left foot slides back
                const p2 = runPhase - 1;
                rightKneeLift = 1.0 * (1 - (p2 % 1) * 0.2);
                rightFootOffsetY = -0.6;
                rightLegBend = 0.8;
                leftKneeLift = 0;
                leftFootOffsetY = 1.0 * p2;
                leftFootOffsetX = 0;
                leftLegBend = 0.15;
              }

              // Pumping arms - bigger swing
              leftArmAngle = runPhase < 1 ? -Math.PI * 0.5 : Math.PI * 0.4;
              rightArmAngle = runPhase < 1 ? Math.PI * 0.4 : -Math.PI * 0.5;
              leftArmBend = 0.6;
              rightArmBend = 0.6;
            }
            break;

          case 2: // TOPROCK - b-boy standing footwork
            {
              const rockPhase = (t * 0.8) % 4;
              hipSwayX = Math.sin(t * 0.8 * Math.PI / 2) * 45;

              if (rockPhase < 1) {
                // Cross step - right foot crosses in front - BIG cross
                leftFootOffsetX = -0.5;
                rightFootOffsetX = -1.2; // Cross way over
                rightFootOffsetY = -0.5;
                leftKneeLift = 0.1;
                rightKneeLift = 0.3;
                bodyLean = -0.3;
              } else if (rockPhase < 2) {
                // Bounce back center with DROP
                leftFootOffsetX = 0;
                rightFootOffsetX = 0;
                leftKneeLift = 0.25;
                rightKneeLift = 0.25;
                hipDrop = 0.5; // BIG drop
                bodyLean = 0;
              } else if (rockPhase < 3) {
                // Cross step - left foot crosses in front
                leftFootOffsetX = 1.2;
                leftFootOffsetY = -0.5;
                rightFootOffsetX = 0.5;
                leftKneeLift = 0.3;
                rightKneeLift = 0.1;
                bodyLean = 0.3;
              } else {
                // Kick out right - BIG kick
                rightFootOffsetX = 1.8;
                rightFootOffsetY = -0.4;
                rightKneeLift = 0.6; // High kick
                leftFootOffsetX = -0.3;
                leftKneeLift = 0.1;
                hipDrop = 0.2;
                bodyLean = -0.2;
              }

              // Arms swing for balance - bigger
              leftArmAngle = Math.PI * 0.6 + Math.sin(t * 1.6) * 0.8;
              rightArmAngle = Math.PI * 0.4 - Math.sin(t * 1.6) * 0.8;
              leftArmBend = 0.3;
              rightArmBend = 0.3;
            }
            break;

          case 3: // POPPING/LOCKING - freeze on beats, flow between
            {
              // Detect if we're on a beat (use bassPeak threshold)
              const onBeat = bassPeak > 0.15;

              // Cycle through freeze poses
              const poseNum = Math.floor(t * 0.5) % 4;

              // DRAMATIC freeze poses
              if (poseNum === 0) {
                // Pose 1: Weight on left, right leg way out
                leftFootOffsetX = -0.5;
                rightFootOffsetX = 1.6; // BIG extension
                rightKneeLift = 0.5;
                leftLegBend = 0.4;
                leftArmAngle = -Math.PI * 0.6;
                rightArmAngle = 0;
                bodyLean = -0.3;
                hipDrop = 0.25;
              } else if (poseNum === 1) {
                // Pose 2: Deep squat - REALLY deep
                hipDrop = 0.7; // Very deep
                leftLegBend = 0.7;
                rightLegBend = 0.7;
                leftFootOffsetX = -0.6;
                rightFootOffsetX = 0.6;
                leftArmAngle = Math.PI * 0.8;
                rightArmAngle = Math.PI * 0.2;
                leftArmBend = 0.6;
                rightArmBend = 0.6;
              } else if (poseNum === 2) {
                // Pose 3: One leg back, arms up - dramatic
                leftFootOffsetY = 1.0; // Way back
                rightKneeLift = 0.7; // High knee
                leftArmAngle = -Math.PI * 0.8;
                rightArmAngle = -Math.PI * 0.8;
                bodyTilt = 0.3;
              } else {
                // Pose 4: Wide stance, robot arms
                leftFootOffsetX = -1.3;
                rightFootOffsetX = 1.3;
                leftArmAngle = 0;
                rightArmAngle = Math.PI;
                leftArmBend = 0.5;
                rightArmBend = 0.5;
                shoulderTwist = 0.3;
                hipDrop = 0.2;
              }

              // Add pop/lock jitter on beats
              if (onBeat) {
                hipSwayX += (Math.random() - 0.5) * 20;
                shoulderTwist += (Math.random() - 0.5) * 0.15;
                hipDrop += 0.15;
              }
            }
            break;

          case 4: // ARM WAVE + HEEL TOE - fluid arm motion with footwork
            {
              const waveT = t * 1.5;
              // Arm wave traveling through body
              const waveProgress = (waveT % 2) / 2; // 0 to 1
              const waveDir = Math.floor(waveT) % 2; // Alternating direction

              if (waveDir === 0) {
                // Wave left to right
                leftArmAngle = -Math.PI / 2 + Math.sin(waveProgress * Math.PI) * 1.0;
                leftArmBend = Math.sin(waveProgress * Math.PI * 2) * 0.5;
                rightArmAngle = -Math.PI / 2 + Math.sin((waveProgress - 0.3) * Math.PI) * 1.0;
                rightArmBend = Math.sin((waveProgress - 0.3) * Math.PI * 2) * 0.5;
              } else {
                // Wave right to left
                rightArmAngle = -Math.PI / 2 + Math.sin(waveProgress * Math.PI) * 1.0;
                rightArmBend = Math.sin(waveProgress * Math.PI * 2) * 0.5;
                leftArmAngle = -Math.PI / 2 + Math.sin((waveProgress - 0.3) * Math.PI) * 1.0;
                leftArmBend = Math.sin((waveProgress - 0.3) * Math.PI * 2) * 0.5;
              }

              // Heel-toe footwork - BIGGER steps
              const footPhase = (t * 2) % 2;
              if (footPhase < 1) {
                leftFootOffsetY = -0.7; // Heel way forward
                rightFootOffsetY = 0.5; // Toe back
                leftKneeLift = 0.35;
                rightKneeLift = 0.1;
              } else {
                leftFootOffsetY = 0.5;
                rightFootOffsetY = -0.7;
                rightKneeLift = 0.35;
                leftKneeLift = 0.1;
              }
              hipSwayX = Math.sin(t) * 35;
              bodyLean = Math.sin(t * 0.5) * 0.2;
              hipDrop = Math.abs(Math.sin(t * 2)) * 0.25;
            }
            break;

          case 5: // SIDE SHUFFLE - quick side steps with arm pumps
            {
              const shuffleT = t * 2.5;
              const shufflePhase = shuffleT % 4;
              hipSwayX = Math.sin(shuffleT * Math.PI / 2) * 55;
              bodyLean = Math.sin(shuffleT * Math.PI / 2) * 0.3;

              if (shufflePhase < 1) {
                // Shuffle left - left foot WAY out
                leftFootOffsetX = -1.8;
                rightFootOffsetX = -0.3;
                leftKneeLift = 0.4;
                hipDrop = 0.25;
              } else if (shufflePhase < 2) {
                // Right foot catches up - bounce
                leftFootOffsetX = -1.2;
                rightFootOffsetX = -1.0;
                rightKneeLift = 0.5;
                hipDrop = 0.15;
              } else if (shufflePhase < 3) {
                // Shuffle right - right foot WAY out
                rightFootOffsetX = 1.8;
                leftFootOffsetX = 0.3;
                rightKneeLift = 0.4;
                hipDrop = 0.25;
              } else {
                // Left foot catches up
                rightFootOffsetX = 1.2;
                leftFootOffsetX = 1.0;
                leftKneeLift = 0.5;
                hipDrop = 0.15;
              }

              // Arms pump BIG with the shuffle
              leftArmAngle = Math.sin(shuffleT) * 1.0;
              rightArmAngle = -Math.sin(shuffleT) * 1.0;
              leftArmBend = 0.6;
              rightArmBend = 0.6;
            }
            break;

          case 6: // STOMP & GROOVE - heavy footwork with arm swings
            {
              const stompT = t * 1.8;
              const stompPhase = stompT % 4;
              hipDrop = 0.2 + Math.abs(Math.sin(stompT * Math.PI)) * 0.35;

              if (stompPhase < 1) {
                // Stomp left - BIG lift then SLAM down
                leftFootOffsetX = -1.0;
                leftKneeLift = 0.9 * Math.max(0, 1 - stompPhase * 2); // HIGH lift
                leftLegBend = stompPhase > 0.5 ? 0.4 : 0;
                rightKneeLift = 0.1;
              } else if (stompPhase < 2) {
                // Hold & groove - bounce
                leftFootOffsetX = -0.7;
                rightFootOffsetX = 0.3;
                leftLegBend = 0.3;
                rightLegBend = 0.15;
                leftKneeLift = 0.15;
                rightKneeLift = 0.15;
              } else if (stompPhase < 3) {
                // Stomp right - BIG lift
                rightFootOffsetX = 1.0;
                rightKneeLift = 0.9 * Math.max(0, 1 - (stompPhase - 2) * 2);
                rightLegBend = stompPhase > 2.5 ? 0.4 : 0;
                leftKneeLift = 0.1;
              } else {
                // Hold & groove
                leftFootOffsetX = -0.3;
                rightFootOffsetX = 0.7;
                leftLegBend = 0.15;
                rightLegBend = 0.3;
                leftKneeLift = 0.15;
                rightKneeLift = 0.15;
              }

              // Big arm swings
              leftArmAngle = Math.PI * 0.4 + Math.sin(stompT * 0.5) * 1.0;
              rightArmAngle = Math.PI * 0.6 - Math.sin(stompT * 0.5) * 1.0;
              leftArmBend = 0.25;
              rightArmBend = 0.25;
              hipSwayX = Math.sin(stompT) * 40;
            }
            break;

          case 7: // FREESTYLE FUNK - chaotic full body - WILD
            {
              const chaos1 = p.noise(syncedFrame * 0.03) * 2 - 1;
              const chaos2 = p.noise(syncedFrame * 0.03 + 100) * 2 - 1;
              const chaos3 = p.noise(syncedFrame * 0.03 + 200) * 2 - 1;
              const chaos4 = p.noise(syncedFrame * 0.03 + 300) * 2 - 1;
              const chaos5 = p.noise(syncedFrame * 0.03 + 400) * 2 - 1;
              const chaos6 = p.noise(syncedFrame * 0.03 + 500) * 2 - 1;

              bodyLean = chaos1 * 0.4 + groove;
              bodyTilt = chaos2 * 0.3;
              hipSwayX = chaos1 * 60;
              hipDrop = Math.abs(chaos3) * 0.5;

              // Chaotic arms - FULL RANGE
              leftArmAngle = chaos2 * Math.PI;
              rightArmAngle = chaos3 * Math.PI;
              leftArmBend = Math.abs(chaos1) * 0.7;
              rightArmBend = Math.abs(chaos4) * 0.7;

              // Chaotic legs - BIG MOVEMENTS
              leftFootOffsetX = chaos4 * 1.5;
              rightFootOffsetX = chaos5 * 1.5;
              leftFootOffsetY = chaos5 * 0.8;
              rightFootOffsetY = chaos6 * 0.8;
              leftKneeLift = Math.abs(chaos3) * 0.8;
              rightKneeLift = Math.abs(chaos1) * 0.8;
              leftLegBend = Math.abs(chaos6) * 0.5;
              rightLegBend = Math.abs(chaos2) * 0.5;

              shoulderTwist = chaos2 * 0.3;
            }
            break;
        }

        // Add beat reactivity to everything - AMPLIFIED
        bodyLean += beatPunch * Math.sin(t * 3) * 0.2;
        hipSwayX += beatPunch * 20;
        // Extra bounce on big beats - DRAMATIC
        hipDrop += beatPunch * 0.35;
        leftKneeLift += beatPunch * 0.25;
        rightKneeLift += beatPunch * 0.25;
        // Feet react to beats too
        leftFootOffsetX += beatPunch * Math.sin(t * 2) * 0.3;
        rightFootOffsetX -= beatPunch * Math.sin(t * 2) * 0.3;

        // Smooth the arm/leg transitions
        const smoothSpeed = 0.12;
        const footSpeed = 0.15; // Feet move slightly faster for snappier steps
        danceMoveSmoothL.armAngle = p.lerp(danceMoveSmoothL.armAngle, leftArmAngle, smoothSpeed);
        danceMoveSmoothL.armBend = p.lerp(danceMoveSmoothL.armBend, leftArmBend, smoothSpeed);
        danceMoveSmoothL.legAngle = p.lerp(danceMoveSmoothL.legAngle, leftLegAngle, smoothSpeed);
        danceMoveSmoothL.legBend = p.lerp(danceMoveSmoothL.legBend, leftLegBend, smoothSpeed);
        danceMoveSmoothL.footOffsetX = p.lerp(danceMoveSmoothL.footOffsetX, leftFootOffsetX, footSpeed);
        danceMoveSmoothL.footOffsetY = p.lerp(danceMoveSmoothL.footOffsetY, leftFootOffsetY, footSpeed);
        danceMoveSmoothL.kneeLift = p.lerp(danceMoveSmoothL.kneeLift, leftKneeLift, footSpeed);

        danceMoveSmoothR.armAngle = p.lerp(danceMoveSmoothR.armAngle, rightArmAngle, smoothSpeed);
        danceMoveSmoothR.armBend = p.lerp(danceMoveSmoothR.armBend, rightArmBend, smoothSpeed);
        danceMoveSmoothR.legAngle = p.lerp(danceMoveSmoothR.legAngle, rightLegAngle, smoothSpeed);
        danceMoveSmoothR.legBend = p.lerp(danceMoveSmoothR.legBend, rightLegBend, smoothSpeed);
        danceMoveSmoothR.footOffsetX = p.lerp(danceMoveSmoothR.footOffsetX, rightFootOffsetX, footSpeed);
        danceMoveSmoothR.footOffsetY = p.lerp(danceMoveSmoothR.footOffsetY, rightFootOffsetY, footSpeed);
        danceMoveSmoothR.kneeLift = p.lerp(danceMoveSmoothR.kneeLift, rightKneeLift, footSpeed);

        smoothHipDrop = p.lerp(smoothHipDrop, hipDrop, footSpeed);

        // ========== BUILD THE FIGURE ==========
        const scale = Math.min(p.width, p.height) * 0.0035;
        const headRadius = 35 * scale;
        const neckLength = 15 * scale;
        const torsoLength = 80 * scale;
        const upperArmLength = 45 * scale;
        const lowerArmLength = 40 * scale;
        const upperLegLength = 50 * scale;
        const lowerLegLength = 45 * scale;
        const hipWidth = 20 * scale;
        const shoulderWidth = 30 * scale;

        // Calculate body positions with lean, tilt, sway, and hip drop
        const baseX = centerX + hipSwayX + bodyLean * 50;
        const baseY = centerY + 50 * scale - bounce + hipSwayY + smoothHipDrop * 150 * scale; // 2.5x bigger hip drop

        // Hip position
        const hipX = baseX;
        const hipY = baseY;

        // Foot offset scaling (in pixels) - LARGE values for visible movement
        const footOffsetScale = 120 * scale; // 3x bigger for obvious steps

        // Spine with tilt and twist
        const spineTopX = hipX + bodyTilt * 30 + shoulderTwist * 20;
        const spineTopY = hipY - torsoLength - neckLength;

        // Shoulders
        const leftShoulderX = spineTopX - shoulderWidth + shoulderTwist * 10;
        const leftShoulderY = spineTopY + neckLength;
        const rightShoulderX = spineTopX + shoulderWidth - shoulderTwist * 10;
        const rightShoulderY = spineTopY + neckLength;

        // Head with bob
        const headBob = Math.sin(t * 2) * (5 + beatPunch * 12);
        const headTilt = Math.sin(t * 0.7) * 0.15 + bodyLean * 0.3;
        const headX = spineTopX + Math.sin(headTilt) * headRadius;
        const headY = spineTopY - headRadius + headBob;

        // Hips - adjusted for foot position (weight shift) - MORE DRAMATIC
        const hipWeightShift = (danceMoveSmoothL.footOffsetX - danceMoveSmoothR.footOffsetX) * 15 * scale;
        const leftHipX = hipX - hipWidth + hipWeightShift;
        const leftHipY = hipY;
        const rightHipX = hipX + hipWidth + hipWeightShift;
        const rightHipY = hipY;

        // Define stick figure points
        const stickPoints: { x: number; y: number; size: number }[] = [];

        // HEAD - circle with expression
        for (let i = 0; i < 16; i++) {
          const angle = (i / 16) * Math.PI * 2 + headTilt;
          stickPoints.push({
            x: headX + Math.cos(angle) * headRadius,
            y: headY + Math.sin(angle) * headRadius,
            size: 7 + smoothedBass * 3,
          });
        }

        // NECK
        for (let i = 0; i < 4; i++) {
          const t = i / 3;
          stickPoints.push({
            x: p.lerp(headX, spineTopX, t),
            y: p.lerp(headY + headRadius, spineTopY + neckLength, t),
            size: 8,
          });
        }

        // TORSO - with body wave
        for (let i = 0; i < 12; i++) {
          const t = i / 11;
          const waveOffset = Math.sin(t * Math.PI + syncedFrame * 0.1) * bodyTilt * 15;
          stickPoints.push({
            x: p.lerp(spineTopX, hipX, t) + waveOffset,
            y: p.lerp(spineTopY + neckLength, hipY, t),
            size: 9 + smoothedBass * 4,
          });
        }

        // LEFT ARM - upper
        const lElbowX = leftShoulderX + Math.cos(danceMoveSmoothL.armAngle) * upperArmLength;
        const lElbowY = leftShoulderY + Math.sin(danceMoveSmoothL.armAngle) * upperArmLength;
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          stickPoints.push({
            x: p.lerp(leftShoulderX, lElbowX, t),
            y: p.lerp(leftShoulderY, lElbowY, t),
            size: 7 + midPunch * 3,
          });
        }
        // LEFT ARM - lower (with bend)
        const lHandAngle = danceMoveSmoothL.armAngle + danceMoveSmoothL.armBend * Math.PI * 0.6;
        const lHandX = lElbowX + Math.cos(lHandAngle) * lowerArmLength;
        const lHandY = lElbowY + Math.sin(lHandAngle) * lowerArmLength;
        for (let i = 0; i < 7; i++) {
          const t = i / 6;
          stickPoints.push({
            x: p.lerp(lElbowX, lHandX, t),
            y: p.lerp(lElbowY, lHandY, t),
            size: 6 + midPunch * 2,
          });
        }

        // RIGHT ARM - upper
        const rElbowX = rightShoulderX + Math.cos(danceMoveSmoothR.armAngle) * upperArmLength;
        const rElbowY = rightShoulderY + Math.sin(danceMoveSmoothR.armAngle) * upperArmLength;
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          stickPoints.push({
            x: p.lerp(rightShoulderX, rElbowX, t),
            y: p.lerp(rightShoulderY, rElbowY, t),
            size: 7 + midPunch * 3,
          });
        }
        // RIGHT ARM - lower
        const rHandAngle = danceMoveSmoothR.armAngle + danceMoveSmoothR.armBend * Math.PI * 0.6;
        const rHandX = rElbowX + Math.cos(rHandAngle) * lowerArmLength;
        const rHandY = rElbowY + Math.sin(rHandAngle) * lowerArmLength;
        for (let i = 0; i < 7; i++) {
          const t = i / 6;
          stickPoints.push({
            x: p.lerp(rElbowX, rHandX, t),
            y: p.lerp(rElbowY, rHandY, t),
            size: 6 + midPunch * 2,
          });
        }

        // LEFT LEG - with knee lift and foot offset
        // Calculate target foot position first (where the foot needs to end up)
        const lTargetFootX = leftHipX + danceMoveSmoothL.footOffsetX * footOffsetScale;
        const lTargetFootY = hipY + upperLegLength + lowerLegLength - danceMoveSmoothL.kneeLift * upperLegLength * 3.5
                            + danceMoveSmoothL.footOffsetY * footOffsetScale;

        // When knee is lifted, adjust the leg angles - DRAMATIC lift
        const lKneeLiftAngle = -danceMoveSmoothL.kneeLift * Math.PI * 0.55; // Much bigger angle for visible lift
        const lEffectiveLegAngle = danceMoveSmoothL.legAngle + lKneeLiftAngle;

        // Upper leg - more dramatic shortening when lifted
        const lKneeX = leftHipX + Math.cos(lEffectiveLegAngle) * upperLegLength * (1 - danceMoveSmoothL.kneeLift * 0.4);
        const lKneeY = leftHipY + Math.sin(lEffectiveLegAngle) * upperLegLength * (1 - danceMoveSmoothL.kneeLift * 0.5);

        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          stickPoints.push({
            x: p.lerp(leftHipX, lKneeX, t),
            y: p.lerp(leftHipY, lKneeY, t),
            size: 8 + beatPunch * 3,
          });
        }

        // LEFT LEG - lower (with bend and knee lift)
        // When knee is lifted high, lower leg hangs more dramatically
        const lLiftBend = danceMoveSmoothL.legBend + danceMoveSmoothL.kneeLift * 1.2; // More bend when lifted
        const lFootAngle = lEffectiveLegAngle - lLiftBend * Math.PI * 0.6;
        let lFootX = lKneeX + Math.cos(lFootAngle) * lowerLegLength;
        let lFootY = lKneeY + Math.sin(lFootAngle) * lowerLegLength;

        // Blend toward target foot position when grounded (low knee lift)
        const lGroundBlend = 1 - danceMoveSmoothL.kneeLift;
        lFootX = p.lerp(lFootX, lTargetFootX, lGroundBlend * 0.7); // Stronger blend to target
        lFootY = p.lerp(lFootY, lTargetFootY, lGroundBlend * 0.5);

        for (let i = 0; i < 7; i++) {
          const t = i / 6;
          stickPoints.push({
            x: p.lerp(lKneeX, lFootX, t),
            y: p.lerp(lKneeY, lFootY, t),
            size: 7 + beatPunch * 2,
          });
        }

        // Add foot (small horizontal line at bottom)
        stickPoints.push({ x: lFootX - 8 * scale, y: lFootY, size: 6 });
        stickPoints.push({ x: lFootX + 8 * scale, y: lFootY, size: 6 });

        // RIGHT LEG - with knee lift and foot offset
        const rTargetFootX = rightHipX + danceMoveSmoothR.footOffsetX * footOffsetScale;
        const rTargetFootY = hipY + upperLegLength + lowerLegLength - danceMoveSmoothR.kneeLift * upperLegLength * 3.5
                            + danceMoveSmoothR.footOffsetY * footOffsetScale;

        const rKneeLiftAngle = -danceMoveSmoothR.kneeLift * Math.PI * 0.55; // Match left leg
        const rEffectiveLegAngle = danceMoveSmoothR.legAngle + rKneeLiftAngle;

        const rKneeX = rightHipX + Math.cos(rEffectiveLegAngle) * upperLegLength * (1 - danceMoveSmoothR.kneeLift * 0.4);
        const rKneeY = rightHipY + Math.sin(rEffectiveLegAngle) * upperLegLength * (1 - danceMoveSmoothR.kneeLift * 0.5);

        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          stickPoints.push({
            x: p.lerp(rightHipX, rKneeX, t),
            y: p.lerp(rightHipY, rKneeY, t),
            size: 8 + beatPunch * 3,
          });
        }

        // RIGHT LEG - lower
        const rLiftBend = danceMoveSmoothR.legBend + danceMoveSmoothR.kneeLift * 1.2; // Match left leg
        const rFootAngle = rEffectiveLegAngle - rLiftBend * Math.PI * 0.6;
        let rFootX = rKneeX + Math.cos(rFootAngle) * lowerLegLength;
        let rFootY = rKneeY + Math.sin(rFootAngle) * lowerLegLength;

        const rGroundBlend = 1 - danceMoveSmoothR.kneeLift;
        rFootX = p.lerp(rFootX, rTargetFootX, rGroundBlend * 0.7);
        rFootY = p.lerp(rFootY, rTargetFootY, rGroundBlend * 0.5);

        for (let i = 0; i < 7; i++) {
          const t = i / 6;
          stickPoints.push({
            x: p.lerp(rKneeX, rFootX, t),
            y: p.lerp(rKneeY, rFootY, t),
            size: 7 + beatPunch * 2,
          });
        }

        // Add right foot
        stickPoints.push({ x: rFootX - 8 * scale, y: rFootY, size: 6 });
        stickPoints.push({ x: rFootX + 8 * scale, y: rFootY, size: 6 });

        // FACE - expressive!
        const eyeOffsetX = headRadius * 0.3;
        const eyeOffsetY = headRadius * 0.1;
        // Eyes that look around
        const eyeLookX = Math.sin(slowT) * 3;
        const eyeLookY = Math.cos(slowT * 0.7) * 2;
        stickPoints.push({ x: headX - eyeOffsetX + eyeLookX, y: headY - eyeOffsetY + eyeLookY, size: 10 + beatPunch * 4 });
        stickPoints.push({ x: headX + eyeOffsetX + eyeLookX, y: headY - eyeOffsetY + eyeLookY, size: 10 + beatPunch * 4 });

        // Mouth - big smile that grows on beats
        const smileWidth = headRadius * (0.4 + beatPunch * 0.2);
        const smileCurve = 0.3 + beatPunch * 0.2;
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          const angle = Math.PI * (0.2 + t * 0.6);
          stickPoints.push({
            x: headX + Math.cos(angle) * smileWidth,
            y: headY + headRadius * 0.35 + Math.sin(angle) * smileWidth * smileCurve,
            size: 5,
          });
        }

        // Assign particles to stick figure points with some spread
        particles.forEach((particle, i) => {
          const pointIndex = i % stickPoints.length;
          const point = stickPoints[pointIndex];

          // Add some jitter on beats
          const jitter = bassPeak * 10;
          particle.targetX = point.x + (Math.random() - 0.5) * jitter;
          particle.targetY = point.y + (Math.random() - 0.5) * jitter;
          particle.targetSize = point.size + bassPeak * 8;
        });
      };

      // Secret mode tracking - persists until toggled off
      let inSecretMode = false;

      // Apply targets for a given mode with intensity
      const applyModeTargets = (mode: typeof MODES[number], waveform: Float32Array, intensity: number) => {
        switch (mode) {
          case 'circles': setCircleTargets(waveform, intensity); break;
          case 'waves': setWaveTargets(intensity); break;
          case 'smileyBeard': setSmileyBeardTargets(intensity); break;
          case 'particles': setParticleTargets(intensity); break;
          case 'geometric': setGeometricTargets(intensity); break;
          case 'sneaker': setSneakerTargets(intensity); break;
          case 'breathing': setBreathingTargets(intensity); break;
          case 'pizza': setPizzaTargets(intensity); break;
          case 'orbital': setOrbitalTargets(intensity); break;
          case 'boombox': setBoomboxTargets(intensity); break;
          case 'fractals': setFractalTargets(intensity); break;
          case 'coffeeCup': setCoffeeCupTargets(intensity); break;
          case 'rubberDuck': setRubberDuckTargets(intensity); break;
        }
      };

      // ========== MUSIC-DRIVEN TRANSITION DETECTION ==========

      const detectTransitionTrigger = (bass: number, mid: number, volume: number): { trigger: boolean; intensity: number } => {
        // Update rolling averages (faster adaptation)
        rollingBassAvg = rollingBassAvg * 0.94 + bass * 0.06;
        rollingMidAvg = rollingMidAvg * 0.94 + mid * 0.06;

        // Combined energy metric
        const currentEnergy = bass * 0.5 + mid * 0.3 + volume * 0.2;
        rollingEnergyAvg = rollingEnergyAvg * 0.92 + currentEnergy * 0.08;

        // Track energy history for detecting drops/builds
        energyHistory.push(currentEnergy);
        if (energyHistory.length > ENERGY_HISTORY_SIZE) {
          energyHistory.shift();
        }

        // Calculate energy variance (detecting sudden changes)
        const recentEnergy = energyHistory.slice(-5);
        const avgRecent = recentEnergy.reduce((a, b) => a + b, 0) / recentEnergy.length;
        const oldEnergy = energyHistory.slice(0, 10);
        const avgOld = oldEnergy.length > 0 ? oldEnergy.reduce((a, b) => a + b, 0) / oldEnergy.length : avgRecent;

        // Detect significant energy spike
        const energyDelta = avgRecent - avgOld;
        const bassSpike = bass - rollingBassAvg;

        // Check cooldown
        const framesSinceTransition = syncedFrame - lastTransitionFrame;
        const cooldownMet = framesSinceTransition > minTransitionCooldown;

        // Multiple trigger conditions - any significant musical event
        let trigger = false;
        let intensity = 0;

        // 1. Bass spike (significant beat hit)
        if (cooldownMet && bassSpike > nextTriggerThreshold) {
          trigger = true;
          intensity = Math.min(1, bassSpike / 0.25);
        }

        // 2. Energy drop then spike (build-up release)
        if (cooldownMet && energyDelta > 0.12 && avgOld < 0.35) {
          trigger = true;
          intensity = Math.min(1, energyDelta / 0.2);
        }

        // 3. Sustained energy - gradual evolution after phrases
        if (cooldownMet && framesSinceTransition > 300 && currentEnergy > 0.35) {
          trigger = true;
          intensity = 0.6 + currentEnergy * 0.4;
        }

        // 4. FALLBACK: Force transition if too long without one (keeps variety)
        if (framesSinceTransition > maxFramesWithoutTransition) {
          trigger = true;
          intensity = 0.5 + currentEnergy * 0.5;
        }

        if (trigger) {
          // Reset for next transition with randomized threshold
          nextTriggerThreshold = 0.12 + Math.random() * 0.1;
          // Long cooldowns so modes stick around (9-15 seconds)
          minTransitionCooldown = 540 + Math.floor(intensity * 180) + Math.floor(Math.random() * 120);
        }

        return { trigger, intensity };
      };

      // ========== MAIN DRAW LOOP ==========

      p.draw = () => {
        // ========== SERVER SYNC INITIALIZATION ==========
        // On first frame with sync data, jump to the correct visual state
        if (!hasInitializedSync && serverElapsedTimeRef.current !== null) {
          hasInitializedSync = true;
          const elapsed = serverElapsedTimeRef.current;

          // Calculate frame offset (60fps assumed)
          frameOffset = Math.floor(elapsed * 60);

          // Calculate which mode we should be in
          // Average transition period is ~12 seconds (720 frames)
          // Mode progression: each mode lasts roughly 12 seconds
          const AVG_MODE_DURATION = 12; // seconds
          currentModeIndex = Math.floor(elapsed / AVG_MODE_DURATION) % MODES.length;

          // Set lastTransitionFrame so we don't immediately transition
          lastTransitionFrame = frameOffset - 300; // Pretend we transitioned 5 seconds ago

          console.log(`[VISUAL SYNC] Elapsed: ${elapsed.toFixed(2)}s, Frame offset: ${frameOffset}, Mode: ${MODES[currentModeIndex]} (${currentModeIndex})`);
        }

        // Update synced frame count (real frames + offset from server time)
        // This is used for all visual timing to keep clients in sync
        syncedFrame = p.frameCount + frameOffset;

        const audioData = getAudioData();
        const { waveform, bass, mid, high, volume } = audioData;

        // Smoothing - balanced for reactivity
        smoothedBass = p.lerp(smoothedBass, bass, 0.35);
        smoothedMid = p.lerp(smoothedMid, mid, 0.4);
        smoothedHigh = p.lerp(smoothedHigh, high, 0.35);
        smoothedVolume = p.lerp(smoothedVolume, volume, 0.4);

        // Peak detection
        bassPeak = bass > smoothedBass + 0.04 ? bass - smoothedBass : bassPeak * 0.8;
        midPeak = mid > smoothedMid + 0.04 ? mid - smoothedMid : midPeak * 0.8;

        // ========== KICK DETECTION - MULTI-BAND ==========
        const bassKickThreshold = 0.03;
        const midKickThreshold = 0.05; // Also detect mid-frequency hits (snares, toms)
        const framesSinceKick = p.frameCount - lastKickFrame;
        const kickCooldown = 4; // ~15 kicks per second max

        kickDetected = false;

        // Detect bass kicks - TASTEFUL zoom (reduced 35%)
        if (bass > smoothedBass + bassKickThreshold && framesSinceKick > kickCooldown) {
          kickDetected = true;
          kickIntensity = Math.min(1, (bass - smoothedBass) / 0.12);
          kickDecay = 1.0;
          lastKickFrame = p.frameCount;
          zoomPulse = 0.018 + kickIntensity * 0.032; // Was 0.03 + 0.05
        }

        // Also detect mid-frequency hits (catches snares, hi-hats, rapid percussion)
        if (mid > smoothedMid + midKickThreshold && framesSinceKick > kickCooldown) {
          kickDetected = true;
          const midIntensity = Math.min(1, (mid - smoothedMid) / 0.15);
          kickIntensity = Math.max(kickIntensity, midIntensity * 0.6);
          kickDecay = Math.max(kickDecay, 0.7);
          lastKickFrame = p.frameCount;
          zoomPulse = Math.max(zoomPulse, 0.012 + midIntensity * 0.02); // Was 0.02 + 0.03
        }

        // Decay
        kickDecay *= 0.85;
        zoomPulse *= 0.88;

        // ========== MUSIC-DRIVEN TRANSITION LOGIC ==========

        const { trigger, intensity } = detectTransitionTrigger(bass, mid, volume);

        if (trigger && transitionProgress >= 0.95) {
          // Trigger new transition!
          currentModeIndex = (currentModeIndex + 1) % MODES.length;
          transitionProgress = 0;
          // Slow transition: 5-8 seconds to complete (20% faster than before)
          transitionSpeed = 0.0018 + intensity * 0.0012;
          lastTransitionFrame = syncedFrame;
        }

        // Progress the transition
        if (transitionProgress < 1) {
          transitionProgress = Math.min(1, transitionProgress + transitionSpeed);
        }

        // Calculate reactivity intensity (current audio energy affects how responsive particles are)
        const reactivityIntensity = 0.5 + smoothedBass * 0.5 + bassPeak * 0.5;

        // ========== SECRET MODE CHECK ==========
        // Sync internal state with external prop (toggle on/off via Konami code)
        if (secretModeActiveRef.current && !inSecretMode) {
          inSecretMode = true;
          console.log('[SECRET] Dancing stick figure mode activated!');
        } else if (!secretModeActiveRef.current && inSecretMode) {
          inSecretMode = false;
          console.log('[SECRET] Returning to normal modes');
        }

        // Apply current mode targets (secret mode overrides normal modes)
        if (inSecretMode) {
          setStickFigureTargets(reactivityIntensity);
        } else {
          const currentMode = MODES[currentModeIndex];
          applyModeTargets(currentMode, waveform, reactivityIntensity);
        }

        // ========== PARTICLE MORPHING ==========

        // TWO SPEEDS:
        // 1. Slow base morphing for languid transformations (5-8 seconds)
        // 2. Quick beat-reactive pulses layered on top

        // EASED morph speed - slow at start/middle, speeds up at the end
        // This creates that "savoring the transformation" feel (20% faster overall)
        let morphLerpSpeed: number;
        // SECRET MODE uses faster morph speeds
        if (inSecretMode) {
          morphLerpSpeed = 0.12; // Fast morph for special modes
        } else if (transitionProgress < 0.6) {
          // First 60% of transition: crawling slow
          morphLerpSpeed = 0.0036;
        } else if (transitionProgress < 0.85) {
          // 60-85%: gradually picking up
          const t = (transitionProgress - 0.6) / 0.25;
          morphLerpSpeed = 0.0036 + t * 0.006;
        } else {
          // Final 85-100%: settling into place
          const t = (transitionProgress - 0.85) / 0.15;
          morphLerpSpeed = 0.0096 + t * 0.0084;
        }

        // Morph background color
        const colorLerpSpeed = morphLerpSpeed * 0.8;
        bgHue = p.lerp(bgHue, targetBgHue, colorLerpSpeed);
        bgSat = p.lerp(bgSat, targetBgSat, colorLerpSpeed);
        bgBright = p.lerp(bgBright, targetBgBright, colorLerpSpeed * 1.2);

        // ========== SCREEN ZOOM EFFECT ==========
        // Apply zoom transformation centered on screen
        p.push();
        const zoomScale = 1 + zoomPulse;
        p.translate(p.width / 2, p.height / 2);
        p.scale(zoomScale);
        p.translate(-p.width / 2, -p.height / 2);

        // Draw background - subtle brightness flash on kicks
        const kickBrightnessBoost = kickDecay * 15;
        p.background(bgHue, bgSat, bgBright + kickBrightnessBoost);

        // Update and draw particles
        p.noStroke();

        // Calculate beat reactivity - tasteful but visible
        const isTransitioning = transitionProgress < 1;
        const transitionBeatBoost = isTransitioning ? 1.5 : 1.0;
        const kickBoost = 2.0 + kickIntensity * 2.5;

        // Decay repulsion force
        repulsionForce *= REPULSION_DECAY;

        // Check if mouse is still active (moved in last 60 frames = ~1 second)
        if (p.frameCount - lastMouseMove > 60) {
          isMouseActive = false;
        }

        particles.forEach((particle) => {
          // Organic noise for fluid feel during transitions
          const noiseScale = isTransitioning ? (1 - transitionProgress) * 15 : 5;
          const noiseX = (p.noise(particle.noiseOffsetX + syncedFrame * 0.008) - 0.5) * noiseScale;
          const noiseY = (p.noise(particle.noiseOffsetY + syncedFrame * 0.008) - 0.5) * noiseScale;

          // ========== CURSOR INTERACTION ==========
          let cursorForceX = 0;
          let cursorForceY = 0;

          // Local cursor attraction
          if (isMouseActive) {
            const dx = mouseX - particle.x;
            const dy = mouseY - particle.y;
            const distToCursor = Math.sqrt(dx * dx + dy * dy);

            if (distToCursor < CURSOR_RADIUS && distToCursor > 1) {
              // Stronger attraction when closer (inverse distance)
              const strength = (1 - distToCursor / CURSOR_RADIUS) * CURSOR_STRENGTH;
              cursorForceX += (dx / distToCursor) * strength * 30;
              cursorForceY += (dy / distToCursor) * strength * 30;
            }
          }

          // Click/tap repulsion burst
          if (repulsionForce > 1) {
            const dx = particle.x - repulsionX;
            const dy = particle.y - repulsionY;
            const distToClick = Math.sqrt(dx * dx + dy * dy);

            if (distToClick < CURSOR_RADIUS * 2 && distToClick > 1) {
              // Push away from click point
              const pushStrength = (repulsionForce / REPULSION_STRENGTH) * (1 - distToClick / (CURSOR_RADIUS * 2));
              cursorForceX += (dx / distToClick) * pushStrength * 15;
              cursorForceY += (dy / distToClick) * pushStrength * 15;
            }
          }

          // Other users' cursor attraction
          const others = getOtherUsersRef.current ? getOtherUsersRef.current() : [];

          // Debug: log other users once every 2 seconds (only for first particle)
          if (particle.index === 0 && p.frameCount % 120 === 0) {
            if (others.length > 0) {
              console.log(`[CURSORS] ${others.length} other users affecting particles:`, others.map(u => `(${(u.x * p.width).toFixed(0)}, ${(u.y * p.height).toFixed(0)})`));
            } else {
              console.log(`[CURSORS] No other users found. getOtherUsersRef.current exists: ${!!getOtherUsersRef.current}`);
            }
          }

          others.forEach((user) => {
            const ux = user.x * p.width;
            const uy = user.y * p.height;
            const dx = ux - particle.x;
            const dy = uy - particle.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < CURSOR_RADIUS && dist > 1) {
              // Same strength as local cursor - all users have equal effect
              const strength = (1 - dist / CURSOR_RADIUS) * CURSOR_STRENGTH;
              cursorForceX += (dx / dist) * strength * 30;
              cursorForceY += (dy / dist) * strength * 30;
            }
          });

          // Apply cursor forces to particle position
          particle.x += cursorForceX;
          particle.y += cursorForceY;

          // SLOW morph toward target position (languid transformation)
          particle.x = p.lerp(particle.x, particle.targetX + noiseX, morphLerpSpeed);
          particle.y = p.lerp(particle.y, particle.targetY + noiseY, morphLerpSpeed);
          particle.size = p.lerp(particle.size, particle.targetSize, morphLerpSpeed * 0.8);

          // ========== TASTEFUL KICK DISPLACEMENT (reduced ~35%) ==========
          const centerX = p.width / 2;
          const centerY = p.height / 2;
          const distFromCenter = p.dist(particle.x, particle.y, centerX, centerY);
          const maxDist = Math.max(p.width, p.height) * 0.5;
          const radialFactor = 0.3 + (distFromCenter / maxDist) * 0.7;

          // Direction from center for radial burst
          const angleFromCenter = p.atan2(particle.y - centerY, particle.x - centerX);

          // KICK-DRIVEN burst - tasteful displacement
          const kickBurstStrength = kickDecay * kickBoost * 25 * radialFactor; // Was 60

          // Continuous bassPeak response
          const bassBurstStrength = bassPeak * 20 * transitionBeatBoost * radialFactor; // Was 40

          const totalBurst = kickBurstStrength + bassBurstStrength;

          // Radial push outward from center
          const burstX = p.cos(angleFromCenter) * totalBurst;
          const burstY = p.sin(angleFromCenter) * totalBurst;

          // Subtle jitter on kicks
          const jitterScale = kickDecay * 20 + bassPeak * 15; // Was 40/30
          const jitterX = (p.noise(particle.noiseOffsetX * 2 + syncedFrame * 0.1) - 0.5) * jitterScale;
          const jitterY = (p.noise(particle.noiseOffsetY * 2 + syncedFrame * 0.1) - 0.5) * jitterScale;

          const displayX = particle.x + burstX + jitterX;
          const displayY = particle.y + burstY + jitterY;

          // Size pulse on kicks - reduced
          const kickSizeBoost = kickDecay * kickBoost * 4; // Was 8
          const bassSizeBoost = bassPeak * 6 * transitionBeatBoost; // Was 12
          const displaySize = particle.size + kickSizeBoost + bassSizeBoost;

          // Hue shifts on kicks - subtler
          const kickHueShift = kickDecay * 60; // Was 120
          const hue = (particle.hue + syncedFrame * 0.2 + smoothedBass * 30 + kickHueShift) % 360;

          // ========== PARTICLE GLOW - TASTEFUL ==========
          // Multiple glow layers emanating FROM the particle outward

          // Outer glow halo - reduced expansion
          const outerGlowSize = displaySize * (3 + kickDecay * kickBoost * 1.2); // Was 4 + 3
          const outerGlowAlpha = 0.06 + kickDecay * 0.15; // Was 0.08 + 0.25
          p.fill(hue, 40, 100, outerGlowAlpha);
          p.ellipse(displayX, displayY, outerGlowSize, outerGlowSize);

          // Middle glow - brighter, tighter
          const midGlowSize = displaySize * (2 + kickDecay * kickBoost * 0.6); // Was 2.5 + 1.5
          const midGlowAlpha = 0.12 + kickDecay * 0.25 + bassPeak * 0.12; // Was 0.15 + 0.4 + 0.2
          p.fill(hue, 50, 100, midGlowAlpha);
          p.ellipse(displayX, displayY, midGlowSize, midGlowSize);

          // Inner glow - reduced
          const innerGlowSize = displaySize * (1.3 + kickDecay * 0.4); // Was 1.5 + 0.8
          const innerGlowAlpha = 0.18 + kickDecay * 0.25; // Was 0.25 + 0.5
          p.fill(hue, 30, 100, innerGlowAlpha);
          p.ellipse(displayX, displayY, innerGlowSize, innerGlowSize);

          // Main particle core - subtler white shift on kicks
          const coreSaturation = 65 - kickDecay * 20; // Was 60 - 40
          const coreBrightness = 90 + kickDecay * 5; // Was + 10
          const coreAlpha = 0.9;
          p.fill(hue, coreSaturation, coreBrightness, coreAlpha);
          p.ellipse(displayX, displayY, displaySize, displaySize);
        });

        // ========== CONNECTION LINES - TASTEFUL ==========
        if (kickDecay > 0.15 || bassPeak > 0.12) {
          const lineAlpha = Math.max(kickDecay * 0.4, bassPeak * 0.25) * transitionBeatBoost; // Was 0.7/0.4
          const lineWeight = 1 + kickDecay * 2 + bassPeak * 1; // Was + 4 + 2
          p.stroke((bgHue + 60) % 360, 40, 100, lineAlpha);
          p.strokeWeight(lineWeight);

          // Connect particles on beats
          const skipAmount = kickDecay > 0.3 ? 4 : 8; // Was 3/6
          const maxDistThreshold = kickDecay > 0.3 ? 250 : 180; // Was 350/200

          for (let i = 0; i < particles.length; i += skipAmount) {
            const p1 = particles[i];
            const p2 = particles[(i + 1) % particles.length];
            const dist = p.dist(p1.x, p1.y, p2.x, p2.y);
            if (dist < maxDistThreshold) {
              p.line(p1.x, p1.y, p2.x, p2.y);
            }
          }
        }

        // ========== SUBTLE AMBIENT GLOW ==========
        if (kickDecay > 0.25) {
          p.noStroke();
          const vignetteAlpha = kickDecay * 0.08; // Was 0.15
          p.fill((bgHue + 30) % 360, 20, 100, vignetteAlpha);
          const vignetteSize = Math.max(p.width, p.height) * 1.5; // Was 2
          p.ellipse(p.width / 2, p.height / 2, vignetteSize, vignetteSize);
        }

        // Extra explosion effect during transition trigger
        if (transitionProgress < 0.3) {
          const explosionIntensity = (0.3 - transitionProgress) / 0.3;
          p.noStroke();
          p.fill((bgHue + 180) % 360, 60, 100, explosionIntensity * 0.2);
          const explosionSize = explosionIntensity * Math.max(p.width, p.height) * 0.5;
          p.ellipse(p.width / 2, p.height / 2, explosionSize, explosionSize);
        }

        // Close the zoom transformation
        p.pop();

        // ========== OTHER USERS' CURSORS ==========
        // Draw after pop() so cursors aren't affected by zoom
        const others = getOtherUsersRef.current ? getOtherUsersRef.current() : [];
        if (others.length > 0) {
          others.forEach((user) => {
            try {
              const ux = user.x * p.width;
              const uy = user.y * p.height;

              // Parse HSL color: "hsl(180, 80%, 60%)" -> extract hue
              const hslMatch = user.color.match(/hsl\((\d+)/);
              const userHue = hslMatch ? parseInt(hslMatch[1]) : 180;

              // Outer glow (using HSB mode)
              p.noStroke();
              p.fill(userHue, 60, 100, 0.25);
              p.ellipse(ux, uy, 40, 40);

              // Inner cursor dot
              p.fill(userHue, 80, 90, 0.9);
              p.ellipse(ux, uy, 12, 12);

              // White center
              p.fill(0, 0, 100, 0.8);
              p.ellipse(ux, uy, 4, 4);
            } catch (err) {
              // Skip this cursor if there's an error
              console.warn('Cursor render error:', err);
            }
          });
        }

        // ========== DEBUG DISPLAY ==========
        if (DEBUG) {
          p.push();
          p.fill(255);
          p.noStroke();
          p.textSize(14);
          p.textAlign(p.LEFT, p.TOP);

          const debugY = 20;
          p.fill(0, 0, 0, 0.5);
          p.rect(10, 10, 200, 120, 5);

          p.fill(255);
          p.text(`Bass: ${bass.toFixed(3)}`, 20, debugY);
          p.text(`Smoothed: ${smoothedBass.toFixed(3)}`, 20, debugY + 18);
          p.text(`BassPeak: ${bassPeak.toFixed(3)}`, 20, debugY + 36);
          p.text(`KickDecay: ${kickDecay.toFixed(3)}`, 20, debugY + 54);
          p.text(`Kicks: ${kickDetected ? 'KICK!' : '-'}`, 20, debugY + 72);
          p.text(`Zoom: ${zoomPulse.toFixed(3)}`, 20, debugY + 90);

          // Visual bass meter
          p.fill(0, 100, 100);
          p.rect(20, debugY + 108, bass * 180, 8);
          p.noFill();
          p.stroke(255);
          p.rect(20, debugY + 108, 180, 8);

          p.pop();
        }
      };
    };

    p5Ref.current = new p5(sketch, containerRef.current);

    return () => {
      p5Ref.current?.remove();
    };
  }, [getAudioData, isPlaying]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
      }}
    />
  );
}
