// js/audio.js - 音频合成引擎（Web Audio API）
(function() {
  'use strict';

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  // ---------- 上下文管理 ----------
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function now() {
    return audioCtx ? audioCtx.currentTime : 0;
  }

  // ---------- 底层合成器 ----------
  // 通用滑音：startFreq -> endFreq，持续时间 duration，音量 volume
  function playSlide(startFreq, endFreq, duration, volume) {
    if (duration <= 0 || volume <= 0) return [];
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.linearRampToValueAtTime(endFreq, t0 + duration);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.setValueAtTime(volume, t0 + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
    return [osc, gain];
  }

  // ---------- 对外原子音效 ----------
  // up 相位：200Hz → 800Hz（升调，吸气/发力）
  function playUp(duration, volume = 0.8) {
    return playSlide(200, 800, duration, volume);
  }

  // down 相位：800Hz → 200Hz（降调，呼气/退让）
  function playDown(duration, volume = 0.8) {
    return playSlide(800, 200, duration, volume);
  }

  // hold 滴答声：短促清脆，默认每秒一次由引擎触发
  function playClick(volume = 0.6, freq = 1500, dur = 0.08) {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
    return [osc, gain];
  }

  // 双短哔哔：用于阶段切换、开始、结束提醒
  function playDoubleBeep(volume = 0.7) {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    const nodes = [];

    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 880;
    g1.gain.setValueAtTime(volume, t0);
    g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    osc1.connect(g1);
    g1.connect(ctx.destination);
    osc1.start(t0);
    osc1.stop(t0 + 0.1);
    nodes.push(osc1, g1);

    const t1 = t0 + 0.15;
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 660;
    g2.gain.setValueAtTime(volume, t1);
    g2.gain.exponentialRampToValueAtTime(0.001, t1 + 0.1);
    osc2.connect(g2);
    g2.connect(ctx.destination);
    osc2.start(t1);
    osc2.stop(t1 + 0.1);
    nodes.push(osc2, g2);

    return nodes;
  }

  // 训练完成音乐：叮咚（双音）
  function playDingDong(volume = 0.8) {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    const nodes = [];

    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 880;
    g1.gain.setValueAtTime(volume, t0);
    g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    osc1.connect(g1);
    g1.connect(ctx.destination);
    osc1.start(t0);
    osc1.stop(t0 + 0.25);
    nodes.push(osc1, g1);

    const t1 = t0 + 0.35;
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 660;
    g2.gain.setValueAtTime(volume, t1);
    g2.gain.exponentialRampToValueAtTime(0.001, t1 + 0.3);
    osc2.connect(g2);
    g2.connect(ctx.destination);
    osc2.start(t1);
    osc2.stop(t1 + 0.3);
    nodes.push(osc2, g2);

    return nodes;
  }

  // ---------- 节点清理工具 ----------
  function stopNodes(nodes) {
    if (!nodes) return;
    if (!Array.isArray(nodes)) nodes = [nodes];
    nodes.forEach(n => {
      try { n.stop(); } catch(e) {}
      try { n.disconnect(); } catch(e) {}
    });
  }

  // ---------- 暴露全局 ----------
  window.AudioEngine = {
    ensure: ensureAudio,
    now: now,
    playUp: playUp,
    playDown: playDown,
    playClick: playClick,
    playDoubleBeep: playDoubleBeep,
    playDingDong: playDingDong,
    stopNodes: stopNodes
  };

})();