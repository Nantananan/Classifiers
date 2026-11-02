// =====================================================================
//  1) EMBED YOUR TEACHABLE MACHINE LINKS HERE (paste once, never type them again)
//     Example: "https://teachablemachine.withgoogle.com/models/AbCdEfGhI/"
//     Leave "" to type the link in the page's Settings instead.
// =====================================================================
const DEFAULT_SOUND_URL = "https://teachablemachine.withgoogle.com/models/pWNhJfmgw/";   // your AUDIO project link
const DEFAULT_IMAGE_URL = "https://teachablemachine.withgoogle.com/models/fqBXbw-LP/";   // your IMAGE project link

// =====================================================================
//  2) PICTURES: put one picture per class inside an "images" folder, named after the class
//     in lowercase (spaces become hyphens). Class "Dog" -> images/dog.jpg  (.jpg .jpeg .png .webp)
//     Class "Rooster Crow" -> images/rooster-crow.jpg
//     Want a different file name? List it below. If no picture is found, an emoji is shown.
// =====================================================================
const IMAGES = {
  // "Dog": "dog.jpg",
  // "Cat": "cat.jpg",
};

// Emoji fallback: matches if the class name contains any of these words
const EMOJI_HINTS = [
  [["dog","aso","bark","tahol"], "🐶"], [["cat","pusa","meow"], "🐱"],
  [["rooster","manok","chicken","tilaok"], "🐔"], [["pig","baboy"], "🐷"],
  [["cow","baka"], "🐮"], [["goat","kambing"], "🐐"], [["horse","kabayo"], "🐴"],
  [["duck","pato"], "🦆"], [["bird","ibon"], "🐦"], [["frog","palaka"], "🐸"],
  [["owl","kuwago"], "🦉"], [["lion","leon"], "🦁"], [["bee","bubuyog"], "🐝"],
  [["clap","palakpak"], "👏"], [["whistle","sipol"], "😗"], [["snap"], "🫰"],
  [["speech","voice","talk","salita"], "🗣️"], [["music","musika"], "🎵"],
  [["person","tao","face","mukha"], "🙂"], [["hand","kamay"], "🖐️"], [["thumb"], "👍"],
];
const emojiFor = name => {
  const n = name.toLowerCase();
  for (const [words, e] of EMOJI_HINTS) if (words.some(w => n.includes(w))) return e;
  return "🔊";
};
// classes that mean "nothing detected"
const isIdle = name => /background|noise|ingay|empty|nothing|walang/i.test(name);

// ---------------------------------------------------------------------
const $ = id => document.getElementById(id);
const el = {
  side:$("side"), status:$("mic-status"), emoji:$("emoji"), img:$("img"), label:$("label"), hint:$("hint"),
  btn:$("toggle"), flip:$("flip"), bars:$("bars"), cam:$("cam-wrap"), ring:$("ring"),
  conf:$("conf"), confVal:$("confVal"), settings:$("settings"),
  card:document.querySelector(".card"), tabs:[...document.querySelectorAll(".tab")],
};

const MODES = {
  sound: { key:"tmSoundUrl", def:DEFAULT_SOUND_URL, input:$("soundUrl"), box:$("soundBox"),
           start:"Start Listening", off:"🎤 Microphone is off", on:"🎤 Listening...",
           go:"Make a sound!", none:"No clear sound" },
  image: { key:"tmImageUrl", def:DEFAULT_IMAGE_URL, input:$("imageUrl"), box:$("imageBox"),
           start:"Start Camera", off:"Camera is off", on:"Camera is on",
           go:"Point the camera at something", none:"Nothing detected" },
};

let mode = "sound", running = false, lastLabel = null, facing = "user";
const sound = { recognizer:null, labels:[], url:"" };
const image = { model:null, webcam:null, labels:[], url:"" };

// restore saved links / hide the box when a link is embedded above
for (const m of Object.values(MODES)) {
  m.input.value = m.def || localStorage.getItem(m.key) || "";
  if (m.def) m.box.style.display = "none";
}
el.conf.value = localStorage.getItem("tmConf") || 80;
el.confVal.textContent = el.conf.value;
el.conf.oninput = () => { el.confVal.textContent = el.conf.value; localStorage.setItem("tmConf", el.conf.value); };

function normalizeUrl(u) {
  u = u.trim().replace(/model\.json$|metadata\.json$/, "");
  if (u && !u.endsWith("/")) u += "/";
  return u;
}

function buildBars(labels) {
  el.bars.innerHTML = labels.map((l, i) => `
    <div class="row"><span>${mode === "sound" ? emojiFor(l) + " " : ""}${l}</span>
      <div class="track"><div class="fill" id="f${i}"></div></div>
      <span class="pct" id="p${i}">0%</span></div>`).join("");
  labels.forEach(findImage); // preload pictures so they appear instantly
}

function resetUI() {
  const m = MODES[mode];
  el.status.textContent = m.off; el.status.classList.remove("on");
  el.btn.textContent = m.start; el.btn.classList.remove("stop");
  el.emoji.style.display = ""; el.img.style.display = "none";
  el.emoji.textContent = "🔇"; el.label.textContent = "—"; el.hint.textContent = "Press Start...";
  el.card.classList.remove("detected", "has-pic");
  el.side.classList.remove("show");   // hide the classes card
}

function runningUI() {
  const m = MODES[mode];
  el.status.textContent = m.on; el.status.classList.add("on");
  el.btn.textContent = "Stop"; el.btn.classList.add("stop");
  el.emoji.style.display = ""; el.img.style.display = "none";
  el.emoji.textContent = "👂"; el.label.textContent = "Listening..."; el.hint.textContent = m.go;
  if (mode === "image") el.emoji.textContent = "👀", el.label.textContent = "Looking...";
  el.side.classList.add("show");      // slide the classes card in on the right
}

// ---------- Mode switching ----------
async function setMode(m) {
  if (running) await stop();
  mode = m;
  el.tabs.forEach(t => t.classList.toggle("active", t.dataset.mode === m));
  el.flip.hidden = m !== "image";
  el.card.classList.toggle("cam-mode", m === "image");   // camera mode: no emoji, no empty picture area
  el.cam.hidden = true;
  el.bars.innerHTML = "";
  resetUI();
}
el.tabs.forEach(t => t.addEventListener("click", () => { if (t.dataset.mode !== mode) setMode(t.dataset.mode); }));

// ---------- Start / Stop ----------
async function start() {
  const m = MODES[mode];
  const url = normalizeUrl(m.input.value);
  if (!url) {
    el.settings.open = true;
    el.hint.textContent = "Please enter the model link in Settings ⚙️";
    return;
  }
  el.btn.disabled = true; el.hint.textContent = "Loading model...";
  try {
    if (mode === "sound") await startSound(url); else await startImage(url);
    localStorage.setItem(m.key, url);
    running = true; lastLabel = null;
    runningUI();
    if (mode === "image") loop();
  } catch (e) {
    console.error(e);
    const denied = e && e.name === "NotAllowedError";
    el.hint.textContent = denied
      ? `Permission denied for the ${mode === "sound" ? "microphone" : "camera"}. Please allow it in your browser settings.`
      : "Something went wrong. Check the link and permissions. (" + (e.message || e) + ")";
    el.settings.open = !denied;
    if (mode === "image") { el.cam.innerHTML = ""; el.cam.hidden = true; }
  } finally { el.btn.disabled = false; }
}

async function stop() {
  if (mode === "sound") {
    if (sound.recognizer && running) sound.recognizer.stopListening();
  } else {
    if (image.webcam) { image.webcam.stop(); image.webcam = null; }
    el.cam.innerHTML = ""; el.cam.hidden = true;
  }
  running = false; lastLabel = null; showToken++;
  resetUI();
  document.querySelectorAll(".fill").forEach(f => f.style.width = "0");
  document.querySelectorAll(".pct").forEach(p => p.textContent = "0%");
}

el.btn.addEventListener("click", () => (running ? stop() : start()));
el.flip.addEventListener("click", async () => {
  facing = facing === "user" ? "environment" : "user";
  if (running && mode === "image") { await stop(); await start(); }
});

// ---------- Sound (Teachable Machine audio) ----------
async function startSound(url) {
  if (!sound.recognizer || sound.url !== url) {
    const r = speechCommands.create("BROWSER_FFT", undefined, url + "model.json", url + "metadata.json");
    await r.ensureModelLoaded();
    sound.recognizer = r; sound.labels = r.wordLabels(); sound.url = url;
  }
  buildBars(sound.labels);
  await sound.recognizer.listen(result => {
    if (running) onScores(sound.labels, Array.from(result.scores));
  }, { includeSpectrogram:false, probabilityThreshold:0, invokeCallbackOnNoiseAndUnknown:true, overlapFactor:0.5 });
}

// ---------- Camera (Teachable Machine image) ----------
async function startImage(url) {
  if (!image.model || image.url !== url) {
    image.model = await tmImage.load(url + "model.json", url + "metadata.json");
    image.labels = image.model.getClassLabels(); image.url = url;
  }
  buildBars(image.labels);
  const webcam = new tmImage.Webcam(260, 260, facing === "user"); // mirror only the front camera
  await webcam.setup({ facingMode: facing });
  await webcam.play();
  image.webcam = webcam;
  el.cam.innerHTML = ""; el.cam.appendChild(webcam.canvas); el.cam.hidden = false;
}

async function loop() {
  if (!running || mode !== "image" || !image.webcam) return;
  image.webcam.update();
  try {
    const preds = await image.model.predict(image.webcam.canvas);
    if (running && mode === "image") onScores(preds.map(p => p.className), preds.map(p => p.probability));
  } catch (e) { console.error(e); }
  requestAnimationFrame(loop);
}

// ---------- Show results (same for sound and camera) ----------
function onScores(labels, scores) {
  scores.forEach((s, i) => {
    const f = $("f" + i), p = $("p" + i);
    if (f) { f.style.width = Math.round(s * 100) + "%"; p.textContent = Math.round(s * 100) + "%"; }
  });

  let top = 0; scores.forEach((s, i) => { if (s > scores[top]) top = i; });
  const name = labels[top], pct = Math.round(scores[top] * 100);

  if (isIdle(name) || pct < Number(el.conf.value)) {
    el.img.style.display = "none"; el.emoji.style.display = "";
    el.emoji.textContent = mode === "image" ? "👀" : "👂";
    el.label.textContent = mode === "image" ? "Looking..." : "Listening...";
    el.hint.textContent = isIdle(name) ? MODES[mode].none : "Not sure...";
    el.card.classList.remove("detected", "has-pic"); showToken++;
    lastLabel = null; return;
  }
  el.label.textContent = name;
  el.hint.textContent = `Detected: ${name} (${pct}%)`;
  if (lastLabel !== name) show(name);
  lastLabel = name;
}

// Keep the Classes card exactly as tall as the main card (desktop layout only)
function syncSideHeight() {
  el.side.style.height = window.matchMedia("(min-width:861px)").matches ? el.card.offsetHeight + "px" : "";
}
if ("ResizeObserver" in window) new ResizeObserver(syncSideHeight).observe(el.card);
window.addEventListener("resize", syncSideHeight);
syncSideHeight();

// Look for the class picture: IMAGES override first, then images/<class>.jpg/.jpeg/.png/.webp
const imgCache = {};
function findImage(name) {
  if (!imgCache[name]) {
    const slug = name.toLowerCase().trim().replace(/\s+/g, "-");
    const candidates = IMAGES[name] ? [IMAGES[name]]
      : ["jpg", "jpeg", "png", "webp"].map(ext => `images/${slug}.${ext}`);
    imgCache[name] = (async () => {
      for (const src of candidates) {
        const ok = await new Promise(res => {
          const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = src;
        });
        if (ok) return src;
      }
      return null;
    })();
  }
  return imgCache[name];
}

// Show the picture (or emoji) with a pop-in effect, a ripple ring and a green glow
let showToken = 0;
async function show(name) {
  const token = ++showToken;
  const src = await findImage(name);
  if (token !== showToken) return;            // result changed while the image was loading
  let target;
  if (src) { el.img.src = src; el.img.style.display = "block"; el.emoji.style.display = "none"; target = el.img; }
  else { el.img.style.display = "none"; el.emoji.style.display = ""; el.emoji.textContent = emojiFor(name); target = el.emoji; }

  target.classList.remove("reveal", "hit"); void target.offsetWidth;
  target.classList.add(src ? "reveal" : "hit");
  el.ring.classList.remove("go"); void el.ring.offsetWidth; el.ring.classList.add("go");
  el.card.classList.add("detected");
  el.card.classList.toggle("has-pic", !!src);
}