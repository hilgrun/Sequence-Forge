// js/app.js - 主应用（精简版，只保留路由和初始化）
(function() {
  'use strict';

  // 确保全局依赖已加载
  const AudioEngine = window.AudioEngine;

  // ---------- 初始化 ----------
  async function init() {
    document.addEventListener('click', () => AudioEngine.ensure(), { once: true });
    // 先激活主页视图，再渲染内容
    window.navigateTo('view-home');
    // 等待渲染完成
    await window.RoutinesEditor.renderHome();
    console.log('✅ 应用初始化完成');
  }

  // 启动
  init();

})();