// js/training-runner.js - 训练执行引擎（完整版，修复组号重复播报）
(function() {
  'use strict';

  window.startTraining = function(routineId) {
    console.warn('⚠️ startTraining 正在初始化，请稍后重试');
  };

  const Utils = window.Utils || {};
  const { $, $$ } = Utils;
  const DB = window.DB;
  const AudioEngine = window.AudioEngine;
  const TrainingEngine = window.TrainingEngine;

  const navigateTo = window.navigateTo || function(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
    if (window.closeDrawer) window.closeDrawer();
  };

  let trainingEngine = null;
  let currentProjectId = null;

  // ================================================================
  // 数字 → 中文语音转换（自然化）
  // ================================================================

  // 用于数量：1→"一"，2→"两"，3→"三"，...
  function toQuantity(num) {
    const map = { 1: '一', 2: '两', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九' };
    return map[num] || num;
  }

  // 用于序数：1→"一"，2→"二"，3→"三"，...
  function toOrdinal(num) {
    const map = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九' };
    return map[num] || num;
  }

  // 用于"个循环" → "两个循环"
  function toCycle(num) {
    const map = { 1: '一', 2: '两', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九' };
    return map[num] || num;
  }

  // ================================================================
  // 调试输出
  // ================================================================
  function logSpeech(original, converted, context) {
    console.log(`🗣️ [语音调试] ${context}: "${original}" → "${converted}"`);
  }

  function getTrainingSettings() {
    try {
      if (window.TrainingSettings && typeof window.TrainingSettings.get === 'function') {
        const s = window.TrainingSettings.get();
        if (s) {
          return {
            soundEnabled: s.soundEnabled !== false,
            voiceEnabled: s.voiceEnabled !== false
          };
        }
      }
    } catch(e) {
      console.warn('⚠️ 获取 TrainingSettings 失败，使用默认值:', e);
    }
    return { soundEnabled: true, voiceEnabled: true };
  }

  function bindTrainingSwitches() {
    const soundBtn = document.getElementById('btn-training-sound');
    const voiceBtn = document.getElementById('btn-training-voice');
    if (!soundBtn || !voiceBtn) return;

    soundBtn.replaceWith(soundBtn.cloneNode(true));
    voiceBtn.replaceWith(voiceBtn.cloneNode(true));

    const newSoundBtn = document.getElementById('btn-training-sound');
    const newVoiceBtn = document.getElementById('btn-training-voice');

    newSoundBtn.addEventListener('click', function() {
      if (window.TrainingSettings) {
        window.TrainingSettings.toggleSound();
        const settings = window.TrainingSettings.get();
        if (trainingEngine) {
          trainingEngine.volume = settings.soundEnabled ? 0.8 : 0;
        }
        if (!settings.soundEnabled && trainingEngine) {
          AudioEngine.stopNodes(trainingEngine._audioNodes);
        }
      }
    });

    newVoiceBtn.addEventListener('click', function() {
      if (window.TrainingSettings) {
        window.TrainingSettings.toggleVoice();
        if (!window.TrainingSettings.get().voiceEnabled && window.SpeechEngine) {
          SpeechEngine.stop();
        }
      }
    });

    if (window.TrainingSettings) {
      window.TrainingSettings.syncUI();
    }
  }

  async function startTraining(routineId) {
    console.log(`🔍 [startTraining] 被调用, routineId: ${routineId}`);

    if (trainingEngine) {
      try { trainingEngine.stop(); } catch(e) {}
      trainingEngine = null;
    }

    const routine = await DB.getRoutine(routineId);
    if (!routine) {
      alert('训练组不存在，请刷新页面后重试');
      return;
    }
    const projects = await DB.getAllProjects();
    if (!projects.length) {
      alert('没有可用的训练动作');
      return;
    }

    const settings = getTrainingSettings();

    if (window.SpeechEngine) {
      SpeechEngine.stop();
      console.log('🔇 [startTraining] 已清空语音');
    }

    navigateTo('view-training');

    document.getElementById('training-title').textContent = routine.name || '训练';
    document.getElementById('training-progress').textContent = '准备中…';

    document.getElementById('btn-training-start').classList.remove('hidden');
    document.getElementById('btn-training-pause').classList.add('hidden');
    document.getElementById('btn-training-resume').classList.add('hidden');
    document.getElementById('btn-training-stop').classList.add('hidden');
    document.getElementById('training-countdown').textContent = '0';
    document.getElementById('training-project-name').textContent = '准备';
    document.getElementById('training-phase-label').textContent = '';
    document.getElementById('training-note').textContent = '';
    document.getElementById('training-image-img').style.display = 'none';
    document.getElementById('training-image-img').src = '';
    document.getElementById('breath-circle').setAttribute('r', '20');
    document.getElementById('breath-circle').setAttribute('fill', 'rgba(200,60,60,0.6)');
    document.getElementById('training-total-progress').style.width = '0%';

    currentProjectId = null;

    console.log('🏗️ [startTraining] 创建 TrainingEngine');

    const engineOptions = {
      callbacks: {
        // ---- 训练开始（等待） ----
        onStart: (data) => {
          console.log('📍 [onStart] 回调触发');

          if (data && data._waitForVoice) {
            if (settings.voiceEnabled && window.SpeechEngine) {
              const totalRounds = routine.rounds || 1;
              const totalSteps = routine.steps.filter(s => s.kind === 'project').length;
              const cyclesDisplay = toCycle(totalRounds);
              const stepsDisplay = toQuantity(totalSteps);
              const msg = `训练开始，共 ${cyclesDisplay} 个循环，${stepsDisplay} 个动作`;
              logSpeech(
                `共 ${totalRounds} 个循环，${totalSteps} 个动作`,
                `共 ${cyclesDisplay} 个循环，${stepsDisplay} 个动作`,
                '训练开始'
              );
              console.log(`📢 [onStart] 同步播报: "${msg}"`);
              SpeechEngine.speakSync(msg, 1.0, 1.0, () => {
                console.log(`✅ [onStart] 语音完成，继续执行`);
                document.getElementById('btn-training-start').classList.add('hidden');
                document.getElementById('btn-training-pause').classList.remove('hidden');
                document.getElementById('btn-training-stop').classList.remove('hidden');
                document.getElementById('training-progress').textContent = '1/1 · 动作 0/0 · 组 0/0 · 次 0/0';
                if (trainingEngine) {
                  trainingEngine.resumeAfterVoice();
                }
              });
            } else {
              document.getElementById('btn-training-start').classList.add('hidden');
              document.getElementById('btn-training-pause').classList.remove('hidden');
              document.getElementById('btn-training-stop').classList.remove('hidden');
              document.getElementById('training-progress').textContent = '1/1 · 动作 0/0 · 组 0/0 · 次 0/0';
              if (trainingEngine) {
                trainingEngine.resumeAfterVoice();
              }
            }
          } else {
            document.getElementById('btn-training-start').classList.add('hidden');
            document.getElementById('btn-training-pause').classList.remove('hidden');
            document.getElementById('btn-training-stop').classList.remove('hidden');
            document.getElementById('training-progress').textContent = '1/1 · 动作 0/0 · 组 0/0 · 次 0/0';
          }
        },

        // ---- 循环切换（等待） ----
        onRoundChange: (data) => {
          console.log(`📍 [onRoundChange] 回调触发, 第 ${data.current}/${data.total} 轮`);

          if (data && data._waitForVoice) {
            if (settings.voiceEnabled && window.SpeechEngine) {
              const ordinalDisplay = toOrdinal(data.current);
              const msg = `第 ${ordinalDisplay} 个循环`;
              logSpeech(
                `第 ${data.current} 个循环`,
                `第 ${ordinalDisplay} 个循环`,
                '循环切换'
              );
              console.log(`📢 [onRoundChange] 同步播报: "${msg}"`);
              SpeechEngine.speakSync(msg, 1.0, 1.0, () => {
                console.log(`✅ [onRoundChange] 语音完成，继续执行`);
                if (trainingEngine) {
                  trainingEngine.resumeAfterVoice();
                }
              });
            } else {
              if (trainingEngine) {
                trainingEngine.resumeAfterVoice();
              }
            }
          } else {
            // UI 更新（不播报）
          }
        },

        onStepChange: (data) => {},

        onCountdownTick: (data) => {
          const remaining = Math.ceil(data.remaining);
          document.getElementById('training-countdown').textContent = remaining;
          document.getElementById('training-project-name').textContent = '准备';
          document.getElementById('training-phase-label').textContent = `${remaining}s`;
        },

        // ---- 组开始 ----
        onGroupStart: (data) => {
          console.log(`📍 [onGroupStart] 回调触发, 组 ${data.group}/${data.totalGroups}, 动作: ${data.project?.name}`);
          console.log(`   isFirstAction: ${data.isFirstAction}, isFirstRep: ${data.isFirstRep}`);

          if (data && data._waitForVoice) {
            if (settings.voiceEnabled && window.SpeechEngine) {
              const project = data.project;
              const step = data.step;
              const groups = step?.rounds || 1;
              const reps = step?.reps || 1;

              // ============================================================
              // ★★★ 修复：只有 isFirstRep === true 时才播报组号 ★★★
              // ============================================================
              if (data.isFirstAction) {
                // 第一次执行该动作：播报 "动作名，X组，X次"
                const groupsDisplay = toQuantity(groups);
                const repsDisplay = toQuantity(reps);
                const msg1 = `${project.name}，${groupsDisplay}组，${repsDisplay}次`;
                logSpeech(
                  `${project.name}，${groups}组，${reps}次`,
                  `${project.name}，${groupsDisplay}组，${repsDisplay}次`,
                  '动作名+数量'
                );
                console.log(`📢 [onGroupStart] 同步播报动作名: "${msg1}"`);
                SpeechEngine.speakSync(msg1, 1.0, 1.0, () => {
                  console.log(`✅ [onGroupStart] 动作名语音完成`);
                  // ============================================================
                  // 只有 isFirstRep === true 时才播报组号
                  // ============================================================
                  if (data.isFirstRep) {
                    const ordinalDisplay = toOrdinal(data.group);
                    const msg2 = `第 ${ordinalDisplay} 组`;
                    logSpeech(
                      `第 ${data.group} 组`,
                      `第 ${ordinalDisplay} 组`,
                      '组号'
                    );
                    console.log(`📢 [onGroupStart] 同步播报组号: "${msg2}"`);
                    SpeechEngine.speakSync(msg2, 1.0, 1.0, () => {
                      console.log(`✅ [onGroupStart] 组号语音完成，继续执行`);
                      if (trainingEngine) {
                        trainingEngine.resumeAfterVoice();
                      }
                    });
                  } else {
                    console.log(`🔇 [onGroupStart] 组号不播报（非首次执行该组）`);
                    if (trainingEngine) {
                      trainingEngine.resumeAfterVoice();
                    }
                  }
                });
              } else if (data.isFirstRep) {
                // ============================================================
                // 非第一次执行该动作，但这是该组的第一次执行 → 只播报组号
                // ============================================================
                const ordinalDisplay = toOrdinal(data.group);
                const msg = `第 ${ordinalDisplay} 组`;
                logSpeech(
                  `第 ${data.group} 组`,
                  `第 ${ordinalDisplay} 组`,
                  '组号'
                );
                console.log(`📢 [onGroupStart] 同步播报组号: "${msg}"`);
                SpeechEngine.speakSync(msg, 1.0, 1.0, () => {
                  console.log(`✅ [onGroupStart] 组号语音完成，继续执行`);
                  if (trainingEngine) {
                    trainingEngine.resumeAfterVoice();
                  }
                });
              } else {
                // ============================================================
                // 非第一次执行该动作，且不是该组的第一次执行 → 不播报
                // ============================================================
                console.log(`🔇 [onGroupStart] 不播报（非首动作且非首次执行该组）`);
                if (trainingEngine) {
                  trainingEngine.resumeAfterVoice();
                }
              }
            } else {
              if (trainingEngine) {
                trainingEngine.resumeAfterVoice();
              }
            }
          }
        },

        // ---- 相位（不播报语音） ----
        onPhaseChange: (data) => {
          console.log(`📍 [onPhaseChange] 回调触发, 相位: ${data.phase.type}, 动作: ${data.project?.name}`);
          const phase = data.phase;
          const project = data.project;
          const step = data.step;

          document.getElementById('training-project-name').textContent = project?.name || '未命名';
          document.getElementById('training-phase-label').textContent = phase.type.toUpperCase();
          const note = step?.note || project?.defaultNote || '';
          document.getElementById('training-note').textContent = note ? `💬 ${note}` : '';

          console.log(`🔇 [onPhaseChange] 相位 ${phase.type} 不播报语音`);

          const img = document.getElementById('training-image-img');
          const newProjectId = project?.id || null;
          if (newProjectId !== currentProjectId) {
            currentProjectId = newProjectId;
            if (project && project.imageData && project.imageData.startsWith('data:image')) {
              img.src = project.imageData;
              img.style.display = 'block';
            } else {
              img.style.display = 'none';
              img.src = '';
            }
          }

          const roundText = `${data.groupRound || 1}/${data.totalGroupRounds || 1}`;
          const stepText = `动作 ${data.stepIndex || 1}/${data.totalSteps || 1}`;
          const groupText = `组 ${data.stepRound || 1}/${data.totalStepRounds || 1}`;
          const repText = `次 ${data.rep || 1}/${data.totalReps || 1}`;
          document.getElementById('training-progress').textContent =
            `${roundText} · ${stepText} · ${groupText} · ${repText}`;
        },

        onTick: (data) => {
          const remainingInt = Math.ceil(data.remaining);
          document.getElementById('training-countdown').textContent = remainingInt;

          const totalSec = data.duration;
          const elapsed = data.elapsed;
          const progressPercent = Math.min(100, (elapsed / totalSec) * 100);
          document.getElementById('training-total-progress').style.width = progressPercent + '%';

          const phase = data.phase;
          const progress = data.elapsed / data.duration;
          const circle = document.getElementById('breath-circle');
          const minR = 20, maxR = 110;
          let r, fill;

          if (phase.type === 'up') {
            r = minR + (maxR - minR) * progress;
            const intensity = 0.6 + 0.3 * progress;
            fill = `rgba(255, ${Math.round(80 - 60 * progress)}, ${Math.round(50 - 30 * progress)}, ${intensity})`;
          } else if (phase.type === 'down') {
            r = maxR - (maxR - minR) * progress;
            const intensity = 0.9 - 0.3 * progress;
            fill = `rgba(${Math.round(200 + 55 * progress)}, ${Math.round(50 + 30 * progress)}, ${Math.round(50 + 30 * progress)}, ${intensity})`;
          } else if (phase.type === 'hold') {
            r = maxR;
            fill = 'rgba(180, 20, 20, 0.9)';
          } else {
            r = 20;
            fill = 'rgba(200,60,60,0.6)';
          }
          circle.setAttribute('r', r.toFixed(1));
          circle.setAttribute('fill', fill);
        },

        // ---- 休息开始（不等待） ----
        onRestStart: (data) => {
          console.log(`📍 [onRestStart] 回调触发, type: ${data.type}`);
          document.getElementById('training-project-name').textContent = '🛑 休息';
          document.getElementById('training-phase-label').textContent = `${data.type.toUpperCase()} 休息`;
          document.getElementById('training-note').textContent = data.type === 'round' ? '循环间大休' : '组间休息';
          document.getElementById('training-image-img').style.display = 'none';
          document.getElementById('training-countdown').textContent = Math.ceil(data.remaining);
          document.getElementById('training-total-progress').style.width = '0%';
        },

        onRestTick: (data) => {
          const remaining = Math.ceil(data.remaining);
          document.getElementById('training-countdown').textContent = remaining;
          const progressPercent = 100 - (remaining / data.duration) * 100;
          document.getElementById('training-total-progress').style.width = progressPercent + '%';
        },

        // ---- 训练完成（等待） ----
        onComplete: (data) => {
          console.log(`📍 [onComplete] 回调触发`);

          if (data && data._waitForVoice) {
            if (settings.voiceEnabled && window.SpeechEngine) {
              console.log(`📢 [onComplete] 同步播报: "训练完成"`);
              SpeechEngine.speakSync('训练完成', 1.0, 1.0, () => {
                console.log(`✅ [onComplete] 语音完成，结束训练`);
                document.getElementById('training-project-name').textContent = '🎉 完成！';
                document.getElementById('training-phase-label').textContent = '';
                document.getElementById('training-countdown').textContent = '0';
                document.getElementById('btn-training-pause').classList.add('hidden');
                document.getElementById('btn-training-resume').classList.add('hidden');
                document.getElementById('btn-training-stop').classList.add('hidden');
                document.getElementById('training-progress').textContent = '完成 🎉';
                document.getElementById('training-total-progress').style.width = '100%';
                AudioEngine.playDingDong(0.8);
                if (trainingEngine) {
                  trainingEngine.resumeAfterVoice();
                }
              });
            } else {
              document.getElementById('training-project-name').textContent = '🎉 完成！';
              document.getElementById('training-phase-label').textContent = '';
              document.getElementById('training-countdown').textContent = '0';
              document.getElementById('btn-training-pause').classList.add('hidden');
              document.getElementById('btn-training-resume').classList.add('hidden');
              document.getElementById('btn-training-stop').classList.add('hidden');
              document.getElementById('training-progress').textContent = '完成 🎉';
              document.getElementById('training-total-progress').style.width = '100%';
              AudioEngine.playDingDong(0.8);
              if (trainingEngine) {
                trainingEngine.resumeAfterVoice();
              }
            }
          } else {
            document.getElementById('training-project-name').textContent = '🎉 完成！';
            document.getElementById('training-phase-label').textContent = '';
            document.getElementById('training-countdown').textContent = '0';
            document.getElementById('btn-training-pause').classList.add('hidden');
            document.getElementById('btn-training-resume').classList.add('hidden');
            document.getElementById('btn-training-stop').classList.add('hidden');
            document.getElementById('training-progress').textContent = '完成 🎉';
            document.getElementById('training-total-progress').style.width = '100%';
            AudioEngine.playDingDong(0.8);
            trainingEngine = null;
          }
        },

        onStop: () => {
          console.log(`📍 [onStop] 回调触发`);
          if (window.SpeechEngine) {
            SpeechEngine.stop();
          }
          trainingEngine = null;
          navigateTo('view-home');
          if (window.RoutinesEditor && typeof window.RoutinesEditor.renderHome === 'function') {
            setTimeout(() => {
              window.RoutinesEditor.renderHome();
            }, 100);
          }
        }
      },
      volume: settings.soundEnabled ? 0.8 : 0
    };

    engineOptions._voiceEnabled = settings.voiceEnabled;

    trainingEngine = new TrainingEngine(engineOptions);
    trainingEngine.load(routine, projects);
    console.log('📦 [startTraining] 引擎已加载，训练组:', routine.name, '动作数:', projects.length);

    const startBtn = document.getElementById('btn-training-start');
    startBtn.replaceWith(startBtn.cloneNode(true));
    const newStartBtn = document.getElementById('btn-training-start');
    newStartBtn.addEventListener('click', function onClickStart() {
      console.log('▶️ [点击开始] 用户点击开始按钮');
      AudioEngine.ensure();
      trainingEngine.start();
      this.removeEventListener('click', onClickStart);
    });

    bindTrainingSwitches();

    console.log('✅ [startTraining] 训练页准备完成，等待用户点击「开始」');
  }

  // ---- 训练控制 ----
  document.getElementById('btn-training-pause').addEventListener('click', () => {
    if (trainingEngine) {
      trainingEngine.pause();
      document.getElementById('btn-training-pause').classList.add('hidden');
      document.getElementById('btn-training-resume').classList.remove('hidden');
    }
  });

  document.getElementById('btn-training-resume').addEventListener('click', () => {
    if (trainingEngine) {
      trainingEngine.resume();
      document.getElementById('btn-training-resume').classList.add('hidden');
      document.getElementById('btn-training-pause').classList.remove('hidden');
    }
  });

  document.getElementById('btn-training-stop').addEventListener('click', () => {
    if (confirm('结束训练？')) {
      if (trainingEngine) trainingEngine.stop();
    }
  });

  document.getElementById('btn-training-back').addEventListener('click', () => {
    if (trainingEngine && trainingEngine.isRunning()) {
      if (!confirm('训练进行中，确定退出？')) return;
      trainingEngine.stop();
    } else {
      navigateTo('view-home');
      if (window.RoutinesEditor && typeof window.RoutinesEditor.renderHome === 'function') {
        setTimeout(() => {
          window.RoutinesEditor.renderHome();
        }, 100);
      }
    }
  });

  // ---- 键盘快捷键 ----
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      const trainingView = document.getElementById('view-training');
      if (!trainingView.classList.contains('active')) return;
      const startBtn = document.getElementById('btn-training-start');
      const pauseBtn = document.getElementById('btn-training-pause');
      const resumeBtn = document.getElementById('btn-training-resume');
      if (!startBtn.classList.contains('hidden')) { startBtn.click(); }
      else if (!pauseBtn.classList.contains('hidden')) { pauseBtn.click(); }
      else if (!resumeBtn.classList.contains('hidden')) { resumeBtn.click(); }
    }
    if (e.code === 'Escape') {
      const trainingView = document.getElementById('view-training');
      if (trainingView.classList.contains('active')) {
        document.getElementById('btn-training-stop').click();
      }
    }
  });

  // ---- 主页语音开关 ----
  const speechToggle = document.getElementById('btn-speech-toggle');
  if (speechToggle) {
    speechToggle.addEventListener('click', function() {
      if (window.TrainingSettings) {
        window.TrainingSettings.toggleVoice();
        const settings = window.TrainingSettings.get();
        this.textContent = settings.voiceEnabled ? '🗣️ 语音 ON' : '🗣️ 语音 OFF';
        if (!settings.voiceEnabled && window.SpeechEngine) {
          SpeechEngine.stop();
        }
      }
    });
  }

  window.startTraining = startTraining;

  console.log('✅ TrainingRunner 已加载（完整版，修复组号重复播报）');

})();