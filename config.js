// Ports
export const PORT              = 9099;   // Express API (LanguageTool-compatible)
export const LLAMA_SERVER_PORT = 8081;   // internal llama-server

// Paths (relative to cwd)
export const MODEL_DIR = 'models';

// Active model — change this number to switch models
export const SELECTED_MODEL_ID = 2;

export const MODELS = {
    1: { fileName: 'rwkv7-2.9B-g1-q4_k_m.gguf'              },   // 1.9 GB  — <10s befriedigend (de/en/fr/…)
    2: { fileName: 'Mistral-Nemo-Instruct-2407-Q6_K.gguf'    },  // 9.4 GB  — ~30s gut (passt nicht ganz in VRAM)
    3: { fileName: 'Qwen2.5-7B-Instruct-Q6_K.gguf'           },  // 5.8 GB  — <10s befriedigend (komplett auf GPU)
};
