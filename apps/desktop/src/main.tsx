export {};

const isPet = new URLSearchParams(window.location.search).get('window') === 'ball';
if (isPet) document.querySelector<HTMLElement>('.startup-shell')!.dataset.window = 'ball';

void import('./render').then(({ mountApp }) => mountApp()).catch(() => {
  const status = document.getElementById('startup-status')!;
  status.setAttribute('role', 'alert');
  status.textContent = isPet ? '加载失败' : '界面加载失败，请重新打开应用。';
});
