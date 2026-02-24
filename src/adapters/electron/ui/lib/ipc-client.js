// ============================================================
// IPC 客户端 — 渲染进程与主进程通信封装
// ============================================================

(function () {
  'use strict';

  var api = window.xuanji;

  if (!api) {
    console.error('[IPC] window.xuanji API 不可用，请检查 preload 脚本');
    // 创建空占位，避免其他脚本报错
    window.XuanjiIPC = {
      config: {
        load: function () { return Promise.resolve({ success: false, error: 'API 不可用' }); },
        save: function () { return Promise.resolve({ success: false, error: 'API 不可用' }); },
      },
      chat: {
        init: function () { return Promise.resolve({ success: false, error: 'API 不可用' }); },
        run: function () { return Promise.resolve({ success: false, error: 'API 不可用' }); },
        stop: function () { return Promise.resolve({ success: true }); },
        reset: function () { return Promise.resolve({ success: true }); },
        state: function () { return Promise.resolve({ success: false, error: 'API 不可用' }); },
      },
      bot: {
        start: function () { return Promise.resolve({ success: false, error: 'API 不可用' }); },
        stop: function () { return Promise.resolve({ success: false, error: 'API 不可用' }); },
        list: function () { return Promise.resolve({ success: true, bots: [] }); },
      },
      models: {
        list: function () { return Promise.resolve({ success: false, error: 'API 不可用' }); },
      },
      onText: function () { return function () {}; },
      onThinking: function () { return function () {}; },
      onToolStart: function () { return function () {}; },
      onToolEnd: function () { return function () {}; },
      onToolDelta: function () { return function () {}; },
      onUsage: function () { return function () {}; },
      onError: function () { return function () {}; },
      onEnd: function () { return function () {}; },
      onBotStatus: function () { return function () {}; },
    onBotLog: function () { return function () {}; },
    onMainLog: function () { return function () {}; },
    loadLogs: function () { return Promise.resolve({ success: true, logs: [] }); },
    };
    return;
  }

  // 事件取消函数收集器（用于批量清理）
  var cleanupFns = [];

  /**
   * 注册事件监听（自动收集清理函数）
   */
  function listen(registrar, callback) {
    var cleanup = registrar(callback);
    cleanupFns.push(cleanup);
    return cleanup;
  }

  window.XuanjiIPC = {
    config: {
      load: function () { return api.config.load(); },
      save: function (config) { return api.config.save(config); },
    },
    chat: {
      init: function (options) { return api.chat.init(options); },
      run: function (message) { return api.chat.run(message); },
      stop: function () { return api.chat.stop(); },
      reset: function () { return api.chat.reset(); },
      state: function () { return api.chat.state(); },
    },
    bot: {
      start: function (type, config) { return api.bot.start(type, config); },
      stop: function (type) { return api.bot.stop(type); },
      list: function () { return api.bot.list(); },
    },
    models: {
      list: function (options) { return api.models.list(options); },
    },
    // 事件监听（返回取消函数）
    onText: function (cb) { return listen(api.chat.onText, cb); },
    onThinking: function (cb) { return listen(api.chat.onThinking, cb); },
    onToolStart: function (cb) { return listen(api.chat.onToolStart, cb); },
    onToolEnd: function (cb) { return listen(api.chat.onToolEnd, cb); },
    onToolDelta: function (cb) { return listen(api.chat.onToolDelta, cb); },
    onUsage: function (cb) { return listen(api.chat.onUsage, cb); },
    onError: function (cb) { return listen(api.chat.onError, cb); },
    onEnd: function (cb) { return listen(api.chat.onEnd, cb); },
    onBotStatus: function (cb) { return listen(api.bot.onStatus, cb); },
    onBotLog: function (cb) { return listen(api.bot.onLog, cb); },
    onMainLog: function (cb) { return listen(api.log.onLog, cb); },
    loadLogs: function (options) { return api.log.load(options); },
    // 批量清理所有监听
    cleanup: function () {
      cleanupFns.forEach(function (fn) { fn(); });
      cleanupFns = [];
    },
  };
})();
