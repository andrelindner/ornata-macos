#!/usr/bin/env node
'use strict';

// ornata-macos — local web GUI server.
//
// Copyright (C) 2025 André Lindner
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation, either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
// FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
//
// A tiny zero-dependency HTTP server (Node built-ins only). It serves the
// single-page GUI and exposes a handful of JSON endpoints. All device I/O goes
// through src/engine.js — the same module the CLI uses — so the keyboard is
// only ever touched from this Node process.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFile } = require('child_process');

const { layoutPayload } = require('./layout');
const { BUNDLED_DIR, scenePath, listScenes, readScene, writeScene } = require('./scenes');
const { probe, applySpec, probeMouse, applyMouse } = require('./engine');

const HOST = '127.0.0.1';
const PORT = Number(process.env.ORNATA_GUI_PORT) || 8787;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// --- helpers ----------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) { reject(new Error('request body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, urlPath) {
  // Only ever serve from PUBLIC_DIR; block traversal.
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { sendJson(res, 404, { error: 'not found' }); return; }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

// --- API --------------------------------------------------------------------

// The spec most recently applied to the keyboard in this server session. The
// device can't be read back, so this is what the page loads on open instead of
// starting with an empty board.
let currentScene = null; // { name: string|null, scene: object }

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/layout') {
    return sendJson(res, 200, layoutPayload());
  }

  if (req.method === 'GET' && p === '/api/current') {
    return sendJson(res, 200, { current: currentScene });
  }

  if (req.method === 'GET' && p === '/api/status') {
    const info = probe();
    return sendJson(res, 200, info);
  }

  if (req.method === 'GET' && p === '/api/scenes') {
    return sendJson(res, 200, { scenes: listScenes(BUNDLED_DIR) });
  }

  if (req.method === 'GET' && p === '/api/scene') {
    try {
      const full = scenePath(BUNDLED_DIR, url.searchParams.get('name'));
      const scene = readScene(full);
      return sendJson(res, 200, { name: path.basename(full), scene });
    } catch (e) {
      return sendJson(res, 404, { error: e.message });
    }
  }

  if (req.method === 'POST' && p === '/api/apply') {
    const spec = await readBody(req);
    try {
      const result = applySpec(spec);
      currentScene = { name: null, scene: spec };
      return sendJson(res, 200, { ok: true, litCells: result.litCells, device: result.name });
    } catch (e) {
      return sendJson(res, 200, { ok: false, code: e.code || 'ERROR', error: e.message });
    }
  }

  if (req.method === 'POST' && p === '/api/off') {
    try {
      const off = { background: '#000000', keys: {} };
      const result = applySpec(off);
      currentScene = { name: null, scene: off };
      return sendJson(res, 200, { ok: true, device: result.name });
    } catch (e) {
      return sendJson(res, 200, { ok: false, code: e.code || 'ERROR', error: e.message });
    }
  }

  if (req.method === 'GET' && p === '/api/mouse/status') {
    return sendJson(res, 200, probeMouse());
  }

  if (req.method === 'POST' && p === '/api/mouse') {
    const opts = await readBody(req);
    try {
      const result = applyMouse(opts);
      return sendJson(res, 200, { ok: true, device: result.name });
    } catch (e) {
      return sendJson(res, 200, { ok: false, code: e.code || 'ERROR', error: e.message });
    }
  }

  if (req.method === 'POST' && p === '/api/save') {
    const body = await readBody(req);
    try {
      const full = scenePath(BUNDLED_DIR, body.name);
      writeScene(full, body.scene);
      return sendJson(res, 200, { ok: true, name: path.basename(full) });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }
  }

  return sendJson(res, 404, { error: 'unknown endpoint' });
}

// --- server -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://${HOST}:${PORT}`); }
  catch (_) { return sendJson(res, 400, { error: 'bad url' }); }

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      if (!res.headersSent) sendJson(res, 500, { error: e.message });
    });
    return;
  }

  if (req.method === 'GET') return serveStatic(res, url.pathname);
  sendJson(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, HOST, () => {
  const urlStr = `http://${HOST}:${PORT}/`;
  console.log('ornata-macos GUI running at ' + urlStr);
  console.log('Press Ctrl+C to stop.');
  console.log('NOTE: quit the "Razer macOS" menu-bar app first — it holds the keyboard open.');
  if (process.env.ORNATA_GUI_NO_OPEN !== '1') {
    execFile('open', [urlStr], () => { /* best effort */ });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Error: port ${PORT} is already in use. Set ORNATA_GUI_PORT to another port.`);
  } else {
    console.error('Error: ' + e.message);
  }
  process.exit(1);
});
