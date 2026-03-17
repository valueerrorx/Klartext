// example request:
// curl -X POST http://localhost:9099/v2/check -H "Content-Type: application/json" -d '{"text":"Das ist einn Test.", "language":"de-DE"}'

import express from 'express';
import { PORT } from './config.js';
import { startLlamaServer, stopLlamaServer } from './llm-server.js';
import { korrigiereText } from './inference.js';
import { findCorrections, findWhitespaceErrors, buildLTResponse } from './diff.js';

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Exam-Name, X-Student-Name, X-Exam-Pin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/v2/check', async (req, res) => {
    const { text, language } = req.body;
    const ts      = new Date().toISOString();
    const exam    = req.headers['x-exam-name']    || '-';
    const student = req.headers['x-student-name'] || '-';
    const pin     = req.headers['x-exam-pin']     || '-';

    console.log(`[${ts}] POST /v2/check`);
    console.log(`  Exam: ${exam} | Student: ${student} | Pin: ${pin}`);
    console.log(`  Language: ${language || '(none)'} | Text (${(text || '').length} chars): "${(text || '').substring(0, 80)}${(text || '').length > 80 ? '…' : ''}"`);

    if (!text) {
        console.log('  => 400 Missing text');
        return res.status(400).json({ error: 'Missing required parameter: text' });
    }

    try {
        const corrected    = await korrigiereText(text, language || 'de-DE');
        const corrections  = [...findWhitespaceErrors(text), ...findCorrections(text, corrected)];
        const responseBody = buildLTResponse(text, language || 'de-DE', corrections);
        console.log(`  => 200 | ${corrections.length} correction(s) found`);
        console.log(JSON.stringify(responseBody, null, 2));
        res.json(responseBody);
    } catch (err) {
        console.error(`  => 500 ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { stopLlamaServer(); process.exit(0); });
}

startLlamaServer()
    .then(() => {
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`Spellcheck API running at http://localhost:${PORT}/v2/check`);
        });
        server.on('error', err => { console.error('Server error:', err); process.exit(1); });
    })
    .catch(err => {
        console.error('Failed to start llama-server:', err.message);
        stopLlamaServer();
        process.exit(1);
    });
