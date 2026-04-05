const KEY = (slug) => `cf_voted_${slug}`;

export function hasVoted(slug, recId) {
  try {
    const set = JSON.parse(localStorage.getItem(KEY(slug)) || '[]');
    return set.includes(recId);
  } catch { return false; }
}

export function markVoted(slug, recId) {
  try {
    const set = JSON.parse(localStorage.getItem(KEY(slug)) || '[]');
    if (!set.includes(recId)) {
      set.push(recId);
      localStorage.setItem(KEY(slug), JSON.stringify(set));
    }
  } catch {}
}

export function removeVote(slug, recId) {
  try {
    const set = JSON.parse(localStorage.getItem(KEY(slug)) || '[]');
    localStorage.setItem(KEY(slug), JSON.stringify(set.filter(id => id !== recId)));
  } catch {}
}
