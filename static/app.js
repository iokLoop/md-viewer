/* md-viewer — annotation & section-toggle logic */

(function () {
  // Only run on the viewer page
  if (typeof PROJECT === 'undefined') return;

  // ── State ───────────────────────────────────────────────────────────────
  let notes        = INIT_NOTES;
  let selectedText = '';
  let selectedSection = '';
  let activeColor  = 'yellow';

  // ── DOM refs ────────────────────────────────────────────────────────────
  const content     = document.getElementById('md-content');
  const notesList   = document.getElementById('notes-list');
  const notesEmpty  = document.getElementById('notes-empty');
  const annBtn      = document.getElementById('ann-btn');
  const annPopup    = document.getElementById('ann-popup');
  const annOverlay  = document.getElementById('ann-overlay');
  const annTextarea = document.getElementById('ann-textarea');
  const annPreview  = document.getElementById('ann-selected-preview');
  const annSave     = document.getElementById('ann-save');
  const annCancel   = document.getElementById('ann-cancel');
  const panelToggle    = document.getElementById('panel-toggle');
  const notesPanel     = document.getElementById('notes-panel');
  const layout         = document.querySelector('.viewer-layout');
  const counter        = document.getElementById('notes-counter');
  const backToTop      = document.getElementById('back-to-top');
  const resolvedToggle = document.getElementById('resolved-toggle');

  let showResolved = false;

  if (!content) return; // safety guard

  // ── Color selector ──────────────────────────────────────────────────────
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
      activeColor = dot.dataset.color;
    });
  });
  document.querySelector('.color-dot[data-color="yellow"]').classList.add('selected');

  // ── Section toggles ─────────────────────────────────────────────────────
  // Simple approach: prepend a toggle button inside each heading (no DOM restructuring)
  function initSectionToggles() {
    content.querySelectorAll('h2, h3').forEach(h => {
      const prefix     = h.tagName === 'H2' ? '## ' : '### ';
      const sectionKey = prefix + h.textContent.trim();

      const btn = document.createElement('button');
      btn.classList.add('section-toggle');
      btn.title       = 'Marcar como completada';
      btn.textContent = '✓';

      h.insertBefore(btn, h.firstChild);

      if ((notes.completed_sections || []).includes(sectionKey)) {
        btn.classList.add('done');
      }

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        apiPost({ action: 'toggle_section', section: sectionKey }).then(data => {
          notes = data.file_data;
          btn.classList.toggle('done', (notes.completed_sections || []).includes(sectionKey));
          updateCounter();
        });
      });
    });
  }

  // Get the closest section heading text above a given node
  function getNearestSection(node) {
    const allHeadings = Array.from(content.querySelectorAll('h2, h3'));
    // Find which heading comes before this node in document order
    let best = '';
    for (const h of allHeadings) {
      if (node.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING) {
        const prefix = h.tagName === 'H2' ? '## ' : '### ';
        // strip the toggle button text (first child is the btn)
        const text = Array.from(h.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !n.classList.contains('section-toggle')))
          .map(n => n.textContent)
          .join('').trim();
        best = prefix + text;
      }
    }
    return best;
  }

  // ── Text selection → float button ───────────────────────────────────────
  document.addEventListener('mouseup', () => {
    // Small delay so browser settles the selection
    setTimeout(() => {
      if (annPopup.style.display !== 'none') return;

      const sel  = window.getSelection();
      const text = sel ? sel.toString().trim() : '';

      if (text.length < 2) {
        annBtn.style.display = 'none';
        return;
      }

      // Check that selection touches the content area
      if (!sel.rangeCount) { annBtn.style.display = 'none'; return; }
      const range     = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const inContent = content.contains(container) ||
                        (container.nodeType === Node.TEXT_NODE && content.contains(container.parentNode));
      if (!inContent) { annBtn.style.display = 'none'; return; }

      selectedText    = text;
      selectedSection = getNearestSection(range.startContainer);

      // position:fixed → viewport coords, no scrollY
      const rect = range.getBoundingClientRect();
      annBtn.style.display = 'block';
      annBtn.style.top     = `${rect.bottom + 8}px`;
      annBtn.style.left    = `${Math.max(0, rect.left)}px`;
    }, 10);
  });

  // Hide button when clicking elsewhere
  document.addEventListener('mousedown', (e) => {
    if (e.target !== annBtn) annBtn.style.display = 'none';
  });

  annBtn.addEventListener('click', () => {
    annBtn.style.display = 'none';
    annPreview.textContent = selectedText.slice(0, 120) + (selectedText.length > 120 ? '…' : '');
    annTextarea.value = '';
    annPopup.style.display  = 'flex';
    annOverlay.style.display = 'block';
    annTextarea.focus();
  });

  // ── Popup actions ────────────────────────────────────────────────────────
  annCancel.addEventListener('click', closePopup);
  annOverlay.addEventListener('click', closePopup);

  annSave.addEventListener('click', () => {
    const noteText = annTextarea.value.trim();
    if (!noteText) return;
    apiPost({
      action:        'add_annotation',
      selected_text: selectedText,
      note:          noteText,
      section:       selectedSection,
      color:         activeColor,
    }).then(data => {
      notes = data.file_data;
      renderNotes();
      updateCounter();
      closePopup();
    });
  });

  annTextarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) annSave.click();
    if (e.key === 'Escape') closePopup();
  });

  function closePopup() {
    annPopup.style.display   = 'none';
    annOverlay.style.display = 'none';
    window.getSelection()?.removeAllRanges();
    annBtn.style.display = 'none';
  }

  // ── Render notes sidebar ─────────────────────────────────────────────────
  function renderNotes() {
    const allAnns = notes.annotations || [];
    // Build global index map (by creation order, regardless of filter)
    const globalIdx = new Map(allAnns.map((a, i) => [a.id, i + 1]));

    const anns = showResolved ? allAnns : allAnns.filter(a => a.status !== 'resolved');
    notesList.innerHTML = '';

    if (allAnns.length === 0) {
      notesEmpty.style.display = 'block';
      highlightAnnotations();
      return;
    }
    notesEmpty.style.display = 'none';

    // Group by section (preserving original order within each group)
    const grouped = {};
    const groupOrder = [];
    anns.forEach(a => {
      const sec = a.section || '(sin sección)';
      if (!grouped[sec]) { grouped[sec] = []; groupOrder.push(sec); }
      grouped[sec].push(a);
    });

    groupOrder.forEach(section => {
      const items = grouped[section];
      const secLabel = document.createElement('div');
      secLabel.style.cssText = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;padding:6px 0 4px;border-bottom:1px solid var(--border);margin-bottom:6px;';
      secLabel.textContent = section.replace(/^#{2,3}\s*/, '');
      notesList.appendChild(secLabel);

      items.forEach(ann => {
        const num      = globalIdx.get(ann.id);
        const resolved = ann.status === 'resolved';
        const card = document.createElement('div');
        card.classList.add('note-card');
        if (resolved) card.classList.add('resolved');
        card.dataset.color = ann.color || 'yellow';
        card.dataset.annId = ann.id;
        card.innerHTML = `
          <div style="margin-bottom:4px">
            <span class="note-num">#${num}</span>
            ${ann.selected_text
              ? `<span class="note-quote" style="display:inline">"${escHtml(ann.selected_text.slice(0, 60))}${ann.selected_text.length > 60 ? '…' : ''}"</span>`
              : ''}
          </div>
          <div class="note-text">${escHtml(ann.note)}</div>
          <div class="note-footer">
            <span class="note-date">${ann.created || ''}</span>
            <span class="note-footer-actions">
              <button class="note-resolve" data-id="${ann.id}" title="${resolved ? 'Reabrir' : 'Marcar resuelta'}">✓</button>
              <button class="note-delete"  data-id="${ann.id}" title="Eliminar">✕</button>
            </span>
          </div>`;
        notesList.appendChild(card);

        // Click card body → scroll to highlight in doc (or section heading)
        card.addEventListener('click', (e) => {
          if (e.target.classList.contains('note-delete') ||
              e.target.classList.contains('note-resolve')) return;
          const hl = content.querySelector(`.ann-highlight[data-ann-id="${ann.id}"]`);
          if (hl) {
            const y = hl.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: y, behavior: 'smooth' });
          } else if (ann.section) {
            const norm = slugNormalize(ann.section.replace(/^#{2,3}\s*/, ''));
            let target = null;
            content.querySelectorAll('h2,h3').forEach(h => {
              if (target) return;
              const hText = slugNormalize(
                Array.from(h.childNodes)
                  .filter(n => !(n.classList && n.classList.contains('section-toggle')))
                  .map(n => n.textContent).join('')
              );
              if (hText === norm) target = h;
            });
            if (target) {
              const y = target.getBoundingClientRect().top + window.scrollY - 60;
              window.scrollTo({ top: y, behavior: 'smooth' });
            }
          }
        });
      });
    });

    // Delete buttons
    notesList.querySelectorAll('.note-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        apiPost({ action: 'delete_annotation', id: btn.dataset.id }).then(data => {
          notes = data.file_data;
          renderNotes();
          updateCounter();
        });
      });
    });

    // Resolve buttons
    notesList.querySelectorAll('.note-resolve').forEach(btn => {
      btn.addEventListener('click', () => {
        apiPost({ action: 'resolve_annotation', id: btn.dataset.id }).then(data => {
          notes = data.file_data;
          renderNotes();
          updateCounter();
        });
      });
    });

    highlightAnnotations();
  }

  // ── Highlight annotated text in the document ─────────────────────────────
  function highlightAnnotations() {
    // Remove existing highlights, restoring original text nodes
    content.querySelectorAll('mark.ann-highlight').forEach(mark => {
      const text = Array.from(mark.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent).join('');
      mark.parentNode.replaceChild(document.createTextNode(text), mark);
      mark.parentNode.normalize?.();
    });

    const allAnns = notes.annotations || [];
    const globalIdx = new Map(allAnns.map((a, i) => [a.id, i + 1]));

    allAnns.forEach(ann => {
      if (!ann.selected_text) return;
      const search = ann.selected_text;
      const walker = document.createTreeWalker(
        content,
        NodeFilter.SHOW_TEXT,
        { acceptNode: n => n.parentElement.closest('.section-toggle, mark')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }
      );
      let node;
      while ((node = walker.nextNode())) {
        const pos = node.textContent.indexOf(search);
        if (pos === -1) continue;

        const before = node.textContent.slice(0, pos);
        const after  = node.textContent.slice(pos + search.length);

        const mark = document.createElement('mark');
        mark.className = 'ann-highlight' + (ann.status === 'resolved' ? ' resolved' : '');
        mark.dataset.annId = ann.id;
        mark.dataset.color  = ann.color || 'yellow';
        mark.title = `[#${globalIdx.get(ann.id)}] ${ann.note}`;
        mark.appendChild(document.createTextNode(search));
        const sup = document.createElement('sup');
        sup.className   = 'ann-num';
        sup.textContent = `#${globalIdx.get(ann.id)}`;
        mark.appendChild(sup);

        const parent = node.parentNode;
        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(mark, node);
        if (after) parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);

        // Click highlight → flash the note card in sidebar
        mark.addEventListener('click', () => {
          const card = notesList.querySelector(`[data-ann-id="${ann.id}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            card.classList.remove('flash');
            void card.offsetWidth;
            card.classList.add('flash');
            setTimeout(() => card.classList.remove('flash'), 700);
          }
        });
        break; // first occurrence only
      }
    });
  }

  // ── Counter ──────────────────────────────────────────────────────────────
  function updateCounter() {
    const allAnns  = notes.annotations || [];
    const open     = allAnns.filter(a => a.status !== 'resolved').length;
    const resolved = allAnns.filter(a => a.status === 'resolved').length;
    const done     = (notes.completed_sections || []).length;
    const parts    = [];
    if (open > 0)     parts.push(`💬 ${open}`);
    if (resolved > 0) parts.push(`✓ ${resolved}`);
    if (done > 0)     parts.push(`☑ ${done}`);
    counter.textContent = parts.join('  ');
  }

  // ── Resolved toggle ──────────────────────────────────────────────────────
  if (resolvedToggle) {
    resolvedToggle.addEventListener('click', () => {
      showResolved = !showResolved;
      resolvedToggle.classList.toggle('active', showResolved);
      renderNotes();
    });
  }

  // ── Panel collapse ───────────────────────────────────────────────────────
  panelToggle.addEventListener('click', () => {
    notesPanel.classList.toggle('collapsed');
    layout.classList.toggle('collapsed');
  });

  // ── Anchor link fix ──────────────────────────────────────────────────────
  // slugNormalize: strip accents, punctuation, collapse ALL runs of spaces/dashes to '-'
  function slugNormalize(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // strip combining accents
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')           // strip punctuation (keeps \w, spaces, hyphens)
      .trim()
      .replace(/[-\s]+/g, '-');           // collapse spaces AND multiple dashes → single '-'
  }

  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const raw  = decodeURIComponent(link.getAttribute('href').slice(1));
      const norm = slugNormalize(raw);

      // 1. Direct ID match (exact or normalized)
      let target = document.getElementById(raw) || document.getElementById(norm);

      // 2. Match by normalizing each heading's ID and text content
      if (!target) {
        content.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
          if (target) return;
          const headingId   = slugNormalize(h.id || '');
          // get text without the toggle button
          const headingText = slugNormalize(
            Array.from(h.childNodes)
              .filter(n => !(n.classList && n.classList.contains('section-toggle')))
              .map(n => n.textContent)
              .join('')
          );
          if (headingId === norm || headingText === norm) target = h;
        });
      }

      if (target) {
        e.preventDefault();
        const TOPBAR = 60;
        const y = target.getBoundingClientRect().top + window.scrollY - TOPBAR;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  });

  // ── API ──────────────────────────────────────────────────────────────────
  function apiPost(payload) {
    return fetch(`/api/${PROJECT}/notes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filepath: FILEPATH, ...payload }),
    }).then(r => r.json());
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  initSectionToggles();
  renderNotes();
  updateCounter();

  document.addEventListener('scroll', () => {
    annBtn.style.display = 'none';
    if (backToTop) backToTop.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });

  if (backToTop) {
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

})();
