// js/routines-editor.js - 完整版（含分类管理、折叠分组、智能播放、lastUsed 显示）
(function() {
  'use strict';

  const Utils = window.Utils || {};
  const { $, $$, generateId, formatTime, estimateTotalDuration, deepClone } = Utils;
  const DB = window.DB;

  const Router = window.Router || {};
  const navigateTo = Router.navigateTo || window.navigateTo || function(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
    if (window.closeDrawer) window.closeDrawer();
  };
  const openDrawer = Router.openDrawer || window.openDrawer || function() {
    const drawer = document.getElementById('project-drawer');
    if (drawer) drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  const closeDrawer = Router.closeDrawer || window.closeDrawer || function() {
    const drawer = document.getElementById('project-drawer');
    if (drawer) drawer.classList.remove('open');
    document.body.style.overflow = '';
  };

  if (!window.Router) {
    window.Router = { navigateTo, openDrawer, closeDrawer };
  }

  let allProjects = [];
  let allRoutines = [];
  let allCategories = [];
  let currentRoutineId = null;
  let editingProjectId = null;
  let editingPhases = [];

  // =============================================================
  // ★ 辅助：渲染单个训练组卡片（用于分类下复用）
  // =============================================================
  function renderRoutineCard(r) {
    const est = estimateTotalDuration(r, allProjects);
    const stepsCount = r.steps.filter(s => s.kind === 'project').length;
    const lastUsedText = r.lastUsed ? new Date(r.lastUsed).toLocaleDateString('zh-CN') : '未使用';
    return `
      <div class="routine-card" data-id="${r.id}">
        <div class="card-title">${r.name || '未命名组'}</div>
        <div class="card-meta">
          <span>${stepsCount} 个动作</span>
          <span>⏱ ${formatTime(est)}</span>
          <span class="card-badge">循环 ×${r.rounds}</span>
          <span class="last-used">🕒 ${lastUsedText}</span>
        </div>
        <div class="card-actions">
          <button class="btn-copy-routine" data-id="${r.id}" title="复制训练组">📋</button>
          <button class="btn-edit-routine" data-id="${r.id}" title="编辑训练组">✏️</button>
          <button class="btn-delete-routine" data-id="${r.id}" title="删除训练组">🗑️</button>
        </div>
      </div>
    `;
  }

  // =============================================================
  // ★ 主页渲染（按分类折叠分组）
  // =============================================================
  async function renderHome(retryCount = 0) {
    try {
      const maxRetries = 3;
      const delay = 500;

      allRoutines = await DB.getAllRoutines();
      allProjects = await DB.getAllProjects();
      allCategories = await DB.getAllCategories();

      if (allRoutines.length === 0 && retryCount < maxRetries) {
        console.log(`🔄 renderHome 重试 ${retryCount + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return renderHome(retryCount + 1);
      }

      const container = document.getElementById('routine-list');
      if (!container) {
        console.error('❌ 找不到 routine-list 元素');
        return;
      }

      if (!allRoutines.length) {
        container.innerHTML = '<div class="empty-state">没有训练组，点击下方管理</div>';
        console.log('📭 当前没有训练组');
        return;
      }

      // 构建分类映射
      const categoryMap = {};
      allCategories.forEach(c => {
        categoryMap[c.id] = { ...c, routines: [] };
      });
      // 未分类
      categoryMap['uncategorized'] = { id: 'uncategorized', name: '未分类', routines: [] };

      allRoutines.forEach(r => {
        if (r.categories && r.categories.length) {
          r.categories.forEach(catId => {
            if (categoryMap[catId]) {
              categoryMap[catId].routines.push(r);
            } else {
              categoryMap['uncategorized'].routines.push(r);
            }
          });
        } else {
          categoryMap['uncategorized'].routines.push(r);
        }
      });

      // 生成 HTML
      let html = '';
      for (const [id, cat] of Object.entries(categoryMap)) {
        if (cat.routines.length === 0) continue;
        html += `
          <div class="category-group" data-category-id="${id}">
            <div class="category-header">
              <span class="toggle-arrow">▶</span>
              <span class="category-name">${cat.name}</span>
              <span class="category-count">(${cat.routines.length})</span>
              <button class="btn-sm smart-play" data-category-id="${id}">▶ 智能播放</button>
            </div>
            <div class="category-routines" style="display:none;">
              ${cat.routines.map(r => renderRoutineCard(r)).join('')}
            </div>
          </div>
        `;
      }

      if (!html) {
        container.innerHTML = '<div class="empty-state">没有训练组，点击下方管理</div>';
        return;
      }

      container.innerHTML = html;

      // ---- 折叠切换 ----
      container.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', (e) => {
          if (e.target.closest('.smart-play')) return;
          const group = header.closest('.category-group');
          const body = group.querySelector('.category-routines');
          const arrow = header.querySelector('.toggle-arrow');
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          arrow.textContent = isHidden ? '▼' : '▶';
        });
      });

      // ---- 智能播放 ----
      container.querySelectorAll('.smart-play').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const catId = btn.dataset.categoryId;
          const catRoutines = categoryMap[catId]?.routines || [];
          if (!catRoutines.length) {
            alert('该分类下暂无训练组');
            return;
          }
          const sorted = [...catRoutines].sort((a, b) => {
            if (!a.lastUsed) return -1;
            if (!b.lastUsed) return 1;
            return a.lastUsed.localeCompare(b.lastUsed);
          });
          if (typeof window.startTraining === 'function') {
            window.startTraining(sorted[0].id);
          } else {
            console.warn('⚠️ startTraining 尚未加载');
          }
        });
      });

      // ---- 训练组卡片事件（点击直接播放） ----
      container.querySelectorAll('.routine-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-actions')) return;
          const id = card.dataset.id;
          if (typeof window.startTraining === 'function') {
            window.startTraining(id);
          }
        });
      });

      // ---- 卡片操作按钮（编辑/复制/删除） ----
      container.querySelectorAll('.btn-edit-routine').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openRoutineEditor(btn.dataset.id);
        });
      });

      container.querySelectorAll('.btn-copy-routine').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const original = await DB.getRoutine(id);
          if (!original) { alert('原训练组不存在'); return; }
          const copy = deepClone(original);
          copy.id = generateId();
          copy.name = original.name + ' (副本)';
          await DB.saveRoutine(copy);
          await renderHome();
        });
      });

      container.querySelectorAll('.btn-delete-routine').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const routine = await DB.getRoutine(id);
          if (!routine) { alert('训练组不存在'); return; }
          if (confirm(`确定要删除训练组「${routine.name}」吗？此操作不可撤销。`)) {
            await DB.deleteRoutine(id);
            await renderHome();
          }
        });
      });

      console.log('✅ 主页渲染完成（分类折叠）');
    } catch(e) {
      console.error('❌ 渲染主页失败:', e);
      const container = document.getElementById('routine-list');
      if (container) {
        container.innerHTML = '<div class="empty-state">加载数据失败，请刷新页面</div>';
      }
    }
  }

  // =============================================================
  // ★ 分类管理渲染
  // =============================================================
  async function renderCategories() {
    const categories = await DB.getAllCategories();
    const container = document.getElementById('category-list');
    if (!categories.length) {
      container.innerHTML = '<div class="empty-state">暂无分类，请添加</div>';
      return;
    }
    container.innerHTML = categories.map(c => `
      <div class="category-item" data-id="${c.id}">
        <span>${c.name}</span>
        <button class="btn-delete-category" data-id="${c.id}">删除</button>
      </div>
    `).join('');

    container.querySelectorAll('.btn-delete-category').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const cat = categories.find(c => c.id === id);
        if (!cat) return;
        if (confirm(`确定删除分类「${cat.name}」吗？该分类将从所有训练组中移除。`)) {
          // 从所有训练组中移除该分类 ID
          const routines = await DB.getAllRoutines();
          for (const r of routines) {
            if (r.categories && r.categories.includes(id)) {
              r.categories = r.categories.filter(c => c !== id);
              await DB.saveRoutine(r);
            }
          }
          await DB.deleteCategory(id);
          await renderCategories();
          await renderHome();
        }
      });
    });
  }

  // =============================================================
  // 动作管理 (保持原有)
  // =============================================================
  async function renderProjects() {
    allProjects = await DB.getAllProjects();
    const container = document.getElementById('project-list');
    if (!allProjects.length) {
      container.innerHTML = '<div class="empty-state">还没有动作，点击「新建动作」创建</div>';
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
      if (confirm('删除此动作？')) {
        await DB.deleteProject(b.dataset.id);
        renderProjects();
        renderHome();
      }
    }));
  }

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
      title.textContent = '编辑动作';
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
      title.textContent = '新建动作';
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
        const input = prompt(`设置「${current.type}」的时长（秒，范围 0.1–60）：`, current.duration.toFixed(1));
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
    if (!name) { alert('请输入动作名'); return; }
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

  // =============================================================
  // ★ 训练组编辑器（含分类多选）
  // =============================================================
  async function openRoutineEditor(id = null) {
    currentRoutineId = id;
    navigateTo('view-routines');

    const title = document.getElementById('routine-editor-title');
    const nameInput = document.getElementById('routine-name');
    const roundsSpan = document.getElementById('routine-rounds');
    const countdownSlider = document.getElementById('routine-countdown');
    const countdownVal = document.getElementById('routine-countdown-val');

    allProjects = await DB.getAllProjects();
    allCategories = await DB.getAllCategories();

    let routine = { id: null, name: '', rounds: 3, countdown: 3, steps: [], categories: [] };
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
    countdownSlider.value = routine.countdown || 3;
    countdownVal.textContent = (routine.countdown || 3) + ' s';

    // ★ 渲染分类多选框
    const checkboxContainer = document.getElementById('category-checkboxes');
    if (allCategories.length) {
      checkboxContainer.innerHTML = allCategories.map(c => `
        <label>
          <input type="checkbox" value="${c.id}" ${routine.categories?.includes(c.id) ? 'checked' : ''}>
          ${c.name}
        </label>
      `).join('');
    } else {
      checkboxContainer.innerHTML = '<span style="color:var(--muted);font-size:0.8rem;">暂无分类，请先到「管理分类」创建</span>';
    }

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
      let name, detail;
      if (isRest) {
        name = '🛑 休息';
        detail = `${step.duration} min`;
      } else {
        const project = allProjects.find(p => p.id === step.projectId);
        name = project?.name || '未命名动作';
        const groups = step.rounds || 1;
        const reps = step.reps || 1;
        detail = `${groups}组 ×${reps}次 · 组间休息 ${step.restAfter || 0} min`;
      }
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
          const groups = prompt('组数：', step.rounds);
          if (groups !== null && !isNaN(parseInt(groups)) && parseInt(groups) > 0) {
            step.rounds = parseInt(groups);
          }
          const reps = prompt('每组次数：', step.reps || 1);
          if (reps !== null && !isNaN(parseInt(reps)) && parseInt(reps) > 0) {
            step.reps = parseInt(reps);
          }
          const rest = prompt('组间休息（分钟）：', step.restAfter);
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
    if (!allProjects.length) { alert('请先创建动作'); return; }

    const names = allProjects.map((p, i) => `${i+1}. ${p.name}`).join('\n');
    const choice = prompt(`选择动作（输入编号）：\n${names}`);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= allProjects.length) { alert('无效编号'); return; }
    const project = allProjects[idx];

    const groupInput = prompt('组数（1-99）：', '3');
    if (groupInput === null) return;
    const groups = parseInt(groupInput);
    if (isNaN(groups) || groups < 1 || groups > 99) { alert('请输入 1-99 之间的数字'); return; }

    const repsInput = prompt('每组次数（1-99）：', '12');
    if (repsInput === null) return;
    const reps = parseInt(repsInput);
    if (isNaN(reps) || reps < 1 || reps > 99) { alert('请输入 1-99 之间的数字'); return; }

    let restBetween = 0;
    if (groups > 1) {
      const restInput = prompt('组间休息（分钟，输入0表示无休息）：', '1');
      if (restInput === null) return;
      const restVal = parseFloat(restInput);
      if (isNaN(restVal) || restVal < 0) { alert('请输入有效的分钟数'); return; }
      restBetween = restVal;
    }

    steps.push({ kind: 'project', projectId: project.id, rounds: groups, reps: reps, restAfter: restBetween, note: '' });
    steps.push({ kind: 'rest', duration: 5, note: '动作后恢复' });
    renderSteps(steps);
  });

  document.getElementById('btn-append-rest').addEventListener('click', () => {
    const steps = window._currentSteps;
    steps.push({ kind: 'rest', duration: 5, note: '休息' });
    renderSteps(steps);
  });

  // ★ 保存训练组（含分类收集）
  document.getElementById('btn-save-routine').addEventListener('click', async () => {
    const name = document.getElementById('routine-name').value.trim();
    if (!name) { alert('请输入组名'); return; }
    const rounds = parseInt(document.getElementById('routine-rounds').textContent);
    const countdown = parseInt(document.getElementById('routine-countdown').value);
    const steps = window._currentSteps || [];
    if (!steps.length) { alert('请至少添加一个步骤'); return; }

    // ★ 收集选中的分类 ID
    const selectedCategories = [];
    document.querySelectorAll('#category-checkboxes input[type="checkbox"]:checked').forEach(cb => {
      selectedCategories.push(cb.value);
    });

    const routine = {
      id: currentRoutineId || generateId(),
      name,
      rounds,
      countdown: countdown || 0,
      steps: steps.map(s => deepClone(s)),
      categories: selectedCategories,
      // 保留原有的 lastUsed（如果存在）
      lastUsed: currentRoutineId ? (await DB.getRoutine(currentRoutineId))?.lastUsed || null : null
    };
    await DB.saveRoutine(routine);
    await renderHome();
    navigateTo('view-home');
  });

  // 按钮 stepper
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
  document.getElementById('routine-countdown').addEventListener('input', function() {
    document.getElementById('routine-countdown-val').textContent = parseInt(this.value) + ' s';
  });

  // 返回按钮
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target === 'home') navigateTo('view-home');
    });
  });

  // =============================================================
  // ★ 底部按钮事件重新绑定
  // =============================================================
  document.getElementById('btn-manage-projects').addEventListener('click', () => {
    navigateTo('view-projects');
    renderProjects();
  });

  // ★ 原来的 btn-new-routine 改为 btn-manage-routines
  document.getElementById('btn-manage-routines').addEventListener('click', () => {
    openRoutineEditor(null);
    window._currentSteps = [];
    renderSteps([]);
  });

  // ★ 新增：管理分类按钮
  document.getElementById('btn-manage-categories').addEventListener('click', () => {
    navigateTo('view-categories');
    renderCategories();
  });

  // ★ 分类管理页面：添加分类
  document.getElementById('btn-add-category').addEventListener('click', async () => {
    const input = document.getElementById('new-category-name');
    const name = input.value.trim();
    if (!name) { alert('请输入分类名称'); return; }
    await DB.saveCategory({ name });
    input.value = '';
    await renderCategories();
    // 刷新主页以更新分类列表
    await renderHome();
  });

  // =============================================================
  // 导入 / 导出 (保持原有)
  // =============================================================
  document.getElementById('btn-export-data').addEventListener('click', async () => {
    try {
      const json = await DB.exportData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `Rhythm_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert('✅ 数据导出成功！');
    } catch (e) {
      alert('❌ 导出失败: ' + e.message);
      console.error(e);
    }
  });

  document.getElementById('btn-import-data').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const jsonStr = ev.target.result;
          const test = JSON.parse(jsonStr);
          if (!test.projects || !test.routines) {
            throw new Error('无效的备份文件格式');
          }
          if (confirm('导入将覆盖当前所有数据，确定继续吗？')) {
            await DB.importData(jsonStr);
            alert('✅ 数据导入成功！页面即将刷新。');
            await renderHome();
            window.location.reload();
          }
        } catch (err) {
          alert('❌ 导入失败: ' + err.message);
          console.error(err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  // =============================================================
  // 暴露全局
  // =============================================================
  window.RoutinesEditor = {
    renderHome: renderHome,
    renderProjects: renderProjects,
    renderCategories: renderCategories,
    openRoutineEditor: openRoutineEditor
  };

  console.log('✅ RoutinesEditor 已加载（含分类管理、折叠分组、智能播放）');
})();