// Sends both images to the verification API and renders the response.
// It never invents a result: if the API is missing or fails, it says so.
(function () {
  const { state, form, updateAnalyzeState, clearAll } = window.SignaCheck.upload;

  const apiBase = (document.querySelector('meta[name="signacheck-api-base"]')?.content || '').replace(/\/$/, '');
  const VERIFY_URL = `${apiBase}/api/v1/verify`;
  const TIMEOUT_MS = 60000;

  const analyzeBtn = document.getElementById('analyze-btn');
  const formError = document.getElementById('form-error');
  const results = document.getElementById('results');
  const statusBox = document.getElementById('result-status');
  const titleEl = document.getElementById('result-title');
  const messageEl = document.getElementById('result-message');
  const refImg = document.getElementById('result-ref-img');
  const qImg = document.getElementById('result-q-img');
  const scoreWrap = document.getElementById('result-score');
  const scoreValue = document.getElementById('result-score-value');
  const scoreFill = document.getElementById('result-score-fill');
  const warnWrap = document.getElementById('result-warnings-wrap');
  const warnList = document.getElementById('result-warnings');
  const limitList = document.getElementById('result-limitations');

  const STATUS_TEXT = {
    consistent: 'Consistent with reference',
    potential_mismatch: 'Potential mismatch: further review recommended',
    inconclusive: 'Inconclusive: insufficient evidence',
    unavailable: 'Verification service unavailable',
  };

  const BASE_LIMITATIONS = [
    "This is an automated, preliminary assessment. It doesn't prove who wrote the signature.",
    'Genuine signatures vary naturally, and skilled forgeries may look very similar to the reference.',
    'For legal, financial, or disputed matters, consult a qualified forensic document examiner.',
  ];

  function setBusy(busy) {
    analyzeBtn.dataset.busy = String(busy);
    analyzeBtn.innerHTML = busy ? '<span class="spinner" aria-hidden="true"></span> Analyzing…' : 'Analyze Signatures';
    updateAnalyzeState();
  }

  function showFormError(text) {
    formError.textContent = text;
    formError.hidden = !text;
  }

  function fillList(ul, items) {
    ul.innerHTML = '';
    items.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
  }

  function render(data) {
    const status = STATUS_TEXT[data.status] ? data.status : 'inconclusive';
    statusBox.className = `result-status result-status--${status}`;
    titleEl.textContent = STATUS_TEXT[status];
    messageEl.textContent = data.message || '';

    refImg.src = state.reference?.url || '';
    qImg.src = state.questioned?.url || '';

    // Show a score only when the API actually returned a numeric one.
    const score = data.similarity_score;
    if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1) {
      scoreWrap.hidden = false;
      scoreValue.textContent = `${Math.round(score * 100)} / 100`;
      scoreFill.style.width = '0';
      requestAnimationFrame(() => { scoreFill.style.width = `${score * 100}%`; });
    } else {
      scoreWrap.hidden = true;
    }

    const warnings = [
      ...(state.reference?.warnings || []).map((w) => `Reference: ${w}`),
      ...(state.questioned?.warnings || []).map((w) => `Questioned: ${w}`),
      ...(Array.isArray(data.quality_warnings) ? data.quality_warnings : []),
    ];
    warnWrap.hidden = warnings.length === 0;
    fillList(warnList, warnings);

    const limitations = Array.isArray(data.limitations) ? data.limitations : [];
    fillList(limitList, [...limitations, ...BASE_LIMITATIONS]);

    results.hidden = false;
    results.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderUnavailable(detail) {
    render({
      status: 'unavailable',
      similarity_score: null,
      message: "The verification server isn't connected yet, so no analysis was performed. Your images were not compared.",
      limitations: ['No authenticity determination has been made.', detail].filter(Boolean),
    });
  }

  async function analyze() {
    showFormError('');
    if (!state.reference || !state.questioned) return;

    const body = new FormData();
    body.append('referenceSignature', state.reference.file);
    body.append('questionedSignature', state.questioned.file);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    setBusy(true);

    try {
      const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: controller.signal });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON response */ }

      if (res.ok && data && data.status) {
        render(data);
      } else if ([404, 405, 501, 502, 503].includes(res.status) || !data) {
        renderUnavailable(`Server responded with HTTP ${res.status}.`);
      } else {
        showFormError(data.error?.message || data.message || `The request failed (HTTP ${res.status}). Please try again.`);
      }
    } catch (err) {
      if (err.name === 'AbortError') showFormError('The analysis took too long and was cancelled. Please try again.');
      else renderUnavailable("The verification server couldn't be reached.");
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  function resetResults() {
    results.hidden = true;
    refImg.removeAttribute('src');
    qImg.removeAttribute('src');
    showFormError('');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!analyzeBtn.disabled) analyze();
  });

  function startOver() {
    resetResults();
    clearAll();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.getElementById('clear-btn').addEventListener('click', startOver);
  document.getElementById('again-btn').addEventListener('click', startOver);
  document.getElementById('clear-results-btn').addEventListener('click', startOver);

  // Changing an image makes the old result stale.
  window.addEventListener('signacheck:inputs-changed', resetResults);
})();
