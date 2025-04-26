// Element references
const toggleSwitch   = document.getElementById('groupingToggle');
const orderInput     = document.getElementById('groupOrder');
const rulesContainer = document.getElementById('rulesContainer');
const addRuleBtn     = document.getElementById('addRuleBtn');
const saveAllBtn     = document.getElementById('saveAll');
const statusText     = document.getElementById('status');

// Load saved settings when popup opens
chrome.storage.local.get(['groupingEnabled', 'groupOrder', 'customRules'], data => {
  toggleSwitch.checked = data.groupingEnabled !== false;

  if (Array.isArray(data.groupOrder)) {
    orderInput.value = data.groupOrder.join(', ');
  }

  const rules = Array.isArray(data.customRules) ? data.customRules : [];
  if (rules.length) {
    rules.forEach(r => addRuleRow(r.keyword, r.groupName));
  } else {
    addRuleRow();
  }
});

// Create one rule row (with optional pre-filled values)
function addRuleRow(keyword = '', groupName = '') {
  const row = document.createElement('div');
  row.className = 'rule-row';

  const keyIn = document.createElement('input');
  keyIn.type = 'text';
  keyIn.placeholder = 'URL keyword';
  keyIn.value = keyword;

  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.placeholder = 'Group name';
  nameIn.value = groupName;

  const remBtn = document.createElement('button');
  remBtn.textContent = '✖';
  remBtn.addEventListener('click', () => row.remove());

  row.append(keyIn, nameIn, remBtn);
  rulesContainer.appendChild(row);
}

// Add new empty rule on "+" click
addRuleBtn.addEventListener('click', () => addRuleRow());

// Save all settings at once
saveAllBtn.addEventListener('click', () => {
  const groupingEnabled = toggleSwitch.checked;

  const groupOrder = orderInput.value
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s);

  const customRules = Array.from(rulesContainer.children)
    .map(row => {
      const [kInput, nInput] = row.querySelectorAll('input');
      return {
        keyword: kInput.value.trim(),
        groupName: nInput.value.trim()
      };
    })
    .filter(r => r.keyword && r.groupName);

  // Persist everything
  chrome.storage.local.set({ groupingEnabled, groupOrder, customRules }, () => {
    statusText.textContent = 'Settings saved!';
    setTimeout(() => statusText.textContent = '', 2000);

    // Re-apply grouping immediately
    chrome.runtime.sendMessage({ type: 'toggleGrouping', enabled: groupingEnabled });
  });
});
