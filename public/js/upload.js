// Handles the two upload slots: drag & drop, file picker, client-side validation and previews.
// Client-side checks improve usability only — the backend must re-validate everything.
(function () {
  const MAX_BYTES = 5 * 1024 * 1024;
  const MIN_W = 100, MIN_H = 40;
  const MAX_W = 6000, MAX_H = 6000;
  const LOW_RES_WIDTH = 300;
  const ALLOWED = {
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
  };

  // Shared state read by results.js
  const state = {
    reference: null, // { file, url, width, height, warnings: [] }
    questioned: null,
  };

  const form = document.getElementById('verify-form');
  const consent = document.getElementById('consent');
  const analyzeBtn = document.getElementById('analyze-btn');
  const hint = document.getElementById('analyze-hint');

  // Detect the real format from the file's first bytes (don't trust the extension).
  async function sniffType(file) {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return null;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
  }

  function formatSize(bytes) {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function validate(file) {
    if (!file) return { error: 'No file selected.' };
    if (file.size === 0) return { error: 'This file is empty.' };
    if (file.size > MAX_BYTES) return { error: `This file is ${formatSize(file.size)}. The maximum is 5 MB.` };

    const realType = await sniffType(file);
    if (!realType || !ALLOWED[realType]) {
      return { error: 'Unsupported file. Please upload a JPG, PNG, or WebP image.' };
    }

    const url = URL.createObjectURL(file);
    let img;
    try {
      img = await loadImage(url);
    } catch {
      URL.revokeObjectURL(url);
      return { error: "This image couldn't be read. It may be damaged." };
    }

    const { naturalWidth: w, naturalHeight: h } = img;
    if (w < MIN_W || h < MIN_H) {
      URL.revokeObjectURL(url);
      return { error: `This image is too small (${w}×${h}px). The minimum is ${MIN_W}×${MIN_H}px.` };
    }
    if (w > MAX_W || h > MAX_H) {
      URL.revokeObjectURL(url);
      return { error: `This image is too large (${w}×${h}px). The maximum is ${MAX_W}×${MAX_H}px.` };
    }

    const warnings = [];
    if (w < LOW_RES_WIDTH) warnings.push(`Low resolution (${w}px wide). Results may be less reliable.`);
    const ratio = w / h;
    if (ratio < 0.8) warnings.push("The image is taller than it is wide. Make sure it's cropped to the signature.");

    return { ok: { file, url, width: w, height: h, warnings } };
  }

  function setupSlot(zone) {
    const slot = zone.dataset.slot;
    const input = zone.querySelector('input[type="file"]');
    const previewImg = zone.querySelector('.preview__img');
    const nameEl = zone.querySelector('.preview__name');
    const msg = document.querySelector(`[data-msg="${slot}"]`);

    function showMsg(text, kind) {
      msg.textContent = text || '';
      msg.className = 'field-msg' + (kind ? ` field-msg--${kind}` : '');
    }

    function clear() {
      if (state[slot]) URL.revokeObjectURL(state[slot].url);
      state[slot] = null;
      input.value = '';
      previewImg.removeAttribute('src');
      zone.classList.remove('has-file', 'has-error');
      showMsg('');
      updateAnalyzeState();
    }

    async function handle(file) {
      showMsg('Checking image…');
      const result = await validate(file);
      if (result.error) {
        // Keep any previously valid image; just report the problem.
        zone.classList.add('has-error');
        showMsg(result.error, 'error');
        input.value = '';
        updateAnalyzeState();
        return;
      }
      if (state[slot]) URL.revokeObjectURL(state[slot].url);
      state[slot] = result.ok;
      previewImg.src = result.ok.url;
      nameEl.textContent = `${file.name} · ${formatSize(file.size)} · ${result.ok.width}×${result.ok.height}`;
      nameEl.title = file.name;
      zone.classList.add('has-file');
      zone.classList.remove('has-error');
      if (result.ok.warnings.length) showMsg(result.ok.warnings.join(' '), 'warn');
      else showMsg('');
      window.dispatchEvent(new CustomEvent('signacheck:inputs-changed'));
      updateAnalyzeState();
    }

    input.addEventListener('change', () => input.files[0] && handle(input.files[0]));

    zone.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'remove') clear();
      if (action === 'replace') input.click();
    });

    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('is-dragover');
    }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
    }));
    zone.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (!files || !files.length) return;
      if (files.length > 1) showMsg('Please drop one image at a time.', 'error');
      else handle(files[0]);
    });

    return { clear };
  }

  // Stop the browser from opening a file dropped outside a drop zone.
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => {
    if (!e.target.closest('.dropzone')) e.preventDefault();
  }));

  function updateAnalyzeState() {
    const missing = [];
    if (!state.reference) missing.push('a reference signature');
    if (!state.questioned) missing.push('a questioned signature');
    const ready = missing.length === 0 && consent.checked;
    analyzeBtn.disabled = !ready || analyzeBtn.dataset.busy === 'true';
    if (missing.length) hint.textContent = `Add ${missing.join(' and ')} to continue.`;
    else if (!consent.checked) hint.textContent = 'Please confirm the consent statement to continue.';
    else hint.textContent = 'Ready to analyze.';
  }

  const slots = Array.from(document.querySelectorAll('.dropzone')).map(setupSlot);
  consent.addEventListener('change', updateAnalyzeState);
  updateAnalyzeState();

  window.SignaCheck = window.SignaCheck || {};
  window.SignaCheck.upload = {
    state,
    form,
    updateAnalyzeState,
    clearAll() {
      slots.forEach((s) => s.clear());
      consent.checked = false;
      updateAnalyzeState();
    },
  };
})();
