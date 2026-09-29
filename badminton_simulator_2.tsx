import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, 
  RotateCcw, Play, RefreshCw, Volume2, VolumeX, 
  Target, Info, Compass, Sparkles, Layers, Award, Trash2
} from 'lucide-react';

const trackEvent = (eventName, eventData = {}) => {
  try {
    if (typeof window !== 'undefined' && window?.umami?.track) {
      window.umami.track(eventName, eventData);
    }
  } catch (err) {
    console.debug('Analytics event tracked silently:', eventName, err);
  }
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playHit(type = 'Smash') {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    const bufferSize = this.ctx.sampleRate * 0.08;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';

    if (type === 'Smash') {
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.06);
      gain.gain.setValueAtTime(0.8, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      noiseFilter.frequency.setValueAtTime(1200, t);
    } else if (type === 'Clear') {
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(100, t + 0.08);
      gain.gain.setValueAtTime(0.6, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      noiseFilter.frequency.setValueAtTime(800, t);
    } else {
      osc.frequency.setValueAtTime(200, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.04);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      noiseFilter.frequency.setValueAtTime(400, t);
    }

    osc.connect(gain);
    whiteNoise.connect(noiseFilter);
    noiseFilter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    whiteNoise.start(t);
    osc.stop(t + 0.1);
    whiteNoise.stop(t + 0.1);
  }

  playWhistle() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, t);
    osc.frequency.setValueAtTime(2600, t + 0.05);
    osc.frequency.setValueAtTime(2400, t + 0.1);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.25);
  }
}

const audio = new AudioEngine();

const COURT_METERS = {
  length: 13.40,
  width: 6.10,
  singlesWidth: 5.18,
  sideAlley: 0.46,
  shortServiceDist: 1.98,
  doublesLongServiceDist: 0.76,
};

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 650;

// Deep Dark Blue matching the arrow key panel
const DEEP_BLUE_BG = "#090d16";

// Green Court Mat Boundary Coordinates (The red outlined area)
const MAT_X = 60;
const MAT_Y = 50;
const MAT_W = 880;
const MAT_H = 550;

// Inner White Court Lines Coordinates
const COURT_X = 120;
const COURT_Y = 100;
const COURT_W = 760;
const COURT_H = 450;

const METERS_PER_PX_Y = COURT_METERS.width / COURT_H;

const SIDE_ALLEY_PX = (COURT_METERS.sideAlley / COURT_METERS.width) * COURT_H;
const SHORT_SERVICE_PX = (COURT_METERS.shortServiceDist / COURT_METERS.length) * COURT_W;
const DOUBLES_LONG_PX = (COURT_METERS.doublesLongServiceDist / COURT_METERS.length) * COURT_W;

export default function BadmintonSimulator() {
  const [dotPos, setDotPos] = useState({ x: 740, y: 210 });
  const [pressedKeys, setPressedKeys] = useState({});
  const [mode, setMode] = useState('doubles');
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [shotType, setShotType] = useState('Smash');
  const [shotPower, setShotPower] = useState(80);
  const [isSimulating, setIsSimulating] = useState(false);
  const [arcHeight, setArcHeight] = useState(0);
  
  const [shotTrail, setShotTrail] = useState([]);
  const [score, setScore] = useState({ in: 0, out: 0 });

  // References to keep track of key states, stop timeouts, and latest dot position for debounced landing checks
  const isMovingRef = useRef(false);
  const stopTimeoutRef = useRef(null);
  const latestDotPosRef = useRef({ x: 740, y: 210 });
  const latestModeRef = useRef('doubles');

  const animRef = useRef(null);
  const containerRef = useRef(null);

  // Keep latest mode ref updated
  useEffect(() => {
    latestModeRef.current = mode;
  }, [mode]);

  const getLineJudgeStatus = useCallback((x, y, currentMode) => {
    const isXInOuter = x >= COURT_X && x <= COURT_X + COURT_W;
    const isYInOuter = y >= COURT_Y && y <= COURT_Y + COURT_H;

    if (!isXInOuter || !isYInOuter) {
      let dx = 0;
      if (x < COURT_X) dx = COURT_X - x;
      else if (x > COURT_X + COURT_W) dx = x - (COURT_X + COURT_W);

      let dy = 0;
      if (y < COURT_Y) dy = COURT_Y - y;
      else if (y > COURT_Y + COURT_H) dy = y - (COURT_Y + COURT_H);

      const distFromBoundary = Math.sqrt(dx * dx + dy * dy);
      const outDistanceCm = (distFromBoundary * METERS_PER_PX_Y * 100).toFixed(1);
      return { status: 'OUT', code: 'OUT_OF_BOUNDS', line: `Outside Court Lines (${outDistanceCm} cm out)` };
    }

    const topSinglesLine = COURT_Y + SIDE_ALLEY_PX;
    const bottomSinglesLine = COURT_Y + COURT_H - SIDE_ALLEY_PX;

    if (currentMode === 'singles') {
      if (y < topSinglesLine || y > bottomSinglesLine) {
        const outDist = Math.min(Math.abs(y - topSinglesLine), Math.abs(y - bottomSinglesLine));
        const outDistCm = (outDist * METERS_PER_PX_Y * 100).toFixed(1);
        return { status: 'OUT', code: 'SIDE_OUT', line: `Outside Singles Line (${outDistCm} cm out)` };
      }
    }

    const distLeft = Math.abs(x - COURT_X);
    const distRight = Math.abs(x - (COURT_X + COURT_W));
    const minYBoundary = currentMode === 'singles' ? topSinglesLine : COURT_Y;
    const maxYBoundary = currentMode === 'singles' ? bottomSinglesLine : COURT_Y + COURT_H;
    
    const distTop = Math.abs(y - minYBoundary);
    const distBottom = Math.abs(y - maxYBoundary);

    const minDistancePx = Math.min(distLeft, distRight, distTop, distBottom);
    const minDistanceCm = (minDistancePx * METERS_PER_PX_Y * 100).toFixed(1);

    if (minDistancePx <= 4) {
      return { status: 'IN', code: 'LINE_CALL', line: `On Boundary Line (${minDistanceCm} cm)`, isLineCall: true };
    }

    return { status: 'IN', code: 'IN_BOUNDS', line: `Inside Court (${minDistanceCm} cm to line)` };
  }, []);

  const currentStatus = getLineJudgeStatus(dotPos.x, dotPos.y, mode);

  // Helper function to tally score
  const recordLandingPoint = useCallback((pos, currentMode) => {
    const judge = getLineJudgeStatus(pos.x, pos.y, currentMode);
    setScore((prev) => ({
      in: judge.status === 'IN' ? prev.in + 1 : prev.in,
      out: judge.status === 'OUT' ? prev.out + 1 : prev.out,
    }));
  }, [getLineJudgeStatus]);

  // Handle keyboard movement and detect when user stops moving dot
  useEffect(() => {
    const handleKeyDown = (e) => {
      const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (arrowKeys.includes(e.key)) {
        e.preventDefault();

        setPressedKeys((prev) => ({ ...prev, [e.key]: true }));
        isMovingRef.current = true;

        // Clear any pending movement stop detection
        if (stopTimeoutRef.current) {
          clearTimeout(stopTimeoutRef.current);
        }

        const STEP = 5; // 5px precision step
        setDotPos((prev) => {
          let nx = prev.x;
          let ny = prev.y;

          if (e.key === 'ArrowUp') ny = Math.max(10, prev.y - STEP);
          if (e.key === 'ArrowDown') ny = Math.min(CANVAS_HEIGHT - 10, prev.y + STEP);
          if (e.key === 'ArrowLeft') nx = Math.max(10, prev.x - STEP);
          if (e.key === 'ArrowRight') nx = Math.min(CANVAS_WIDTH - 10, prev.x + STEP);

          const newPos = { x: nx, y: ny };
          latestDotPosRef.current = newPos;
          return newPos;
        });

        trackEvent('dot_moved_keyboard', { key: e.key });
      }
    };

    const handleKeyUp = (e) => {
      const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (arrowKeys.includes(e.key)) {
        setPressedKeys((prev) => {
          const next = { ...prev, [e.key]: false };
          
          // Check if all arrow keys are released
          const anyKeyPressed = Object.values(next).some(Boolean);
          if (!anyKeyPressed && isMovingRef.current) {
            // Set a short debounce timeout to confirm user has stopped moving completely
            if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
            stopTimeoutRef.current = setTimeout(() => {
              isMovingRef.current = false;
              recordLandingPoint(latestDotPosRef.current, latestModeRef.current);
              trackEvent('manual_movement_stopped', { 
                pos: latestDotPosRef.current, 
                mode: latestModeRef.current 
              });
            }, 300);
          }

          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    };
  }, [recordLandingPoint]);

  const triggerShotSimulation = (targetX = null, targetY = null) => {
    if (isSimulating) return;

    const startPos = { x: COURT_X + 80, y: CANVAS_HEIGHT / 2 };
    
    // Bounds for the green area (Red outline region)
    const minGreenX = MAT_X + 10;
    const maxGreenX = MAT_X + MAT_W - 10;
    const minGreenY = MAT_Y + 10;
    const maxGreenY = MAT_Y + MAT_H - 10;

    let destPos = { x: dotPos.x, y: dotPos.y };

    if (targetX !== null && targetY !== null) {
      destPos = { 
        x: Math.max(minGreenX, Math.min(maxGreenX, targetX)), 
        y: Math.max(minGreenY, Math.min(maxGreenY, targetY)) 
      };
    } else {
      const powerFactor = shotPower / 100;
      let baseLandingX = COURT_X + COURT_W * (0.55 + powerFactor * 0.48); 
      let baseLandingY = CANVAS_HEIGHT / 2 + (Math.random() - 0.5) * (COURT_H * 0.95 * powerFactor);

      if (shotType === 'Clear') {
        baseLandingX = COURT_X + COURT_W * (0.68 + powerFactor * 0.42);
      } else if (shotType === 'Smash') {
        baseLandingX = COURT_X + COURT_W * (0.48 + powerFactor * 0.45);
      } else if (shotType === 'Drop') {
        baseLandingX = COURT_X + COURT_W * 0.53 + (Math.random() - 0.5) * 80;
      } else if (shotType === 'Drive') {
        baseLandingX = COURT_X + COURT_W * (0.6 + powerFactor * 0.38);
      } else if (shotType === 'Net Shot') {
        baseLandingX = COURT_X + COURT_W * 0.52 + (Math.random() - 0.5) * 40;
      }

      destPos = {
        x: Math.max(minGreenX, Math.min(maxGreenX, baseLandingX)),
        y: Math.max(minGreenY, Math.min(maxGreenY, baseLandingY))
      };
    }

    setIsSimulating(true);

    if (soundEnabled) audio.playHit(shotType);

    let peakArc = 80;
    if (shotType === 'Clear') peakArc = 180;
    if (shotType === 'Drop') peakArc = 120;
    if (shotType === 'Smash') peakArc = 35;
    if (shotType === 'Drive') peakArc = 20;
    if (shotType === 'Net Shot') peakArc = 45;

    const startTime = performance.now();
    const duration = Math.max(400, 1200 - shotPower * 8);

    const animateFrame = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      const curX = startPos.x + (destPos.x - startPos.x) * progress;
      const curY = startPos.y + (destPos.y - startPos.y) * progress;
      const currentHeight = Math.sin(progress * Math.PI) * peakArc;

      const newPos = { x: curX, y: curY };
      setDotPos(newPos);
      latestDotPosRef.current = newPos;
      setArcHeight(currentHeight);

      if (progress < 1) {
        animRef.current = requestAnimationFrame(animateFrame);
      } else {
        setIsSimulating(false);
        setArcHeight(0);

        if (soundEnabled) audio.playWhistle();

        // Increment IN or OUT count upon landing
        recordLandingPoint(destPos, mode);

        setShotTrail((prev) => [...prev.slice(-4), { start: startPos, end: destPos, peak: peakArc }]);

        const judge = getLineJudgeStatus(destPos.x, destPos.y, mode);
        trackEvent('shot_simulated', { type: shotType, power: shotPower, result: judge.status });
      }
    };

    animRef.current = requestAnimationFrame(animateFrame);
  };

  const handleCourtClick = (e) => {
    if (isSimulating) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();

    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;

    const clickedX = (e.clientX - rect.left) * scaleX;
    const clickedY = (e.clientY - rect.top) * scaleY;

    triggerShotSimulation(clickedX, clickedY);
  };

  const handleManualMove = (dx, dy) => {
    setDotPos((prev) => {
      const nx = Math.max(10, Math.min(CANVAS_WIDTH - 10, prev.x + dx));
      const ny = Math.max(10, Math.min(CANVAS_HEIGHT - 10, prev.y + dy));
      const newPos = { x: nx, y: ny };
      latestDotPosRef.current = newPos;

      // Trigger debounced stop check for manual on-screen button movement
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = setTimeout(() => {
        recordLandingPoint(newPos, latestModeRef.current);
      }, 300);

      return newPos;
    });
  };

  const resetPosition = () => {
    setDotPos({ x: 740, y: 210 });
    latestDotPosRef.current = { x: 740, y: 210 };
    setShotTrail([]);
    trackEvent('reset_position');
  };

  const resetStats = () => {
    setScore({ in: 0, out: 0 });
    trackEvent('reset_stats');
  };

  const generateRandomShot = () => {
    const minGreenX = MAT_X + 15;
    const maxGreenX = MAT_X + MAT_W - 15;
    const minGreenY = MAT_Y + 15;
    const maxGreenY = MAT_Y + MAT_H - 15;

    const randX = minGreenX + Math.random() * (maxGreenX - minGreenX);
    const randY = minGreenY + Math.random() * (maxGreenY - minGreenY);
    triggerShotSimulation(randX, randY);
  };

  return (
    <div className="flex flex-col md:flex-row w-screen h-screen bg-[#090d16] text-slate-100 font-sans overflow-hidden select-none">
      
      {/* Sidebar Controls */}
      <aside className="w-full md:w-80 lg:w-96 bg-[#090d16] border-r border-slate-800/80 flex flex-col justify-between shrink-0 h-auto md:h-full z-20 shadow-2xl overflow-y-auto">
        
        {/* Header & Logo */}
        <div className="p-4 border-b border-slate-800/80 bg-[#060910] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-inner">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-base text-white tracking-wide leading-none">Badminton Simulator</h1>
              <p className="text-xs text-slate-400 mt-1">Court Judge & Trajectory Physics</p>
            </div>
          </div>
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 transition-colors border border-slate-800"
            title={soundEnabled ? "Mute SFX" : "Enable SFX"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>
        </div>

        {/* Control Panel Body */}
        <div className="p-4 space-y-5 flex-1">

          {/* REFEREE CALL BADGE DISPLAY & COUNTERS */}
          <div className="bg-[#05080f] rounded-xl p-3.5 border border-slate-800/80 shadow-inner space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-emerald-400" /> Line Judge Call
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                {mode.toUpperCase()}
              </span>
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <div className="flex items-center gap-3">
                <div className={`px-4 py-1.5 rounded-lg text-lg font-black tracking-wider shadow-lg flex items-center gap-2 ${
                  currentStatus.status === 'IN' 
                    ? currentStatus.isLineCall 
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50' 
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/50'
                }`}>
                  <span className={`w-2.5 h-2.5 rounded-full animate-ping ${
                    currentStatus.status === 'IN' ? 'bg-emerald-400' : 'bg-rose-500'
                  }`} />
                  {currentStatus.status === 'IN' ? (currentStatus.isLineCall ? 'LINE CALL' : 'IN') : 'OUT'}
                </div>
              </div>

              {/* Tally Stats Display */}
              <div className="flex items-center gap-2.5 text-xs font-mono bg-[#090d16] px-3 py-2 rounded-lg border border-slate-800">
                <div className="text-emerald-400 font-bold"><span className="text-slate-500 font-normal mr-1">IN:</span>{score.in}</div>
                <div className="text-slate-700">|</div>
                <div className="text-rose-400 font-bold"><span className="text-slate-500 font-normal mr-1">OUT:</span>{score.out}</div>
              </div>
            </div>

            <p className="text-xs text-slate-400 font-mono truncate">
              {currentStatus.line}
            </p>

            {/* Reset Counter Button */}
            <div className="pt-1 flex items-center justify-between border-t border-slate-800/60">
              <span className="text-[11px] text-slate-500">Landing Point Tracker</span>
              <button
                onClick={resetStats}
                className="px-2.5 py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-rose-400 hover:text-rose-300 rounded-md border border-slate-800 transition-colors flex items-center gap-1.5"
                title="Reset IN and OUT tally"
              >
                <Trash2 className="w-3 h-3" /> Reset Counters
              </button>
            </div>
          </div>

          {/* SINGLES / DOUBLES TOGGLE */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-emerald-400" /> Match Format Mode
            </label>
            <div className="grid grid-cols-2 gap-2 bg-[#05080f] p-1 rounded-xl border border-slate-800/80">
              <button
                onClick={() => { setMode('doubles'); trackEvent('mode_changed', { mode: 'doubles' }); }}
                className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                  mode === 'doubles'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Doubles (Full Court)
              </button>
              <button
                onClick={() => { setMode('singles'); trackEvent('mode_changed', { mode: 'singles' }); }}
                className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                  mode === 'singles'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Singles (Inner Side)
              </button>
            </div>
          </div>

          {/* SHOT TRAJECTORY CONTROL PANEL */}
          <div className="space-y-3 bg-[#05080f] p-3 rounded-xl border border-slate-800/80">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-emerald-400" /> Shot Simulator
              </label>
              <span className="text-[10px] text-slate-500">Physics Engine</span>
            </div>

            {/* Shot Type Selector */}
            <div className="grid grid-cols-3 gap-1.5">
              {['Smash', 'Clear', 'Drop', 'Drive', 'Net Shot'].map((type) => (
                <button
                  key={type}
                  onClick={() => setShotType(type)}
                  className={`py-1 px-2 text-[11px] font-medium rounded-md border transition-all ${
                    shotType === type
                      ? 'bg-slate-800 text-emerald-400 border-emerald-500/50 shadow'
                      : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            {/* Shot Power Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Power & Speed</span>
                <span className="font-mono text-emerald-400">{shotPower}%</span>
              </div>
              <input 
                type="range" 
                min="20" 
                max="100" 
                value={shotPower} 
                onChange={(e) => setShotPower(Number(e.target.value))}
                className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => triggerShotSimulation()}
                disabled={isSimulating}
                className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                {isSimulating ? 'In Flight...' : 'Hit Shot'}
              </button>
              <button
                onClick={generateRandomShot}
                disabled={isSimulating}
                className="py-2 px-3 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-800 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Random Drop
              </button>
            </div>
          </div>

          {/* D-PAD & ACTIVE KEY INDICATORS */}
          <div className="bg-[#05080f] p-3 rounded-xl border border-slate-800/80 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-slate-300 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-emerald-400" /> Arrow Key Controls
              </span>
              <span className="text-[10px] font-mono text-slate-500">5px step</span>
            </div>

            <div className="flex flex-col items-center justify-center py-1">
              {/* Up Key */}
              <button
                onClick={() => handleManualMove(0, -5)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center mb-1 border transition-all ${
                  pressedKeys['ArrowUp']
                    ? 'bg-emerald-500 text-white border-emerald-400 scale-95 shadow-lg shadow-emerald-500/30'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
                title="Up Arrow (5px)"
              >
                <ArrowUp className="w-5 h-5" />
              </button>

              {/* Left / Down / Right Keys */}
              <div className="flex gap-1">
                <button
                  onClick={() => handleManualMove(-5, 0)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                    pressedKeys['ArrowLeft']
                      ? 'bg-emerald-500 text-white border-emerald-400 scale-95 shadow-lg shadow-emerald-500/30'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                  title="Left Arrow (5px)"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleManualMove(0, 5)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                    pressedKeys['ArrowDown']
                      ? 'bg-emerald-500 text-white border-emerald-400 scale-95 shadow-lg shadow-emerald-500/30'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                  title="Down Arrow (5px)"
                >
                  <ArrowDown className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleManualMove(5, 0)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                    pressedKeys['ArrowRight']
                      ? 'bg-emerald-500 text-white border-emerald-400 scale-95 shadow-lg shadow-emerald-500/30'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                  title="Right Arrow (5px)"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* POSITION & COORDINATES READOUT */}
          <div className="flex items-center justify-between text-xs font-mono bg-[#05080f] p-2.5 rounded-lg border border-slate-800/80 text-slate-400">
            <div>
              <span className="text-slate-600 mr-1">X:</span>{Math.round(dotPos.x)} px
            </div>
            <div>
              <span className="text-slate-600 mr-1">Y:</span>{Math.round(dotPos.y)} px
            </div>
            <button
              onClick={resetPosition}
              className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 text-[11px]"
            >
              <RotateCcw className="w-3 h-3" /> Reset Pos
            </button>
          </div>

        </div>

        {/* Footer Info */}
        <div className="p-3 border-t border-slate-800/80 bg-[#060910] text-[11px] text-slate-500 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Info className="w-3 h-3" /> Click court area to drop shuttle
          </span>
          <span className="font-mono text-[10px] text-slate-600">v3.5 Auto-Tally</span>
        </div>

      </aside>

      {/* Main Viewport */}
      <main className="flex-1 h-full bg-[#090d16] relative flex items-center justify-center p-2 sm:p-6 md:p-8 overflow-hidden">
        
        {/* Interactive SVG Court Container */}
        <div ref={containerRef} className="w-full h-full max-w-6xl flex items-center justify-center relative">
          
          <svg
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            onClick={handleCourtClick}
            className="w-full h-full max-h-full cursor-crosshair drop-shadow-2xl select-none"
            style={{ touchAction: 'none' }}
          >
            <defs>
              {/* White Dot Glow Filter */}
              <filter id="dotGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* 1. Deep Dark Blue Background Area (#090d16) */}
            <rect
              x="0"
              y="0"
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              fill={DEEP_BLUE_BG}
            />

            {/* 2. Green Court Mat Rectangle (#1b633a) - Red Outlined Zone */}
            <rect
              x={MAT_X}
              y={MAT_Y}
              width={MAT_W}
              height={MAT_H}
              fill="#1b633a"
              rx="12"
              ry="12"
              stroke="#22c55e"
              strokeWidth="1.5"
              strokeOpacity="0.4"
            />

            {/* 3. Main Inner Badminton Court Field (#23824d) */}
            <rect
              x={COURT_X}
              y={COURT_Y}
              width={COURT_W}
              height={COURT_H}
              fill="#23824d"
              rx="2"
            />

            {/* Singles Mode Side Alley Highlight */}
            {mode === 'singles' && (
              <>
                <rect
                  x={COURT_X}
                  y={COURT_Y}
                  width={COURT_W}
                  height={SIDE_ALLEY_PX}
                  fill="#17502f"
                  opacity="0.6"
                />
                <rect
                  x={COURT_X}
                  y={COURT_Y + COURT_H - SIDE_ALLEY_PX}
                  width={COURT_W}
                  height={SIDE_ALLEY_PX}
                  fill="#17502f"
                  opacity="0.6"
                />
              </>
            )}

            {/* OFFICIAL BADMINTON COURT WHITE LINES */}
            <g stroke="#ffffff" strokeWidth="5" strokeLinecap="square" fill="none">
              
              {/* Outer Boundary Box */}
              <rect x={COURT_X} y={COURT_Y} width={COURT_W} height={COURT_H} />

              {/* Top Singles Side Line */}
              <line x1={COURT_X} y1={COURT_Y + SIDE_ALLEY_PX} x2={COURT_X + COURT_W} y2={COURT_Y + SIDE_ALLEY_PX} />

              {/* Bottom Singles Side Line */}
              <line x1={COURT_X} y1={COURT_Y + COURT_H - SIDE_ALLEY_PX} x2={COURT_X + COURT_W} y2={COURT_Y + COURT_H - SIDE_ALLEY_PX} />

              {/* Center Net Line (Vertical dividing line) */}
              <line x1={COURT_X + COURT_W / 2} y1={COURT_Y} x2={COURT_X + COURT_W / 2} y2={COURT_Y + COURT_H} />

              {/* Left Short Service Line */}
              <line 
                x1={COURT_X + COURT_W / 2 - SHORT_SERVICE_PX} 
                y1={COURT_Y} 
                x2={COURT_X + COURT_W / 2 - SHORT_SERVICE_PX} 
                y2={COURT_Y + COURT_H} 
              />

              {/* Right Short Service Line */}
              <line 
                x1={COURT_X + COURT_W / 2 + SHORT_SERVICE_PX} 
                y1={COURT_Y} 
                x2={COURT_X + COURT_W / 2 + SHORT_SERVICE_PX} 
                y2={COURT_Y + COURT_H} 
              />

              {/* Left Long Service Line for Doubles */}
              <line 
                x1={COURT_X + DOUBLES_LONG_PX} 
                y1={COURT_Y} 
                x2={COURT_X + DOUBLES_LONG_PX} 
                y2={COURT_Y + COURT_H} 
              />

              {/* Right Long Service Line for Doubles */}
              <line 
                x1={COURT_X + COURT_W - DOUBLES_LONG_PX} 
                y1={COURT_Y} 
                x2={COURT_X + COURT_W - DOUBLES_LONG_PX} 
                y2={COURT_Y + COURT_H} 
              />

              {/* Center Service Line (Left Side) */}
              <line 
                x1={COURT_X} 
                y1={CANVAS_HEIGHT / 2} 
                x2={COURT_X + COURT_W / 2 - SHORT_SERVICE_PX} 
                y2={CANVAS_HEIGHT / 2} 
              />

              {/* Center Service Line (Right Side) */}
              <line 
                x1={COURT_X + COURT_W / 2 + SHORT_SERVICE_PX} 
                y1={CANVAS_HEIGHT / 2} 
                x2={COURT_X + COURT_W} 
                y2={CANVAS_HEIGHT / 2} 
              />

              {/* Center Line tick marks */}
              <line x1={COURT_X + COURT_W / 2 - 12} y1={CANVAS_HEIGHT / 2} x2={COURT_X + COURT_W / 2 + 12} y2={CANVAS_HEIGHT / 2} strokeWidth="3" opacity="0.8" />
            </g>

            {/* Center Net Visualization */}
            <g>
              <line 
                x1={COURT_X + COURT_W / 2} 
                y1={COURT_Y - 15} 
                x2={COURT_X + COURT_W / 2} 
                y2={COURT_Y + COURT_H + 15} 
                stroke="#090d16" 
                strokeWidth="6" 
                opacity="0.5" 
              />
              <line 
                x1={COURT_X + COURT_W / 2} 
                y1={COURT_Y - 15} 
                x2={COURT_X + COURT_W / 2} 
                y2={COURT_Y + COURT_H + 15} 
                stroke="#ffffff" 
                strokeWidth="2.5" 
                strokeDasharray="4 3" 
              />
              {/* Net Post studs */}
              <circle cx={COURT_X + COURT_W / 2} cy={COURT_Y - 12} r="5" fill="#0284c7" />
              <circle cx={COURT_X + COURT_W / 2} cy={COURT_Y + COURT_H + 12} r="5" fill="#0284c7" />
            </g>

            {/* Shot Trail lines */}
            {shotTrail.map((trail, index) => (
              <path
                key={index}
                d={`M ${trail.start.x} ${trail.start.y} Q ${(trail.start.x + trail.end.x) / 2} ${(trail.start.y + trail.end.y) / 2 - trail.peak} ${trail.end.x} ${trail.end.y}`}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                strokeDasharray="4 4"
                opacity={0.3 + (index / shotTrail.length) * 0.5}
              />
            ))}

            {/* Active Flight Parabola during simulation */}
            {isSimulating && (
              <path
                d={`M ${COURT_X + 80} ${CANVAS_HEIGHT / 2} Q ${(COURT_X + 80 + dotPos.x) / 2} ${(CANVAS_HEIGHT / 2 + dotPos.y) / 2 - arcHeight * 2} ${dotPos.x} ${dotPos.y}`}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="3"
                strokeLinecap="round"
                opacity="0.8"
              />
            )}

            {/* MOVABLE WHITE DOT & TARGET MARKER */}
            <g transform={`translate(${dotPos.x}, ${dotPos.y})`}>
              
              {/* Flight Height Shadow */}
              {arcHeight > 0 && (
                <ellipse 
                  cx="0" 
                  cy={arcHeight * 0.4} 
                  rx={9 + arcHeight * 0.1} 
                  ry={5 + arcHeight * 0.05} 
                  fill="#000000" 
                  opacity="0.5" 
                />
              )}

              {/* Pulsing Ripple Rings */}
              <circle 
                cx="0" 
                cy="0" 
                r="18" 
                fill={currentStatus.status === 'IN' ? '#10b981' : '#f43f5e'} 
                opacity="0.3" 
                className="animate-ping"
              />

              {/* Movable White Dot with crisp outline */}
              <circle 
                cx="0" 
                cy="0" 
                r="9.5" 
                fill="#0f172a" 
              />
              <circle 
                cx="0" 
                cy="0" 
                r="8.5" 
                fill="#ffffff" 
                filter="url(#dotGlow)"
              />

              {/* Center Core Dot */}
              <circle cx="0" cy="0" r="3" fill="#0f172a" />
            </g>

          </svg>

          {/* Floating Live Coordinates Overlay */}
          <div className="absolute top-3 right-3 bg-[#090d16]/90 text-white px-3 py-1.5 rounded-lg text-xs font-mono backdrop-blur border border-slate-800 shadow-xl pointer-events-none flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>X: {Math.round(dotPos.x)} | Y: {Math.round(dotPos.y)}</span>
          </div>

        </div>
      </main>

    </div>
  );
}