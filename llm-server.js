// Manages the llama-server child process.
// The model is loaded once on startup and stays in memory for the lifetime of this process.
// All inference happens via HTTP — no per-request model loading.

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { MODELS, SELECTED_MODEL_ID, MODEL_DIR, LLAMA_SERVER_PORT } from './config.js';

let llamaServerProcess = null;

function resolvePath(dir, file) {
    const p = path.resolve(process.cwd(), dir, file);
    if (!fs.existsSync(p)) throw new Error(`Datei fehlt: ${p}`);
    return p;
}

function findLlamaBinDir() {
    // Prefer the Vulkan-enabled build; fall back to CPU-only bin/
    const vulkanBuild = path.resolve(process.cwd(), 'llama.cpp', 'build', 'bin', 'llama-server');
    return fs.existsSync(vulkanBuild)
        ? path.resolve(process.cwd(), 'llama.cpp', 'build', 'bin')
        : path.resolve(process.cwd(), 'llama.cpp', 'bin');
}

export async function startLlamaServer() {
    const model      = MODELS[SELECTED_MODEL_ID];
    const modelPath  = resolvePath(MODEL_DIR, model.fileName);
    const binDir     = findLlamaBinDir();
    const binaryPath = path.join(binDir, 'llama-server');

    if (!fs.existsSync(binaryPath)) throw new Error(`llama-server nicht gefunden: ${binaryPath}`);

    const args = [
        '-m', modelPath,
        '--host', '127.0.0.1',
        '--port', String(LLAMA_SERVER_PORT),
        '--ctx-size', '4096',
        '--threads', '-1',          // auto-detect CPU cores
        '--n-gpu-layers', '999',    // offload all possible layers to GPU (Vulkan/AMD)
        '--log-disable',
    ];

    // Ensure shared libs (.so) in the same directory are found at runtime
    const ldPath = [binDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

    console.log(`[llama-server] Loading model: ${model.fileName} …`);
    llamaServerProcess = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LD_LIBRARY_PATH: ldPath },
    });
    llamaServerProcess.stderr.setEncoding('utf8');
    llamaServerProcess.stderr.on('data', d => process.stderr.write(d));
    llamaServerProcess.on('exit', code => {
        console.error(`[llama-server] process exited (code ${code})`);
        llamaServerProcess = null;
    });

    // Poll /health until the server responds (large models can take ~60 s to load)
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(`http://127.0.0.1:${LLAMA_SERVER_PORT}/health`);
            if (r.ok) { console.log('[llama-server] Ready — model loaded.'); return; }
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('llama-server did not become ready within 3 minutes');
}

export function stopLlamaServer() {
    if (llamaServerProcess) llamaServerProcess.kill();
}
