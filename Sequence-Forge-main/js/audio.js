// js/audio.js - 音频合成引擎 + 语音播报（粤语版）
(function() {
  'use strict';

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  // ---------- 音频上下文 ----------
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new AudioCtx();
      console.log('🎵 AudioContext 已创建');
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
      console.log('🎵 AudioContext 已恢复');
    }
    return audioCtx;
  }

  function now() {
    return audioCtx ? audioCtx.currentTime : 0;
  }

  // ---------- 音效合成 ----------
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

  function playUp(duration, volume = 0.8) {
    return playSlide(200, 800, duration, volume);
  }

  function playDown(duration, volume = 0.8) {
    return playSlide(800, 200, duration, volume);
  }

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

  function stopNodes(nodes) {
    if (!nodes) return;
    if (!Array.isArray(nodes)) nodes = [nodes];
    nodes.forEach(n => {
      try { n.stop(); } catch(e) {}
      try { n.disconnect(); } catch(e) {}
    });
  }

  // ================================================================
  // 语音播报模块（粤语版）
  // ================================================================
  let speechEnabled = true;
  let speechRate = 1.0;
  let speechPitch = 1.0;
  let currentUtterance = null;

  function getVoices() {
    return window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }

  // ---- 获取粤语语音（优先） ----
  function getCantoneseVoice() {
    const voices = window.speechSynthesis.getVoices();
    // 按优先级匹配粤语
    let targetVoice = voices.find(v => v.lang.startsWith('yue')) ||
                      voices.find(v => v.lang.startsWith('zh-HK')) ||
                      voices.find(v => v.lang.startsWith('zh-Hant-HK')) ||
                      voices.find(v => v.lang.startsWith('zh-Hant')) ||
                      voices.find(v => v.lang.startsWith('zh'));
    return targetVoice || null;
  }

  // ---- 核心：同步播报（带完成回调）- 粤语 ----
  function speakSync(text, rate = 1.0, pitch = 1.0, callback) {
    console.log(`🔊 [speakSync] 调用: "${text}"`);

    if (!speechEnabled) {
      console.log(`🔇 [speakSync] 语音已禁用，跳过: "${text}"`);
      if (callback) callback();
      return;
    }
    if (!window.speechSynthesis) {
      console.warn('⚠️ 浏览器不支持语音播报');
      if (callback) callback();
      return;
    }
    if (!text || text.trim() === '') {
      console.warn('⚠️ [speakSync] 文本为空，跳过');
      if (callback) callback();
      return;
    }

    try { window.speechSynthesis.cancel(); } catch(e) {}
    console.log(`⏹️ [speakSync] 已取消之前的语音`);
    currentUtterance = null;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate || speechRate;
    utterance.pitch = pitch || speechPitch;
    // ---- 粤语语言代码 ----
    utterance.lang = 'yue-HK';

    // ---- 优先选择粤语语音 ----
    const targetVoice = getCantoneseVoice();
    if (targetVoice) {
      utterance.voice = targetVoice;
      console.log(`🔊 [speakSync] 使用粤语语音: ${targetVoice.name} (${targetVoice.lang})`);
    } else {
      console.warn('⚠️ [speakSync] 未找到粤语语音，使用默认语音');
    }

    utterance.onstart = () => {
      console.log(`▶️ [speakSync] 开始播放: "${text}"`);
      currentUtterance = utterance;
    };
    utterance.onend = () => {
      console.log(`✅ [speakSync] 播放完成: "${text}"`);
      currentUtterance = null;
      if (callback) callback();
    };
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') {
        console.warn(`⚠️ [speakSync] 播报错误: "${text}"`, e);
      } else {
        console.log(`⏸️ [speakSync] 被中断: "${text}"`);
      }
      currentUtterance = null;
      if (callback) callback();
    };

    try {
      window.speechSynthesis.speak(utterance);
      console.log(`📤 [speakSync] 已提交到语音引擎: "${text}"`);
    } catch(e) {
      console.warn(`⚠️ [speakSync] 播报异常: "${text}"`, e);
      if (callback) callback();
    }
  }

  // ---- 直接播报（不等待，异步）- 粤语 ----
  function speak(text, rate = 1.0, pitch = 1.0) {
    console.log(`🔊 [speak] 调用: "${text}" (异步，不等待)`);

    if (!speechEnabled) {
      console.log(`🔇 [speak] 语音已禁用，跳过: "${text}"`);
      return;
    }
    if (!window.speechSynthesis) {
      console.warn('⚠️ 浏览器不支持语音播报');
      return;
    }
    if (!text || text.trim() === '') {
      console.warn('⚠️ [speak] 文本为空，跳过');
      return;
    }

    try { window.speechSynthesis.cancel(); } catch(e) {}
    console.log(`⏹️ [speak] 已取消之前的语音`);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate || speechRate;
    utterance.pitch = pitch || speechPitch;
    // ---- 粤语语言代码 ----
    utterance.lang = 'yue-HK';

    // ---- 优先选择粤语语音 ----
    const targetVoice = getCantoneseVoice();
    if (targetVoice) {
      utterance.voice = targetVoice;
      console.log(`🔊 [speak] 使用粤语语音: ${targetVoice.name} (${targetVoice.lang})`);
    } else {
      console.warn('⚠️ [speak] 未找到粤语语音，使用默认语音');
    }

    utterance.onstart = () => {
      console.log(`▶️ [speak] 开始播放: "${text}"`);
    };
    utterance.onend = () => {
      console.log(`✅ [speak] 播放完成: "${text}"`);
    };
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') {
        console.warn(`⚠️ [speak] 播报错误: "${text}"`, e);
      } else {
        console.log(`⏸️ [speak] 被中断: "${text}"`);
      }
    };

    try {
      window.speechSynthesis.speak(utterance);
      console.log(`📤 [speak] 已提交到语音引擎: "${text}"`);
    } catch(e) {
      console.warn(`⚠️ [speak] 播报异常: "${text}"`, e);
    }
  }

  function stopSpeech() {
    console.log(`⏹️ [stopSpeech] 停止所有语音`);
    try { window.speechSynthesis.cancel(); } catch(e) {}
    currentUtterance = null;
  }

  function setSpeechEnabled(enabled) {
    speechEnabled = enabled;
    console.log(`🔊 [setSpeechEnabled] 语音${enabled ? '启用' : '禁用'}`);
    if (!enabled) stopSpeech();
  }

  function isSpeechEnabled() { return speechEnabled; }

  // ---- 预加载语音列表 ----
  function preloadVoices() {
    if (window.speechSynthesis) {
      // 触发语音列表加载
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        const voices = window.speechSynthesis.getVoices();
        console.log(`🔊 语音列表已加载，共 ${voices.length} 个语音`);
        // 检查是否有粤语语音
        const cantonese = voices.find(v => v.lang.startsWith('yue') || v.lang.startsWith('zh-HK'));
        if (cantonese) {
          console.log(`✅ 找到粤语语音: ${cantonese.name} (${cantonese.lang})`);
        } else {
          console.warn('⚠️ 未找到粤语语音，将使用默认中文语音');
        }
      };
    }
  }

  // ================================================================
  // 对外 API
  // ================================================================
  const SpeechEngine = {
    speakSync: speakSync,
    speak: speak,
    stop: stopSpeech,
    setEnabled: setSpeechEnabled,
    isEnabled: isSpeechEnabled,
    getVoices: getVoices,
    getCantoneseVoice: getCantoneseVoice
  };

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

  window.SpeechEngine = SpeechEngine;

  // 预加载语音列表
  preloadVoices();

  console.log('✅ SpeechEngine 已加载（粤语版）');

})();