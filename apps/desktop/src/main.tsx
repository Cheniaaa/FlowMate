export {};

void import('./render').then(({ mountApp }) => mountApp()).catch(() => {
  const status = document.getElementById('startup-status')!;
  status.setAttribute('role', 'alert');
  status.textContent = new URLSearchParams(window.location.search).get('window') === 'ball'
    ? '加载失败' : '界面加载失败，请重新打开应用。';
});
