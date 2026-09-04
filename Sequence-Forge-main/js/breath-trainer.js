// js/breath-trainer.js - 呼吸训练模块（快速呼吸训练）
(function() {
  'use strict';

  const STORAGE_KEY = 'breathSettings_v1';

  const defaultSettings = {
    inhale: 4,
    hold: 7,
    exhale: 8,
    exhaleHold: 0,
    countdown: 3,
    mode: 'count',
    count: 10,
    time: 5,
    sound: true,
    vibrate: true,
    volume: 0.8
  };

  let breathSettings = null;
  let breathEngine = null;

  const B = {
    setup: document.getElementById('breath-setup'),
    exec: document.getElementById('breath-exec'),
    inhaleSlider: document.getElementById('breath-inhale'),
    inhaleVal: document.getElementById('breath-inhale-val'),
    holdSlider: document.getElementById('breath-hold'),
    holdVal: document.getElementById('breath-hold-val'),
    exhaleSlider: document.getElementById('breath-exhale'),
    exhaleVal: document.getElementById('breath-exhale-val'),
    exhaleHoldSlider: document.getElementById('breath-exhale-hold'),
    exhaleHoldVal: document.getElementById('breath-exhale-hold-val'),
    countdownSlider: document.getElementById('breath-countdown'),
    countdownVal: document.getElementById('breath-countdown-val'),
    modeCount: document.getElementById('breath-mode-count'),
    modeTime: document.getElementById('breath-mode-time'),
    countControl: document.getElementById('breath-count-control'),
    timeControl: document.getElementById('breath-time-control'),
    countSlider: document.getElementById('breath-count'),
    countVal: document.getElementById('breath-count-val'),
    timeSlider: document.getElementById('breath-time'),
    timeVal: document.getElementById('breath-time-val'),
    soundToggle: document.getElementById('breath-sound-toggle'),
    vibrateToggle: document.getElementById('breath-vibrate-toggle'),
    volumeSlider: document.getElementById('breath-volume'),
    volumeVal: document.getElementById('breath-volume-val'),
    startBtn: document.getElementById('btn-breath-start'),
    backBtn: document.getElementById('btn-breath-back'),
    phaseName: document.getElementById('breath-phase-name'),
    countdownBig: document.getElementById('breath-countdown-big'),
    circle: document.getElementById('breath-circle-big'),
    execDetail: document.getElementById('breath-exec-detail'),
    execTime: document.getElementById('breath-exec-time'),
    progress: document.getElementById('breath-total-progress'),
    progressText: document.getElementById('breath-progress'),
    pauseBtn: document.getElementById('btn-breath-pause'),
    resumeBtn: document.getElementById('btn-breath-resume'),
    stopBtn: document.getElementById('btn-breath-stop')
  };

  // ---- 存储 ----
  function loadBreathSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        breathSettings = { ...defaultSettings, ...s };
      } else {
        breathSettings = { ...defaultSettings };
      }
    } catch(e) {
      breathSettings = { ...defaultSettings };
    }
    syncBreathUI();
  }

  function saveBreathSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(breathSettings));
    } catch(e) {}
  }

  function syncBreathUI() {
    const s = breathSettings;
    B.inhaleSlider.value = s.inhale;
    B.inhaleVal.textContent = s.inhale.toFixed(1) + ' s';
    B.holdSlider.value = s.hold;
    B.holdVal.textContent = s.hold.toFixed(1) + ' s';
    B.exhaleSlider.value = s.exhale;
    B.exhaleVal.textContent = s.exhale.toFixed(1) + ' s';
    B.exhaleHoldSlider.value = s.exhaleHold;
    B.exhaleHoldVal.textContent = s.exhaleHold.toFixed(1) + ' s';
    B.countdownSlider.value = s.countdown;
    B.countdownVal.textContent = s.countdown + ' s';
    B.countSlider.value = s.count;
    B.countVal.textContent = s.count + ' 次';
    B.timeSlider.value = s.time;
    B.timeVal.textContent = s.time.toFixed(1) + ' min';
    B.volumeSlider.value = s.volume;
    B.volumeVal.textContent = Math.round(s.volume * 100) + '%';
    updateBreathModeUI(s.mode);
    updateBreathToggle(B.soundToggle, s.sound, '🔊 声音');
    updateBreathToggle(B.vibrateToggle, s.vibrate, '📳 振动');
  }

  function updateBreathModeUI(mode) {
    B.modeCount.classList.toggle('active', mode === 'count');
    B.modeTime.classList.toggle('active', mode === 'time');
    B.countControl.classList.toggle('hidden', mode === 'time');
    B.timeControl.classList.toggle('hidden', mode === 'count');
  }

  function updateBreathToggle(btn, on, label) {
    btn.textContent = label;
    btn.classList.toggle('on', on);
    btn.classList.toggle('off', !on);
  }

  // ---- 呼吸训练引擎 ----
  class BreathEngine {
    constructor(settingsRef, callbacks) {
      this.settingsRef = settingsRef;
      this.callbacks = callbacks || {};
      this.phase = 'idle';
      this.phaseElapsed = 0;
      this.phaseDuration = 0;
      this.cycleIndex = 0;
      this.totalCycles = 0;
      this.totalElapsed = 0;
      this.isRunning = false;
      this.isPaused = false;
      this.isCountdown = false;
      this._timerId = null;
      this._holdTickId = null;
      this._audioNodes = [];
    }

    calcTotalCycles() {
      if (this.settingsRef.mode === 'count') {
        return this.settingsRef.count;
      } else {
        const oneCycle = this.settingsRef.inhale + this.settingsRef.hold + this.settingsRef.exhale + this.settingsRef.exhaleHold;
        const totalSec = this.settingsRef.time * 60;
        return Math.ceil(totalSec / oneCycle);
      }
    }

    getPhaseDuration(phase) {
      if (phase === 'inhale') return this.settingsRef.inhale;
      if (phase === 'hold') return this.settingsRef.hold;
      if (phase === 'exhale') return this.settingsRef.exhale;
      if (phase === 'exhaleHold') return this.settingsRef.exhaleHold;
      return 0;
    }

    getNextPhase(currentPhase) {
      if (currentPhase === 'inhale') return 'hold';
      if (currentPhase === 'hold') return 'exhale';
      if (currentPhase === 'exhale') {
        if (this.settingsRef.exhaleHold > 0) return 'exhaleHold';
        return 'inhale';
      }
      if (currentPhase === 'exhaleHold') return 'inhale';
      return 'inhale';
    }

    start() {
      if (this.isRunning) return;
      if (this.phase === 'finished') {
        this._reset();
      }
      this.totalCycles = this.calcTotalCycles();
      this.cycleIndex = 0;
      this.totalElapsed = 0;
      this.isRunning = true;
      this.isPaused = false;
      this._trigger('onStart');

      const cd = this.settingsRef.countdown || 0;
      if (cd > 0) {
        this._startCountdown(cd);
      } else {
        this._startCycle();
      }
    }

    _startCountdown(totalSeconds) {
      this.isCountdown = true;
      let elapsed = 0;
      let lastSecond = -1;
      const startTime = performance.now();
      let lastTick = startTime;

      this._trigger('onCountdownTick', { remaining: totalSeconds });

      this._timerId = setInterval(() => {
        if (this.isPaused) return;
        const now = performance.now();
        const dt = (now - lastTick) / 1000;
        lastTick = now;
        elapsed += dt;
        const remaining = Math.max(0, totalSeconds - elapsed);

        const intSecond = Math.ceil(remaining);
        if (intSecond !== lastSecond && intSecond > 0) {
          lastSecond = intSecond;
          if (this.settingsRef.sound) {
            AudioEngine.playClick(this.settingsRef.volume * 0.6);
          }
          if (this.settingsRef.vibrate) {
            navigator.vibrate && navigator.vibrate(30);
          }
        }

        this._trigger('onCountdownTick', { remaining: remaining });

        if (elapsed >= totalSeconds) {
          this._clearTimers();
          this.isCountdown = false;
          this._trigger('onCountdownEnd', {});
          this._startCycle();
        }
      }, 100);
    }

    _startCycle() {
      this.phase = 'inhale';
      this.phaseElapsed = 0;
      this.phaseDuration = this.getPhaseDuration('inhale');
      this._trigger('onPhaseStart', { phase: this.phase, duration: this.phaseDuration });
      this._runPhase('inhale');
    }

    pause() {
      if (!this.isRunning || this.isPaused) return;
      this.isPaused = true;
      this._clearTimers();
      this._stopAudio();
      this._trigger('onPause');
    }

    resume() {
      if (!this.isRunning || !this.isPaused) return;
      this.isPaused = false;
      this._trigger('onResume');
      if (this.isCountdown) {
        const cd = this.settingsRef.countdown || 0;
        this._startCountdown(cd - this.phaseElapsed);
      } else {
        this._runPhase(this.phase);
      }
    }

    stop() {
      this._reset();
      this._trigger('onStop');
    }

    _reset() {
      this.isRunning = false;
      this.isPaused = false;
      this.isCountdown = false;
      this.phase = 'idle';
      this.phaseElapsed = 0;
      this.phaseDuration = 0;
      this.cycleIndex = 0;
      this.totalElapsed = 0;
      this._clearTimers();
      this._stopAudio();
    }

    _runPhase(phase) {
      if (!this.isRunning || this.isPaused) return;
      this.phase = phase;
      this.phaseElapsed = 0;
      this.phaseDuration = this.getPhaseDuration(phase);

      if (this.settingsRef.mode === 'count' && this.cycleIndex >= this.totalCycles) {
        this._finish();
        return;
      }
      if (this.settingsRef.mode === 'time') {
        const totalTarget = this.settingsRef.time * 60;
        if (this.totalElapsed >= totalTarget) {
          this._finish();
          return;
        }
        if (this.totalElapsed + this.phaseDuration > totalTarget) {
          this.phaseDuration = totalTarget - this.totalElapsed;
          if (this.phaseDuration <= 0) {
            this._finish();
            return;
          }
        }
      }

      this._trigger('onPhaseStart', { phase, duration: this.phaseDuration });

      const vol = this.settingsRef.volume;
      const nodes = [];

      if (this.settingsRef.sound) {
        if (phase === 'inhale') {
          const n = AudioEngine.playUp(this.phaseDuration, vol);
          if (n) nodes.push(...n);
        } else if (phase === 'exhale') {
          const n = AudioEngine.playDown(this.phaseDuration, vol);
          if (n) nodes.push(...n);
        } else if (phase === 'hold' || phase === 'exhaleHold') {
          this._startHoldTick(vol);
        }
      }
      this._audioNodes = nodes;

      if (this.settingsRef.vibrate) {
        navigator.vibrate && navigator.vibrate(50);
      }

      const startTime = performance.now();
      let lastTick = startTime;

      this._timerId = setInterval(() => {
        if (this.isPaused) return;
        const now = performance.now();
        const dt = (now - lastTick) / 1000;
        lastTick = now;
        this.phaseElapsed += dt;
        this.totalElapsed += dt;

        if (this.phaseElapsed >= this.phaseDuration) {
          this._clearTimers();
          this._stopAudio();
          this._trigger('onPhaseEnd', { phase: this.phase });

          if (this.phase === 'exhale') {
            if (this.settingsRef.exhaleHold <= 0) {
              this.cycleIndex++;
            }
          } else if (this.phase === 'exhaleHold') {
            this.cycleIndex++;
          }

          const nextPhase = this.getNextPhase(this.phase);
          if (nextPhase === 'inhale') {
            if (this.settingsRef.mode === 'count' && this.cycleIndex >= this.totalCycles) {
              this._finish();
              return;
            }
            if (this.settingsRef.mode === 'time') {
              const totalTarget = this.settingsRef.time * 60;
              if (this.totalElapsed >= totalTarget) {
                this._finish();
                return;
              }
            }
          }
          this._runPhase(nextPhase);
        } else {
          this._trigger('onTick', {
            phase: this.phase,
            elapsed: this.phaseElapsed,
            duration: this.phaseDuration,
            remaining: this.phaseDuration - this.phaseElapsed,
            cycle: this.cycleIndex,
            totalCycles: this.totalCycles,
            totalElapsed: this.totalElapsed
          });
        }
      }, 100);
    }

    _startHoldTick(volume) {
      this._stopHoldTick();
      this._holdTickId = setInterval(() => {
        if (this.isPaused) return;
        if (this.settingsRef.sound) {
          const nodes = AudioEngine.playClick(volume * 1.2);
          if (nodes) this._audioNodes.push(...nodes);
        }
      }, 1000);
    }

    _stopHoldTick() {
      if (this._holdTickId) {
        clearInterval(this._holdTickId);
        this._holdTickId = null;
      }
    }

    _clearTimers() {
      if (this._timerId) {
        clearInterval(this._timerId);
        this._timerId = null;
      }
      this._stopHoldTick();
    }

    _stopAudio() {
      if (this._audioNodes.length > 0) {
        AudioEngine.stopNodes(this._audioNodes);
        this._audioNodes = [];
      }
    }

    _finish() {
      this._clearTimers();
      this._stopAudio();
      this.isRunning = false;
      this.phase = 'finished';
      this._trigger('onComplete', {
        totalCycles: this.cycleIndex,
        totalElapsed: this.totalElapsed
      });
      if (this.settingsRef.sound) {
        AudioEngine.playDingDong(this.settingsRef.volume);
      }
    }

    _trigger(eventName, data) {
      if (this.callbacks && typeof this.callbacks[eventName] === 'function') {
        try {
          this.callbacks[eventName](data);
        } catch(e) {
          console.error('BreathEngine callback error:', e);
        }
      }
    }
  }

  // ---- UI 控制 ----
  function initBreathUI() {
    loadBreathSettings();

    B.inhaleSlider.addEventListener('input', function() {
      breathSettings.inhale = parseFloat(this.value);
      B.inhaleVal.textContent = breathSettings.inhale.toFixed(1) + ' s';
      saveBreathSettings();
    });
    B.holdSlider.addEventListener('input', function() {
      breathSettings.hold = parseFloat(this.value);
      B.holdVal.textContent = breathSettings.hold.toFixed(1) + ' s';
      saveBreathSettings();
    });
    B.exhaleSlider.addEventListener('input', function() {
      breathSettings.exhale = parseFloat(this.value);
      B.exhaleVal.textContent = breathSettings.exhale.toFixed(1) + ' s';
      saveBreathSettings();
    });
    B.exhaleHoldSlider.addEventListener('input', function() {
      breathSettings.exhaleHold = parseFloat(this.value);
      B.exhaleHoldVal.textContent = breathSettings.exhaleHold.toFixed(1) + ' s';
      saveBreathSettings();
    });
    B.countdownSlider.addEventListener('input', function() {
      breathSettings.countdown = parseInt(this.value, 10);
      B.countdownVal.textContent = breathSettings.countdown + ' s';
      saveBreathSettings();
    });
    B.countSlider.addEventListener('input', function() {
      breathSettings.count = parseInt(this.value, 10);
      B.countVal.textContent = breathSettings.count + ' 次';
      saveBreathSettings();
    });
    B.timeSlider.addEventListener('input', function() {
      breathSettings.time = parseFloat(this.value);
      B.timeVal.textContent = breathSettings.time.toFixed(1) + ' min';
      saveBreathSettings();
    });
    B.volumeSlider.addEventListener('input', function() {
      breathSettings.volume = parseFloat(this.value);
      B.volumeVal.textContent = Math.round(breathSettings.volume * 100) + '%';
      saveBreathSettings();
    });

    B.modeCount.addEventListener('click', function() {
      breathSettings.mode = 'count';
      updateBreathModeUI('count');
      saveBreathSettings();
    });
    B.modeTime.addEventListener('click', function() {
      breathSettings.mode = 'time';
      updateBreathModeUI('time');
      saveBreathSettings();
    });

    B.soundToggle.addEventListener('click', function() {
      breathSettings.sound = !breathSettings.sound;
      updateBreathToggle(this, breathSettings.sound, '🔊 声音');
      saveBreathSettings();
    });
    B.vibrateToggle.addEventListener('click', function() {
      breathSettings.vibrate = !breathSettings.vibrate;
      updateBreathToggle(this, breathSettings.vibrate, '📳 振动');
      saveBreathSettings();
    });

    B.startBtn.addEventListener('click', function() {
      startBreathTraining();
    });

    B.backBtn.addEventListener('click', function() {
      if (breathEngine && breathEngine.isRunning) {
        breathEngine.stop();
      }
      B.exec.classList.add('hidden');
      B.setup.classList.remove('hidden');
    });

    B.pauseBtn.addEventListener('click', function() {
      if (breathEngine) {
        breathEngine.pause();
        B.pauseBtn.classList.add('hidden');
        B.resumeBtn.classList.remove('hidden');
      }
    });
    B.resumeBtn.addEventListener('click', function() {
      if (breathEngine) {
        breathEngine.resume();
        B.resumeBtn.classList.add('hidden');
        B.pauseBtn.classList.remove('hidden');
      }
    });
    B.stopBtn.addEventListener('click', function() {
      if (breathEngine) {
        breathEngine.stop();
      }
    });

    document.addEventListener('keydown', function(e) {
      const viewBreath = document.getElementById('view-breath');
      if (!viewBreath.classList.contains('active')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (B.exec.classList.contains('hidden')) {
          B.startBtn.click();
        } else {
          const pauseBtn = B.pauseBtn;
          const resumeBtn = B.resumeBtn;
          if (!pauseBtn.classList.contains('hidden')) {
            pauseBtn.click();
          } else if (!resumeBtn.classList.contains('hidden')) {
            resumeBtn.click();
          }
        }
      }
      if (e.code === 'Escape') {
        if (!B.exec.classList.contains('hidden')) {
          B.stopBtn.click();
        } else {
          document.querySelector('#view-breath .btn-back')?.click();
        }
      }
    });
  }

  function startBreathTraining() {
    saveBreathSettings();

    breathEngine = new BreathEngine(breathSettings, {
      onStart: function() {
        B.setup.classList.add('hidden');
        B.exec.classList.remove('hidden');
        B.pauseBtn.classList.remove('hidden');
        B.resumeBtn.classList.add('hidden');
        B.phaseName.textContent = '准备';
        B.countdownBig.textContent = '0';
        B.progress.style.width = '0%';
        B.execDetail.textContent = '循环 0/' + breathEngine.totalCycles;
        B.execTime.textContent = '⏱ 00:00';
        B.progressText.textContent = '0/' + breathEngine.totalCycles;
      },
      onCountdownTick: function(data) {
        const remaining = Math.ceil(data.remaining);
        B.countdownBig.textContent = remaining;
        B.phaseName.textContent = 'Ready';
      },
      onCountdownEnd: function() {
        B.phaseName.textContent = 'Start';
      },
      onPhaseStart: function(data) {
        const phaseNames = { inhale: 'In', hold: 'Hold', exhale: 'Out', exhaleHold: 'Hold' };
        B.phaseName.textContent = phaseNames[data.phase] || data.phase;
        const circle = B.circle;
        if (data.phase === 'inhale') {
          circle.setAttribute('fill', 'rgba(255, 120, 50, 0.8)');
        } else if (data.phase === 'exhale' || data.phase === 'exhaleHold') {
          circle.setAttribute('fill', 'rgba(200, 60, 200, 0.8)');
        } else if (data.phase === 'hold') {
          circle.setAttribute('fill', 'rgba(180, 20, 20, 0.9)');
        }
      },
      onTick: function(data) {
        const remaining = Math.ceil(data.remaining);
        B.countdownBig.textContent = remaining > 0 ? remaining : 0;

        const progress = data.elapsed / data.duration;
        const circle = B.circle;
        const minR = 25, maxR = 100;
        let r;
        if (data.phase === 'inhale') {
          r = minR + (maxR - minR) * progress;
        } else if (data.phase === 'exhale' || data.phase === 'exhaleHold') {
          r = maxR - (maxR - minR) * progress;
        } else if (data.phase === 'hold') {
          r = maxR;
        } else {
          r = minR;
        }
        circle.setAttribute('r', r.toFixed(1));

        const total = data.totalCycles || 1;
        const current = data.cycle || 0;
        B.execDetail.textContent = `循环 ${Math.min(current + 1, total)}/${total}`;
        B.progressText.textContent = `${Math.min(current + 1, total)}/${total}`;

        const totalSec = data.totalElapsed || 0;
        const m = Math.floor(totalSec / 60);
        const s = Math.floor(totalSec % 60);
        B.execTime.textContent = `⏱ ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

        let progressPercent = 0;
        if (data.phase === 'inhale' || data.phase === 'hold' || data.phase === 'exhale' || data.phase === 'exhaleHold') {
          progressPercent = (data.elapsed / data.duration) * 100;
        }
        const overallProgress = (current / total) * 100 + (progressPercent / total);
        B.progress.style.width = Math.min(100, overallProgress) + '%';
      },
      onPause: function() {},
      onResume: function() {},
      onComplete: function(data) {
        B.phaseName.textContent = '🎉 Well Done！';
        B.countdownBig.textContent = '0';
        B.progress.style.width = '100%';
        B.execDetail.textContent = `循环 ${data.totalCycles || 0}/${data.totalCycles || 0}`;
        B.progressText.textContent = `${data.totalCycles || 0}/${data.totalCycles || 0}`;
        B.pauseBtn.classList.add('hidden');
        B.resumeBtn.classList.add('hidden');
        B.stopBtn.classList.add('hidden');
        setTimeout(() => {
          if (breathEngine) breathEngine.stop();
          B.exec.classList.add('hidden');
          B.setup.classList.remove('hidden');
          B.stopBtn.classList.remove('hidden');
        }, 3000);
      },
      onStop: function() {
        B.exec.classList.add('hidden');
        B.setup.classList.remove('hidden');
        B.pauseBtn.classList.remove('hidden');
        B.resumeBtn.classList.add('hidden');
        B.stopBtn.classList.remove('hidden');
        B.circle.setAttribute('r', '25');
        B.circle.setAttribute('fill', 'rgba(200,60,60,0.6)');
        B.countdownBig.textContent = '0';
        B.phaseName.textContent = '准备';
        B.progress.style.width = '0%';
        breathEngine = null;
      }
    });

    breathEngine.start();
  }

  // ---- 对外暴露 ----
  function openBreathTraining() {
    const viewBreath = document.getElementById('view-breath');
    if (!viewBreath) return;
    // 通过全局 navigateTo 切换视图
    if (window.navigateTo) {
      window.navigateTo('view-breath');
    } else {
      // fallback：直接操作 DOM
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      viewBreath.classList.add('active');
    }
    B.setup.classList.remove('hidden');
    B.exec.classList.add('hidden');
    B.pauseBtn.classList.remove('hidden');
    B.resumeBtn.classList.add('hidden');
    B.stopBtn.classList.remove('hidden');
    B.circle.setAttribute('r', '25');
    B.circle.setAttribute('fill', 'rgba(200,60,60,0.6)');
    B.countdownBig.textContent = '0';
    B.phaseName.textContent = '准备';
    B.progress.style.width = '0%';
    loadBreathSettings();
    syncBreathUI();
  }

  // ---- 绑定主页快速开始按钮 ----
  document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('btn-quick-start');
    if (btn) {
      btn.addEventListener('click', function() {
        openBreathTraining();
      });
    }
  });

  // ---- 初始化 ----
  initBreathUI();

  // ---- 暴露到全局 ----
  window.BreathTrainer = {
    open: openBreathTraining,
    reload: function() {
      loadBreathSettings();
      syncBreathUI();
    }
  };

})();