// js/db.js - 数据层：IndexedDB 封装 + 导入导出
(function() {
  'use strict';

  const DB_NAME = 'SequenceForgeDB';
  const DB_VERSION = 1;
  const STORE_PROJECTS = 'projects';
  const STORE_ROUTINES = 'routines';

  // ---------- 工具函数 ----------
  function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
  }

  // 将 Blob/File 转为 base64 DataURL
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 数据 URL 转 Blob（用于导出时直接存为 base64，无需转）
  // 但我们储存时直接存 dataURL 字符串

  // ---------- 数据库连接 ----------
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (db && db.name === DB_NAME) {
        resolve(db);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_PROJECTS)) {
          d.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains(STORE_ROUTINES)) {
          d.createObjectStore(STORE_ROUTINES, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  // ---------- 通用 CRUD 辅助 ----------
  function putItem(storeName, item) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve(item);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function getItem(storeName, id) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function getAllItems(storeName) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function deleteItem(storeName, id) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  function clearStore(storeName) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  // ---------- 对外 API ----------
  const DB = {

    // ----- Projects -----
    async saveProject(project) {
      if (!project.id) project.id = generateId();
      // 确保 phases 是数组，每个元素有 type 和 duration
      if (!Array.isArray(project.phases)) project.phases = [];
      // 如果传了 File 对象，需要先转 base64
      if (project.imageFile && typeof project.imageFile !== 'string') {
        project.imageData = await fileToDataURL(project.imageFile);
        delete project.imageFile;
      }
      // 确保 imageData 是字符串或 null
      return putItem(STORE_PROJECTS, project);
    },

    getProject(id) {
      return getItem(STORE_PROJECTS, id);
    },

    getAllProjects() {
      return getAllItems(STORE_PROJECTS);
    },

    deleteProject(id) {
      return deleteItem(STORE_PROJECTS, id);
    },

    // ----- Routines -----
    async saveRoutine(routine) {
      if (!routine.id) routine.id = generateId();
      if (!Array.isArray(routine.steps)) routine.steps = [];
      // steps 里每个元素保证有 kind
      return putItem(STORE_ROUTINES, routine);
    },

    getRoutine(id) {
      return getItem(STORE_ROUTINES, id);
    },

    getAllRoutines() {
      return getAllItems(STORE_ROUTINES);
    },

    deleteRoutine(id) {
      return deleteItem(STORE_ROUTINES, id);
    },

    // ----- 导入 / 导出 -----
    // 导出：返回一个 JSON 字符串（包含所有 projects 和 routines，以及元数据）
    async exportData() {
      const projects = await this.getAllProjects();
      const routines = await this.getAllRoutines();
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: projects,
        routines: routines
      };
      return JSON.stringify(payload, null, 2);
    },

    // 导入：接收一个 JSON 字符串，清空现有数据并写入新数据
    async importData(jsonStr) {
      let payload;
      try {
        payload = JSON.parse(jsonStr);
      } catch (e) {
        throw new Error('无效的 JSON 文件');
      }
      if (!payload.projects || !payload.routines) {
        throw new Error('数据格式错误：缺少 projects 或 routines 字段');
      }
      // 清空现有数据
      await clearStore(STORE_PROJECTS);
      await clearStore(STORE_ROUTINES);
      // 批量写入
      const dbConn = await openDB();
      const tx = dbConn.transaction([STORE_PROJECTS, STORE_ROUTINES], 'readwrite');
      const projStore = tx.objectStore(STORE_PROJECTS);
      const routStore = tx.objectStore(STORE_ROUTINES);
      for (const p of payload.projects) {
        projStore.put(p);
      }
      for (const r of payload.routines) {
        routStore.put(r);
      }
      // 等待事务完成
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('导入事务中止'));
      });
    },

    // 辅助：获取所有数据（不序列化），用于预览或调试
    async getAllData() {
      const projects = await this.getAllProjects();
      const routines = await this.getAllRoutines();
      return { projects, routines };
    }
  };

  // 暴露全局
  window.DB = DB;

})();