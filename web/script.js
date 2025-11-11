async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const text = await res.text();
  try { return { ok: res.ok, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, data: text }; }
}

function setResult(id, value) {
  const el = document.getElementById(id);
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

let glpiEnabled = false;
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    glpiEnabled = !!cfg.glpi_enabled;
  } catch {
    glpiEnabled = false;
  }
  const banner = document.getElementById('glpi-banner');
  if (!glpiEnabled) banner.classList.remove('hidden');
  else banner.classList.add('hidden');
}

function showModal(message, { continueText = 'Continue', cancelText = 'Cancel' } = {}) {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  const btnCancel = document.getElementById('modal-cancel');
  const btnContinue = document.getElementById('modal-continue');
  body.textContent = message;
  btnContinue.textContent = continueText;
  btnCancel.textContent = cancelText;
  modal.classList.remove('hidden');
  return new Promise(resolve => {
    const onCancel = () => { cleanup(); resolve(false); };
    const onContinue = () => { cleanup(); resolve(true); };
    function cleanup() {
      btnCancel.removeEventListener('click', onCancel);
      btnContinue.removeEventListener('click', onContinue);
      modal.classList.add('hidden');
    }
    btnCancel.addEventListener('click', onCancel);
    if (glpiEnabled) {
      btnContinue.disabled = false;
      btnContinue.addEventListener('click', onContinue);
    } else {
      btnContinue.disabled = true;
    }
  });
}

document.getElementById('form-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const confirmed = await showModal('Add Entry: proceed to send to GLPI?', { continueText: 'Send', cancelText: 'Cancel' });
  if (!confirmed) { setResult('add-result', 'Cancelled.'); return; }
  setResult('add-result', 'Submitting to GLPI...');
  try {
    const res = await fetch('/api/add_entry', { method: 'POST', body: fd });
    const data = await res.json();
    setResult('add-result', data);
  } catch (err) {
    setResult('add-result', String(err));
  }
});

document.getElementById('form-qr').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  setResult('qr-result', 'Decoding...');
  try {
    const res = await fetch('/api/scan_qr', { method: 'POST', body: fd });
    const data = await res.json();
    setResult('qr-result', data);
    const value = data && data.qr_value ? `QR code scanned: ${data.qr_value}` : 'No QR detected.';
    await showModal(value, { continueText: 'Close', cancelText: 'Close' });
  } catch (err) {
    setResult('qr-result', String(err));
  }
});

document.getElementById('form-location').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const payload = {
    item_id: form.item_id.value ? Number(form.item_id.value) : null,
    qr_value: form.qr_value.value || null,
    location_id: Number(form.location_id.value)
  };
  const summary = `Change Location:\nitem_id=${payload.item_id}\nqr_value=${payload.qr_value}\nlocation_id=${payload.location_id}\nProceed?`;
  const confirmed = await showModal(summary, { continueText: 'Update', cancelText: 'Cancel' });
  if (!confirmed) { setResult('loc-result', 'Cancelled.'); return; }
  setResult('loc-result', 'Updating in GLPI...');
  const res = await postJSON('/api/change_location', payload);
  setResult('loc-result', res.data);
});

document.getElementById('form-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const payload = {
    item_id: form.item_id.value ? Number(form.item_id.value) : null,
    qr_value: form.qr_value.value || null,
    user_id: Number(form.user_id.value)
  };
  const summary = `Change User:\nitem_id=${payload.item_id}\nqr_value=${payload.qr_value}\nuser_id=${payload.user_id}\nProceed?`;
  const confirmed = await showModal(summary, { continueText: 'Update', cancelText: 'Cancel' });
  if (!confirmed) { setResult('user-result', 'Cancelled.'); return; }
  setResult('user-result', 'Updating in GLPI...');
  const res = await postJSON('/api/change_user', payload);
  setResult('user-result', res.data);
});

document.getElementById('form-check').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const payload = {
    item_id: form.item_id.value ? Number(form.item_id.value) : null,
    qr_value: form.qr_value.value || null
  };
  const summary = `Check Entry:\nitem_id=${payload.item_id}\nqr_value=${payload.qr_value}\nProceed?`;
  const confirmed = await showModal(summary, { continueText: 'Check', cancelText: 'Cancel' });
  if (!confirmed) { setResult('check-result', 'Cancelled.'); return; }
  setResult('check-result', 'Checking in GLPI...');
  const res = await postJSON('/api/check_entry', payload);
  setResult('check-result', res.data);
});

// Initialize config on load
loadConfig();

// Routing for QR param landing
(function initRouting() {
  const params = new URLSearchParams(location.search);
  const qrParam = params.get('qr');
  if (qrParam) {
    const info = document.getElementById('qr-actions-info');
    info.textContent = `QR value: ${qrParam}`;
    // Prefill forms
    const qInputs = document.querySelectorAll('input[name="qr_value"]');
    qInputs.forEach(inp => (inp.value = qrParam));
    document.getElementById('tab-qr-actions')?.classList.remove('hidden');
  }
})();

// Open/Close panels
(function initOpenClose() {
  const openQR = document.getElementById('open-qr-scan');
  const openOCR = document.getElementById('open-ocr-capture');
  const qrPanel = document.getElementById('tab-qr-scan');
  const ocrPanel = document.getElementById('tab-ocr-capture');
  const qrClose = document.getElementById('qr-close');
  const ocrClose = document.getElementById('ocr-close');
  openQR?.addEventListener('click', () => { qrPanel.classList.remove('hidden'); });
  openOCR?.addEventListener('click', () => { ocrPanel.classList.remove('hidden'); });
  qrClose?.addEventListener('click', () => { qrPanel.classList.add('hidden'); });
  ocrClose?.addEventListener('click', () => { ocrPanel.classList.add('hidden'); });
})();

// QR scan via camera using ZXing (iOS compatible)
(function qrCamera() {
  const video = document.getElementById('qr-video');
  const startBtn = document.getElementById('qr-start');
  const stopBtn = document.getElementById('qr-stop');
  const resultEl = document.getElementById('qr-live-result');
  let stream = null;
  let scanning = false;
  let codeReader = null;
  let selectedDeviceId = null;

  async function start() {
    try {
      // Pick back camera when possible
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter(d => d.kind === 'videoinput');
      const back = videos.find(d => /back|rear|environment/i.test(d.label)) || videos[0];
      selectedDeviceId = back ? back.deviceId : undefined;

      stream = await navigator.mediaDevices.getUserMedia({
        video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: 'environment' },
        audio: false
      });
      video.srcObject = stream;
      video.setAttribute('playsinline','');
      video.setAttribute('muted','');
      video.setAttribute('autoplay','');
      await video.play();
      scanning = true;

      const { BrowserMultiFormatReader, NotFoundException } = window.ZXing;
      codeReader = new BrowserMultiFormatReader();
      const loop = async () => {
        if (!scanning) return;
        try {
          const result = await codeReader.decodeOnceFromVideoDevice(selectedDeviceId || null, video);
          if (result && result.text) {
            const value = result.text;
            resultEl.textContent = 'QR detected: ' + value;
            const base = location.origin + location.pathname;
            location.href = `${base}?qr=${encodeURIComponent(value)}`;
            return;
          }
        } catch (err) {
          if (!(err instanceof NotFoundException)) {
            // ignore transient decode errors
          }
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch (e) {
      resultEl.textContent = 'Camera error: ' + e;
    }
  }
  function stop() {
    scanning = false;
    if (codeReader) {
      try { codeReader.reset(); } catch {}
      codeReader = null;
    }
    if (video) video.pause();
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }
  startBtn?.addEventListener('click', start);
  stopBtn?.addEventListener('click', stop);
})();

// OCR capture via camera and local queue
(function ocrCamera() {
  const video = document.getElementById('ocr-video');
  const canvas = document.getElementById('ocr-canvas');
  const preview = document.getElementById('ocr-preview');
  const startBtn = document.getElementById('ocr-start');
  const captureBtn = document.getElementById('ocr-capture');
  const retakeBtn = document.getElementById('ocr-retake');
  const addBtn = document.getElementById('ocr-add-to-list');
  const listEl = document.getElementById('ocr-list');
  const pushAllBtn = document.getElementById('ocr-push-all');
  const clearBtn = document.getElementById('ocr-clear-list');

  let stream = null;
  let lastCapture = null; // { blob, url }
  let queue = []; // [{ id, url, blob }]

  function renderQueue() {
    listEl.innerHTML = '';
    if (!queue.length) {
      const p = document.createElement('p');
      p.textContent = 'No items in list.';
      listEl.appendChild(p);
      return;
    }
    queue.forEach(item => {
      const card = document.createElement('div');
      card.className = 'item';
      const img = document.createElement('img');
      img.src = item.url;
      card.appendChild(img);
      const actions = document.createElement('div');
      actions.className = 'actions';
      const pushBtn = document.createElement('button');
      pushBtn.textContent = 'Push to GLPI';
      pushBtn.addEventListener('click', () => pushOne(item));
      const removeBtn = document.createElement('button');
      removeBtn.className = 'secondary';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        queue = queue.filter(x => x.id !== item.id);
        URL.revokeObjectURL(item.url);
        renderQueue();
      });
      actions.appendChild(pushBtn);
      actions.appendChild(removeBtn);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  async function start() {
    try {
      // Prefer back camera
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter(d => d.kind === 'videoinput');
      const back = videos.find(d => /back|rear|environment/i.test(d.label)) || videos[0];
      const deviceId = back ? back.deviceId : undefined;
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
        audio: false
      });
      video.srcObject = stream;
      video.setAttribute('playsinline','');
      video.setAttribute('muted','');
      video.setAttribute('autoplay','');
      await video.play();
      preview.classList.add('hidden');
      video.classList.remove('hidden');
    } catch (e) {
      alert('Camera error: ' + e);
    }
  }
  function capture() {
    if (!video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      lastCapture = { blob, url };
      preview.src = url;
      preview.classList.remove('hidden');
      video.classList.add('hidden');
    }, 'image/jpeg', 0.92);
  }
  function retake() {
    if (lastCapture?.url) URL.revokeObjectURL(lastCapture.url);
    lastCapture = null;
    preview.classList.add('hidden');
    video.classList.remove('hidden');
  }
  function addToList() {
    if (!lastCapture) return;
    const id = Date.now() + Math.random().toString(16).slice(2);
    queue.push({ id, blob: lastCapture.blob, url: lastCapture.url });
    // reset for next
    lastCapture = null;
    preview.classList.add('hidden');
    video.classList.remove('hidden');
    renderQueue();
  }

  async function pushBlobToGLPI(blob) {
    const fd = new FormData();
    fd.append('spec_image', blob, 'capture.jpg');
    fd.append('item_type', 'auto');
    const confirmed = await showModal('Push this device to GLPI?', { continueText: 'Send', cancelText: 'Cancel' });
    if (!confirmed) return { cancelled: true };
    const res = await fetch('/api/add_entry', { method: 'POST', body: fd });
    const data = await res.json();
    return data;
  }

  async function pushOne(item) {
    if (!glpiEnabled) { alert('GLPI not configured'); return; }
    const data = await pushBlobToGLPI(item.blob);
    // Optionally remove on success
    // queue = queue.filter(x => x.id !== item.id);
    // URL.revokeObjectURL(item.url);
    // renderQueue();
    console.log('Push result:', data);
  }

  async function pushAll() {
    if (!glpiEnabled) { alert('GLPI not configured'); return; }
    for (const item of queue) {
      // eslint-disable-next-line no-await-in-loop
      await pushOne(item);
    }
  }
  function clearList() {
    queue.forEach(i => URL.revokeObjectURL(i.url));
    queue = [];
    renderQueue();
  }

  startBtn?.addEventListener('click', start);
  captureBtn?.addEventListener('click', capture);
  retakeBtn?.addEventListener('click', retake);
  addBtn?.addEventListener('click', addToList);
  pushAllBtn?.addEventListener('click', pushAll);
  clearBtn?.addEventListener('click', clearList);
  renderQueue();
})();

// QR Action landing buttons
(function qrActions() {
  const params = new URLSearchParams(location.search);
  const qrValue = params.get('qr');
  const viewBtn = document.getElementById('qr-act-view');
  const locBtn = document.getElementById('qr-act-change-location');
  const userBtn = document.getElementById('qr-act-change-user');

  viewBtn?.addEventListener('click', async () => {
    const payload = { item_id: null, qr_value: qrValue };
    const ok = await showModal(`View info for QR=${qrValue}?`, { continueText: 'View', cancelText: 'Cancel' });
    if (!ok) return;
    const res = await postJSON('/api/check_entry', payload);
    alert(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2));
  });
  locBtn?.addEventListener('click', async () => {
    const loc = prompt('Enter new Location ID:');
    if (!loc) return;
    const payload = { item_id: null, qr_value: qrValue, location_id: Number(loc) };
    const ok = await showModal(`Change location to ${loc}?`, { continueText: 'Update', cancelText: 'Cancel' });
    if (!ok) return;
    const res = await postJSON('/api/change_location', payload);
    alert(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2));
  });
  userBtn?.addEventListener('click', async () => {
    const user = prompt('Enter new User ID:');
    if (!user) return;
    const payload = { item_id: null, qr_value: qrValue, user_id: Number(user) };
    const ok = await showModal(`Change user to ${user}?`, { continueText: 'Update', cancelText: 'Cancel' });
    if (!ok) return;
    const res = await postJSON('/api/change_user', payload);
    alert(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2));
  });
})(); 

