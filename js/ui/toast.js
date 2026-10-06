/* Transient on-screen message. */

const toastEl = document.getElementById('toast'); let toastTO = 0;
export function toast(msg, ms = 2200) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastTO); toastTO = setTimeout(() => toastEl.classList.remove('on'), ms); }
