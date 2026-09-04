// js/training-settings.js - 训练音效/语音设置管理
(function() {
  'use strict';

  const STORAGE_KEY = 'trainingSettings_v1';

  const defaultSettings = {
    soundEnabled: true,
    voiceEnabled: true
  };

  let settings = null;

  // ---- 加载 ----
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        settings = { ...defaultSettings, ...s };
      } else {
        settings = { ...defaultSettings };
      }
    } catch(e) {
      settings = { ...defaultSettings };
    }
    syncUI();
    return settings;
  }

  // ---- 保存 ----
  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch(e) {}
  }

  // ---- 同步 UI ----
  function syncUI() {
    const soundBtn = document.getElementById('btn-training-sound');
    const voiceBtn = document.getElementById('btn-training-voice');
    if (soundBtn) {
      soundBtn.textContent = settings?.soundEnabled !== false ? '🔊 音效' : '🔇 音效';
      soundBtn.classList.toggle('on', settings?.soundEnabled !== false);
      soundBtn.classList.toggle('off', settings?.soundEnabled === false);
    }
    if (voiceBtn) {
      voiceBtn.textContent = settings?.voiceEnabled !== false ? '🗣️ 语音' : '🔇 语音';
      voiceBtn.classList.toggle('on', settings?.voiceEnabled !== false);
      voiceBtn.classList.toggle('off', settings?.voiceEnabled === false);
    }
    // 同步到 SpeechEngine（如果存在）
    if (window.SpeechEngine) {
      window.SpeechEngine.setEnabled(settings?.voiceEnabled !== false);
    }
  }

  // ---- 对外 API ----
  const TrainingSettings = {
    get: function() {
      if (!settings) {
        // 如果尚未加载，立即加载
        return loadSettings();
      }
      return settings;
    },
    getSoundEnabled: function() {
      const s = this.get();
      return s?.soundEnabled !== false;
    },
    getVoiceEnabled: function() {
      const s = this.get();
      return s?.voiceEnabled !== false;
    },
    setSoundEnabled: function(val) {
      const s = this.get();
      s.soundEnabled = val;
      saveSettings();
      syncUI();
    },
    setVoiceEnabled: function(val) {
      const s = this.get();
      s.voiceEnabled = val;
      saveSettings();
      syncUI();
      if (window.SpeechEngine) {
        window.SpeechEngine.setEnabled(val);
      }
    },
    toggleSound: function() {
      const s = this.get();
      this.setSoundEnabled(!s.soundEnabled);
    },
    toggleVoice: function() {
      const s = this.get();
      this.setVoiceEnabled(!s.voiceEnabled);
    },
    load: loadSettings,
    syncUI: syncUI
  };

  // 立即初始化，确保其他模块调用 get() 时不会返回 null
  TrainingSettings.load();

  window.TrainingSettings = TrainingSettings;

  console.log('✅ TrainingSettings 已加载');

})();