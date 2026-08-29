// js/engine.js - 四层嵌套训练状态机（增加 reps 层）
(function() {
  'use strict';

  const STATE = {
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    FINISHED: 'finished'
  };

  class TrainingEngine {
    constructor(options = {}) {
      this.routine = null;
      this.projects = [];
      this.callbacks = options.callbacks || {};
      this.volume = options.volume ?? 0.8;

      this.state = STATE.IDLE;
      this.currentRound = 0;         // 循环次数（训练组级别）
      this.currentStepIndex = 0;     // 当前动作索引
      this.currentStepRound = 0;     // 当前动作的组数
      this.currentRep = 0;           // 当前组内的次数
      this.currentPhaseIndex = 0;    // 当前相位索引
      this.phaseElapsed = 0;
      this.phaseRemaining = 0;

      this._timerId = null;
      this._holdTickId = null;
      this._audioNodes = [];
      this._lastBeepSecond = -1;
      this._isCountdown = false;
    }

    load(routine, projects) {
      this.routine = routine;
      this.projects = projects;
      this.state = STATE.IDLE;
      this._resetCounters();
      return this;
    }

    _resetCounters() {
      this.currentRound = 0;
      this.currentStepIndex = 0;
      this.currentStepRound = 0;
      this.currentRep = 0;
      this.currentPhaseIndex = 0;
      this.phaseElapsed = 0;
      this.phaseRemaining = 0;
      this._clearTimers();
      this._stopAudio();
      this._lastBeepSecond = -1;
      this._isCountdown = false;
    }

    // ---------- 控制 ----------
    start() {
      console.log('🚀 Engine.start() 被调用');
      if (!this.routine || this.routine.steps.length === 0) {
        console.error('❌ 没有训练组或步骤为空');
        return;
      }
      if (this.state === STATE.RUNNING) {
        console.warn('⚠️ 已在运行中');
        return;
      }
      if (this.state === STATE.PAUSED) {
        this.resume();
        return;
      }

      this._resetCounters();
      this.state = STATE.RUNNING;
      this._trigger('onStart', { routine: this.routine });

      const countdown = this.routine.countdown || 0;
      if (countdown > 0) {
        this._startCountdown(countdown, () => {
          this._runRound();
        });
      } else {
        this._runRound();
      }
    }

    pause() {
      if (this.state !== STATE.RUNNING) return;
      this.state = STATE.PAUSED;
      this._clearTimers();
      this._stopAudio();
      this._trigger('onPause', {});
    }

    resume() {
      if (this.state !== STATE.PAUSED) return;
      this.state = STATE.RUNNING;
      if (this.phaseRemaining > 0) {
        const remaining = this.phaseRemaining;
        this.phaseRemaining = 0;
        this._startPhaseWithDuration(this.currentPhase, remaining, true);
      } else {
        this._resumeCurrentLevel();
      }
      this._trigger('onResume', {});
    }

    stop() {
      this._resetCounters();
      this.state = STATE.IDLE;
      this._stopAudio();
      this._trigger('onStop', {});
    }

    // ---------- 倒计时 ----------
    _startCountdown(totalSeconds, onComplete) {
      this._isCountdown = true;
      let elapsed = 0;
      let lastSecond = -1;
      this._trigger('onCountdownTick', { remaining: totalSeconds });

      const startTime = performance.now();
      let lastTick = startTime;

      this._timerId = setInterval(() => {
        if (this.state === STATE.PAUSED) return;
        const now = performance.now();
        const dt = (now - lastTick) / 1000;
        lastTick = now;
        elapsed += dt;
        const remaining = Math.max(0, totalSeconds - elapsed);

        const intSecond = Math.ceil(remaining);
        if (intSecond !== lastSecond && intSecond > 0) {
          lastSecond = intSecond;
          AudioEngine.playClick(this.volume * 0.6);
        }

        this._trigger('onCountdownTick', { remaining: remaining });

        if (elapsed >= totalSeconds) {
          this._clearTimers();
          this._isCountdown = false;
          this._trigger('onCountdownEnd', {});
          if (onComplete) onComplete();
        }
      }, 100);
    }

    // ---------- 四级状态机 ----------
    _runRound() {
      if (this.currentRound >= this.routine.rounds) {
        this._finish();
        return;
      }
      this._trigger('onRoundChange', {
        current: this.currentRound + 1,
        total: this.routine.rounds
      });
      this.currentStepIndex = 0;
      this._runStep();
    }

    _runStep() {
      if (this.currentStepIndex >= this.routine.steps.length) {
        this.currentRound++;
        this._runRound();
        return;
      }

      const step = this.routine.steps[this.currentStepIndex];
      this.currentStepRound = 0;
      this.currentRep = 0;
      this._trigger('onStepChange', {
        index: this.currentStepIndex + 1,
        total: this.routine.steps.length,
        step: step
      });
      this._runStepRound(step);
    }

    // ---------- 组数循环 + 次数循环（三层嵌套）----------
    _runStepRound(step) {
      // 检查组数是否完成
      if (this.currentStepRound >= (step.rounds || 1)) {
        // 所有组完成 → 进入下一步骤
        const isLastStep = this.currentStepIndex === this.routine.steps.length - 1;
        const isLastRound = this.currentRound === this.routine.rounds - 1;
        if (isLastStep && isLastRound) {
          this._finish();
          return;
        }
        this.currentStepIndex++;
        this._runStep();
        return;
      }

      // 如果是休息块
      if (step.kind === 'rest') {
        const dur = step.duration || 0;
        this._startRest(dur * 60, 'step', () => {
          this.currentStepRound++;
          this._runStepRound(step);
        });
        return;
      }

      // 检查当前组内的次数是否完成
      const reps = step.reps || 1;
      if (this.currentRep >= reps) {
        // 当前组次数完成 → 进入下一组
        this.currentRep = 0;
        this.currentStepRound++;

        // 组间休息（最后一组不休息）
        if (this.currentStepRound < step.rounds && step.restAfter > 0) {
          this._startRest(step.restAfter * 60, 'step', () => {
            this._runStepRound(step);
          });
          return;
        }
        this._runStepRound(step);
        return;
      }

      // 执行动作（找项目）
      const project = this.projects.find(p => p.id === step.projectId);
      if (!project) {
        console.warn(`⚠️ 找不到动作 ${step.projectId}，跳过`);
        this.currentRep++;
        this._runStepRound(step);
        return;
      }

      this.currentPhaseIndex = 0;
      this._trigger('onProjectStart', {
        project: project,
        step: step,
        round: this.currentStepRound + 1,
        totalRounds: step.rounds || 1,
        rep: this.currentRep + 1,
        totalReps: reps
      });

      this._runPhase(project, step, () => {
        // 一次相位序列完成 → 次数+1
        this.currentRep++;
        this._runStepRound(step);
      }, this.currentStepIndex, this.routine.steps.length);
    }

    // ---------- 相位执行 ----------
    _runPhase(project, step, onComplete, stepIndex, totalSteps) {
      if (this.currentPhaseIndex >= project.phases.length) {
        if (onComplete) onComplete();
        return;
      }

      const phase = project.phases[this.currentPhaseIndex];
      const duration = phase.duration || 0;
      if (duration <= 0) {
        this.currentPhaseIndex++;
        this._runPhase(project, step, onComplete, stepIndex, totalSteps);
        return;
      }

      this.currentPhase = phase;
      this.phaseRemaining = 0;

      const reps = step.reps || 1;
      this._trigger('onPhaseChange', {
        phase: phase,
        project: project,
        step: step,
        index: this.currentPhaseIndex + 1,
        total: project.phases.length,
        groupRound: this.currentRound + 1,
        totalGroupRounds: this.routine.rounds,
        stepIndex: stepIndex + 1,
        totalSteps: totalSteps,
        stepRound: this.currentStepRound + 1,
        totalStepRounds: step.rounds || 1,
        rep: this.currentRep + 1,
        totalReps: reps
      });

      this._startPhaseWithDuration(phase, duration, false, () => {
        this.currentPhaseIndex++;
        this._runPhase(project, step, onComplete, stepIndex, totalSteps);
      });
    }

    // ---------- 相位计时 ----------
    _startPhaseWithDuration(phase, duration, isResume = false, onComplete) {
      this._clearTimers();
      this._stopAudio();

      this.phaseElapsed = 0;
      this.phaseRemaining = duration;

      const vol = this.volume;
      if (phase.type === 'up') {
        this._audioNodes = AudioEngine.playUp(duration, vol);
      } else if (phase.type === 'down') {
        this._audioNodes = AudioEngine.playDown(duration, vol);
      } else if (phase.type === 'hold') {
        this._audioNodes = [];
        this._startHoldTick(vol);
      }

      this._trigger('onTick', {
        phase: phase,
        elapsed: 0,
        duration: duration,
        remaining: duration
      });

      const startTime = performance.now();
      let lastTick = startTime;

      this._timerId = setInterval(() => {
        if (this.state === STATE.PAUSED) return;
        const now = performance.now();
        const dt = (now - lastTick) / 1000;
        lastTick = now;
        this.phaseElapsed += dt;
        this.phaseRemaining = Math.max(0, duration - this.phaseElapsed);

        this._trigger('onTick', {
          phase: phase,
          elapsed: this.phaseElapsed,
          duration: duration,
          remaining: this.phaseRemaining
        });

        if (this.phaseElapsed >= duration) {
          this._clearTimers();
          this._stopAudio();
          this.phaseRemaining = 0;
          this._trigger('onTick', { phase, elapsed: duration, duration, remaining: 0 });
          if (onComplete) onComplete();
        }
      }, 100);
    }

    // ---------- Hold 滴答 ----------
    _startHoldTick(volume) {
      this._stopHoldTick();
      const nodes = AudioEngine.playClick(volume * 1.2);
      if (nodes) this._audioNodes.push(...nodes);
      this._holdTickId = setInterval(() => {
        if (this.state === STATE.PAUSED) return;
        const nodes = AudioEngine.playClick(volume * 1.2);
        if (nodes) this._audioNodes.push(...nodes);
      }, 1000);
    }

    _stopHoldTick() {
      if (this._holdTickId) {
        clearInterval(this._holdTickId);
        this._holdTickId = null;
      }
    }

    // ---------- 休息 ----------
    _startRest(totalSeconds, type, onComplete) {
      if (totalSeconds <= 0) {
        if (onComplete) onComplete();
        return;
      }
      this._clearTimers();
      this._stopAudio();
      this._lastBeepSecond = -1;

      let elapsed = 0;
      this._trigger('onRestStart', { type, duration: totalSeconds, remaining: totalSeconds });

      const startTime = performance.now();
      let lastTick = startTime;

      this._timerId = setInterval(() => {
        if (this.state === STATE.PAUSED) return;
        const now = performance.now();
        const dt = (now - lastTick) / 1000;
        lastTick = now;
        elapsed += dt;
        const remaining = Math.max(0, totalSeconds - elapsed);

        this._trigger('onRestTick', { type, duration: totalSeconds, remaining });

        if (remaining <= 10 && remaining > 0) {
          const intSecond = Math.ceil(remaining);
          if (intSecond !== this._lastBeepSecond) {
            this._lastBeepSecond = intSecond;
            AudioEngine.playClick(this.volume * 0.8);
          }
        }

        if (elapsed >= totalSeconds) {
          this._clearTimers();
          this._lastBeepSecond = -1;
          this._trigger('onRestEnd', { type });
          if (onComplete) onComplete();
        }
      }, 100);
    }

    // ---------- 恢复辅助 ----------
    _resumeCurrentLevel() {
      const step = this.routine.steps[this.currentStepIndex];
      if (step) {
        this._runStepRound(step);
      } else {
        this._runStep();
      }
    }

    // ---------- 清理 ----------
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
      this.state = STATE.FINISHED;
      this._clearTimers();
      this._stopAudio();
      this._trigger('onComplete', {});
    }

    _trigger(eventName, data) {
      if (this.callbacks && typeof this.callbacks[eventName] === 'function') {
        try {
          this.callbacks[eventName](data);
        } catch (e) {
          console.error(`Engine callback error [${eventName}]:`, e);
        }
      }
    }

    getState() { return this.state; }
    isRunning() { return this.state === STATE.RUNNING; }
    isPaused() { return this.state === STATE.PAUSED; }
    isFinished() { return this.state === STATE.FINISHED; }
  }

  window.TrainingEngine = TrainingEngine;
})();