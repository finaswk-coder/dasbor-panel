const apps = [
  { name:"YouTube", url:"https://youtube.com" },
  { name:"TikTok", url:"https://tiktok.com" },
  { name:"Instagram", url:"https://instagram.com" },
  { name:"Discord", url:"https://discord.com/app" },
  { name:"WhatsApp Web", url:"https://web.whatsapp.com" },
  { name:"Gmail", url:"https://mail.google.com" },
  { name:"Spotify", url:"https://spotify.com" },
];

const grid = document.getElementById("grid");
const q = document.getElementById("q");

function render(){
  grid.innerHTML = "";
  apps
    .filter(app => app.name.toLowerCase().includes(q.value.toLowerCase()))
    .forEach(app => {
      const div = document.createElement("div");
      div.className = "tile";
      div.textContent = app.name;
      div.onclick = ()=> window.open(app.url,"_blank");
      grid.appendChild(div);
    });
}

q.addEventListener("input", render);
render();
