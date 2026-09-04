// js/ui-router.js - 路由 & 导航 & 抽屉控制
(function() {
  'use strict';

  // ---------- 路由 ----------
  function navigateTo(viewId) {
    const views = document.querySelectorAll('.view');
    views.forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
    closeDrawer();
  }

  // ---------- 抽屉控制 ----------
  function openDrawer() {
    const drawer = document.getElementById('project-drawer');
    if (drawer) drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    const drawer = document.getElementById('project-drawer');
    if (drawer) drawer.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ---------- 暴露到全局（尽早暴露，让其他模块可以安全引用） ----------
  window.Router = {
    navigateTo: navigateTo,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer
  };

  // 同时暴露单个函数，方便直接调用
  window.navigateTo = navigateTo;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;

  console.log('✅ Router 已加载');

})();