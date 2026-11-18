const rows = [...document.querySelectorAll('.case')];
const filter = document.getElementById('filter');
let page = 0;
function render() {
  const selected = rows.filter(row => filter.value === 'all' || row.dataset.group === filter.value);
  const pages = Math.max(1, Math.ceil(selected.length / 6));
  page = Math.min(page, pages - 1);
  rows.forEach(row => { row.hidden = true; });
  selected.slice(page * 6, page * 6 + 6).forEach(row => { row.hidden = false; });
  document.getElementById('page').textContent = `${selected.length}题 · ${page + 1}/${pages}页`;
  document.getElementById('prev').disabled = page === 0;
  document.getElementById('next').disabled = page === pages - 1;
}
filter.onchange = () => { page = 0; render(); };
document.getElementById('prev').onclick = () => { page--; render(); };
document.getElementById('next').onclick = () => { page++; render(); };
render();
