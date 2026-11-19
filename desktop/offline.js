// Shown by main.cjs when THUNK_REMOTE_URL is set and the server cannot be reached.
const params = new URLSearchParams(location.search);
const server = params.get("url");
document.getElementById("server").textContent = server || "";
document.getElementById("error").textContent = params.get("error") || "";
const retry = () => { if (server) location.href = server; };
document.getElementById("retry").addEventListener("click", retry);
setInterval(retry, 15000);
