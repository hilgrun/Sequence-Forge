// js/engine.js - 四层嵌套训练状态机（完整版，带自定义播报文案标记）
(function() {
  'use strict';

  const STATE = {
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    WAITING_VOICE: 'waiting_voice',
    FINISHED: 'finished'
  };

  class TrainingEngine {
    constructor(options = {}) {
      this.routine = null;
      this.projects = [];
      this.callbacks = options.callbacks || {};
      this.volume = options.volume ?? 0.8;

      this.state = STATE.IDLE;
      this.currentRound = 0;
      this.currentStepIndex = 0;
      this.currentStepRound = 0;
      this.currentRep = 0;
      this.currentPhaseIndex = 0;
      this.phaseElapsed = 0;
      this.phaseRemaining = 0;

      this._timerId = null;
      this._holdTickId = null;
      this._audioNodes = [];
      this._lastBeepSecond = -1;
      this._isCountdown = false;
      this._pendingAction = null;
      this._actionSpoken = new Set();

      console.log('🏋️ TrainingEngine 实例已创建');
    }

    load(routine, projects) {
      console.log('📦 [load] 加载训练组:', routine.name);
      this.routine = routine;
      this.projects = projects;
      this._totalActionSteps = routine.steps.filter(s => s.kind === 'project').length;
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
      this._pendingAction = null;
      this._actionSpoken = new Set();
    }

    resumeAfterVoice() {
      console.log('🔊 [resumeAfterVoice] 语音播报完成，继续执行');
      if (this.state !== STATE.WAITING_VOICE) {
        console.log('⚠️ [resumeAfterVoice] 不在等待状态，忽略');
        return;
      }
      this.state = STATE.RUNNING;
      if (this._pendingAction) {
        const action = this._pendingAction;
        this._pendingAction = null;
        action();
      }
    }

    start() {
      console.log('🚀 [start] 引擎启动');
      if (!this.routine || this.routine.steps.length === 0) {
        console.error('❌ 没有训练组或步骤为空');
        return;
      }
      if (this.state === STATE.RUNNING || this.state === STATE.WAITING_VOICE) {
        console.warn('⚠️ 已在运行或等待中');
        return;
      }
      if (this.state === STATE.PAUSED) {
        console.log('⏸️ [start] 从暂停状态恢复');
        this.resume();
        return;
      }

      this._resetCounters();
      this.state = STATE.RUNNING;
      console.log('🏃 [start] 状态设置为 RUNNING');

      this.state = STATE.WAITING_VOICE;
      this._pendingAction = () => {
        console.log('✅ [start] 训练开始语音完成，开始倒计时');
        const countdown = this.routine.countdown || 0;
        if (countdown > 0) {
          console.log(`⏱️ [start] 开始倒计时 ${countdown}s`);
          this._startCountdown(countdown, () => {
            console.log('⏱️ [start] 倒计时结束，开始训练');
            this._runRound();
          });
        } else {
          this._runRound();
        }
      };
      this._trigger('onStart', { routine: this.routine, _waitForVoice: true });
    }

    pause() {
      if (this.state !== STATE.RUNNING && this.state !== STATE.WAITING_VOICE) return;
      console.log('⏸️ [pause] 暂停训练');
      this.state = STATE.PAUSED;
      this._clearTimers();
      this._stopAudio();
      this._trigger('onPause', {});
    }

    resume() {
      if (this.state !== STATE.PAUSED) return;
      console.log('▶️ [resume] 恢复训练');
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
      console.log('⏹️ [stop] 停止训练');
      this._resetCounters();
      this.state = STATE.IDLE;
      this._stopAudio();
      this._trigger('onStop', {});
    }

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
        console.log('🏁 [_runRound] 所有循环完成');
        this._finish();
        return;
      }
      console.log(`🔄 [_runRound] 开始第 ${this.currentRound + 1}/${this.routine.rounds} 轮`);

      // ---- 每个循环重置动作播报记录 ----
      this._actionSpoken = new Set();

      this.state = STATE.WAITING_VOICE;
      this._pendingAction = () => {
        console.log(`✅ [_runRound] 循环语音完成，继续执行`);
        this._trigger('onRoundChange', {
          current: this.currentRound + 1,
          total: this.routine.rounds
        });
        this.currentStepIndex = 0;
        this._runStep();
      };
      this._trigger('onRoundChange', {
        current: this.currentRound + 1,
        total: this.routine.rounds,
        _waitForVoice: true
      });
    }

    _runStep() {
      if (this.currentStepIndex >= this.routine.steps.length) {
        console.log(`✅ [_runStep] 本轮所有步骤完成，进入下一轮`);
        this.currentRound++;
        this._runRound();
        return;
      }

      const step = this.routine.steps[this.currentStepIndex];
      console.log(`📋 [_runStep] 执行步骤 ${this.currentStepIndex + 1}/${this.routine.steps.length}, kind: ${step.kind}`);
      this.currentStepRound = 0;
      this.currentRep = 0;
      this._trigger('onStepChange', {
        index: this.currentStepIndex + 1,
        total: this.routine.steps.length,
        step: step
      });
      this._runStepRound(step);
    }

    _runStepRound(step) {
      if (this.currentStepRound >= (step.rounds || 1)) {
        console.log(`✅ [_runStepRound] 步骤 ${step.kind} 所有组完成`);
        const isLastStep = this.currentStepIndex === this.routine.steps.length - 1;
        const isLastRound = this.currentRound === this.routine.rounds - 1;
        if (isLastStep && isLastRound) {
          console.log('🏁 [_runStepRound] 所有步骤完成，结束训练');
          this._finish();
          return;
        }
        this.currentStepIndex++;
        this._runStep();
        return;
      }

      // ============================================================
      // 休息块（动作间休息）－ type: 'action'
      // ============================================================
      if (step.kind === 'rest') {
        const dur = step.duration || 0;
        console.log(`🛑 [_runStepRound] 休息块 ${dur}分钟`);
        this._startRest(dur * 60, 'action', () => {
          console.log(`✅ [_runStepRound] 休息完成，进入下一组`);
          this.currentStepRound++;
          this._runStepRound(step);
        });
        return;
      }

      const reps = step.reps || 1;
      if (this.currentRep >= reps) {
        console.log(`✅ [_runStepRound] 当前组次数完成 (${this.currentRep}/${reps})，进入下一组`);
        this.currentRep = 0;
        this.currentStepRound++;
        // ============================================================
        // 组间休息 － type: 'group'
        // ============================================================
        if (this.currentStepRound < step.rounds && step.restAfter > 0) {
          console.log(`🛑 [_runStepRound] 组间休息 ${step.restAfter}分钟`);
          this._startRest(step.restAfter * 60, 'group', () => {
            this._runStepRound(step);
          });
          return;
        }
        this._runStepRound(step);
        return;
      }

      const project = this.projects.find(p => p.id === step.projectId);
      if (!project) {
        console.warn(`⚠️ 找不到动作 ${step.projectId}，跳过`);
        this.currentRep++;
        this._runStepRound(step);
        return;
      }

      console.log(`🏋️ [_runStepRound] 执行动作: ${project.name}, 组 ${this.currentStepRound + 1}/${step.rounds}, 次 ${this.currentRep + 1}/${reps}`);

      const isFirstGroup = (this.currentStepRound === 0);
      const isFirstRep = (this.currentRep === 0);
      const isFirstAction = !this._actionSpoken.has(project.id);

      if (isFirstAction) {
        this._actionSpoken.add(project.id);
      }

      this.state = STATE.WAITING_VOICE;
      this._pendingAction = () => {
        console.log(`✅ [_runStepRound] 语音完成，开始相位`);
        this.currentPhaseIndex = 0;
        this._runPhase(project, step, () => {
          console.log(`✅ [_runStepRound] 动作 ${project.name} 本次完成，次数+1`);
          this.currentRep++;
          this._runStepRound(step);
        }, this.currentStepIndex, this.routine.steps.length);
      };

      this._trigger('onGroupStart', {
        project: project,
        step: step,
        group: this.currentStepRound + 1,
        totalGroups: step.rounds || 1,
        isFirstGroup: isFirstGroup,
        isFirstRep: isFirstRep,
        isFirstAction: isFirstAction,
        _waitForVoice: true
      });
    }

    _runPhase(project, step, onComplete, stepIndex, totalSteps) {
      if (this.currentPhaseIndex >= project.phases.length) {
        console.log(`✅ [_runPhase] 所有相位完成`);
        if (onComplete) onComplete();
        return;
      }

      const phase = project.phases[this.currentPhaseIndex];
      const duration = phase.duration || 0;
      if (duration <= 0) {
        console.log(`⚠️ [_runPhase] 相位 ${phase.type} 时长为0，跳过`);
        this.currentPhaseIndex++;
        this._runPhase(project, step, onComplete, stepIndex, totalSteps);
        return;
      }

      this.currentPhase = phase;
      this.phaseRemaining = 0;

      const reps = step.reps || 1;
      console.log(`🔄 [_runPhase] 相位 ${phase.type} (${this.currentPhaseIndex + 1}/${project.phases.length}), 时长 ${duration}s`);

      this._trigger('onPhaseChange', {
        phase: phase,
        project: project,
        step: step,
        index: this.currentPhaseIndex + 1,
        total: project.phases.length,
        groupRound: this.currentRound + 1,
        totalGroupRounds: this.routine.rounds,
        stepIndex: stepIndex + 1,
        totalSteps: this._totalActionSteps,
        stepRound: this.currentStepRound + 1,
        totalStepRounds: step.rounds || 1,
        rep: this.currentRep + 1,
        totalReps: reps
      });

      console.log(`🔇 [_runPhase] 相位 ${phase.type} 不播报语音`);

      this._startPhaseWithDuration(phase, duration, false, () => {
        console.log(`✅ [_runPhase] 相位 ${phase.type} 执行完成`);
        this.currentPhaseIndex++;
        this._runPhase(project, step, onComplete, stepIndex, totalSteps);
      });
    }

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

    // ================================================================
    // 休息语音播报 － 你可以在这里自定义播报文案
    // ================================================================
    _startRest(totalSeconds, type, onComplete) {
      console.log(`🛑 [_startRest] 开始休息, type: ${type}, seconds: ${totalSeconds}`);

      if (totalSeconds <= 0) {
        console.log(`⚠️ [_startRest] 休息时长为0，跳过`);
        if (onComplete) onComplete();
        return;
      }

      this._clearTimers();
      this._stopAudio();
      this._lastBeepSecond = -1;

      const SpeechEngine = window.SpeechEngine;
      if (SpeechEngine) {
        // ============================================================
        // ★★★ 自定义播报文案区域 ★★★
        // 你可以修改下面每个 case 中的字符串内容来改变播报语音
        // ============================================================
        let restMsg;
        let displayTime;

        if (type === 'round') {
          // 循环间大休（当前未使用，保留）
          restMsg = '组间休息';
        } else if (type === 'group') {
          // 组间休息（两组动作之间的休息）
          if (totalSeconds >= 60) {
            displayTime = Math.round((totalSeconds / 60) * 10) / 10;
            restMsg = `休息 ${displayTime} 分钟`;   // ← 改这里可自定义
          } else {
            restMsg = `休息 ${Math.ceil(totalSeconds)} 秒`; // ← 改这里
          }
        } else if (type === 'action') {
          // 动作间休息（独立休息块）
          if (totalSeconds >= 60) {
            displayTime = Math.round((totalSeconds / 60) * 10) / 10;
            restMsg = `动作间休息 ${displayTime} 分钟`; // ← 改这里
          } else {
            restMsg = `休息 ${Math.ceil(totalSeconds)} 秒，准备下一个动作`; // ← 改这里
          }
        } else {
          restMsg = `休息 ${Math.ceil(totalSeconds)} 秒`;
        }

        console.log(`📢 [_startRest] 异步播报休息语音: "${restMsg}"`);
        SpeechEngine.speak(restMsg);
      }

      this._startRestTimer(totalSeconds, type, onComplete);
    }

    _startRestTimer(totalSeconds, type, onComplete) {
      console.log(`⏱️ [_startRestTimer] 开始休息计时 ${totalSeconds}s`);
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
          console.log(`✅ [_startRestTimer] 休息完成`);
          this._trigger('onRestEnd', { type });
          if (onComplete) onComplete();
        }
      }, 100);
    }

    _resumeCurrentLevel() {
      const step = this.routine.steps[this.currentStepIndex];
      if (step) {
        this._runStepRound(step);
      } else {
        this._runStep();
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
      console.log('🏁 [_finish] 训练结束');
      const SpeechEngine = window.SpeechEngine;
      if (SpeechEngine && this.callbacks._voiceEnabled !== false) {
        this.state = STATE.WAITING_VOICE;
        this._pendingAction = () => {
          this.state = STATE.FINISHED;
          this._clearTimers();
          this._stopAudio();
          this._trigger('onComplete', {});
        };
        this._trigger('onComplete', { _waitForVoice: true });
      } else {
        this.state = STATE.FINISHED;
        this._clearTimers();
        this._stopAudio();
        this._trigger('onComplete', {});
      }
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
    isRunning() { return this.state === STATE.RUNNING || this.state === STATE.WAITING_VOICE; }
    isPaused() { return this.state === STATE.PAUSED; }
    isFinished() { return this.state === STATE.FINISHED; }
  }

  window.TrainingEngine = TrainingEngine;

  console.log('✅ TrainingEngine 已加载（完整版）');

})();