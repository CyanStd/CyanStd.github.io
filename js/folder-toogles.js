/* ── src/js/folder-toggles.js ─────────────────────── */

document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    
    // The corresponding arrow cell gets flipped on/off after clicking this toggle button
    const arrowCell = this.closest('.folded-cell'); 
    const parentFoldContainer = arrowCell.parentElement; // .fold-item
    
    // Get current state via an attribute that stays persistent across page reloads
    const isOpenStr = parentFoldContainer.dataset.isOpen || JSON.stringify(true);
    const isFolderOpen = isOpenStr !== 'null' && isOpenStr !== '"false"';
    
    // Flip boolean state and persist it back to localStorage so browser remembers user's choice
    const newState = !isFolderOpen;
    
    // Update all sibling buttons/arrows on same `.fold-item` group together at once
    const siblings = document.querySelector(`[data-parent="${parentFoldContainer.id}"]`);
    let isOpenArr = [];
    parentFoldContainer.children.forEach(child => {
      if (child.classList.contains('toggle-btn')) {
        isOpenArr.push(child.textContent?.includes('▲') ? false : true);
      } else if (child.classList.contains('arrow-cell')) {
        child.innerHTML = newState 
          ? '<svg height="16" width="16" viewBox="0 0 24 24" fill="#007bff"><g transform="rotate(90 12 12)"><path fill="currentColor" d="M6 9l6 6 6-6"/></g></svg>' 
          : '<svg height="16" width="16" viewBox="0 0 24 24" fill="#555"><g transform="rotate(-90 12 12)"><path stroke="currentColor" fill="none" stroke-linecap="round" stroke-width="2" d="m8 4 6 6-6 6"/></g></svg>';
      }
    });
  });
});