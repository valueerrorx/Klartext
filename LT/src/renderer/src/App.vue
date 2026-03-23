<template>
  <div id="app">

    <!-- Content: editor + sidebar -->
    <div id="content">

      <!-- Editor (scrollable) -->
      <div id="editor-wrapper">
        <div id="editorcontent">
          <editor-content :editor="editor" />
        </div>
        <!-- Canvas overlays the editor for highlights -->
        <canvas id="highlight-layer"></canvas>
      </div>

      <!-- LanguageTool Sidebar -->
      <div id="lt-sidebar">

        <div id="lt-controls">
          <button id="lt-check-btn" @click="checkText" :disabled="checking">
            {{ checking ? 'Prüfe...' : 'Prüfen' }}
          </button>
          <button
            v-if="ignoreList.size > 0"
            id="lt-clear-btn"
            @click="clearIgnoreList"
            title="Ignorierliste löschen"
          >✕ {{ ignoreList.size }}</button>
        </div>

        <div id="lt-lang">
          <select v-model="language">
            <option value="de-DE">Deutsch</option>
            <option value="en-GB">English (GB)</option>
            <option value="en-US">English (US)</option>
            <option value="fr-FR">Français</option>
            <option value="es-ES">Español</option>
            <option value="it-IT">Italiano</option>
            <option value="sl-SI">Slovenščina</option>
          </select>
        </div>

        <div id="lt-status" v-if="ltStatus">{{ ltStatus }}</div>

        <div id="lt-errors">
          <div
            v-for="(match, i) in matches"
            :key="i"
            class="error-entry"
            :class="{ selected: match === currentLTword }"
            @click="showWord(match)"
          >
            <div class="error-header">
              <span class="color-dot" :style="{ backgroundColor: match.color }"></span>
              <span class="error-word">{{ match.wrongWord }}</span>
              <button class="ignore-btn" @click.stop="ignoreWord(match)" title="Ignorieren">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                  <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                  <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
                </svg>
              </button>
            </div>
            <div class="error-category" v-if="match.rule?.category?.name">{{ match.rule.category.name }}</div>
            <div class="error-message" v-if="match.message">{{ match.message }}</div>
            <div class="error-suggestions" v-if="match.replacements?.length">
              → {{ match.replacements.slice(0, 3).map(r => r.value).join(', ') }}
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script>
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

import { Editor, EditorContent } from '@tiptap/vue-3'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'

const LT_URL = 'http://localhost:9099/v2/check'

function getColor(issueType, isOnlySpaces) {
  const t = issueType ?? ''
  if (t === 'whitespace' || (t === 'typographical' && isOnlySpaces)) return 'rgba(243,190,41,0.9)'
  if (t === 'typographical') return 'rgba(146,43,33,0.8)'
  if (t === 'misspelling') return 'rgba(211,84,0,0.8)'
  if (t === 'grammar') return 'rgba(26,115,232,0.85)'
  if (t === 'style') return 'rgba(0,128,128,0.85)'
  if (t === 'punctuation') return 'rgba(136,84,208,0.85)'
  if (t === 'semantics') return 'rgba(180,80,180,0.85)'
  if (t === 'redundancy') return 'rgba(200,100,50,0.85)'
  return 'rgba(108,52,131,0.8)'
}

export default {
  components: { EditorContent },

  data() {
    return {
      editor: null,
      language: 'de-DE',
      matches: [],
      currentLTword: null,
      checking: false,
      ltStatus: '',
      ignoreList: new Set(),
      _resizeObserver: null,
      _scrollHandler: null
    }
  },

  mounted() {
    this.editor = new Editor({
      extensions: [Document, Paragraph, Text],
      content: '<p>ich weis das ich nix weis</p>',
      autofocus: true
    })

    // scroll → redraw highlights
    this._scrollHandler = () => {
      if (!this.matches.length) return
      requestAnimationFrame(() => {
        this._updatePositions()
        this._drawCanvas()
      })
    }
    document.getElementById('editor-wrapper')
      .addEventListener('scroll', this._scrollHandler)

    // resize → resize canvas and redraw
    this._resizeObserver = new ResizeObserver(() => {
      this._resizeCanvas()
      this._updatePositions()
      this._drawCanvas()
    })
    this._resizeObserver.observe(document.getElementById('editor-wrapper'))
  },

  beforeUnmount() {
    this.editor?.destroy()
    document.getElementById('editor-wrapper')
      ?.removeEventListener('scroll', this._scrollHandler)
    this._resizeObserver?.disconnect()
  },

  methods: {

    // ── LT check ──────────────────────────────────────────────────

    async checkText() {
      const text = this.editor.getText()
      if (!text.trim()) {
        this.ltStatus = 'Kein Text vorhanden'
        this.matches = []
        this.currentLTword = null
        this._clearCanvas()
        return
      }

      this.checking = true
      this.ltStatus = 'Prüfe...'
      this.matches = []
      this.currentLTword = null
      this._clearCanvas()

      try {
        const response = await fetch(LT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ text, language: this.language }).toString()
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()

        this.matches = data.matches
          .map(m => ({
            ...m,
            wrongWord: text.substring(m.offset, m.offset + m.length),
            color: getColor(
              m.rule?.issueType,
              text.substring(m.offset, m.offset + m.length).trim() === ''
            )
          }))
          .filter(m => !this.ignoreList.has(m.wrongWord))

        this.ltStatus = this.matches.length ? '' : 'Keine Fehler gefunden'

        await this.$nextTick()
        this._findWordPositions()

      } catch (e) {
        this.ltStatus = 'Server nicht erreichbar (localhost:9099)'
        this.matches = []
      } finally {
        this.checking = false
      }
    },

    // ── Sidebar interactions ───────────────────────────────────────

    showWord(match) {
      this.currentLTword = match

      // scroll editor to the word
      if (match.range) {
        const wrapperEl = document.getElementById('editor-wrapper')
        const wrapperRect = wrapperEl.getBoundingClientRect()
        const rects = match.range.getClientRects()
        if (rects.length) {
          const r = rects[0]
          const wordTopInWrapper = r.top - wrapperRect.top + wrapperEl.scrollTop
          wrapperEl.scrollTo({
            top: wordTopInWrapper - wrapperEl.offsetHeight / 2 + r.height,
            behavior: 'smooth'
          })
        }
      }

      this._updatePositions()
      this._drawCanvas()
    },

    ignoreWord(match) {
      this.ignoreList = new Set([...this.ignoreList, match.wrongWord])
      this.matches = this.matches.filter(m => !this.ignoreList.has(m.wrongWord))
      if (this.currentLTword === match) this.currentLTword = null
      this._updatePositions()
      this._drawCanvas()
    },

    clearIgnoreList() {
      this.ignoreList = new Set()
    },

    // ── Canvas ────────────────────────────────────────────────────

    _resizeCanvas() {
      const canvas = document.getElementById('highlight-layer')
      const wrapperEl = document.getElementById('editor-wrapper')
      if (!canvas || !wrapperEl) return
      // size canvas to cover the entire scrollable content
      canvas.width = wrapperEl.offsetWidth
      canvas.height = wrapperEl.scrollHeight
    },

    _clearCanvas() {
      const canvas = document.getElementById('highlight-layer')
      if (!canvas) return
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    },

    // Convert viewport-relative word rects → canvas-relative positions.
    // Canvas top-left = wrapper top-left + scroll offset.
    _updatePositions() {
      const canvas = document.getElementById('highlight-layer')
      const wrapperEl = document.getElementById('editor-wrapper')
      if (!canvas || !wrapperEl) return
      const wRect = wrapperEl.getBoundingClientRect()

      this.matches.forEach(word => {
        if (!word.range) return
        try {
          const rects = word.range.getClientRects()
          if (rects.length) {
            const r = rects[0]
            word.position = {
              left:   r.left - wRect.left,
              top:    r.top  - wRect.top + wrapperEl.scrollTop,
              width:  r.width,
              height: r.height
            }
          }
        } catch (e) { /* stale range – cleaned up on next full check */ }
      })
    },

    _drawCanvas() {
      const canvas = document.getElementById('highlight-layer')
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      this.matches.forEach(word => {
        if (!word.position) return
        const { left, top, width, height } = word.position
        const isSelected = word === this.currentLTword

        if (word.isInsertion) {
          // Missing character: draw a thin vertical bar at the insertion point
          // (right edge of the reference character = where the char should be inserted)
          const xPos = left + width
          ctx.fillStyle = word.color
          ctx.fillRect(xPos - 1, top, 2, height)
          if (isSelected) {
            ctx.globalAlpha = 0.2
            ctx.fillRect(xPos - 10, top, 20, height)
            ctx.globalAlpha = 1
          }
        } else if (isSelected) {
          // full-height semi-transparent block for selected word
          ctx.globalAlpha = 0.35
          ctx.fillStyle = word.color
          ctx.fillRect(left, top, width, height)
          ctx.globalAlpha = 1
        } else {
          // 3px underline-bar at bottom of the character cell
          ctx.fillStyle = word.color
          ctx.fillRect(left, top + height - 3, width, 3)
        }
      })
    },

    // ── Find word positions ────────────────────────────────────────

    _findWordPositions() {
      const textContainer = document.querySelector('.ProseMirror')
      if (!textContainer) return

      this._resizeCanvas()

      // Build offset map from ProseMirror document model (not from DOM tags).
      // This exactly mirrors editor.getText() logic, so it is robust to tables,
      // images, nested structures, and any TipTap extension.
      const offsetMap = this._buildOffsetMap()

      // Step 1: regex search for normal (non-empty, non-whitespace) words
      const regexWords = this.matches.filter(m => !m.range && m.length > 0 && m.wrongWord.trim() !== '')
      this._findByRegex(textContainer, regexWords)

      // Step 2: offset-map for zero-length (missing char) + whitespace +
      //         any word the regex approach failed to locate
      this.matches.filter(m => !m.range).forEach(w => this._findByOffsetMap(w, offsetMap))

      this._updatePositions()
      this._drawCanvas()
    },

    // Builds a flat array indexed by editor.getText() offset.
    // Entry is { pmPos } for real text chars, null for '\n' block/hardbreak separators.
    //
    // Uses doc.nodesBetween() which is EXACTLY what ProseMirror's getTextBetween
    // (called by editor.getText()) does internally — so the indices always match,
    // regardless of tables, images, figures, or any unknown extension.
    _buildOffsetMap() {
      const doc = this.editor.state.doc
      const map = []
      let separated = true   // mirrors the 'separated' flag in getTextBetween

      doc.nodesBetween(0, doc.content.size, (node, pos) => {
        if (node.isText) {
          for (let i = 0; i < node.text.length; i++) {
            map.push({ pmPos: pos + i })
          }
          separated = false
        } else if (!separated && node.isBlock) {
          // Any block boundary → the '\n' blockSeparator in editor.getText()
          map.push(null)
          separated = true
        }
        // Non-text inline leaves (images etc.) contribute nothing → no map entry
      })

      return map
    },

    // Regex-based position search (best for normal words – handles distance sorting).
    _findByRegex(textContainer, words) {
      if (!words.length) return

      const nodeIterator = document.createNodeIterator(textContainer, NodeFilter.SHOW_TEXT)
      let textNode, textOffset = 0
      const candidateMap = new Map()

      while ((textNode = nodeIterator.nextNode())) {
        const nodeText = textNode.nodeValue
        const nodeStart = textOffset

        words.forEach(word => {
          const escaped = word.wrongWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const fw = word.wrongWord[0] || ''
          const lw = word.wrongWord[word.wrongWord.length - 1] || ''
          const pattern = (/\w/.test(fw) || /\w/.test(lw)) ? `\\b${escaped}\\b` : escaped
          const regex = new RegExp(pattern, 'g')
          let match
          while ((match = regex.exec(nodeText)) !== null) {
            const distance = Math.abs(nodeStart + match.index - word.offset)
            if (!candidateMap.has(word)) candidateMap.set(word, [])
            candidateMap.get(word).push({ textNode, match, distance, offsetInNode: match.index })
          }
        })

        textOffset += nodeText.length
      }

      candidateMap.forEach((candidates, word) => {
        candidates.sort((a, b) => a.distance - b.distance)
        for (const { textNode: node, match, offsetInNode } of candidates) {
          const taken = this.matches.some(w =>
            w !== word && w.range &&
            w.range.startContainer === node && w.range.startOffset === offsetInNode)
          if (taken) continue
          const range = document.createRange()
          range.setStart(node, offsetInNode)
          range.setEnd(node, offsetInNode + match[0].length)
          if (!range.getClientRects().length) continue
          word.range = range
          break
        }
      })
    },

    // Offset-map–based position search using ProseMirror's view.domAtPos().
    // Handles: length=0 (missing char), whitespace, and anything the regex missed.
    _findByOffsetMap(word, offsetMap) {
      const view = this.editor.view

      // Convert a pair of consecutive PM positions to a DOM Range.
      // view.domAtPos() is TipTap's canonical mapping — handles all node types.
      const rangeForPm = (pmStart, pmEnd) => {
        try {
          const s = view.domAtPos(pmStart)
          const e = view.domAtPos(pmEnd)
          const r = document.createRange()
          r.setStart(s.node, s.offset)
          r.setEnd(e.node, e.offset)
          return r.getClientRects().length ? r : null
        } catch (_) { return null }
      }

      if (word.length === 0) {
        // Insertion: anchor on the last real char before the offset,
        // skipping backwards over any null (= \n) entries.
        let refIdx = word.offset - 1
        while (refIdx >= 0 && !offsetMap[refIdx]) refIdx--
        if (refIdx < 0) return
        const entry = offsetMap[refIdx]
        const range = rangeForPm(entry.pmPos, entry.pmPos + 1)
        if (!range) return
        word.range = range
        word.isInsertion = true   // → drawn as a vertical bar at the insertion point

      } else {
        // Whitespace / not-found word: map start and end via PM positions.
        const startEntry = offsetMap[word.offset]
        if (!startEntry) return
        let endIdx = word.offset + word.length - 1
        while (endIdx > word.offset && !offsetMap[endIdx]) endIdx--
        const endEntry = offsetMap[endIdx]
        if (!endEntry) return
        const range = rangeForPm(startEntry.pmPos, endEntry.pmPos + 1)
        if (!range) return
        word.range = range
      }
    }
  }
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #app {
  height: 100vh;
  overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
  background: #f0f0f5;
}

#app { display: flex; flex-direction: column; }

/* ── Layout ───────────────────────────────────────── */

#content { display: flex; flex: 1; overflow: hidden; }

/* ── Editor + canvas ──────────────────────────────── */

#editor-wrapper {
  position: relative;   /* anchor for absolute canvas */
  flex: 1;
  overflow-y: auto;
  background: #eeeefa;
  padding: 8px;
}

#editorcontent {
  position: relative;
  z-index: 2;           /* text stays above canvas */
  max-width: 210mm;
  margin: 0 auto;
  background: #fff;
  padding: 10mm 15mm;
  box-shadow: 0 2px 10px rgba(0,0,0,0.12);
}

.ProseMirror {
  outline: none;
  min-height: 400px;
  font-size: 12pt;
  line-height: 1.8;
  color: #111;
}

.ProseMirror p        { margin-bottom: 0.5em; }
.ProseMirror h1       { font-size: 1.8em; margin: 0.6em 0 0.3em; }
.ProseMirror h2       { font-size: 1.4em; margin: 0.6em 0 0.3em; }
.ProseMirror h3       { font-size: 1.15em; margin: 0.6em 0 0.3em; }

#highlight-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none; /* clicks pass through to editor */
  z-index: 3;           /* on top, but pointer-events: none */
}

/* ── LT Sidebar ───────────────────────────────────── */

#lt-sidebar {
  width: 280px;
  flex-shrink: 0;
  background: #fff;
  border-left: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

#lt-controls {
  display: flex;
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid #eee;
}

#lt-check-btn {
  flex: 1;
  padding: 6px;
  background: #2e7d32;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

#lt-check-btn:hover:not(:disabled) { background: #1b5e20; }
#lt-check-btn:disabled             { background: #aaa; cursor: default; }

#lt-clear-btn {
  padding: 6px 10px;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #666;
}

#lt-clear-btn:hover { border-color: #e88; color: #c33; }

#lt-lang {
  padding: 8px 10px;
  border-bottom: 1px solid #eee;
}

#lt-lang select {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  background: #fafafa;
}

#lt-status {
  padding: 8px 10px;
  font-size: 12px;
  color: #666;
  border-bottom: 1px solid #eee;
  font-style: italic;
}

#lt-errors { flex: 1; overflow-y: auto; padding: 6px; }

.error-entry {
  padding: 8px;
  margin-bottom: 5px;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  background: #fafafa;
  cursor: pointer;
}

.error-entry:hover    { background: #f0f0f8; }
.error-entry.selected { background: #eef4ff; border-color: #aac4e8; }

.error-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.error-word {
  font-weight: 600;
  font-size: 13px;
  flex: 1;
  word-break: break-word;
}

.ignore-btn {
  border: none;
  background: none;
  cursor: pointer;
  color: #aaa;
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: 3px;
}

.ignore-btn:hover { color: #555; background: #eee; }

.error-category {
  font-size: 11px;
  color: #999;
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.error-message {
  font-size: 12px;
  color: #444;
  margin-bottom: 3px;
  line-height: 1.4;
}

.error-suggestions {
  font-size: 12px;
  color: #2e7d32;
  font-style: italic;
}
</style>
