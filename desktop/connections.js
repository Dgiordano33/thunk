const api = window.connections;
const message = document.querySelector('#message');
async function refresh() {
  const result = await api.invoke('status');
  for (const [key, value] of Object.entries(result)) document.getElementById(key).textContent = value;
}
async function act(action, value) {
  try { message.textContent = await api.invoke(action, value); await refresh(); }
  catch (error) { message.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
}
for (const button of document.querySelectorAll('[data-provider]')) button.onclick = async () => {
  document.querySelector('#progress').textContent = '';
  document.querySelector('#cancel').hidden = false;
  document.querySelectorAll('[data-provider]').forEach(b => b.disabled = true);
  await act('connect', button.dataset.provider);
  document.querySelector('#cancel').hidden = true;
  document.querySelectorAll('[data-provider]').forEach(b => b.disabled = false);
};
for (const button of document.querySelectorAll('[data-open]')) button.onclick = () => act('open-login', button.dataset.open);
document.querySelector('#key-form').onsubmit = async event => {
  event.preventDefault();
  const input = document.querySelector('#key'), button = event.submitter;
  const key = input.value; input.value = ''; button.disabled = true;
  await act('save-key', key); button.disabled = false;
};
document.querySelector('#remove').onclick = () => act('remove-key');
document.querySelector('#cancel').onclick = () => act('cancel');
document.querySelector('#refresh').onclick = () => refresh().catch(error => message.textContent = error.message);
api.onProgress(text => {
  const progress = document.querySelector('#progress');
  progress.textContent = text;
  progress.scrollIntoView({ block: 'nearest' });
});
refresh().catch(error => message.textContent = error.message);
