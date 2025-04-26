/**
 * Tab grouping priority order:
 * 
 * 1. Custom URL matching:
 *    - If a tab's URL contains a user-defined keyword (customRules), assign it to the specified group name.
 * 
 * 2. Exact bookmark URL match:
 *    - If a tab's full URL exactly matches a saved bookmark URL, assign it to the name of that bookmark's folder.
 * 
 * 3. Bookmark domain match:
 *    - If the domain of the tab matches a bookmark domain (not exact URL), assign it to that folder's name.
 * 
 * 4. Domain-based grouping:
 *    - If more than one open tab shares the same domain, group them together using the domain name in uppercase.
 * 
 * 5. "OTHER" fallback:
 *    - If none of the above rules match, assign the tab to a default "OTHER" group.
 */

let groupingEnabled = false;

// On startup, restore toggle state
chrome.storage.local.get(['groupingEnabled'], data => {
  groupingEnabled = data.groupingEnabled === true;
  if (groupingEnabled) groupAndLog();
});

// Listen for popup messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'toggleGrouping') {
    groupingEnabled = msg.enabled;
    chrome.storage.local.set({ groupingEnabled });
    if (groupingEnabled) groupAndLog();
    else ungroupAll();
    sendResponse({ success: true });
  }
});

// Reapply when tabs finish loading
chrome.tabs.onUpdated.addListener((_, info) => {
  if (info.status === 'complete' && groupingEnabled) {
    groupAndLog();
  }
});

async function groupAndLog() {
  // 1) Fetch bookmarks, open tabs, and stored settings
  const [bookmarkTree, tabs, store] = await Promise.all([
    chrome.bookmarks.getTree(),
    chrome.tabs.query({ currentWindow: true }),
    chrome.storage.local.get(['groupOrder', 'customRules'])
  ]);
  const groupOrder  = store.groupOrder  || [];
  const customRules = store.customRules || [];

  // 2) Build maps from bookmarks
  const urlMap = {}, domainMap = {};
  (function recurse(nodes, folder) {
    for (const n of nodes) {
      if (n.children) recurse(n.children, n.title?.toUpperCase() || null);
      else if (n.url && folder) {
        urlMap[n.url] = folder;
        const d = extractDomain(n.url);
        if (d && !domainMap[d]) domainMap[d] = folder;
      }
    }
  })(bookmarkTree[0].children, null);

  // 3) Count tabs per domain
  const domainCount = {};
  for (const t of tabs) {
    const d = extractDomain(t.url);
    if (d) domainCount[d] = (domainCount[d]||0) + 1;
  }

  // 4) Bucket each tab into a group
  const groups = {};
  for (const t of tabs) {
    let assigned = false;
    // apply customRules first
    for (const r of customRules) {
      if (t.url.includes(r.keyword)) {
        const title = r.groupName.toUpperCase();
        (groups[title] = groups[title]||[]).push(t.id);
        assigned = true;
        break;
      }
    }
    if (assigned) continue;

    const d = extractDomain(t.url);
    const title =
      urlMap[t.url] ||
      domainMap[d] ||
      (domainCount[d] > 1 ? d.toUpperCase() : 'OTHER');
    (groups[title] = groups[title]||[]).push(t.id);
  }

  if (!groupingEnabled) return ungroupAll();

  // 5) Manage tab-groups and colors
  const existing = await chrome.tabGroups.query({});
  const existingMap = new Map(existing.map(g => [g.title.toUpperCase(), g]));
  const usedColors = new Set(existing.map(g => g.color));

  for (const [rawTitle, tabIds] of Object.entries(groups)) {
    if (!tabIds.length) continue;
    const title = rawTitle.toUpperCase();
    const prev  = existingMap.get(title);

    if (prev) {
      // add new tabs if needed
      const inGrp = (await chrome.tabs.query({ groupId: prev.id })).map(t=>t.id);
      const toAdd = tabIds.filter(id=>!inGrp.includes(id));
      if (toAdd.length) await chrome.tabs.group({ groupId: prev.id, tabIds: toAdd });
    } else {
      // pick a unique color
      let color = hashColor(title);
      if (usedColors.has(color)) {
        for (const c of VALID_COLORS) {
          if (!usedColors.has(c)) { color = c; break; }
        }
      }
      usedColors.add(color);

      const gid = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(gid, { title, color });
    }
  }

  // 6) Finally reorder to match user preference
  await reorderGroups(groupOrder);
}

async function reorderGroups(order) {
  const all = await chrome.tabGroups.query({});
  const map = new Map(all.map(g => [g.title.toUpperCase(), g.id]));
  const seq = [];

  // ordered ones first
  for (const name of order) {
    if (map.has(name)) seq.push(map.get(name));
  }
  // then the rest (except OTHER)
  for (const g of all) {
    const t = g.title.toUpperCase();
    if (t !== 'OTHER' && !seq.includes(g.id)) seq.push(g.id);
  }
  // finally OTHER
  if (map.has('OTHER')) seq.push(map.get('OTHER'));

  // move groups in sequence
  let idx = 0;
  for (const gid of seq) {
    const ids = (await chrome.tabs.query({ groupId: gid })).map(t=>t.id);
    await chrome.tabs.move(ids, { index: idx });
    idx += ids.length;
  }
}

async function ungroupAll() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const t of tabs) {
    if (t.groupId !== -1) await chrome.tabs.ungroup(t.id);
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const VALID_COLORS = [
  "blue","cyan","green","grey","orange",
  "pink","purple","red","yellow"
];
function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
  }
  return VALID_COLORS[Math.abs(h) % VALID_COLORS.length];
}
