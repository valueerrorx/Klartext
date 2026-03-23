/**
 * @license GPL LICENSE
 * Copyright (c) 2021 Thomas Michael Weissel
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free Software Foundation,
 * either version 3 of the License, or any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * You should have received a copy of the GNU General Public License along with this program.
 * If not, see <http://www.gnu.org/licenses/>
 */

// Sends text to llama-server and returns the corrected version.
// Handles prompt building (per language) and raw output cleaning.

import { LLAMA_SERVER_PORT } from './config.js';

const SYSTEM_PROMPTS = {
    de: 'Du bist ein Korrektursystem. Korrigiere Rechtschreib- und Grammatikfehler im Text. Antworte AUSSCHLIESSLICH mit dem korrigierten Text — keine Einleitungen, keine Erklärungen, keine Auflistung der Änderungen, kein Markdown.',
    en: 'You are a text correction system. Fix spelling and grammar errors. Reply with the corrected text ONLY — no introduction, no explanations, no list of changes, no markdown.',
    it: 'Sei un sistema di correzione. Correggi gli errori nel testo. Rispondi SOLO con il testo corretto — nessuna introduzione, spiegazione o elenco di modifiche.',
    fr: 'Tu es un système de correction. Corrige les fautes dans le texte. Réponds UNIQUEMENT avec le texte corrigé — pas d\'introduction, d\'explication ni de liste de modifications.',
};

// Known preamble phrases models add before the corrected text
const PREAMBLE_PATTERNS = [
    /^hier ist der korrigierte text[:\s]*/i,
    /^korrigierter text[:\s]*/i,
    /^der korrigierte text lautet[:\s]*/i,
    /^korrektur[:\s]*/i,
    /^ergebnis[:\s]*/i,
    /^ausgabe[:\s]*/i,
    /^here is the corrected text[:\s]*/i,
    /^corrected text[:\s]*/i,
    /^here('s| is) the (corrected|fixed) (version|text)[:\s]*/i,
    /^voici le texte corrigé[:\s]*/i,
    /^texte corrigé[:\s]*/i,
    /^ecco il testo corretto[:\s]*/i,
    /^testo corretto[:\s]*/i,
];

// Strips preamble and metadata (change lists, HR, tables) from model output.
// Reads top-to-bottom: keeps lines until a clear metadata boundary is hit.
// This preserves multi-paragraph corrected texts in full.
function extractCorrectedText(rawOutput) {
    let text = rawOutput.trim();
    if (!text) return rawOutput;

    for (const re of PREAMBLE_PATTERNS) {
        text = text.replace(re, '').trim();
    }

    const resultLines = [];
    for (const line of text.split('\n')) {
        const t = line.trim();

        // Hard stops — everything after this is metadata
        if (/^[-=*_]{3,}\s*$/.test(t)) break;                                                    // horizontal rule
        if (/^(änderungen|changes|corrections|korrekturen|modifications)[:\s]*$/i.test(t)) break; // section header
        if (/^[-*•]\s+[„"'"]\S/.test(t) && /[→\->]/.test(t)) break;                             // bullet change list
        if (/^\d+\.\s+\S/.test(t) && /[→\->]/.test(t)) break;                                   // numbered change list

        // Soft skip — table rows are metadata but don't end the content block
        if (/\|/.test(t) && (t.match(/\|/g) || []).length >= 2) continue;

        resultLines.push(line);
    }

    return resultLines.join('\n').trim() || text;
}

export async function korrigiereText(textToCorrect, language = 'de-DE') {
    const langKey      = language.split('-')[0];
    const systemPrompt = SYSTEM_PROMPTS[langKey] ?? SYSTEM_PROMPTS.en;

    const response = await fetch(`http://127.0.0.1:${LLAMA_SERVER_PORT}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: textToCorrect },
            ],
            temperature: 0.1,
            stream: false,
        }),
    });

    if (!response.ok) {
        throw new Error(`llama-server HTTP ${response.status}: ${await response.text()}`);
    }

    const data   = await response.json();
    const raw    = data.choices?.[0]?.message?.content ?? '';
    const result = extractCorrectedText(raw);

    console.log(`  [model raw]:       ${raw}`);
    console.log(`  [model extracted]: ${result}`);
    return result;
}
