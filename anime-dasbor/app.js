const apps = [
  // fav:true => masuk tombol "Open Favorit"
  { name:"YouTube",   url:"https://www.youtube.com",   cat:"Video",   icon:"▶️",  desc:"Nonton video online.", fav:true },
  { name:"TikTok",    url:"https://www.tiktok.com",    cat:"Video",   icon:"🎵",  desc:"Short video & trend.", fav:false },
  { name:"Instagram", url:"https://www.instagram.com", cat:"Sosial",  icon:"📸",  desc:"Story, reels, DM.",    fav:true },
  { name:"Discord",   url:"https://discord.com/app",   cat:"Chat",    icon:"💬",  desc:"Server komunitas.",    fav:true },
  { name:"WhatsApp Web", url:"https://web.whatsapp.com", cat:"Chat",  icon:"🟢",  desc:"Chat WA dari browser.", fav:false },
  { name:"Telegram Web", url:"https://web.telegram.org", cat:"Chat",  icon:"✈️",  desc:"Telegram versi web.",    fav:false },

  { name:"Gmail",     url:"https://mail.google.com",   cat:"Produktif", icon:"📧", desc:"Email cepat.",        fav:false },
  { name:"Drive",     url:"https://drive.google.com",  cat:"Produktif", icon:"📁", desc:"Simpan file.",        fav:false },
  { name:"Docs",      url:"https://docs.google.com",   cat:"Produktif", icon:"📝", desc:"Dokumen online.",     fav:false },

  { name:"Spotify",   url:"https://open.spotify.com",  cat:"Musik",   icon:"🎧",  desc:"Dengerin musik.",      fav:false },
  { name:"Netflix",   url:"https://www.netflix.com",   cat:"Video",   icon:"🍿",  desc:"Film & series.",       fav:false },

  { name:"GitHub",    url:"https://github.com",        cat:"Dev",     icon:"🐙",  desc:"Repo & project.",      fav:false },
  { name:"Stack Overflow", url:"https://stackoverflow.com", cat:"Dev", icon:"🧠", desc:"Cari solusi error.",   fav:false },

  { name:"ChatGPT",   url:"https://chat.openai.com",   cat:"AI",      icon:"🤖",  desc:"Asisten AI.",          fav:true },
];

const grid = document.getElementById("grid");
const chips = document.getElementById("chips");
const q = document.getElementById("q");

const countApps = document.getElementById("countApps");
const countCats = document.getElementById("countCats");

const statusEl = document.getElementById("status");
const activeCatEl = document.getElementById("activeCat");

const shuffleBtn = document.getElementById("shuffle");
const resetBtn = document.getElementById("reset");
const themeBtn = document.getElementById("theme");
const openFavBtn = document.getElementById("openFav");

const clockEl = document.getElementById("clock");
const dateEl = document.getElementById("date");

let activeCat = "Semua";
let order = [...apps];

function uniqueCats(list){
  return ["Semua", ...Array.from(new Set(list.map(x => x.cat))).sort((a,b)=>a.localeCompare(b))];
}

function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function match(app, text){
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return (app.name + " " + app.cat + " " + app.desc).toLowerCase().includes(t);
}

function filteredList(){
  const text = q.value || "";
  return order
    .filter(a => activeCat === "Semua" ? true : a.cat === activeCat)
    .filter(a => match(a, text));
}

function renderChips(){
  const cats = uniqueCats(apps);
  chips.innerHTML = "";
  cats.forEach(c => {
    const el = document.createElement("div");
    el.className = "chip" + (c === activeCat ? " active" : "");
    el.textContent = c;
    el.onclick = () => {
      activeCat = c;
      activeCatEl.textContent = c;
      statusEl.textContent = "Filter: " + c;
      renderChips();
      render();
    };
    chips.appendChild(el);
  });
  countCats.textContent = (cats.length - 1).toString();
}

function render(){
  const list = filteredList();
  grid.innerHTML = "";

  list.forEach(app => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.onclick = () => window.open(app.url, "_blank", "noopener,noreferrer");

    tile.innerHTML = `
      <div class="row">
        <div class="icon">${app.icon}</div>
        <div class="row" style="gap:8px;">
          ${app.fav ? `<div class="fav">⭐ FAV</div>` : ``}
          <div class="badge">${app.cat}</div>
        </div>
      </div>
      <div class="name">${app.name}</div>
      <div class="desc">${app.desc}</div>
    `;
    grid.appendChild(tile);
  });

  countApps.textContent = apps.length.toString();
}

q.addEventListener("input", () => {
  statusEl.textContent = q.value.trim() ? ("Search: " + q.value.trim()) : "Ready";
  render();
});

shuffleBtn.addEventListener("click", () => {
  order = shuffle([...order]);
  statusEl.textContent = "Order: Acak";
  render();
});

resetBtn.addEventListener("click", () => {
  activeCat = "Semua";
  q.value = "";
  order = [...apps];
  statusEl.textContent = "Ready";
  activeCatEl.textContent = "Semua";
  renderChips();
  render();
});

themeBtn.addEventListener("click", () => {
  document.body.classList.toggle("light");
  themeBtn.textContent = document.body.classList.contains("light") ? "☀️" : "🌙";
});

openFavBtn.addEventListener("click", () => {
  const favs = apps.filter(a => a.fav);
  const maxTabs = 8;
  favs.slice(0, maxTabs).forEach(a => window.open(a.url, "_blank", "noopener,noreferrer"));
  statusEl.textContent = `Open favorit: ${Math.min(favs.length, maxTabs)} tab`;
});

/* Clock */
function pad(n){ return String(n).padStart(2,"0"); }
function tick(){
  const d = new Date();
  clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  dateEl.textContent = d.toLocaleDateString("id-ID", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
}
setInterval(tick, 1000);
tick();

/* init */
renderChips();
render();
