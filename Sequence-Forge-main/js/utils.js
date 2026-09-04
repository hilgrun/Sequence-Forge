// js/utils.js - 工具函数：格式化、文件下载、数据验证等
(function() {
  'use strict';

  // ---------- ID 生成 ----------
  function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
  }

  // ---------- 时间格式化 ----------
  // 秒 → MM:SS
  function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  // 秒 → 分钟（保留一位小数）
  function secondsToMinutes(seconds) {
    return Math.round((seconds / 60) * 10) / 10;
  }

  // 分钟 → 秒
  function minutesToSeconds(minutes) {
    return minutes * 60;
  }

  // 预估训练总时长（秒）
  function estimateTotalDuration(routine, projects) {
    if (!routine || !routine.steps || routine.steps.length === 0) return 0;
    let total = 0;

    for (const step of routine.steps) {
      if (step.kind === 'rest') {
        total += (step.duration || 0) * 60 * (step.rounds || 1);
      } else {
        const project = projects.find(p => p.id === step.projectId);
        if (project) {
          const phaseSum = project.phases.reduce((sum, p) => sum + (p.duration || 0), 0);
          const stepTotal = phaseSum * (step.rounds || 1);
          total += stepTotal;
        }
        // 加上项目后短歇
        total += (step.restAfter || 0) * 60;
      }
    }
    // 乘以组循环数
    total *= (routine.rounds || 1);
    // 加上组间休息
    total += (routine.restBetweenRounds || 0) * 60 * Math.max(0, (routine.rounds || 1) - 1);
    return total;
  }

  // ---------- 文件操作 ----------
  // 下载 JSON 文件
  function downloadJSON(data, filename = 'sequence_forge_backup.json') {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 从 File 对象读取 JSON
  function readJSONFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          resolve(data);
        } catch (err) {
          reject(new Error('无效的 JSON 文件'));
        }
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });
  }

  // 图片文件转 Base64 DataURL（已移至 db.js，这里保留别名）
  // 避免重复实现，直接引用 DB 的方法，如果 DB 未加载则报错
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------- 数据验证 ----------
  function validateProject(project) {
    if (!project || typeof project !== 'object') return false;
    if (!project.name || typeof project.name !== 'string') return false;
    if (!Array.isArray(project.phases) || project.phases.length === 0) return false;
    // 检查每个相位
    for (const p of project.phases) {
      if (!['up', 'hold', 'down'].includes(p.type)) return false;
      if (typeof p.duration !== 'number' || p.duration <= 0) return false;
    }
    return true;
  }

  function validateRoutine(routine) {
    if (!routine || typeof routine !== 'object') return false;
    if (!routine.name || typeof routine.name !== 'string') return false;
    if (typeof routine.rounds !== 'number' || routine.rounds < 1) return false;
    if (!Array.isArray(routine.steps)) return false;
    // 至少一个步骤
    if (routine.steps.length === 0) return false;
    // 检查每个步骤
    for (const step of routine.steps) {
      if (!['project', 'rest'].includes(step.kind)) return false;
      if (step.kind === 'project') {
        if (!step.projectId) return false;
        if (typeof step.rounds !== 'number' || step.rounds < 1) return false;
      }
      if (step.kind === 'rest') {
        if (typeof step.duration !== 'number' || step.duration <= 0) return false;
      }
    }
    return true;
  }

  // ---------- DOM 辅助 ----------
  // 安全获取元素
  function $(selector, context = document) {
    return context.querySelector(selector);
  }

  function $$(selector, context = document) {
    return context.querySelectorAll(selector);
  }

  // 切换元素的显示/隐藏
  function toggleVisible(el, show) {
    if (!el) return;
    if (show) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  // 格式化文件大小
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ---------- 深拷贝 ----------
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ---------- 暴露全局 ----------
  window.Utils = {
    generateId: generateId,
    formatTime: formatTime,
    secondsToMinutes: secondsToMinutes,
    minutesToSeconds: minutesToSeconds,
    estimateTotalDuration: estimateTotalDuration,
    downloadJSON: downloadJSON,
    readJSONFile: readJSONFile,
    fileToDataURL: fileToDataURL,
    validateProject: validateProject,
    validateRoutine: validateRoutine,
    $: $,
    $$: $$,
    toggleVisible: toggleVisible,
    formatFileSize: formatFileSize,
    deepClone: deepClone
  };

})();