// js/app.js - 主控制器（最终版，顶部显示 组/项目/循环 三个进度）
(function() {
  'use strict';
  const { $, $$, toggleVisible, generateId, formatTime, minutesToSeconds, estimateTotalDuration, deepClone } = window.Utils;
  const DB = window.DB;
  const AudioEngine = window.AudioEngine;
  const TrainingEngine = window.TrainingEngine;

  // ---------- 全局状态 ----------
  let allProjects = [];
  let allRoutines = [];
  let currentRoutineId = null;
  let editingProjectId = null;
  let editingPhases = [];
  let trainingEngine = null;

  // ---------- 路由 ----------
  function navigateTo(viewId) {
    $$('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
    closeDrawer();
  }

  // ---------- 抽屉控制 ----------
  function openDrawer() {
    document.getElementById('project-drawer').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    document.getElementById('project-drawer').classList.remove('open');
    document.body.style.overflow = '';
  }

  // ---------- 渲染：主页 ----------
  async function renderHome() {
    allRoutines = await DB.getAllRoutines();
    allProjects = await DB.getAllProjects();
    const container = document.getElementById('routine-list');
    if (!allRoutines.length) {
      container.innerHTML = '<div class="empty-state">没有训练组，点击下方创建</div>';
      return;
    }
    container.innerHTML = allRoutines.map(r => {
      const est = estimateTotalDuration(r, allProjects);
      const stepsCount = r.steps.length;
      return `
        <div class="routine-card" data-id="${r.id}">
          <div class="card-title">${r.name || '未命名组'}</div>
          <div class="card-meta">
            <span>${stepsCount} 个动作</span>
            <span>⏱ ${formatTime(est)}</span>
            <span class="card-badge">循环 ×${r.rounds}</span>
          </div>
          <div class="card-actions">
            <button class="btn-copy-routine" data-id="${r.id}" title="复制训练组">📋</button>
            <button class="btn-edit-routine" data-id="${r.id}" title="编辑训练组">✏️</button>
            <button class="btn-delete-routine" data-id="${r.id}" title="删除训练组">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // 点击卡片主体 → 开始训练
    container.querySelectorAll('.routine-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.btn-edit-routine')) return;
        if (e.target.closest('.btn-copy-routine')) return;
        if (e.target.closest('.btn-delete-routine')) return;
        const id = el.dataset.id;
        console.log('🔍 点击卡片，ID:', id);
        startTraining(id);
      });
    });

    // 编辑按钮 → 打开训练组编辑器
    container.querySelectorAll('.btn-edit-routine').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRoutineEditor(btn.dataset.id);
      });
    });

    // 复制按钮
    container.querySelectorAll('.btn-copy-routine').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const original = await DB.getRoutine(id);
        if (!original) {
          alert('原训练组不存在');
          return;
        }
        const copy = deepClone(original);
        copy.id = generateId();
        copy.name = original.name + ' (副本)';
        await DB.saveRoutine(copy);
        await renderHome();
        console.log('📋 已复制训练组:', original.name, '→', copy.name);
      });
    });

    // ---- 删除按钮 ----
    container.querySelectorAll('.btn-delete-routine').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        // 获取训练组名称用于确认提示
        const routine = await DB.getRoutine(id);
        if (!routine) {
          alert('训练组不存在');
          return;
        }
        if (confirm(`确定要删除训练组「${routine.name}」吗？此操作不可撤销。`)) {
          await DB.deleteRoutine(id);
          await renderHome();
          console.log('🗑️ 已删除训练组:', routine.name);
        }
      });
    });
  }

  // ---------- 渲染：项目列表 ----------
  async function renderProjects() {
    allProjects = await DB.getAllProjects();
    const container = document.getElementById('project-list');
    if (!allProjects.length) {
      container.innerHTML = '<div class="empty-state">还没有项目，点击「新建」创建</div>';
      return;
    }
    container.innerHTML = allProjects.map(p => {
      const phaseChips = p.phases.map(ph => `<span class="phase-chip">${ph.type} ${ph.duration}s</span>`).join('');
      const imgHtml = p.imageData ? `<img class="thumb" src="${p.imageData}" alt="">` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:1.2rem;">🖼️</div>`;
      return `
        <div class="project-item" data-id="${p.id}">
          ${imgHtml}
          <div class="info">
            <div class="name">${p.name}</div>
            <div class="phases">${phaseChips}</div>
          </div>
          <div class="actions">
            <button class="btn-edit-project" data-id="${p.id}">✏️</button>
            <button class="btn-delete-project" data-id="${p.id}">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-edit-project').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openProjectDrawer(b.dataset.id);
    }));
    container.querySelectorAll('.btn-delete-project').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('删除此项目？')) {
        await DB.deleteProject(b.dataset.id);
        renderProjects();
        renderHome();
      }
    }));
  }

  // ---------- 项目抽屉 ----------
  async function openProjectDrawer(id = null) {
    editingProjectId = id;
    const title = document.getElementById('project-drawer-title');
    const nameInput = document.getElementById('project-name');
    const noteInput = document.getElementById('project-note');
    const preview = document.getElementById('project-image-preview');

    nameInput.value = '';
    noteInput.value = '';
    preview.innerHTML = '';
    document.getElementById('project-image-input').value = '';
    document.getElementById('btn-remove-image').style.display = 'none';

    if (id) {
      title.textContent = '编辑项目';
      const p = await DB.getProject(id);
      if (p) {
        nameInput.value = p.name || '';
        noteInput.value = p.defaultNote || '';
        if (p.imageData) {
          preview.innerHTML = `<img src="${p.imageData}" alt="">`;
          document.getElementById('btn-remove-image').style.display = 'inline-block';
        }
        editingPhases = p.phases.map(ph => ({ ...ph }));
      }
    } else {
      title.textContent = '新建项目';
      editingPhases = [];
    }
    renderPhaseChips();
    openDrawer();
  }

  function renderPhaseChips() {
    const container = document.getElementById('phase-list');
    if (!editingPhases.length) {
      container.innerHTML = '<span style="color:var(--muted);font-size:0.8rem;">暂无相位，点击下方添加</span>';
      return;
    }
    container.innerHTML = editingPhases.map((ph, idx) => `
      <span class="phase-chip-edit">
        ${ph.type}
        <button class="step-btn" data-idx="${idx}" data-dir="-0.5">−</button>
        <span class="duration-value" data-idx="${idx}">${ph.duration.toFixed(1)}s</span>
        <button class="step-btn" data-idx="${idx}" data-dir="0.5">＋</button>
        <span class="del" data-idx="${idx}">×</span>
      </span>
    `).join('');

    container.querySelectorAll('.step-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.idx);
        const dir = parseFloat(this.dataset.dir);
        let newVal = editingPhases[idx].duration + dir;
        newVal = Math.min(60, Math.max(0.1, newVal));
        editingPhases[idx].duration = Math.round(newVal * 10) / 10;
        renderPhaseChips();
      });
    });

    container.querySelectorAll('.duration-value').forEach(el => {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.idx);
        const current = editingPhases[idx];
        if (!current) return;
        const input = prompt(
          `设置「${current.type}」的时长（秒，范围 0.1–60）：`,
          current.duration.toFixed(1)
        );
        if (input === null) return;
        const val = parseFloat(input);
        if (isNaN(val) || val < 0.1 || val > 60) {
          alert('请输入 0.1 到 60 之间的数值');
          return;
        }
        editingPhases[idx].duration = Math.round(val * 10) / 10;
        renderPhaseChips();
      });
    });

    container.querySelectorAll('.del').forEach(el => {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.idx);
        if (confirm(`删除「${editingPhases[idx].type}」相位？`)) {
          editingPhases.splice(idx, 1);
          renderPhaseChips();
        }
      });
    });
  }

  document.querySelectorAll('.btn-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.phase;
      editingPhases.push({ type, duration: 1.0 });
      renderPhaseChips();
    });
  });

  document.getElementById('btn-remove-image').addEventListener('click', () => {
    document.getElementById('project-image-preview').innerHTML = '';
    document.getElementById('project-image-input').value = '';
    document.getElementById('btn-remove-image').style.display = 'none';
  });

  document.getElementById('project-image-input').addEventListener('change', function(e) {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = document.getElementById('project-image-preview');
      preview.innerHTML = `<img src="${ev.target.result}" alt="">`;
      document.getElementById('btn-remove-image').style.display = 'inline-block';
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-project-save').addEventListener('click', async () => {
    const name = document.getElementById('project-name').value.trim();
    if (!name) { alert('请输入项目名'); return; }
    if (!editingPhases.length) { alert('请至少添加一个相位'); return; }

    const note = document.getElementById('project-note').value.trim();
    let imageData = null;
    const preview = document.getElementById('project-image-preview');
    if (preview.querySelector('img')) {
      imageData = preview.querySelector('img').src;
    }

    const project = {
      id: editingProjectId || generateId(),
      name,
      phases: editingPhases.map(ph => ({ ...ph })),
      defaultNote: note,
      imageData: imageData
    };
    await DB.saveProject(project);
    closeDrawer();
    renderProjects();
    renderHome();
  });

  document.getElementById('btn-project-cancel').addEventListener('click', closeDrawer);
  document.getElementById('btn-new-project').addEventListener('click', () => openProjectDrawer(null));

  // ---------- 训练组编辑器 ----------
  async function openRoutineEditor(id = null) {
    currentRoutineId = id;
    navigateTo('view-routines');

    const title = document.getElementById('routine-editor-title');
    const nameInput = document.getElementById('routine-name');
    const roundsSpan = document.getElementById('routine-rounds');
    const restSlider = document.getElementById('routine-rest-between');
    const restVal = document.getElementById('routine-rest-between-val');
    const countdownSlider = document.getElementById('routine-countdown');
    const countdownVal = document.getElementById('routine-countdown-val');

    allProjects = await DB.getAllProjects();

    let routine = { id: null, name: '', rounds: 3, restBetweenRounds: 2, countdown: 3, steps: [] };
    if (id) {
      const found = await DB.getRoutine(id);
      if (found) routine = found;
      title.textContent = '编辑训练组';
    } else {
      title.textContent = '新建训练组';
    }

    currentRoutineId = routine.id;
    nameInput.value = routine.name || '';
    roundsSpan.textContent = routine.rounds || 3;
    restSlider.value = routine.restBetweenRounds || 2;
    restVal.textContent = (routine.restBetweenRounds || 2).toFixed(1) + ' min';
    countdownSlider.value = routine.countdown || 3;
    countdownVal.textContent = (routine.countdown || 3) + ' s';

    window._currentSteps = routine.steps.map(s => deepClone(s));
    renderSteps(window._currentSteps);
  }

  function renderSteps(steps) {
    const container = document.getElementById('step-list');
    if (!steps.length) {
      container.innerHTML = '<div class="empty-state">点击下方添加步骤</div>';
      return;
    }
    container.innerHTML = steps.map((step, idx) => {
      const isRest = step.kind === 'rest';
      const name = isRest ? '🛑 休息' : (allProjects.find(p => p.id === step.projectId)?.name || '未命名项目');
      const detail = isRest
        ? `${step.duration} min`
        : `×${step.rounds} · 组间短歇 ${step.restAfter || 0} min`;
      const note = step.note ? ` 💬 ${step.note}` : '';
      return `
        <div class="step-card ${isRest ? 'rest-step' : 'project-step'}">
          <span class="step-index">${idx + 1}</span>
          <div class="step-info">
            <div class="step-name">${name}${note}</div>
            <div class="step-detail">${detail}</div>
          </div>
          <div class="step-actions">
            <button class="btn-edit-step" data-idx="${idx}">✏️</button>
            <button class="btn-move-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn-move-down" data-idx="${idx}" ${idx === steps.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn-delete-step" data-idx="${idx}">✖</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-edit-step').forEach(b => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.idx);
        const step = window._currentSteps[idx];
        if (!step) return;
        if (step.kind === 'rest') {
          const dur = prompt('休息时长（分钟）：', step.duration);
          if (dur !== null && !isNaN(parseFloat(dur)) && parseFloat(dur) > 0) {
            step.duration = parseFloat(dur);
            const note = prompt('备注（可选）：', step.note || '');
            if (note !== null) step.note = note;
            renderSteps(window._currentSteps);
          }
        } else {
          const rounds = prompt('循环次数：', step.rounds);
          if (rounds !== null && !isNaN(parseInt(rounds)) && parseInt(rounds) > 0) {
            step.rounds = parseInt(rounds);
          }
          const rest = prompt('组间短歇（分钟）：', step.restAfter);
          if (rest !== null && !isNaN(parseFloat(rest)) && parseFloat(rest) >= 0) {
            step.restAfter = parseFloat(rest);
          }
          const note = prompt('备注（可选）：', step.note || '');
          if (note !== null) step.note = note;
          renderSteps(window._currentSteps);
        }
      });
    });

    container.querySelectorAll('.btn-move-up').forEach(b => b.addEventListener('click', () => moveStep(parseInt(b.dataset.idx), -1)));
    container.querySelectorAll('.btn-move-down').forEach(b => b.addEventListener('click', () => moveStep(parseInt(b.dataset.idx), 1)));
    container.querySelectorAll('.btn-delete-step').forEach(b => b.addEventListener('click', () => {
      if (confirm('删除此步骤？')) {
        const idx = parseInt(b.dataset.idx);
        window._currentSteps.splice(idx, 1);
        renderSteps(window._currentSteps);
      }
    }));
  }

  function moveStep(idx, dir) {
    const steps = window._currentSteps;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= steps.length) return;
    [steps[idx], steps[newIdx]] = [steps[newIdx], steps[idx]];
    renderSteps(steps);
  }

  document.getElementById('btn-append-project').addEventListener('click', () => {
    const steps = window._currentSteps;
    if (!allProjects.length) {
      alert('请先创建训练项目');
      return;
    }
    const names = allProjects.map((p, i) => `${i+1}. ${p.name}`).join('\n');
    const choice = prompt(`选择项目（输入编号）：\n${names}`);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= allProjects.length) { alert('无效编号'); return; }
    const project = allProjects[idx];
    steps.push({
      kind: 'project',
      projectId: project.id,
      rounds: 3,
      restAfter: 5,
      note: ''
    });
    steps.push({
      kind: 'rest',
      duration: 5,
      note: '自动恢复'
    });
    renderSteps(steps);
  });

  document.getElementById('btn-append-rest').addEventListener('click', () => {
    const steps = window._currentSteps;
    steps.push({
      kind: 'rest',
      duration: 5,
      note: '休息'
    });
    renderSteps(steps);
  });

  // 保存训练组
  document.getElementById('btn-save-routine').addEventListener('click', async () => {
    const name = document.getElementById('routine-name').value.trim();
    if (!name) { alert('请输入组名'); return; }
    const rounds = parseInt(document.getElementById('routine-rounds').textContent);
    const restBetweenRounds = parseFloat(document.getElementById('routine-rest-between').value);
    const countdown = parseInt(document.getElementById('routine-countdown').value);
    const steps = window._currentSteps || [];
    if (!steps.length) { alert('请至少添加一个步骤'); return; }

    const routine = {
      id: currentRoutineId || generateId(),
      name,
      rounds,
      restBetweenRounds,
      countdown: countdown || 0,
      steps: steps.map(s => deepClone(s))
    };
    await DB.saveRoutine(routine);
    await renderHome();
    navigateTo('view-home');
  });

  // 训练组元数据操作
  document.querySelectorAll('.btn-stepper').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const dir = parseInt(btn.dataset.dir);
      const span = document.getElementById(`routine-${target}`);
      let val = parseInt(span.textContent) + dir;
      if (val < 1) val = 1;
      if (val > 99) val = 99;
      span.textContent = val;
    });
  });
  document.getElementById('routine-rest-between').addEventListener('input', function() {
    document.getElementById('routine-rest-between-val').textContent = parseFloat(this.value).toFixed(1) + ' min';
  });
  document.getElementById('routine-countdown').addEventListener('input', function() {
    document.getElementById('routine-countdown-val').textContent = parseInt(this.value) + ' s';
  });

  // ---------- 训练执行 ----------
  async function startTraining(routineId) {
    console.log('🔍 startTraining 被调用, routineId:', routineId);

    if (trainingEngine) {
      try { trainingEngine.stop(); } catch(e) {}
      trainingEngine = null;
    }

    const routine = await DB.getRoutine(routineId);
    if (!routine) {
      alert('训练组不存在，请刷新页面后重试');
      console.error('❌ 未找到训练组:', routineId);
      return;
    }
    const projects = await DB.getAllProjects();
    if (!projects.length) { alert('没有可用的训练项目'); return; }

    navigateTo('view-training');
    document.getElementById('training-title').textContent = routine.name || '训练';
    document.getElementById('training-progress').textContent = '准备中…';

    // 重置 UI
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

    // 创建引擎
    trainingEngine = new TrainingEngine({
      callbacks: {
        onStart: (data) => {
          console.log('✅ 训练开始');
          document.getElementById('btn-training-start').classList.add('hidden');
          document.getElementById('btn-training-pause').classList.remove('hidden');
          document.getElementById('btn-training-stop').classList.remove('hidden');
          document.getElementById('training-progress').textContent = '1/1 · 项目 0/0 · 循环 0/0';
        },
        onRoundChange: (data) => {
          // 组进度变更，但 onPhaseChange 会覆盖，这里不重复处理
        },
        onStepChange: (data) => {
          // 项目进度变更，但 onPhaseChange 会覆盖
        },
        onCountdownTick: (data) => {
          const remaining = Math.ceil(data.remaining);
          document.getElementById('training-countdown').textContent = remaining;
          document.getElementById('training-project-name').textContent = '准备';
          document.getElementById('training-phase-label').textContent = `${remaining}s`;
        },
        onPhaseChange: (data) => {
          console.log('🔄 相位切换:', data.phase.type, '项目:', data.project?.name);
          const phase = data.phase;
          const project = data.project;
          const step = data.step;

          document.getElementById('training-project-name').textContent = project?.name || '未命名';
          document.getElementById('training-phase-label').textContent = phase.type.toUpperCase();
          const note = step?.note || project?.defaultNote || '';
          document.getElementById('training-note').textContent = note ? `💬 ${note}` : '';

          const img = document.getElementById('training-image-img');
          if (project && project.imageData && project.imageData.startsWith('data:image')) {
            img.src = project.imageData;
            img.style.display = 'block';
          } else {
            img.style.display = 'none';
            img.src = '';
          }

          // ---- 顶部信息：总循环 / 项目顺序 / 组数 ----
          const groupText = `${data.groupRound || 1}/${data.totalGroupRounds || 1}`;
          const stepText = `项目 ${data.stepIndex || 1}/${data.totalSteps || 1}`;
          const roundText = `循环 ${data.stepRound || 1}/${data.totalStepRounds || 1}`;
          document.getElementById('training-progress').textContent = `${groupText} · ${stepText} · ${roundText}`;
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
        onRestStart: (data) => {
          document.getElementById('training-project-name').textContent = '🛑 休息';
          document.getElementById('training-phase-label').textContent = `${data.type.toUpperCase()} 休息`;
          document.getElementById('training-note').textContent = data.type === 'round' ? '组间大休' : '恢复中';
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
        onComplete: () => {
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
        },
        onStop: () => {
          trainingEngine = null;
          navigateTo('view-home');
          renderHome();
        }
      },
      volume: 0.8
    });

    trainingEngine.load(routine, projects);
    console.log('📦 引擎已加载，训练组:', routine.name, '项目数:', projects.length);

    const startBtn = document.getElementById('btn-training-start');
    startBtn.replaceWith(startBtn.cloneNode(true));
    const newStartBtn = document.getElementById('btn-training-start');
    newStartBtn.addEventListener('click', function onClickStart() {
      console.log('▶️ 用户点击开始');
      AudioEngine.ensure();
      trainingEngine.start();
      this.removeEventListener('click', onClickStart);
    });

    console.log('✅ 训练页准备完成，等待用户点击「开始」');
  }

  // ---------- 训练控制 ----------
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
      renderHome();
    }
  });

  // ---------- 键盘快捷键 ----------
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      const trainingView = document.getElementById('view-training');
      if (!trainingView.classList.contains('active')) return;
      const startBtn = document.getElementById('btn-training-start');
      const pauseBtn = document.getElementById('btn-training-pause');
      const resumeBtn = document.getElementById('btn-training-resume');
      if (!startBtn.classList.contains('hidden')) {
        startBtn.click();
      } else if (!pauseBtn.classList.contains('hidden')) {
        pauseBtn.click();
      } else if (!resumeBtn.classList.contains('hidden')) {
        resumeBtn.click();
      }
    }
    if (e.code === 'Escape') {
      const trainingView = document.getElementById('view-training');
      if (trainingView.classList.contains('active')) {
        document.getElementById('btn-training-stop').click();
      }
    }
  });

  // ---------- 导航绑定 ----------
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target === 'home') navigateTo('view-home');
    });
  });

  document.getElementById('btn-manage-projects').addEventListener('click', () => {
    navigateTo('view-projects');
    renderProjects();
  });

  document.getElementById('btn-new-routine').addEventListener('click', () => {
    openRoutineEditor(null);
    window._currentSteps = [];
    renderSteps([]);
  });

  // ---------- PWA 安装 ----------
  let deferredPrompt = null;
  const installBanner = document.getElementById('install-banner');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  if (!isStandalone) {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installBanner.classList.add('show');
    });
  }

  document.getElementById('btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) {
      alert('请在浏览器菜单中使用 "添加到主屏幕" 或 "安装应用"');
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBanner.classList.remove('show');
  });

  document.getElementById('btn-close-banner').addEventListener('click', () => {
    installBanner.classList.remove('show');
  });

  // ---------- 初始化 ----------
  async function init() {
    document.addEventListener('click', () => AudioEngine.ensure(), { once: true });
    await renderHome();
    navigateTo('view-home');
  }

  init();

})();