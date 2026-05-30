/**
 * embedding-worker.js — 向量化子进程
 *
 * 由 Electron 主进程 spawn 运行在打包的 Node.js 上。
 * 通过 stdin/stdout JSON-Line 协议通信。
 *
 * 通信协议：
 *   父进程 → worker: {"id":"1","method":"embed","params":{"text":"..."}}
 *   父进程 → worker: {"id":"2","method":"init","params":{}}
 *   worker → 父进程: {"id":"1","result":{"vector":[0.1,0.2,...]}}
 *   worker → 父进程: {"id":"2","result":{"ok":true}}
 *   worker → 父进程: {"id":"1","error":"错误信息"}
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// 设置环境变量，防止 native 模块找不到
// 兼容两种运行方式：
// 1) 打包的 Node.js：process.execPath = Resources/node/bin/node
// 2) Electron 内置 Node（ELECTRON_RUN_AS_NODE=1）：process.execPath = Electron 可执行文件
let resourcesDir;
if (typeof process.resourcesPath === 'string') {
  resourcesDir = process.resourcesPath;
} else {
  // 兜底：假设 execPath 在 Resources 子目录下
  const workerDir = path.dirname(process.execPath);
  resourcesDir = path.resolve(workerDir, '..', '..');
}
const distNodeModules = path.join(resourcesDir, 'dist-electron', 'node_modules');
const bundledNodeModules = path.join(resourcesDir, 'node', 'node_modules');

const pathSep = process.platform === 'win32' ? ';' : ':';
process.env.NODE_PATH = [process.env.NODE_PATH, distNodeModules, bundledNodeModules].filter(Boolean).join(pathSep);
require('module').Module._initPaths();

// 立即通知父进程 worker 已就绪（在加载 transformers 之前发送）
// 避免 import('@xenova/transformers') 时因模块加载耗时导致父进程超时
process.stdout.write(JSON.stringify({ id: 'ready', result: { pid: process.pid, node: process.version } }) + '\n');

let pipeline = null;
let initialized = false;

// ESM import 不使用 NODE_PATH，需要按绝对路径导入
// 多路径搜索 @xenova/transformers（打包环境 + dev 模式）
function resolveTransformers(searchPaths) {
  for (const base of searchPaths) {
    try {
      const transformersDir = path.join(base, '@xenova', 'transformers');
      const pkgJson = JSON.parse(fs.readFileSync(path.join(transformersDir, 'package.json'), 'utf-8'));
      const mainExport = (pkgJson.exports && pkgJson.exports['.']) || pkgJson.main || './src/transformers.js';
      return path.join(transformersDir, mainExport);
    } catch { continue; }
  }
  return null;
}

let transformersEntry = resolveTransformers([
  distNodeModules,
  bundledNodeModules,
  // NODE_PATH 中的目录（dev 模式下父进程传入项目 node_modules）
  ...(process.env.NODE_PATH || '').split(pathSep).filter(Boolean),
]);
if (!transformersEntry) {
  // 最后的 fallback
  transformersEntry = path.join(distNodeModules, '@xenova', 'transformers', 'src', 'transformers.js');
}

async function initPipeline(modelId, cacheDir, remoteHost) {
  let createPipeline, env;

  // @xenova/transformers 是 ESM 包，必须按绝对路径 import()
  try {
    const t = await import(pathToFileURL(transformersEntry).href);
    createPipeline = t.pipeline;
    env = t.env;
  } catch (err) {
    return { ok: false, error: `Failed to load transformers: ${err.message}` };
  }

  try {
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    if (remoteHost) env.remoteHost = remoteHost;

    // 设置推理后端 — 优先 onnxruntime-node，WASM 兜底
    if (process.env.XFORMERS_BACKEND === 'wasm') {
      env.backends = {
        'onnxruntime-web': {
          wasm: { numThreads: 1 },
        },
      };
    }

    const pipe = await createPipeline('feature-extraction', modelId, {
      quantized: true,
    });

    pipeline = pipe;
    initialized = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function embed(text) {
  if (!initialized) {
    return { error: 'Pipeline not initialized' };
  }
  try {
    const result = await pipeline(text, { pooling: 'mean', normalize: true });
    const vector = Array.from(result.data);
    return { vector };
  } catch (err) {
    return { error: err.message };
  }
}

// stdin 行协议
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    send({ id: 'unknown', error: 'Invalid JSON' });
    return;
  }

  try {
    if (req.method === 'init') {
      const result = await initPipeline(req.params.modelId, req.params.cacheDir, req.params.remoteHost);
      send({ id: req.id, result });
    } else if (req.method === 'embed') {
      const result = await embed(req.params.text);
      send({ id: req.id, result });
    } else {
      send({ id: req.id, error: `Unknown method: ${req.method}` });
    }
  } catch (err) {
    send({ id: req.id, error: err.message });
  }
});
