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

// Compares original and corrected text to produce a list of corrections,
// then formats them as a LanguageTool-compatible JSON response.

const STRIP_PUNCT = /[.,!?;:'"«»„"]+/g;
const norm = w => w.toLowerCase().replace(STRIP_PUNCT, '');

// Classify a word substitution by how different the two words are
function classifyError(wrong, corrected) {
    const w = wrong.toLowerCase();
    const c = corrected.toLowerCase();
    if (w === c) return 'typographical'; // only case/punctuation differs

    // Levenshtein similarity
    const len = Math.max(w.length, c.length);
    let dp = Array.from({ length: w.length + 1 }, (_, i) => i);
    for (let j = 1; j <= c.length; j++) {
        const prev = dp.slice();
        dp[0] = j;
        for (let i = 1; i <= w.length; i++) {
            dp[i] = c[j-1] === w[i-1] ? prev[i-1] : 1 + Math.min(prev[i-1], prev[i], dp[i-1]);
        }
    }
    const similarity = (len - dp[w.length]) / len;
    return similarity >= 0.45 ? 'misspelling' : 'grammar';
}

// LCS-based word diff — robust against model truncation or insertions/deletions.
// Greedy lookahead loses alignment when the model drops a chunk; LCS finds the
// globally optimal alignment so unmatched tail tokens never cause false positives.
export function findCorrections(input, output) {
    const cleanOutput = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    const inputTokens = [];
    for (const m of input.matchAll(/\S+/g)) {
        inputTokens.push({ raw: m[0], norm: norm(m[0]), offset: m.index });
    }
    const outputTokens = (cleanOutput.match(/\S+/g) || []).map(w => ({ raw: w, norm: norm(w) }));

    if (outputTokens.length === 0) return [];

    // Build LCS DP table
    const n  = inputTokens.length;
    const m  = outputTokens.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            dp[i][j] = inputTokens[i-1].norm === outputTokens[j-1].norm
                ? dp[i-1][j-1] + 1
                : Math.max(dp[i-1][j], dp[i][j-1]);
        }
    }

    // Backtrack → sequence of keep / delete / insert ops; keep stores both tokens for punct checks
    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && inputTokens[i-1].norm === outputTokens[j-1].norm) {
            ops.unshift({ type: 'keep', inTok: inputTokens[i-1], outTok: outputTokens[j-1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
            ops.unshift({ type: 'insert', out: outputTokens[j-1] });
            j--;
        } else {
            ops.unshift({ type: 'delete', inTok: inputTokens[i-1] });
            i--;
        }
    }

    const TRAIL_PUNCT = /[.,!?;:]+$/;

    // Reports a punctuation mismatch at the position right after a given token
    const pushPunctCorrection = (inTok, outTok, corrections) => {
        const wordLen  = inTok.raw.replace(TRAIL_PUNCT, '').length;
        const inPunct  = inTok.raw.match(TRAIL_PUNCT)?.[0]  ?? '';
        const outPunct = outTok.raw.match(TRAIL_PUNCT)?.[0] ?? '';
        if (inPunct === outPunct) return;
        corrections.push({
            wrongword:     inPunct,
            correctedword: outPunct,
            wordlength:    inPunct.length,
            offset:        inTok.offset + wordLen,
            issueType:     'typographical',
        });
    };

    // Collect consecutive delete/insert blocks and pair them positionally.
    // A strict adjacent-only check misaligns when multiple words in a row differ,
    // because the LCS backtracker groups all deletes before all inserts in each block.
    const corrections = [];
    let k = 0;
    while (k < ops.length) {
        if (ops[k].type === 'keep') {
            const { inTok, outTok } = ops[k];
            // Kept word: check for case/typographical difference (norm stripped case, so "ich"==="Ich" in LCS)
            const inWord  = inTok.raw.replace(TRAIL_PUNCT, '');
            const outWord = outTok.raw.replace(TRAIL_PUNCT, '');
            if (inWord !== outWord) {
                corrections.push({
                    wrongword:     inWord,
                    correctedword: outWord,
                    wordlength:    inWord.length,
                    offset:        inTok.offset,
                    issueType:     'typographical',
                });
            }
            // Also check if punctuation suffix changed
            pushPunctCorrection(inTok, outTok, corrections);
            k++;
            continue;
        }
        if (ops[k].type !== 'delete') { k++; continue; }

        const deletes = [];
        const inserts = [];
        while (k < ops.length && ops[k].type === 'delete') deletes.push(ops[k++]);
        while (k < ops.length && ops[k].type === 'insert') inserts.push(ops[k++]);

        const count = Math.min(deletes.length, inserts.length);
        for (let p = 0; p < count; p++) {
            const inTok         = deletes[p].inTok;
            const outTok        = inserts[p].out;
            const wordLen       = inTok.raw.replace(TRAIL_PUNCT, '').length;
            const wrongword     = input.substring(inTok.offset, inTok.offset + wordLen);
            const correctedword = outTok.raw.replace(TRAIL_PUNCT, '');
            if (wrongword !== correctedword) {
                corrections.push({
                    wrongword, correctedword,
                    wordlength: wordLen,
                    offset:     inTok.offset,
                    issueType:  classifyError(wrongword, correctedword),
                });
            }
            // Also check if punctuation suffix was added/changed for this substituted word
            pushPunctCorrection(inTok, outTok, corrections);
        }
    }
    return corrections;
}

// Detects pure whitespace errors (double spaces, space before punctuation)
export function findWhitespaceErrors(text) {
    const errors = [];
    const seen   = new Set();

    const add = (m, replacement) => {
        if (seen.has(m.index)) return;
        seen.add(m.index);
        errors.push({
            wrongword:     m[0],
            correctedword: replacement,
            wordlength:    m[0].length,
            offset:        m.index,
            issueType:     'whitespace',
        });
    };

    for (const m of text.matchAll(/ {2,}/g))       add(m, ' ');    // double spaces
    for (const m of text.matchAll(/ ([.,!?;:])/g)) add(m, m[1]);   // space before punctuation

    return errors.sort((a, b) => a.offset - b.offset);
}

// Returns only the sentence containing the character at `offset`, split on .!?\n
function extractSentence(text, offset) {
    const sentenceEnd = /[.!?\n]/g;
    let start = 0;
    let end   = text.length;
    let match;
    while ((match = sentenceEnd.exec(text)) !== null) {
        if (match.index < offset) start = match.index + 1;
        else { end = match.index + 1; break; }
    }
    return text.slice(start, end).trim();
}

// Builds a LanguageTool-compatible JSON response from a list of corrections
export function buildLTResponse(text, language, corrections) {
    const ISSUE_META = {
        misspelling:   { id: 'TYPOS',      name: 'Possible Typo',      typeName: 'UnknownWord'    },
        grammar:       { id: 'GRAMMAR',    name: 'Grammar',             typeName: 'Other'          },
        typographical: { id: 'TYPOS',      name: 'Typographical Error', typeName: 'Other'          },
        whitespace:    { id: 'WHITESPACE', name: 'Whitespace',          typeName: 'typographical'  },
    };

    const matches = corrections.map(c => {
        const meta = ISSUE_META[c.issueType] ?? ISSUE_META.grammar;
        return {
            message:      c.issueType === 'grammar' ? 'Grammar error' : 'Possible spelling mistake',
            shortMessage: c.issueType,
            replacements: [{ value: c.correctedword }],
            offset:       c.offset,
            length:       c.wordlength,
            context: {
                text:   text.substring(Math.max(0, c.offset - 20), c.offset + c.wordlength + 20),
                offset: Math.min(c.offset, 20),
                length: c.wordlength,
            },
            sentence: extractSentence(text, c.offset),
            type: { typeName: meta.typeName },
            rule: {
                id:          'LOCAL_AI_SPELLCHECK',
                description: 'Local AI spellchecker',
                issueType:   c.issueType,
                category:    { id: meta.id, name: meta.name },
            },
            ignoreForIncompleteSentence: false,
            contextForSureMatch: 0,
        };
    });

    return {
        software: { name: 'local-ai-spellcheck', version: '1.0.0', apiVersion: 1, status: '' },
        warnings: { incompleteResults: false },
        language: { name: language, code: language },
        matches,
    };
}
