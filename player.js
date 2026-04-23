/* ═══════════════════════════════════════════════
   PLAYER SYSTEM — miku.battle.gg
   ═══════════════════════════════════════════════ */

    /* ─── Player Data ──────────────────────────────────────── */
    const WIN_BONUS  = 50;
    const LOSS_BONUS = 10;
    const DAILY_BONUS = 30;

    // Three pack tiers
    // svgArt is an inline SVG used as the pack image — no external files needed.
    // Drop a real image file in Supabase storage at images/packs/ to override (the img onerror will fall back to svgArt).
    function makePackSVG(label, color, accent) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220">
          <defs>
            <linearGradient id="pg_${label}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="${color}cc"/>
              <stop offset="100%" stop-color="${accent}88"/>
            </linearGradient>
            <filter id="glow_${label}"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <rect x="4" y="4" width="152" height="212" rx="16" fill="url(#pg_${label})" stroke="${color}" stroke-width="2" opacity="0.95"/>
          <rect x="12" y="12" width="136" height="196" rx="12" fill="none" stroke="${color}44" stroke-width="1"/>
          <text x="80" y="108" text-anchor="middle" font-size="52" filter="url(#glow_${label})">📦</text>
          <text x="80" y="148" text-anchor="middle" font-size="13" font-weight="900" font-family="sans-serif" fill="${color}" letter-spacing="2">${label.toUpperCase()}</text>
          <text x="80" y="168" text-anchor="middle" font-size="9" font-family="sans-serif" fill="${color}88" letter-spacing="1">5 CARDS</text>
          <circle cx="80" cy="40" r="18" fill="${color}22" stroke="${color}44" stroke-width="1"/>
          <text x="80" y="46" text-anchor="middle" font-size="16">⚔️</text>
        </svg>`;
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    const PACK_TYPES = [
        {
            id: 'common',
            name: 'Common Pack',
            cost: 50,
            imagePath: window.supabaseStorageUrl('common.png'),
            svgArt: makePackSVG('common', '#94a3b8', '#64748b'),
            color: '#94a3b8',
            glow: 'rgba(100,116,139,0.4)',
            weights: { COMMON:60, UNCOMMON:30, RARE:6, EPIC:3, LEGENDARY:1 }
        },
        {
            id: 'rare',
            name: 'Rare Pack',
            cost: 100,
            imagePath: window.supabaseStorageUrl('rare.png'),
            svgArt: makePackSVG('rare', '#60a5fa', '#3b82f6'),
            color: '#3b82f6',
            glow: 'rgba(59,130,246,0.4)',
            weights: { COMMON:30, UNCOMMON:30, RARE:30, EPIC:7, LEGENDARY:3 }
        },
        {
            id: 'epic',
            name: 'Epic Pack',
            cost: 200,
            imagePath: window.supabaseStorageUrl('epic.png'),
            svgArt: makePackSVG('epic', '#c084fc', '#a855f7'),
            color: '#a855f7',
            glow: 'rgba(168,85,247,0.5)',
            weights: { COMMON:10, UNCOMMON:15, RARE:35, EPIC:25, LEGENDARY:15 }
        }
    ];

    const STARTER_PACK_SIZE = 10; // free cards on first launch

    let playerData = null;
    let collectionFilter = 'ALL';
    let collectionOwned  = 'owned';
    let currentDeckIndex = 0;
    let _nexusReadyFired = false; // guard against double-init

    function createNewPlayer() {
        return {
            username: 'Commander',
            collection: [],       // [{name, count}]
            decks: [{ name: 'Starter Deck', cards: [] }],
            activeDeckIndex: 0,
            points: 50,           // small starting allowance
            wins: 0, losses: 0,
            packsOpened: 0,
            packHistory: [],      // [{cards:[{name,rarity,isNew}], date}]
            lastLoginDate: null,
            claimedDailyToday: false
        };
    }

    function savePlayerData() {
        localStorage.setItem('nexus_player', JSON.stringify(playerData));
        refreshUI();
    }

    function loadPlayerData() {
        const raw = localStorage.getItem('nexus_player');
        if (raw) {
            try { playerData = JSON.parse(raw); }
            catch(e) { playerData = createNewPlayer(); }
        } else {
            playerData = createNewPlayer();
            // Give starter cards once ALL_CHARS is loaded
            setTimeout(giveStarterCards, 1200);
        }
    }

    /* ─── Collection helpers ───────────────────────────────── */
    function getOwnedCount(cardName) {
        const entry = playerData.collection.find(c => c.name === cardName);
        return entry ? entry.count : 0;
    }

    function addCardToCollection(cardName) {
        const entry = playerData.collection.find(c => c.name === cardName);
        const isNew = !entry;
        if (entry) entry.count++;
        else playerData.collection.push({ name: cardName, count: 1 });
        return isNew;
    }

    function totalOwnedCards() {
        return playerData.collection.reduce((s, c) => s + c.count, 0);
    }

    function giveStarterCards() {
        if (!ALL_CHARS || ALL_CHARS.length === 0) { setTimeout(giveStarterCards, 500); return; }

        const commonPack = PACK_TYPES.find(p => p.id === 'common');
        if (!commonPack) return;

        const pool = ALL_CHARS.filter(c => !c.isKeyCard);
        const allPulled = [];

        // Open 2 common packs (5 cards each = 10 cards)
        for (let pack = 0; pack < 2; pack++) {
            for (let i = 0; i < 5; i++) {
                const rarity = rollRarityForPack(commonPack.weights);
                const rarityPool = pool.filter(c => c.rarity === rarity);
                const candidates = rarityPool.length > 0 ? rarityPool : pool;
                const card = candidates[Math.floor(Math.random() * candidates.length)];
                const isNew = addCardToCollection(card.name);
                allPulled.push({ name: card.name, rarity: card.rarity, isNew });
            }
            playerData.packsOpened++;
            playerData.packHistory.unshift({ packId: 'common', packName: 'Common Pack (Starter)', cards: allPulled.slice(pack*5, pack*5+5), date: new Date().toLocaleDateString() });
        }

        savePlayerData();
        // Show the welcome reveal after a brief delay
        setTimeout(() => showPackReveal(allPulled, commonPack), 400);
    }

    /* ─── Daily reward ─────────────────────────────────────── */
    function checkDailyReward() {
        const today = new Date().toISOString().slice(0, 10);
        if (playerData.lastLoginDate !== today) {
            playerData.lastLoginDate = today;
            playerData.points += DAILY_BONUS;
            savePlayerData();
            showDailyReward(DAILY_BONUS);
        }
    }

    function showDailyReward(amount) {
        document.getElementById('daily-points-display').textContent = `+${amount}`;
        document.getElementById('daily-reward-overlay').classList.add('visible');
    }

    function closeDailyReward() {
        const today = new Date().toISOString().slice(0, 10);
        if (playerData.lastLoginDate !== today) {
            playerData.lastLoginDate = today;
            playerData.points += DAILY_BONUS;
            savePlayerData();
        }
        document.getElementById('daily-reward-overlay').classList.remove('visible');
    }

    /* ─── Pack opening ─────────────────────────────────────── */
    function rollRarityForPack(weights) {
        const total = Object.values(weights).reduce((a,b)=>a+b, 0);
        let roll = Math.random() * total;
        for (const [rarity, weight] of Object.entries(weights)) {
            roll -= weight;
            if (roll <= 0) return rarity;
        }
        return 'COMMON';
    }

    function openPack(packId) {
        const pack = PACK_TYPES.find(p => p.id === packId);
        if (!pack) return;

        const errEl = document.getElementById(`not-enough-points-${packId}`);
        if (playerData.points < pack.cost) {
            if (errEl) errEl.classList.remove('hidden');
            return;
        }
        if (errEl) errEl.classList.add('hidden');
        if (!ALL_CHARS || ALL_CHARS.length === 0) return;

        playerData.points -= pack.cost;
        playerData.packsOpened++;

        const pool = ALL_CHARS.filter(c => !c.isKeyCard);
        const pulled = [];

        for (let i = 0; i < 5; i++) {
            const rarity = rollRarityForPack(pack.weights);
            const rarityPool = pool.filter(c => c.rarity === rarity);
            const candidates = rarityPool.length > 0 ? rarityPool : pool;
            const card = candidates[Math.floor(Math.random() * candidates.length)];
            const isNew = addCardToCollection(card.name);
            pulled.push({ name: card.name, rarity: card.rarity, isNew });
        }

        playerData.packHistory.unshift({ packId, packName: pack.name, cards: pulled, date: new Date().toLocaleDateString() });
        if (playerData.packHistory.length > 30) playerData.packHistory.pop();

        savePlayerData();
        renderPackShop();
        showPackReveal(pulled, pack);
    }

    // Single card reveal state
    let _revealState = { cards: [], currentIndex: 0, revealedAll: false, pack: null };

    async function showPackReveal(cards, pack) {
        const overlay = document.getElementById('pack-reveal-overlay');
        const container = document.getElementById('pack-reveal-cards');
        container.innerHTML = '';
        overlay.classList.add('visible');

        // Initialize reveal state
        _revealState = { cards: cards, currentIndex: 0, revealedAll: false, pack: pack };

        // Show first card in single reveal mode
        showSingleRevealCard(0);
    }

    function showSingleRevealCard(index) {
        const container = document.getElementById('pack-reveal-cards');
        const c = _revealState.cards[index];

        container.innerHTML = `
            <div class="pack-reveal-single">
                <div class="reveal-card-info">
                    <div class="reveal-card-name">${c.name}</div>
                    <div class="reveal-card-rarity rc-${c.rarity}">${c.rarity}</div>
                    <div class="reveal-card-count">${index + 1} of ${_revealState.cards.length}</div>
                </div>
                <div class="reveal-single-card rarity-${c.rarity}" id="reveal-single-card">
                    <img src="" class="reveal-card" id="reveal-card-img">
                </div>
                <button class="reveal-next-btn" id="reveal-next-btn">
                    ${index < _revealState.cards.length - 1 ? 'Next Card →' : 'View All Cards'}
                </button>
            </div>
        `;

        // Load card image
        const cardDef = ALL_CHARS.find(x => x.name === c.name);
        const imgPath = cardDef ? getCardImage(c.name) : null;
        const imgFallback = cardDef ? getCardImageJpg(c.name) : null;
        const img = document.getElementById('reveal-card-img');
        if (imgPath && img) {
            img.src = imgPath;
            img.onerror = () => { if (img.src !== imgFallback) img.src = imgFallback; };
        }

        // Setup next button
        const nextBtn = document.getElementById('reveal-next-btn');
        if (nextBtn) {
            nextBtn.onclick = () => {
                if (index < _revealState.cards.length - 1) {
                    showSingleRevealCard(index + 1);
                } else {
                    showAllRevealedCards();
                }
            };
        }
    }

    function showAllRevealedCards() {
        const container = document.getElementById('pack-reveal-cards');
        container.innerHTML = '';
        _revealState.revealedAll = true;

        const cards = _revealState.cards;

        for (let i = 0; i < cards.length; i++) {
            const c = cards[i];
            const wrap = document.createElement('div');
            wrap.className = 'reveal-card-wrap rarity-' + c.rarity;
            wrap.style.animationDelay = `${i * 100}ms`;

            // Badge
            const badge = document.createElement('div');
            badge.className = c.isNew ? 'new-badge' : 'dup-badge';
            badge.textContent = c.isNew ? 'NEW!' : 'Dupe';
            wrap.appendChild(badge);

            // Card image
            const cardDef = ALL_CHARS.find(x => x.name === c.name);
            const imgPath = cardDef ? getCardImage(c.name) : null;
            const imgFallback = cardDef ? getCardImageJpg(c.name) : null;
            if (imgPath) {
                const img = document.createElement('img');
                img.src = imgPath;
                img.className = 'reveal-card';
                img.onerror = () => { if (img.src !== imgFallback) img.src = imgFallback; };
                wrap.appendChild(img);
            } else {
                const placeholder = document.createElement('div');
                placeholder.className = 'reveal-card';
                placeholder.style.cssText = `width:100%;height:100%;background:rgba(99,102,241,0.1);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:32px;`;
                placeholder.innerHTML = `🃏`;
                wrap.appendChild(placeholder);
            }

            container.appendChild(wrap);
        }

        // Add continue button after all cards
        const continueBtn = document.createElement('button');
        continueBtn.className = 'reveal-continue-btn';
        continueBtn.textContent = 'Continue';
        continueBtn.style.animation = 'btn-appear 0.5s ease-out 0.5s forwards';
        continueBtn.style.opacity = '0';
        continueBtn.onclick = closePackReveal;
        container.appendChild(continueBtn);
    }

    function closePackReveal() {
        document.getElementById('pack-reveal-overlay').classList.remove('visible');
        if (document.getElementById('screen-packshop') && !document.getElementById('screen-packshop').classList.contains('hidden-screen')) {
            renderPackShop();
        }
    }

    /* ─── Deck builder ─────────────────────────────────────── */
    function renderDeckTabs() {
        const tabs = document.getElementById('deck-tabs');
        if (!tabs) return;
        tabs.innerHTML = '';
        playerData.decks.forEach((deck, i) => {
            const btn = document.createElement('button');
            btn.className = `deck-tab ${i === currentDeckIndex ? 'active' : ''}`;
            btn.textContent = deck.name || `Deck ${i+1}`;
            if (i === playerData.activeDeckIndex) btn.textContent += ' ★';
            btn.onclick = () => { currentDeckIndex = i; renderDeckBuilder(); };
            tabs.appendChild(btn);
        });
        // Add new deck button
        const addBtn = document.createElement('button');
        addBtn.className = 'deck-tab';
        addBtn.textContent = '+ New';
        addBtn.onclick = () => {
            playerData.decks.push({ name: `Deck ${playerData.decks.length+1}`, cards: [] });
            currentDeckIndex = playerData.decks.length - 1;
            savePlayerData();
            renderDeckBuilder();
        };
        tabs.appendChild(addBtn);
    }

    function renderDeckBuilder() {
        renderDeckTabs();
        const deck = playerData.decks[currentDeckIndex];
        if (!deck) return;

        document.getElementById('deck-name-input').value = deck.name;
        document.getElementById('deck-filled').textContent = deck.cards.length;

        // Render slots
        const grid = document.getElementById('deck-slot-grid');
        grid.innerHTML = '';
        for (let i = 0; i < 10; i++) {
            const slotEl = document.createElement('div');
            slotEl.className = `deck-card-slot ${deck.cards[i] ? 'filled' : ''}`;
            if (deck.cards[i]) {
                const cardDef = ALL_CHARS && ALL_CHARS.find(c => c.name === deck.cards[i]);
                // async image
                slotEl.innerHTML = `<div class="remove-x">✕</div><div style="font-size:9px;font-weight:800;text-align:center;padding:4px;color:rgba(255,255,255,0.8);">${deck.cards[i]}</div>`;
                slotEl.onclick = () => { deck.cards.splice(i, 1); savePlayerData(); renderDeckBuilder(); };
                if (cardDef) {
                    const src = getCardImage(cardDef.name);
                    const fb  = getCardImageJpg(cardDef.name);
                    slotEl.innerHTML = `<div class="remove-x">✕</div><img src="${src}" onerror="if(this.src!=='${fb}')this.src='${fb}'" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
                }
            } else {
                slotEl.innerHTML = `<span style="font-size:20px;opacity:0.2;">+</span>`;
            }
            grid.appendChild(slotEl);
        }

        renderDeckPicker();
    }

    function renderDeckPicker() {
        const list = document.getElementById('deck-picker-list');
        if (!list || !ALL_CHARS) return;
        const search = (document.getElementById('deck-search')?.value || '').toLowerCase();
        const deck = playerData.decks[currentDeckIndex];
        list.innerHTML = '';

        // Build counts in current deck
        const deckCounts = {};
        deck.cards.forEach(n => { deckCounts[n] = (deckCounts[n]||0)+1; });

        // Filter owned non-key cards
        const owned = playerData.collection.filter(c => c.count > 0);
        const cards = ALL_CHARS.filter(c =>
            !c.isKeyCard &&
            owned.some(o => o.name === c.name) &&
            (!search || c.name.toLowerCase().includes(search))
        );

        if (cards.length === 0) {
            list.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;padding:24px;">No cards match.</div>`;
            return;
        }

        cards.forEach(card => {
            const owned = getOwnedCount(card.name);
            const inDeck = deckCounts[card.name] || 0;
            const canAdd = deck.cards.length < 10 && inDeck < owned;

            const row = document.createElement('div');
            row.className = `pick-card-row ${!canAdd ? 'disabled' : ''}`;

            const rarityColors = {COMMON:'#64748b',UNCOMMON:'#10b981',RARE:'#3b82f6',EPIC:'#a855f7',LEGENDARY:'#f59e0b'};
            const dot = `<span style="width:7px;height:7px;border-radius:50%;background:${rarityColors[card.rarity]||'#64748b'};flex-shrink:0;display:inline-block;margin-right:2px;"></span>`;

            row.innerHTML = `
                <img src="" onerror="this.style.display='none'" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;background:rgba(99,102,241,0.1);">
                <span class="pick-name">${dot} ${card.name}</span>
                <span class="pick-count">${inDeck}/${owned}</span>
            `;

            const _imgEl = row.querySelector('img');
            if (_imgEl) {
                const _src = getCardImage(card.name);
                const _fb  = getCardImageJpg(card.name);
                _imgEl.src = _src;
                _imgEl.onerror = () => { if (_imgEl.src !== _fb) _imgEl.src = _fb; };
                _imgEl.style.display = '';
            }

            if (canAdd) {
                row.onclick = () => {
                    deck.cards.push(card.name);
                    savePlayerData();
                    renderDeckBuilder();
                };
            }

            list.appendChild(row);
        });
    }

    function saveDeck() {
        const name = document.getElementById('deck-name-input').value.trim();
        if (name) playerData.decks[currentDeckIndex].name = name;
        savePlayerData();
        renderDeckBuilder();
    }

    function setActiveDeck(idx) {
        playerData.activeDeckIndex = idx;
        savePlayerData();
        renderDeckBuilder();
    }

    /* ─── Collection screen ────────────────────────────────── */
    function setCollectionFilter(rarity, btn) {
        collectionFilter = rarity;
        document.querySelectorAll('#collection-rarity-filters .collection-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCollection();
    }

    function setCollectionOwned(mode, btn) {
        collectionOwned = mode;
        document.querySelectorAll('#collection-toggle .collection-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCollection();
    }

    async function renderCollection() {
        const grid = document.getElementById('collection-grid');
        const label = document.getElementById('collection-count-label');
        if (!grid || !ALL_CHARS) return;

        const search = (document.getElementById('collection-search')?.value || '').toLowerCase();
        const total = totalOwnedCards();
        const unique = playerData.collection.filter(c => c.count > 0).length;
        label.textContent = `${unique} unique · ${total} total · ${ALL_CHARS.filter(c=>!c.isKeyCard).length} available`;

        let cards = ALL_CHARS.filter(c => !c.isKeyCard);
        if (collectionOwned === 'owned') cards = cards.filter(c => getOwnedCount(c.name) > 0);
        if (collectionFilter !== 'ALL') cards = cards.filter(c => c.rarity === collectionFilter);
        if (search) cards = cards.filter(c => c.name.toLowerCase().includes(search));

        grid.innerHTML = '';
        for (const card of cards) {
            const count = getOwnedCount(card.name);
            const locked = count === 0;
            const wrap = document.createElement('div');
            wrap.className = `collection-card-wrap ${locked ? 'locked' : ''}`;
            wrap.title = locked ? `${card.name} — not owned` : `${card.name} (×${count})`;
            if (!locked) {
                wrap.style.cursor = 'pointer';
                wrap.onclick = () => showCardDetails(card.name);
            }

            const rarityColors = {COMMON:'#64748b',UNCOMMON:'#10b981',RARE:'#3b82f6',EPIC:'#a855f7',LEGENDARY:'#f59e0b'};
            const borderColor = rarityColors[card.rarity] || '#64748b';

            wrap.innerHTML = `
                <div style="border:2px solid ${borderColor}20;border-radius:12px;overflow:hidden;background:rgba(255,255,255,0.03);aspect-ratio:3/4;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;gap:6px;">
                    <img src="" alt="${card.name}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid ${borderColor}40;" onerror="this.style.display='none'">
                    <div style="font-size:11px;font-weight:800;text-align:center;line-height:1.2;">${card.name}</div>
                    <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;color:${borderColor};">${card.rarity}</div>
                    <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.4);">${card.series}</div>
                </div>
                ${!locked ? `<div class="owned-count-badge">×${count}</div>` : '<div class="locked-overlay"><i data-lucide="lock" class="w-6 h-6" style="color:rgba(255,255,255,0.3);"></i></div>'}
            `;

            const _ci = wrap.querySelector('img');
            if (_ci) {
                const _src = getCardImage(card.name);
                const _fb  = getCardImageJpg(card.name);
                _ci.src = _src;
                _ci.onerror = () => { if (_ci.src !== _fb) _ci.src = _fb; };
            }

            grid.appendChild(wrap);
        }
        lucide.createIcons();
    }

    /* ─── Card details modal ───────────────────────────────── */
    async function showCardDetails(cardName) {
        const card = ALL_CHARS && ALL_CHARS.find(c => c.name === cardName);
        if (!card) return;

        const rarityColors = {COMMON:'#64748b',UNCOMMON:'#10b981',RARE:'#3b82f6',EPIC:'#a855f7',LEGENDARY:'#f59e0b'};
        const borderColor = rarityColors[card.rarity] || '#64748b';
        const count = getOwnedCount(cardName);

        let statsHtml = '';
        if (card.atk !== undefined || card.hp !== undefined) {
            statsHtml = `
                <div class="card-details-stats">
                    ${card.atk !== undefined ? `
                        <div class="card-details-stat">
                            <div class="card-details-stat-value" style="color:#f87171;">⚔️ ${card.atk}</div>
                            <div class="card-details-stat-label">Attack</div>
                        </div>
                    ` : ''}
                    ${card.hp !== undefined ? `
                        <div class="card-details-stat">
                            <div class="card-details-stat-value" style="color:#86efac;">❤️ ${card.hp}</div>
                            <div class="card-details-stat-label">Health</div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        let abilitiesHtml = '';
        if (card.description) {
            const formattedDesc = await formatDescription(card.description);
            abilitiesHtml = `
                <div class="card-details-description">
                    <div class="card-details-description-label">Description</div>
                    <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.85);">${formattedDesc}</div>
                </div>
            `;
        }

        const imgSrc = getCardImage(cardName);
        const imgFb = getCardImageJpg(cardName);

        const content = `
            <div class="card-details-image-section">
                <img src="${imgSrc}" onerror="if(this.src!=='${imgFb}')this.src='${imgFb}'" alt="${cardName}" class="card-details-image" style="border-color:${borderColor}80;">
                <div style="font-size:12px;color:rgba(255,255,255,0.6);text-align:center;">
                    Owned: <span style="color:${borderColor};font-weight:900;font-size:14px;">×${count}</span>
                </div>
            </div>
            <div class="card-details-info">
                <div class="card-details-header">
                    <div class="card-details-name" style="color:${borderColor};">${card.name}</div>
                    <div class="card-details-meta">
                        <div class="card-details-badge" style="border-color:${borderColor}44;color:${borderColor};">
                            ${card.rarity}
                        </div>
                        ${card.series ? `<div class="card-details-badge">${card.series}</div>` : ''}
                        ${card.cost !== undefined ? `<div class="card-details-badge">Cost: ${card.cost}</div>` : ''}
                    </div>
                </div>
                ${statsHtml}
                ${abilitiesHtml}
            </div>
        `;

        document.getElementById('card-details-content').innerHTML = content;
        document.getElementById('card-details-overlay').classList.add('visible');
    }

    function closeCardDetails() {
        document.getElementById('card-details-overlay').classList.remove('visible');
    }

    /* ─── Arena Confirmation Modal ───────────────────────── */
    // 5 difficulty levels with rarity ranges
    const ARENA_DIFFICULTIES = [
        { id: 1, name: 'Rookie', minRarity: 0, maxRarity: 1, color: '#64748b', description: 'Common & Uncommon cards' },
        { id: 2, name: 'Fighter', minRarity: 1, maxRarity: 2, color: '#10b981', description: 'Up to Rare' },
        { id: 3, name: 'Veteran', minRarity: 2, maxRarity: 3, color: '#3b82f6', description: 'Up to Epic' },
        { id: 4, name: 'Elite', minRarity: 3, maxRarity: 4, color: '#a855f7', description: 'Up to Legendary' },
        { id: 5, name: 'Legendary', minRarity: 4, maxRarity: 4, color: '#f59e0b', description: 'Only Legendary!' }
    ];

    let selectedDifficulty = 1;
    let _arenaPendingBattle = false;

    function openArenaConfirm() {
        if (!playerData || !playerData.decks) return;
        
        const activeDeck = playerData.decks[playerData.activeDeckIndex];
        if (!activeDeck || !activeDeck.cards || activeDeck.cards.length === 0) {
            showNoDeckWarning();
            return;
        }

        // Render difficulty buttons
        const diffContainer = document.getElementById('difficulty-buttons');
        diffContainer.innerHTML = '';
        
        ARENA_DIFFICULTIES.forEach(diff => {
            const btn = document.createElement('button');
            btn.style.cssText = `
                background: ${selectedDifficulty === diff.id ? diff.color + '33' : 'rgba(255,255,255,0.05)'};
                border: 2px solid ${selectedDifficulty === diff.id ? diff.color : 'rgba(255,255,255,0.1)'};
                border-radius: 10px;
                padding: 8px 4px;
                cursor: pointer;
                transition: all 0.2s ease;
                color: white;
            `;
            btn.innerHTML = `
                <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.05em;color:${diff.color};margin-bottom:2px;">LV ${diff.id}</div>
                <div style="font-size:11px;font-weight:800;">${diff.name}</div>
            `;
            btn.onclick = () => selectDifficulty(diff.id);
            btn.onmouseover = () => {
                if (selectedDifficulty !== diff.id) {
                    btn.style.borderColor = diff.color + '66';
                    btn.style.background = diff.color + '22';
                }
            };
            btn.onmouseout = () => {
                if (selectedDifficulty !== diff.id) {
                    btn.style.borderColor = 'rgba(255,255,255,0.1)';
                    btn.style.background = 'rgba(255,255,255,0.05)';
                }
            };
            diffContainer.appendChild(btn);
        });

        // Render deck preview
        const deckPreview = document.getElementById('arena-deck-preview');
        deckPreview.innerHTML = '';
        
        activeDeck.cards.forEach(cardName => {
            const cardDef = ALL_CHARS && ALL_CHARS.find(c => c.name === cardName);
            const rarityColors = {COMMON:'#64748b',UNCOMMON:'#10b981',RARE:'#3b82f6',EPIC:'#a855f7',LEGENDARY:'#f59e0b'};
            const color = cardDef ? (rarityColors[cardDef.rarity] || '#64748b') : '#64748b';
            
            const cardEl = document.createElement('div');
            cardEl.style.cssText = `
                width: 40px;
                height: 40px;
                border-radius: 6px;
                background: ${color}22;
                border: 1px solid ${color}66;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 9px;
                font-weight: 700;
                color: ${color};
                overflow: hidden;
                text-overflow: ellipsis;
                padding: 2px;
            `;
            cardEl.textContent = cardName.substring(0, 6);
            cardEl.title = cardName;
            deckPreview.appendChild(cardEl);
        });

        // Show modal
        document.getElementById('arena-confirm-overlay').style.opacity = '1';
        document.getElementById('arena-confirm-overlay').style.pointerEvents = 'auto';
    }

    function selectDifficulty(diffId) {
        selectedDifficulty = diffId;
        openArenaConfirm(); // Re-render with new selection
    }

    function closeArenaConfirm() {
        document.getElementById('arena-confirm-overlay').style.opacity = '0';
        document.getElementById('arena-confirm-overlay').style.pointerEvents = 'none';
        _arenaPendingBattle = false;
    }

    function confirmArenaBattle() {
        _arenaPendingBattle = true;
        closeArenaConfirm();
        
        // Set the difficulty for the AI
        if (typeof setArenaDifficulty === 'function') {
            setArenaDifficulty(selectedDifficulty);
        }
        
        // Start the battle
        showScreen('arena');
        startBattleInternal();
    }

    function goToArena() {
        openArenaConfirm();
    }

    // Set arena difficulty (called before battle starts)
    window.setArenaDifficulty = function(diffLevel) {
        selectedDifficulty = diffLevel;
        console.log('Arena difficulty set to:', diffLevel);
    };

    /* ─── No Deck Warning ──────────────────────────────────── */
    function checkDeckBeforeBattle() {
        if (!playerData || !playerData.decks) return false;
        
        const activeDeck = playerData.decks[playerData.activeDeckIndex];
        if (!activeDeck || !activeDeck.cards || activeDeck.cards.length === 0) {
            showNoDeckWarning();
            return false;
        }
        return true;
    }

    function showNoDeckWarning() {
        document.getElementById('no-deck-overlay').style.opacity = '1';
        document.getElementById('no-deck-overlay').style.pointerEvents = 'auto';
    }

    function closeNoDeckWarning() {
        document.getElementById('no-deck-overlay').style.opacity = '0';
        document.getElementById('no-deck-overlay').style.pointerEvents = 'none';
    }

    function goToDeckBuilder() {
        closeNoDeckWarning();
        showScreen('deckbuilder');
    }


    /* ─── Pack shop screen ─────────────────────────────────── */
    function renderPackShop() {
        const pts = document.getElementById('shop-points-display');
        if (pts) pts.textContent = playerData.points;

        const grid = document.getElementById('pack-cards-grid');
        if (!grid) return;
        grid.innerHTML = '';

        PACK_TYPES.forEach(pack => {
            const canAfford = playerData.points >= pack.cost;
            const rarityColors = {COMMON:'#64748b',UNCOMMON:'#10b981',RARE:'#3b82f6',EPIC:'#a855f7',LEGENDARY:'#f59e0b'};
            const oddsRows = Object.entries(pack.weights).map(([r, w]) =>
                `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 7px;border-radius:6px;background:rgba(255,255,255,0.04);">
                    <span style="font-size:10px;font-weight:800;color:${rarityColors[r]};">${r.charAt(0)+r.slice(1).toLowerCase()}</span>
                    <span style="font-size:10px;font-weight:900;color:rgba(255,255,255,0.3);">${w}%</span>
                </div>`
            ).join('');

            const card = document.createElement('div');
            card.className = 'pack-card';
            const displayColor = pack.customColor || pack.color;
            const displayName  = pack.customName  || pack.name;
            const imgSrc       = pack.customImage  || pack.imagePath;
            card.style.cssText = `
                border-color: ${displayColor}44;
                --pack-glow-color: ${displayColor}55;
                --pack-border-color: ${displayColor}99;
            `;
            card.innerHTML = `
                <div class="pack-image-area" style="cursor:pointer;" onclick="openPackCustomizer('${pack.id}')" title="Click to customize">
                    <img src="${imgSrc}" alt="${displayName}" class="pack-img-preview"
                        style="--pack-glow-color:${displayColor}88;"
                        onerror="this.src='${pack.svgArt}'">
                </div>
                <h3 style="font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:0.06em;color:${displayColor};margin-bottom:4px;text-shadow:0 0 20px ${displayColor}66;">${displayName}</h3>
                <p style="color:rgba(255,255,255,0.2);font-size:10px;font-weight:700;letter-spacing:0.08em;margin-bottom:14px;">5 CARDS PER PACK</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:16px;">${oddsRows}</div>
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.06);margin-bottom:14px;">
                    <span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.25);">Cost</span>
                    <span style="font-size:20px;font-weight:900;color:${displayColor};">${pack.cost} <span style="font-size:11px;color:rgba(255,255,255,0.3);font-weight:700;">pts</span></span>
                </div>
                <button onclick="openPack('${pack.id}')" ${canAfford ? '' : 'disabled'}
                    class="pack-open-btn w-full justify-center"
                    style="background:linear-gradient(135deg,${displayColor}bb,${displayColor});box-shadow:0 8px 28px ${pack.glow};">
                    <i data-lucide="package-open" class="w-4 h-4"></i> Open Pack
                </button>
                <div id="not-enough-points-${pack.id}" class="text-red-400 text-xs font-bold mt-3 hidden text-center">Not enough points!</div>
            `;
            grid.appendChild(card);
        });

        lucide.createIcons();

        // History
        const history = document.getElementById('pack-history');
        const empty = document.getElementById('pack-history-empty');
        if (!history) return;
        history.innerHTML = '';
        if (playerData.packHistory.length === 0) {
            if (empty) empty.style.display = 'block';
        } else {
            if (empty) empty.style.display = 'none';
            playerData.packHistory.slice(0, 15).forEach(entry => {
                const rarityColors = {COMMON:'#64748b',UNCOMMON:'#10b981',RARE:'#3b82f6',EPIC:'#a855f7',LEGENDARY:'#f59e0b'};
                if (!entry.cards) return;
                const packDef = PACK_TYPES.find(p => p.id === entry.packId);
                entry.cards.forEach(c => {
                    const item = document.createElement('div');
                    item.className = 'pack-history-item';
                    item.innerHTML = `
                        <span class="pack-history-rarity" style="background:${rarityColors[c.rarity]||'#64748b'};"></span>
                        <span style="font-size:12px;font-weight:700;flex:1;">${c.name}</span>
                        ${packDef ? `<span style="font-size:8px;font-weight:900;border-radius:5px;padding:1px 5px;margin-right:4px;background:${packDef.color}22;color:${packDef.color};">${packDef.name}</span>` : ''}
                        <span style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.06em;" class="rc-${c.rarity}">${c.rarity}</span>
                        ${c.isNew ? `<span style="font-size:8px;font-weight:900;background:rgba(34,197,94,0.2);color:#4ade80;border-radius:6px;padding:2px 6px;margin-left:4px;">NEW</span>` : ''}
                    `;
                    history.appendChild(item);
                });
            });
        }
    }

    /* ─── Lobby screen ─────────────────────────────────────── */
    function renderLobby() {
        const deck = playerData.decks[playerData.activeDeckIndex];
        const deckInfo = document.getElementById('lobby-deck-info');
        if (deckInfo) {
            if (deck && deck.cards.length > 0) {
                deckInfo.innerHTML = `
                    <div class="active-deck-chip">
                        <i data-lucide="layers" class="w-3 h-3 text-indigo-400"></i>
                        <span class="text-sm font-black">${deck.name}</span>
                        <span class="text-xs text-slate-500 font-bold">${deck.cards.length}/10 cards</span>
                    </div>
                `;
            } else {
                deckInfo.innerHTML = `<span class="text-slate-500 text-sm">No deck built yet. <a onclick="showScreen('deckbuilder')" style="color:#6366f1;cursor:pointer;">Build one →</a></span>`;
            }
        }
        const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        set('lobby-points', playerData.points);
        set('lobby-wins', playerData.wins);
        set('lobby-collection-count', totalOwnedCards());
        set('lobby-packs', playerData.packsOpened);

        // ── Collection progress bar ──────────────────────────────
        if (ALL_CHARS) {
            const collectible = ALL_CHARS.filter(c => !c.isKeyCard);
            const totalAvail = collectible.length;
            const uniqueOwned = playerData.collection.filter(c => c.count > 0).length;
            const pct = totalAvail > 0 ? Math.round((uniqueOwned / totalAvail) * 100) : 0;

            set('progress-unique', uniqueOwned);
            set('progress-total', totalAvail);
            const bar = document.getElementById('collection-progress-bar');
            if (bar) bar.style.width = pct + '%';

            // Per-rarity mini progress
            const rarityRow = document.getElementById('rarity-progress-row');
            if (rarityRow) {
                const rarities = ['COMMON','UNCOMMON','RARE','EPIC','LEGENDARY'];
                const rarityColors = {COMMON:'#64748b',UNCOMMON:'#10b981',RARE:'#3b82f6',EPIC:'#a855f7',LEGENDARY:'#f59e0b'};
                rarityRow.innerHTML = rarities.map(r => {
                    const avail = collectible.filter(c => c.rarity === r).length;
                    const owned = playerData.collection.filter(c => c.count > 0 && ALL_CHARS.find(x => x.name === c.name && x.rarity === r)).length;
                    const p = avail > 0 ? Math.round((owned/avail)*100) : 0;
                    return `<div style="text-align:center;">
                        <div style="font-size:9px;font-weight:900;color:${rarityColors[r]};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${r.slice(0,3)}</div>
                        <div style="font-size:11px;font-weight:900;color:rgba(255,255,255,0.7);">${owned}<span style="color:rgba(255,255,255,0.3);font-size:9px;">/${avail}</span></div>
                        <div style="height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:4px;overflow:hidden;">
                            <div style="height:100%;width:${p}%;background:${rarityColors[r]};border-radius:2px;transition:width 0.6s ease;"></div>
                        </div>
                    </div>`;
                }).join('');
            }
        }

        lucide.createIcons();
    }

    /* ─── Battle result overlay ────────────────────────────── */
    window.showBattleResult = function(isWin) {
        if (!playerData) return;
        const ptsBefore = playerData.points;
        // Award points (also tracked via patched checkVictory)
        // awardBattleResult will have already run from the patched checkVictory,
        // so we just read the current values.
        const ptsEarned = isWin ? WIN_BONUS : LOSS_BONUS;

        const overlay = document.getElementById('battle-result-overlay');
        document.getElementById('battle-result-icon').textContent = isWin ? '🏆' : '💀';
        document.getElementById('battle-result-title').textContent = isWin ? 'Victory!' : 'Defeat';
        document.getElementById('battle-result-title').style.color = isWin ? '#4ade80' : '#f87171';
        document.getElementById('battle-result-sub').textContent = isWin
            ? 'Enemy Nexus destroyed.' : 'Your Nexus has fallen.';
        document.getElementById('battle-result-pts').textContent = `+${ptsEarned}`;
        document.getElementById('battle-result-record').textContent = `${playerData.wins}W/${playerData.losses}L`;
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
    };

    function closeBattleResult(rematch) {
        const overlay = document.getElementById('battle-result-overlay');
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        if (rematch) {
            // Restart battle in place
            if (typeof startBattleInternal === 'function') startBattleInternal();
        } else {
            window.showScreen('lobby');
        }
    }

    /* ─── Points toast ─────────────────────────────────────── */
    function showPointsToast(icon, title, sub) {
        const toast = document.getElementById('points-toast');
        document.getElementById('toast-icon').textContent = icon;
        document.getElementById('toast-title').textContent = title;
        document.getElementById('toast-sub').textContent = sub;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-8px)';
        }, 3000);
    }

    /* ─── Username editing ─────────────────────────────────── */
    function editUsername() {
        // Remove any existing modal
        const existing = document.getElementById('username-edit-modal');
        if (existing) existing.remove();

        const current = playerData?.username || 'Commander';
        const modal = document.createElement('div');
        modal.id = 'username-edit-modal';
        modal.style.cssText = `
            position:fixed;inset:0;z-index:80000;
            background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);
            display:flex;align-items:center;justify-content:center;
        `;
        modal.innerHTML = `
            <div style="background:linear-gradient(145deg,#0f172a,#1a0a2e);
                border:2px solid rgba(99,102,241,0.5);border-radius:24px;
                padding:36px 32px;width:320px;box-shadow:0 0 60px rgba(99,102,241,0.3);">
                <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:rgba(255,255,255,0.4);margin-bottom:16px;">Change Username</div>
                <input id="username-edit-input" type="text" maxlength="20" value="${current}"
                    style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(99,102,241,0.4);
                    border-radius:10px;padding:10px 14px;color:white;font-size:14px;font-weight:700;
                    outline:none;box-sizing:border-box;margin-bottom:20px;"
                    onkeydown="if(event.key==='Enter')document.getElementById('username-save-btn').click();if(event.key==='Escape')document.getElementById('username-edit-modal').remove();"
                >
                <div style="display:flex;gap:10px;">
                    <button id="username-save-btn" onclick="
                        const v=document.getElementById('username-edit-input').value.trim();
                        if(v){playerData.username=v.slice(0,20);savePlayerData();refreshUI();}
                        document.getElementById('username-edit-modal').remove();
                    " style="flex:1;background:linear-gradient(135deg,#4f46e5,#6366f1);color:white;
                        border:none;border-radius:10px;padding:10px;font-weight:900;font-size:12px;
                        text-transform:uppercase;letter-spacing:0.08em;cursor:pointer;">Save</button>
                    <button onclick="document.getElementById('username-edit-modal').remove()"
                        style="flex:1;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6);
                        border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px;
                        font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;cursor:pointer;">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => document.getElementById('username-edit-input')?.focus(), 50);
    }

    /* ─── Reset save ───────────────────────────────────────── */
    function confirmResetSave() {
        if (confirm('Reset all progress? This cannot be undone.')) {
            localStorage.removeItem('nexus_player');
            location.reload();
        }
    }

    /* ─── Global UI refresh ────────────────────────────────── */
    function refreshUI() {
        const pts = playerData.points;
        const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        set('header-points-value', pts);
        set('header-wins', playerData.wins);
        set('header-losses', playerData.losses);
        set('sidebar-points', pts);
        set('sidebar-username', playerData.username);
    }

    /* ─── Hook into existing checkVictory ──────────────────── */
    function awardBattleResult(isWin) {
        if (!playerData) return;
        const earned = isWin ? WIN_BONUS : LOSS_BONUS;
        if (isWin) { playerData.points += WIN_BONUS; playerData.wins++; }
        else        { playerData.points += LOSS_BONUS; playerData.losses++; }
        savePlayerData();
        showPointsToast(
            isWin ? '🏆' : '🛡️',
            isWin ? `Victory! +${WIN_BONUS} pts` : `Defeat. +${LOSS_BONUS} pts`,
            `Total: ${playerData.points} pts`
        );
    }

    /* ─── Hook draw() to use active deck ──────────────────── */
    // Weighted random draw from deck (respects card copies owned)
    function drawFromDeck() {
        if (!playerData || !ALL_CHARS) return;
        if (state.hand.length >= 4) return;

        const deck = playerData.decks[playerData.activeDeckIndex];
        const pool = (deck && deck.cards.length > 0)
            ? deck.cards  // array of names, duplicates = higher weight
            : ALL_CHARS.filter(c => !c.isKeyCard).map(c => c.name);

        const name = pool[Math.floor(Math.random() * pool.length)];
        const card = ALL_CHARS.find(c => c.name === name);
        if (card) state.hand.push({ ...card, maxHp: card.hp ?? card.maxHp });
    }

    /* ═══════════════════════════════════════════════════════════════
       STORY MODE — Dynamic expansion and 4-level completion
       ═══════════════════════════════════════════════════════════════ */

    /* ─── Supabase map bucket ───────────────────────────────────── */
    const SUPABASE_MAP_BUCKET = 'map-images';
    function getMapImageUrl(filename) {
        return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_MAP_BUCKET}/${filename}`;
    }

    /* ─── Global story config ──────────────────────────────────── */
    const STORY_CONFIG = {
        mapImage: getMapImageUrl('new_haven.png'),
        title: 'Story Mode',
        subtitle: 'Journey across the world and challenge every commander.'
    };

    /* ─── Chapter enemy pools ──────────────────────────────────────
       Each chapter defines an enemyPool — a list of card names the AI
       will draw from exclusively during that chapter's battles.
       Falls back to all non-key cards if the pool is empty or the
       named cards don't exist in ALL_CHARS at runtime.
    ─────────────────────────────────────────────────────────────── */

    // Call this to get the resolved pool for a chapter at battle time.
    function resolveEnemyPool(chapter) {
        if (!ALL_CHARS) return [];
        const pool = chapter.enemyPool || [];
        if (pool.length === 0) return ALL_CHARS.filter(c => !c.isKeyCard);
        const resolved = pool
            .map(name => ALL_CHARS.find(c => c.name === name))
            .filter(Boolean);
        return resolved.length > 0 ? resolved : ALL_CHARS.filter(c => !c.isKeyCard);
    }

    // Active enemy pool for the current story battle (set in startStoryBattle).
    let _activeEnemyPool = null;

    /* ─── Chapter + level definitions ─────────────────────────── */
    let STORY_CHAPTERS = [
        {
            id: 'ch1',
            title: 'Chapter 1: The Lab',
            location: 'New Haven',
            mapX: 50, mapY: 50,
            locked: false,
            _mapImage: getMapImageUrl('new_haven.png'),
            // Lab scientists, researchers, assistants — chapter-specific enemies
            enemyPool: ['Joseph', 'Jane', 'Natalie Bergeron', 'Marija', 'Diana Bullen'],
            levels: [
                {
                    id: 'ch1-lv1', title: 'Level 1: The Clutz', mapX: 0, mapY: -250, scale: 2.0, background: null,
                    opponent: { name: 'Joseph', portrait: null, difficulty: 1, deck: ['Joseph','Joseph','Joseph','Jill','Jill','Joey','Joey','Juliana Roberts','Juliana Roberts','Bucky'] },
                    dialogue: {
                        intro: ["Aw mate, I wasn't even trying to do that!", "Wait, are we battling?"],
                        win: ["Oof, you got me."], lose: ["Oops, my bad!"]
                    },
                    reward: { points: 50, cardName: null }
                },
                {
                    id: 'ch1-lv2', title: 'Level 2: Team Spirit', mapX: -225, mapY: -175, scale: 2.0, background: null,
                    opponent: { name: 'Jane', portrait: null, difficulty: 2, deck: ['Jane','Jane','Joseph','Joseph','Natalie Bergeron','Natalie Bergeron','Jill','Jill','Joey','Juliana Roberts'] },
                    dialogue: { intro: ["I can do this! I know I can!"], win: ["I'll try harder next time..."], lose: ["Yay! We did it!"] },
                    reward: { points: 60, cardName: null }
                },
                {
                    id: 'ch1-lv3', title: 'Level 3: Spilled Meds', mapX: -275, mapY: 0, scale: 2.0, background: null,
                    opponent: { name: 'Natalie Bergeron', portrait: null, difficulty: 2, deck: ['Natalie Bergeron','Natalie Bergeron','Joseph','Joseph','Jane','Juliana Roberts','Juliana Roberts','Jill','Joey','Aria Bergeron'] },
                    dialogue: { intro: ["S-sorry! I didn't mean to — oh no, that spilled too."], win: ["I'm so clumsy..."], lose: ["Wait, did I win?"] },
                    reward: { points: 70, cardName: null }
                },
                {
                    id: 'ch1-lv4', title: 'Level 4: Executive Order', mapX: -225, mapY: 175, scale: 2.0, background: null,
                    opponent: { name: 'Marija', portrait: null, difficulty: 3, deck: ['Marija','Juliana Roberts','Juliana Roberts','Jane','Jane','Natalie Bergeron','Joseph','Jill','Jill','Joey'] },
                    dialogue: { intro: ["The boss is here. Let's see your paperwork."], win: ["Your forms are in order. Proceed."], lose: ["Denied."] },
                    reward: { points: 100, cardName: null }
                },
                {
                    id: 'ch1-lv5', title: 'Level 5: Head Researcher', mapX: 0, mapY: 250, scale: 2.0, background: null,
                    opponent: { name: 'Diana Bullen', portrait: null, difficulty: 4, deck: ['Diana Bullen','Diana Bullen','Marija','Juliana Roberts','Juliana Roberts','Jane','Natalie Bergeron','Natalie Bergeron','Asuka','Joey'] },
                    dialogue: { intro: ["The more data we collect, the better.", "Show me what you're made of."], win: ["Fascinating results."], lose: ["Insufficient data. Try again."] },
                    reward: { points: 150, cardName: null }
                },
                {
                    id: 'ch1-lv6', title: 'Level 6: A cat in a frenzy', mapX: 225, mapY: 175, scale: 2.0, background: null,
                    opponent: { name: 'Quinta Valentine', portrait: null, difficulty: 4, deck: ['Quinta Valentine','Quinta Valentine','Saria Williams','Jane','Jane','Joseph','Asuka','Asuka','Jill','Joey'] },
                    dialogue: { intro: ["Come out, come out."], win: ["As usual, mweheh."], lose: ["MIARGHWW!! Grrr.."] },
                    reward: { points: 100, cardName: null }
                },
                {
                    id: 'ch1-lv7', title: 'Level 7: A power Mooove!', mapX: 275, mapY: 0, scale: 2.0, background: null,
                    opponent: { name: 'Clara Garcia', portrait: null, difficulty: 4, deck: ['Clara Garcia','Clara Garcia','Cheetor','Cheetor','Aria Bergeron','Aria Bergeron','Marija','Juliana Roberts','Juliana Roberts','Joey'] },
                    dialogue: { intro: ["It's time to mooove!"], win: ["Fair game, another time?"], lose: ["Next time, you got this"] },
                    reward: { points: 100, cardName: null }
                },
                {
                    id: 'ch1-lv8', title: 'Level 8: Yo, you wanna play?', mapX: 225, mapY: -175, scale: 2.0, background: null,
                    opponent: { name: 'Cheetor', portrait: null, difficulty: 4, deck: ['Cheetor','Cheetor','Clara Garcia','Clara Garcia','Quinta Valentine','Saria Williams','Bucky','Asuka','Asuka','Jill'] },
                    dialogue: { intro: ["Yo, don't go easy on me now."], win: ["Good job lil' buddy, GG."], lose: ["Yo, GG, you got it next time."] },
                    reward: { points: 100, cardName: null }
                },
                {
                    id: 'ch1-lv9', title: 'Level 9: The Final Showdown', mapX: 525, mapY: -375, scale: 2.0, background: null,
                    opponent: { name: 'Doe', portrait: null, difficulty: 5, deck: ['Doe','Doe','Diana Bullen','Marija','Saria Williams','Saria Williams','Quinta Valentine','Asuka','Asuka','Clara Garcia'] },
                    dialogue: { intro: ["Oh? You're staring again. Go on, I don't mind."], win: ["Good job, I'll be back."], lose: ["Do better next time."] },
                    reward: { points: 200, cardName: null }
                },
            ]
        },
        {
            id: 'ch2',
            title: 'Chapter 2: Family Matters',
            location: 'Adoptive Life',
            mapX: 35, mapY: 50,
            locked: true,
            _mapImage: getMapImageUrl('adoptive_life.png'),
            // Family members and relatives — chapter-specific enemies
            enemyPool: ['James Lone', 'Aunt Julie', 'Farley Kate', 'Hayley', 'Maria Hunley'],
            levels: [
                {
                    id: 'ch2-lv1', title: 'Level 1: Apathy', mapX: 27, mapY: 42, scale: 1.0, background: null,
                    opponent: { name: 'James Lone', portrait: null, difficulty: 2, deck: [] },
                    dialogue: { intro: ["Whatever. It's not like I was trying."], win: ["Tch. Good for you."], lose: ["Told you I'd win."] },
                    reward: { points: 60, cardName: null }
                },
                {
                    id: 'ch2-lv2', title: 'Level 2: Hug Attack', mapX: 43, mapY: 42, scale: 1.0, background: null,
                    opponent: { name: 'Aunt Julie', portrait: null, difficulty: 2, deck: [] },
                    dialogue: { intro: ["I MISSED YOU SO MUCH! Come here!"], win: ["Aww, you're getting so strong!"], lose: ["Gotcha!"] },
                    reward: { points: 70, cardName: null }
                },
                {
                    id: 'ch2-lv3', title: 'Level 3: Calm Down', mapX: 27, mapY: 58, scale: 1.0, background: null,
                    opponent: { name: 'Farley Kate', portrait: null, difficulty: 3, deck: [] },
                    dialogue: { intro: ["Just take it easy. Everything works out."], win: ["Well played, kiddo."], lose: ["Don't sweat it."] },
                    reward: { points: 80, cardName: null }
                },
                {
                    id: 'ch2-lv4', title: 'Level 4: Energy Burst', mapX: 43, mapY: 58, scale: 1.0, background: null,
                    opponent: { name: 'Hayley', portrait: null, difficulty: 3, deck: [] },
                    dialogue: { intro: ["OOH OOH CAN I GO FIRST?! PLEASE?!"], win: ["NO FAIR!"], lose: ["I WIN I WIN I WIN!"] },
                    reward: { points: 90, cardName: null }
                },
                {
                    id: 'ch2-lv5', title: 'Level 5: Mama Bear', mapX: 35, mapY: 35, scale: 1.0, background: null,
                    opponent: { name: 'Maria Hunley', portrait: null, difficulty: 5, deck: [] },
                    dialogue: { intro: ["You want to get to them? You go through me first."], win: ["You've earned my respect."], lose: ["Not in my house."] },
                    reward: { points: 200, cardName: null }
                }
            ]
        },
        {
            id: 'ch3',
            title: 'Chapter 3: RPG Realm',
            location: 'Dumb Super Fantasy RPG',
            mapX: 55, mapY: 50,
            locked: true,
            _mapImage: getMapImageUrl('legend_of_you.png'),
            // Fantasy RPG characters — chapter-specific enemies
            enemyPool: ['Hed', 'Curtis VonGravis', 'Priest Pristo', 'Borcolls Carple', 'Princess Beatrice'],
            levels: [
                {
                    id: 'ch3-lv1', title: 'Level 1: Borrowed HP', mapX: 47, mapY: 42, scale: 1.0, background: null,
                    opponent: { name: 'Hed', portrait: null, difficulty: 2, deck: [] },
                    dialogue: { intro: ["Let me just... borrow... a little HP."], win: ["My HP!"], lose: ["Thanks for the donation!"] },
                    reward: { points: 80, cardName: null }
                },
                {
                    id: 'ch3-lv2', title: 'Level 2: Paralyzer', mapX: 63, mapY: 42, scale: 1.0, background: null,
                    opponent: { name: 'Curtis VonGravis', portrait: null, difficulty: 3, deck: [] },
                    dialogue: { intro: ["AHULA! Prepare to be paralyzed!"], win: ["I can't move!"], lose: ["Stay right there."] },
                    reward: { points: 90, cardName: null }
                },
                {
                    id: 'ch3-lv3', title: 'Level 3: Holy Light', mapX: 47, mapY: 58, scale: 1.0, background: null,
                    opponent: { name: 'Priest Pristo', portrait: null, difficulty: 4, deck: [] },
                    dialogue: { intro: ["The holy light will make sinners weak."], win: ["The darkness prevails..."], lose: ["Purified!"] },
                    reward: { points: 100, cardName: null }
                },
                {
                    id: 'ch3-lv4', title: 'Level 4: Apple Rage', mapX: 63, mapY: 58, scale: 1.0, background: null,
                    opponent: { name: 'Borcolls Carple', portrait: null, difficulty: 4, deck: [] },
                    dialogue: { intro: ["YOU DIDN'T BUY MY APPLE?!"], win: ["My business... ruined."], lose: ["Should have bought the apple."] },
                    reward: { points: 120, cardName: null }
                },
                {
                    id: 'ch3-lv5', title: 'Level 5: The Core', mapX: 55, mapY: 35, scale: 1.0, background: null,
                    opponent: { name: 'Princess Beatrice', portrait: null, difficulty: 5, deck: [] },
                    dialogue: { intro: ["THE CORE BOWS TO ME."], win: ["Impossible... my Essentia..."], lose: ["Bow before the Master."] },
                    reward: { points: 250, cardName: null }
                }
            ]
        },
        {
            id: 'ch4',
            title: 'Chapter 4: The Amyverse',
            location: "Everythin' with Amy Lyn",
            mapX: 75, mapY: 50,
            locked: true,
            _mapImage: getMapImageUrl('bloodlines.png'),
            // Amy Lyn variants across all her alternate forms — chapter-specific enemies
            enemyPool: ['Farmer Amy Lyn', 'Karate Amy Lyn', 'Pirate Amy Lyn', 'Boss Amy Lyn', 'Amy Lyn'],
            levels: [
                {
                    id: 'ch4-lv1', title: 'Level 1: Corn Field', mapX: 67, mapY: 42, scale: 1.0, background: null,
                    opponent: { name: 'Farmer Amy Lyn', portrait: null, difficulty: 2, deck: [] },
                    dialogue: { intro: ["Ya ready for another day of corn farmin?"], win: ["Crop failed..."], lose: ["Harvest time!"] },
                    reward: { points: 90, cardName: null }
                },
                {
                    id: 'ch4-lv2', title: 'Level 2: Dojo', mapX: 83, mapY: 42, scale: 1.0, background: null,
                    opponent: { name: 'Karate Amy Lyn', portrait: null, difficulty: 3, deck: [] },
                    dialogue: { intro: ["Black Belt Amy is here!"], win: ["I yield!"], lose: ["Hi-yah!"] },
                    reward: { points: 100, cardName: null }
                },
                {
                    id: 'ch4-lv3', title: 'Level 3: High Seas', mapX: 67, mapY: 58, scale: 1.0, background: null,
                    opponent: { name: 'Pirate Amy Lyn', portrait: null, difficulty: 4, deck: [] },
                    dialogue: { intro: ["Yargh! I'm gonna steal ya treasure!"], win: ["Me booty!"], lose: ["Walk the plank!"] },
                    reward: { points: 120, cardName: null }
                },
                {
                    id: 'ch4-lv4', title: 'Level 4: Corner Office', mapX: 83, mapY: 58, scale: 1.0, background: null,
                    opponent: { name: 'Boss Amy Lyn', portrait: null, difficulty: 4, deck: [] },
                    dialogue: { intro: ["I'm the boss around these parts."], win: ["I'm ruined..."], lose: ["You're fired!"] },
                    reward: { points: 150, cardName: null }
                },
                {
                    id: 'ch4-lv5', title: 'Level 5: The Coolest', mapX: 75, mapY: 35, scale: 1.0, background: null,
                    opponent: { name: 'Amy Lyn', portrait: null, difficulty: 6, deck: [] },
                    dialogue: { intro: ["Coolest girl in town!"], win: ["Not cool!"], lose: ["Stay cool!"] },
                    reward: { points: 300, cardName: null }
                }
            ]
        },
        {
            id: 'ch5',
            title: 'Chapter 5: Water Rescue',
            location: 'The Lifeguard Has Teeth!',
            mapX: 85, mapY: 80,
            locked: true,
            _mapImage: getMapImageUrl('adoptive_life.png'),
            // Lifeguards, sea creatures, water rescuers — chapter-specific enemies
            enemyPool: ['Melanika', 'Rowdy', 'Rinco', 'Daphne Mokarran', 'Rirarra'],
            levels: [
                {
                    id: 'ch5-lv1', title: 'Level 1: Surf Board', mapX: 77, mapY: 72, scale: 1.0, background: null,
                    opponent: { name: 'Melanika', portrait: null, difficulty: 3, deck: [] },
                    dialogue: { intro: ["Yo! Catch this wave!"], win: ["Wipeout..."], lose: ["Tubular!"] },
                    reward: { points: 100, cardName: null }
                },
                {
                    id: 'ch5-lv2', title: 'Level 2: The Backup', mapX: 93, mapY: 72, scale: 1.0, background: null,
                    opponent: { name: 'Rowdy', portrait: null, difficulty: 3, deck: [] },
                    dialogue: { intro: ["Also me!"], win: ["Aww man!"], lose: ["Rowdy wins!"] },
                    reward: { points: 110, cardName: null }
                },
                {
                    id: 'ch5-lv3', title: 'Level 3: Sweet Guard', mapX: 77, mapY: 88, scale: 1.0, background: null,
                    opponent: { name: 'Rinco', portrait: null, difficulty: 4, deck: [] },
                    dialogue: { intro: ["Hello human dear."], win: ["Goodbye human dear."], lose: ["You're safe now."] },
                    reward: { points: 120, cardName: null }
                },
                {
                    id: 'ch5-lv4', title: 'Level 4: The Upgrader', mapX: 93, mapY: 88, scale: 1.0, background: null,
                    opponent: { name: 'Daphne Mokarran', portrait: null, difficulty: 5, deck: [] },
                    dialogue: { intro: ["Yes I am. And I'll upgrade everything!"], win: ["Downgraded..."], lose: ["Fully upgraded!"] },
                    reward: { points: 150, cardName: null }
                },
                {
                    id: 'ch5-lv5', title: 'Level 5: Shark Cove', mapX: 85, mapY: 65, scale: 1.0, background: null,
                    opponent: { name: 'Rirarra', portrait: null, difficulty: 6, deck: [] },
                    dialogue: { intro: ["Rhararara! Welcome to Sharrrk Cove!"], win: ["Swimming with the fishes..."], lose: ["Shark bite!"] },
                    reward: { points: 350, cardName: null }
                }
            ]
        }
    ];

    /* ─── Story progress state ─────────────────────────────────── */
    // storyProgress.completedLevels — set of level ids the player has won
    let storyProgress = { completedLevels: [], mapImage: null, chapterBgs: {} };

    function loadStoryProgress() {
        const raw = localStorage.getItem('nexus_story');
        if (raw) {
            try {
                const d = JSON.parse(raw);
                // Migrate old `completed` (chapter ids) to completedLevels
                if (d.completed && !d.completedLevels) {
                    d.completedLevels = d.completed.map(cid => `${cid}-lv1`);
                }
                storyProgress = { ...storyProgress, ...d };
                if (d.mapImage) STORY_CONFIG.mapImage = d.mapImage;
                STORY_CHAPTERS.forEach(ch => {
                    ch.levels.forEach(lv => {
                        if (d.chapterBgs && d.chapterBgs[lv.id]) lv.background = d.chapterBgs[lv.id];
                    });
                });
            } catch(e) {}
        }
        refreshChapterLocks();
    }

    function saveStoryProgress() {
        storyProgress.chapterBgs = {};
        STORY_CHAPTERS.forEach(ch => {
            ch.levels.forEach(lv => { if (lv.background) storyProgress.chapterBgs[lv.id] = lv.background; });
        });
        storyProgress.mapImage = STORY_CONFIG.mapImage;
        localStorage.setItem('nexus_story', JSON.stringify(storyProgress));
    }

    // A chapter is "beaten" if AT LEAST 4 levels are complete (or all if length < 4)
    function isChapterBeaten(chId) {
        const ch = STORY_CHAPTERS.find(c => c.id === chId);
        if (!ch) return false;
        const required = Math.min(4, ch.levels.length);
        const completedCount = ch.levels.filter(lv => storyProgress.completedLevels.includes(lv.id)).length;
        return completedCount >= required;
    }

    function refreshChapterLocks() {
        STORY_CHAPTERS.forEach((ch, i) => {
            ch.locked = i === 0 ? false : !isChapterBeaten(STORY_CHAPTERS[i - 1].id);
        });
    }

    function markLevelComplete(levelId) {
        if (!storyProgress.completedLevels.includes(levelId)) {
            storyProgress.completedLevels.push(levelId);
        }
        refreshChapterLocks();
        saveStoryProgress();
    }

    function applyChapterMap(ch) {
        if (ch._mapImage) STORY_CONFIG.mapImage = ch._mapImage;
    }

    /* ─── Story mode flags ─────────────────────────────────────── */
    let _storyModeActive  = false;
    let _activeStoryLevel = null;   // the active LEVEL object (not chapter)
    // keep _activeStoryChapter as alias for compatibility
    Object.defineProperty(window, '_activeStoryChapter', {
        get: () => _activeStoryLevel,
        set: v  => { _activeStoryLevel = v; },
        configurable: true
    });

    /* ─── Which chapter is currently expanded on the map ──────── */
    let _expandedChapterId = null;

    /* ─── Render the story screen ──────────────────────────────── */
    function renderStoryScreen() {
        const screen = document.getElementById('screen-story');
        if (!screen) return;
        loadStoryProgress();

        screen.innerHTML = `
            <div class="story-header">
                <div>
                    <h2 class="story-title">${STORY_CONFIG.title}</h2>
                    <p class="story-subtitle">${STORY_CONFIG.subtitle}</p>
                </div>
                <div class="story-header-actions">
                    <button class="story-btn-secondary" onclick="uploadStoryMap()">🗺️ Upload Map</button>
                </div>
            </div>
            <div class="story-map-container" id="story-map-container">
                <img src="${STORY_CONFIG.mapImage}" class="story-map-img" id="story-map-img" alt="Map"
                    onerror="this.style.display='none'; document.getElementById('story-map-fallback').style.display='flex';">
                <div class="story-map-placeholder" id="story-map-fallback" style="display:none;">
                    <div style="text-align:center;opacity:0.4;">
                        <div style="font-size:48px;margin-bottom:12px;">🗺️</div>
                        <div style="font-size:14px;font-weight:700;">Map loading...</div>
                        <div style="font-size:12px;margin-top:6px;">Try refreshing or uploading a custom map</div>
                    </div>
                </div>
                ${renderAllPins()}
            </div>
        `;
    }

    function renderAllPins() {
        // Responsive scale factor based on container width
        const container = document.getElementById('story-map-container');
        const containerWidth = container ? container.offsetWidth : window.innerWidth;
        const baseWidth = window.innerWidth / 0.6; // reference width for original mapX/mapY values
        const scaleFactor = Math.min(1, containerWidth / baseWidth);

        let firstLockedFound = false;

        return STORY_CHAPTERS.map((ch, index) => {
            const beaten = isChapterBeaten(ch.id);
            
            // LOGIC: Show if it's the first chapter, OR if the previous chapter is beaten
            const prevChapter = STORY_CHAPTERS[index - 1];
            const isDiscovered = index === 0 || (prevChapter && isChapterBeaten(prevChapter.id));

            // If not discovered, don't render the pin at all
            if (!isDiscovered) return '';

            const expanded = _expandedChapterId === ch.id;
            const req = Math.min(4, ch.levels.length);
            const completedInChapter = ch.levels.filter(lv => storyProgress.completedLevels.includes(lv.id)).length;
            
            // Determine if this is the "Current" active mission
            const isNew = isDiscovered && !beaten;
            
            const chCls = 'story-pin story-pin-chapter' +
                         (isNew ? ' available current-mission' : '') +
                         (beaten ? ' done' : '') +
                         (expanded ? ' expanded' : '');

            const chIcon = beaten ? '✅' : '⚔️';

            let levelPins = '';
            let levelLines = '';

            if (expanded) {
                ch.levels.forEach((lv, li) => {
                    const lvDone = storyProgress.completedLevels.includes(lv.id);

                    // A level is accessible only if it's the first, or the previous level is done
                    const prevLv = ch.levels[li - 1];
                    const lvAccessible = li === 0 || (prevLv && storyProgress.completedLevels.includes(prevLv.id));

                    // Hide levels that haven't been unlocked yet
                    if (!lvAccessible && !lvDone) {
                        const offsetX = lv.mapX * scaleFactor;
                        const offsetY = lv.mapY * scaleFactor;
                        const lineAngle = Math.atan2(offsetY, offsetX) * (180 / Math.PI);
                        const lineLength = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
                        levelLines += `<div class="story-pin-line" style="--line-angle: ${lineAngle}deg; --line-length: ${lineLength}px; animation-delay: ${li * 0.05}s; opacity:0.25;"></div>`;
                        levelPins += `
                            <div class="story-pin story-pin-level" style="--radial-x: ${offsetX}px; --radial-y: ${offsetY}px; animation-delay: ${li * 0.05}s; opacity:0.3; cursor:not-allowed; filter:grayscale(1);" title="Complete previous level to unlock">
                                <div class="story-pin-icon-small">🔒</div>
                                <div class="story-pin-label-small">Locked</div>
                            </div>`;
                        return;
                    }

                    const lvIcon = lvDone ? '✅' : `<img src="${getCardImage(lv.opponent.name)}" onerror="this.src='${getCardImageJpg(lv.opponent.name)}'" alt="${lv.opponent.name}" style="width:100%;height:100%;object-fit:cover; border-radius:50%;border:2px solid rgba(255,255,255,0.2);">`;
                    const lvCls  = 'story-pin story-pin-level' + (lvDone ? ' done' : '');
                    const lvClick = `onclick="showLevelModal('${ch.id}','${lv.id}')"`;

                    // Apply responsive scaling to mapX/mapY
                    const offsetX = lv.mapX * scaleFactor;
                    const offsetY = lv.mapY * scaleFactor;
                    const lineAngle = Math.atan2(offsetY, offsetX) * (180 / Math.PI);
                    const lineLength = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

                    levelLines += `<div class="story-pin-line" style="--line-angle: ${lineAngle}deg; --line-length: ${lineLength}px; animation-delay: ${li * 0.05}s;"></div>`;
                    const lvScale = (lv.scale ?? 1.0) * scaleFactor;
                    levelPins += `
                        <div class="${lvCls}" style="--radial-x: ${offsetX}px; --radial-y: ${offsetY}px; --pin-scale: ${lvScale}; animation-delay: ${li * 0.05}s;" ${lvClick} title="${lv.title}">
                            <div class="story-pin-icon-small">${lvIcon}</div>
                            <div class="story-pin-label-small">${lv.title.split(':').pop().trim()}</div>
                        </div>`;
                });
            }

            const labelContent = `${ch.title.split(':')[0]} <span class="chapter-progression">${completedInChapter}/${req}</span>`;

            return `
                <div class="story-chapter-group" style="left:${ch.mapX}%;top:${ch.mapY}%;">
                    ${levelLines}
                    <div class="${chCls}" onclick="toggleChapterExpand('${ch.id}')" title="${ch.location}">
                        <div class="story-pin-dot">${chIcon}</div>
                        <div class="story-pin-label">${labelContent}</div>
                    </div>
                    ${levelPins}
                </div>`;
        }).join('');
    }

    function toggleChapterExpand(chId) {
        _expandedChapterId = (_expandedChapterId === chId) ? null : chId;
        // Re-render just the pins without a full screen rebuild
        const container = document.getElementById('story-map-container');
        if (!container) { renderStoryScreen(); return; }
        // Remove existing pins
        container.querySelectorAll('.story-pin').forEach(p => p.remove());
        // Inject updated pins
        const tmp = document.createElement('div');
        tmp.innerHTML = renderAllPins();
        while (tmp.firstChild) container.appendChild(tmp.firstChild);
    }

    /* ─── Level detail modal ───────────────────────────────────── */
    window.showLevelModal = function(chapterId, levelId) {
        const ch = STORY_CHAPTERS.find(c => c.id === chapterId);
        if (!ch || ch.locked) return;
        const lv = ch.levels.find(l => l.id === levelId);
        if (!lv) return;

        const lvDone = storyProgress.completedLevels.includes(lv.id);
        const chNum = STORY_CHAPTERS.indexOf(ch) + 1;
        const lvNum = ch.levels.indexOf(lv) + 1;

        const imgSrc  = getCardImage(lv.opponent.name);
        const imgFb   = getCardImageJpg(lv.opponent.name);

        const diffStars = Array.from({ length: 6 }, (_, i) =>
            `<span style="color:${i < (lv.opponent.difficulty || 1) ? '#f59e0b' : 'rgba(255,255,255,0.12)'}; font-size:13px;">★</span>`
        ).join('');

        const introLines = (lv.dialogue?.intro || []).map(line =>
            `<div class="slm-quote">"${line}"</div>`
        ).join('');

        // Build existing modal if any, remove first
        const existing = document.getElementById('story-level-modal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'story-level-modal-overlay';
        overlay.className = 'slm-overlay';
        overlay.innerHTML = `
            <div class="slm-box" id="slm-box">
                <button class="slm-close" onclick="closeLevelModal()">✕</button>

                <div class="slm-chapter-label">Chapter ${chNum} · Level ${lvNum}</div>
                <div class="slm-title">${lv.title}</div>

                <div class="slm-hero">
                    <div class="slm-portrait-ring">
                        <img src="${imgSrc}"
                             onerror="if(this.src!=='${imgFb}')this.src='${imgFb}'"
                             alt="${lv.opponent.name}"
                             class="slm-portrait-img">
                    </div>
                    <div class="slm-hero-info">
                        <div class="slm-opponent-name">${lv.opponent.name}</div>
                        <div class="slm-location">${ch.location}</div>
                        <div class="slm-difficulty">${diffStars}<span class="slm-diff-label">Difficulty</span></div>
                        <div class="slm-reward-row">
                            <span class="slm-reward-badge">🪙 ${lv.reward.points} pts</span>
                            ${lvDone ? '<span class="slm-done-badge">✓ Completed</span>' : ''}
                        </div>
                    </div>
                </div>

                ${introLines ? `
                <div class="slm-dialogue-block">
                    <div class="slm-dialogue-label">Opening Lines</div>
                    ${introLines}
                </div>` : ''}

                <div class="slm-actions">
                    <button class="slm-cancel-btn" onclick="closeLevelModal()">Back</button>
                    <button class="slm-fight-btn" onclick="closeLevelModal(); startStoryBattle('${chapterId}','${levelId}')">
                        ⚔️ ${lvDone ? 'Rematch' : 'Fight'}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('slm-visible'));

        // Close on backdrop click
        overlay.addEventListener('click', e => { if (e.target === overlay) closeLevelModal(); });
    };

    window.closeLevelModal = function() {
        const overlay = document.getElementById('story-level-modal-overlay');
        if (!overlay) return;
        overlay.classList.remove('slm-visible');
        setTimeout(() => overlay.remove(), 280);
    };

    /* ─── Start a story battle ─────────────────────────────────── */
    function startStoryBattle(chapterId, levelId) {
        const ch = STORY_CHAPTERS.find(c => c.id === chapterId);
        if (!ch || ch.locked) return;
        const lv = ch.levels.find(l => l.id === levelId);
        if (!lv) return;

        applyChapterMap(ch);
        ['story-result-overlay','vn-dialogue'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });

        _activeStoryLevel = lv;
        applyArenaBackground(lv.background);
        _storyModeActive = true;

        // ── Set enemy pool: prefer per-level opponent.deck, fall back to chapter enemyPool ──
        // lv.opponent.deck is an array of card names (with duplicates for weighting).
        // If it's non-empty, resolve those names to card objects and use them.
        // Otherwise fall back to the chapter-wide enemyPool.
        const levelDeck = (lv.opponent.deck && lv.opponent.deck.length > 0 && ALL_CHARS)
            ? lv.opponent.deck.map(name => ALL_CHARS.find(c => c.name === name)).filter(Boolean)
            : [];
        _activeEnemyPool = levelDeck.length > 0 ? levelDeck : resolveEnemyPool(ch);

        // Override the global enemy AI draw to use this chapter's pool.
        // The original is stored as window._baseEnemyDraw so we can restore
        // it when story mode ends.
        if (typeof window.enemyDraw === 'function' && !window._baseEnemyDraw) {
            window._baseEnemyDraw = window.enemyDraw;
        }
        window.enemyDraw = function() {
            if (!_storyModeActive || !_activeEnemyPool || _activeEnemyPool.length === 0) {
                return window._baseEnemyDraw ? window._baseEnemyDraw() : undefined;
            }
            // Mirror the player draw logic but from the chapter enemy pool
            const card = _activeEnemyPool[Math.floor(Math.random() * _activeEnemyPool.length)];
            if (card && state && state.eHand !== undefined && state.eHand.length < 4) {
                state.eHand.push({ ...card, maxHp: card.hp ?? card.maxHp });
            } else if (card && state && Array.isArray(state.hand)) {
                // Fallback: some engines use a unified hand array for enemy
                // — do nothing, let original handle it.
                if (window._baseEnemyDraw) window._baseEnemyDraw();
            }
        };

        // Also patch the general enemy card-pick used by some AI routines:
        // window.getEnemyCard / window.pickEnemyCard etc.
        if (typeof window.pickEnemyCard === 'function' && !window._basePickEnemyCard) {
            window._basePickEnemyCard = window.pickEnemyCard;
        }
        window.pickEnemyCard = function() {
            if (!_storyModeActive || !_activeEnemyPool || _activeEnemyPool.length === 0) {
                return window._basePickEnemyCard ? window._basePickEnemyCard() : null;
            }
            return { ..._activeEnemyPool[Math.floor(Math.random() * _activeEnemyPool.length)] };
        };

        showScreen('arena');
        if (typeof startBattle === 'function') {
            startBattle();
        } else {
            state.pHp = 30; state.eHp = 30;
            state.pBoard = [null,null,null,null];
            state.eBoard = [null,null,null,null];
            state.hand = []; state.turn = 1; state.mana = 1; state.maxMana = 1;
            for (let i = 0; i < 4; i++) draw();
            updateBattleUI();
        }
        setTimeout(() => showStoryIntro(lv), 800);
    }

    /* ─── Intro / outro dialogue ───────────────────────────────── */
    async function showStoryIntro(lv) {
        for (const line of lv.dialogue.intro) {
            await showDialogue(lv.opponent.name, line, { portrait: lv.opponent.portrait, autoClose: false, _isStory: true });
            await new Promise(r => {
                const box = document.getElementById('vn-dialogue');
                if (box) { const h = () => { box.removeEventListener('click', h); r(); }; box.addEventListener('click', h); }
                else setTimeout(r, 1500);
            });
        }
    }

    async function showStoryOutro(isWin) {
        const lv = _activeStoryLevel;
        if (!lv) return;
        const lines = isWin ? lv.dialogue.win : lv.dialogue.lose;
        for (const line of lines) {
            await showDialogue(lv.opponent.name, line, { portrait: lv.opponent.portrait, autoClose: true, _isStory: true });
            await new Promise(r => setTimeout(r, 2200));
        }
    }

    /* ─── Story result screen ──────────────────────────────────── */
    function showStoryResult(isWin, lv) {
        const existing = document.getElementById('story-result-overlay');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'story-result-overlay';
        overlay.className = 'story-result-overlay';
        overlay.innerHTML = `
            <div class="story-result-box">
                <div class="story-result-icon">${isWin ? '🏆' : '💀'}</div>
                <div class="story-result-title" style="color:${isWin ? '#fbbf24' : '#f87171'}">${isWin ? 'Victory!' : 'Defeated'}</div>
                <div class="story-result-chapter">${lv.title}</div>
                ${isWin ? `
                <div class="story-result-rewards">
                    <div class="story-result-reward-item">
                        <span style="font-size:22px;">🪙</span>
                        <span style="font-size:24px;font-weight:900;color:#fbbf24;">+${lv.reward.points}</span>
                        <span style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;font-weight:800;">Points</span>
                    </div>
                </div>` : `<div style="font-size:13px;color:rgba(255,255,255,0.5);margin:12px 0 20px;">+10 pts for trying</div>`}
                <div style="display:flex;gap:12px;margin-top:8px;">
                    <button class="story-btn-primary"   onclick="closeStoryResult(false)">🗺️ Map</button>
                    <button class="story-btn-secondary" onclick="closeStoryResult(true)">⚔️ Retry</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        setTimeout(() => overlay.classList.add('visible'), 50);
    }

    function closeStoryResult(retry) {
        const overlay = document.getElementById('story-result-overlay');
        if (overlay) overlay.remove();
        if (retry && _activeStoryLevel) {
            const ch = STORY_CHAPTERS.find(c => c.levels.some(l => l.id === _activeStoryLevel.id));
            if (ch) startStoryBattle(ch.id, _activeStoryLevel.id);
        } else {
            _activeStoryLevel = null;
            showScreen('story');
        }
    }

    /* ─── Arena background helper ──────────────────────────────── */
    function applyArenaBackground(url) {
        const arena = document.getElementById('screen-arena');
        if (!arena) return;
        if (url) {
            arena.style.backgroundImage    = `url('${url}')`;
            arena.style.backgroundSize     = 'cover';
            arena.style.backgroundPosition = 'center';
        } else {
            arena.style.backgroundImage = '';
        }
    }

    /* ─── Upload map stub ──────────────────────────────────────── */
    function uploadStoryMap() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = e => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => { STORY_CONFIG.mapImage = ev.target.result; saveStoryProgress(); renderStoryScreen(); };
            reader.readAsDataURL(file);
        };
        input.click();
    }
    function openStoryEditor_REMOVED() {
        const existing = document.getElementById('story-editor-modal');
        if (existing) existing.remove();

        // ── Build a working copy of positions we can mutate freely ──
        const editState = STORY_CHAPTERS.map(ch => ({
            chIdx:    STORY_CHAPTERS.indexOf(ch),
            id:       ch.id,
            title:    ch.title,
            location: ch.location || '',
            mapX:     ch.mapX,
            mapY:     ch.mapY,
            levels:   ch.levels.map(lv => ({
                id:    lv.id,
                title: lv.title,
                mapX:  lv.mapX,
                mapY:  lv.mapY,
                background: lv.background || ''
            }))
        }));

        // Track which item is selected: { type:'chapter'|'level', chIdx, lvIdx? }
        let selected = null;
        // Track which tab is active in the sidebar: 'chapters' | 'levels'
        let activeTab = 'chapters';

        const modal = document.createElement('div');
        modal.id = 'story-editor-modal';
        modal.style.cssText = `
            position:fixed;inset:0;z-index:75000;
            background:rgba(4,4,16,0.92);backdrop-filter:blur(18px);
            display:flex;flex-direction:column;
            font-family:'Segoe UI',system-ui,sans-serif;
        `;

        // ── CSS injected once ──────────────────────────────────────
        if (!document.getElementById('pin-editor-styles')) {
            const style = document.createElement('style');
            style.id = 'pin-editor-styles';
            style.textContent = `
                #story-editor-modal {color:#e2e8f0;}
                .pe-topbar {
                    display:flex;align-items:center;justify-content:space-between;
                    padding:14px 20px;
                    background:rgba(13,18,32,0.95);
                    border-bottom:1px solid rgba(99,102,241,0.25);
                    gap:12px;flex-shrink:0;
                }
                .pe-topbar h2 {margin:0;font-size:16px;font-weight:800;color:#c7d2fe;letter-spacing:.04em;white-space:nowrap;}
                .pe-topbar-hint {font-size:11px;color:rgba(255,255,255,0.35);flex:1;text-align:center;}
                .pe-body {display:flex;flex:1;overflow:hidden;}
                .pe-sidebar {
                    width:260px;flex-shrink:0;
                    background:rgba(10,10,26,0.9);
                    border-right:1px solid rgba(99,102,241,0.18);
                    display:flex;flex-direction:column;overflow:hidden;
                }
                .pe-tabs {display:flex;border-bottom:1px solid rgba(99,102,241,0.18);}
                .pe-tab {
                    flex:1;padding:10px;font-size:11px;font-weight:800;
                    letter-spacing:.06em;text-transform:uppercase;
                    background:transparent;border:none;cursor:pointer;
                    color:rgba(255,255,255,0.35);transition:all .15s;
                }
                .pe-tab.active {color:#818cf8;border-bottom:2px solid #818cf8;}
                .pe-tab:hover:not(.active) {color:rgba(255,255,255,0.6);}
                .pe-list {flex:1;overflow-y:auto;padding:8px;}
                .pe-list::-webkit-scrollbar {width:4px;}
                .pe-list::-webkit-scrollbar-track {background:transparent;}
                .pe-list::-webkit-scrollbar-thumb {background:rgba(99,102,241,0.3);border-radius:2px;}
                .pe-item {
                    padding:10px 12px;border-radius:8px;cursor:pointer;
                    border:1px solid transparent;margin-bottom:4px;
                    transition:all .15s;font-size:12px;font-weight:600;
                    display:flex;align-items:center;gap:8px;
                }
                .pe-item:hover {background:rgba(99,102,241,0.12);border-color:rgba(99,102,241,0.25);}
                .pe-item.selected {background:rgba(99,102,241,0.22);border-color:rgba(99,102,241,0.5);color:#c7d2fe;}
                .pe-item-badge {
                    font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;
                    background:rgba(99,102,241,0.25);color:#818cf8;white-space:nowrap;flex-shrink:0;
                }
                .pe-item-badge.level {background:rgba(168,85,247,0.2);color:#c084fc;}
                .pe-canvas-wrap {
                    flex:1;position:relative;overflow:hidden;
                    display:flex;align-items:center;justify-content:center;
                    background:repeating-conic-gradient(rgba(255,255,255,0.02) 0% 25%, transparent 0% 50%) 0 0/32px 32px;
                }
                .pe-map-frame {position:relative;box-shadow:0 0 60px rgba(0,0,0,0.8);border-radius:8px;overflow:hidden;cursor:crosshair;}
                .pe-map-frame img {display:block;max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;user-select:none;pointer-events:none;}
                .pe-pin {
                    position:absolute;transform:translate(-50%,-50%);
                    cursor:grab;user-select:none;touch-action:none;
                    z-index:10;transition:filter .15s;
                    display:flex;flex-direction:column;align-items:center;
                }
                .pe-pin:hover .pe-pin-dot,.pe-pin.dragging .pe-pin-dot {filter:brightness(1.3);box-shadow:0 0 12px rgba(99,102,241,0.8);}
                .pe-pin.dragging {cursor:grabbing;z-index:20;}
                .pe-pin-dot {
                    width:28px;height:28px;border-radius:50%;
                    background:linear-gradient(135deg,#4f46e5,#7c3aed);
                    border:2px solid rgba(255,255,255,0.6);
                    display:flex;align-items:center;justify-content:center;
                    font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.5);
                    transition:all .15s;
                }
                .pe-pin-dot.level-dot {
                    width:22px;height:22px;font-size:10px;
                    background:linear-gradient(135deg,#7c3aed,#a855f7);
                }
                .pe-pin-dot.selected-dot {
                    border-color:#fbbf24;box-shadow:0 0 0 3px rgba(251,191,36,0.4),0 2px 8px rgba(0,0,0,0.5);
                }
                .pe-pin-label {
                    margin-top:3px;font-size:9px;font-weight:800;
                    background:rgba(0,0,0,0.75);padding:2px 5px;border-radius:3px;
                    white-space:nowrap;color:#e2e8f0;pointer-events:none;
                    backdrop-filter:blur(4px);max-width:90px;overflow:hidden;text-overflow:ellipsis;
                }
                .pe-inspector {
                    width:220px;flex-shrink:0;
                    background:rgba(10,10,26,0.9);
                    border-left:1px solid rgba(99,102,241,0.18);
                    padding:16px;overflow-y:auto;
                }
                .pe-inspector h4 {margin:0 0 12px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#818cf8;}
                .pe-field {margin-bottom:12px;}
                .pe-field label {display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,0.4);margin-bottom:4px;}
                .pe-field input {
                    width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;
                    border:1px solid rgba(99,102,241,0.3);
                    background:rgba(255,255,255,0.06);color:#e2e8f0;font-size:12px;
                    transition:border-color .15s;outline:none;
                }
                .pe-field input:focus {border-color:#6366f1;}
                .pe-field input[type=number] {width:90px;}
                .pe-coord-row {display:flex;gap:8px;align-items:flex-end;}
                .pe-no-selection {
                    display:flex;flex-direction:column;align-items:center;justify-content:center;
                    height:100%;color:rgba(255,255,255,0.2);text-align:center;gap:8px;padding:20px;
                }
                .pe-no-selection span {font-size:30px;}
                .pe-no-selection p {font-size:11px;line-height:1.5;margin:0;}
                .pe-btn-row {display:flex;gap:8px;margin-top:4px;}
                .pe-btn {
                    flex:1;padding:9px;border-radius:7px;border:none;cursor:pointer;
                    font-size:12px;font-weight:700;transition:all .15s;
                }
                .pe-btn-primary {background:#4f46e5;color:white;}
                .pe-btn-primary:hover {background:#4338ca;}
                .pe-btn-cancel {background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);}
                .pe-btn-cancel:hover {background:rgba(255,255,255,0.14);}
                .pe-crosshair {
                    position:absolute;pointer-events:none;z-index:30;
                    width:0;height:0;
                }
                .pe-crosshair::before,.pe-crosshair::after {
                    content:'';position:absolute;background:rgba(251,191,36,0.6);
                }
                .pe-crosshair::before {width:1px;height:12px;left:0;top:-6px;}
                .pe-crosshair::after {width:12px;height:1px;left:-6px;top:0;}
            `;
            document.head.appendChild(style);
        }

        // ── Build HTML skeleton ────────────────────────────────────
        modal.innerHTML = `
            <div class="pe-topbar">
                <h2>📍 Pin Editor</h2>
                <div class="pe-topbar-hint">Drag pins on the map · click to select · edit coords in Inspector</div>
                <div class="pe-btn-row" style="flex-shrink:0;width:auto;margin:0;gap:8px;">
                    <button class="pe-btn pe-btn-cancel" id="pe-close-btn">Cancel</button>
                    <button class="pe-btn pe-btn-primary" id="pe-save-btn">💾 Save & Close</button>
                </div>
            </div>
            <div class="pe-body">
                <!-- Sidebar: chapter / level list -->
                <div class="pe-sidebar">
                    <div class="pe-tabs">
                        <button class="pe-tab active" id="pe-tab-ch">Chapters</button>
                        <button class="pe-tab" id="pe-tab-lv">Levels</button>
                    </div>
                    <div class="pe-list" id="pe-list"></div>
                </div>

                <!-- Map canvas -->
                <div class="pe-canvas-wrap" id="pe-canvas-wrap">
                    <div class="pe-map-frame" id="pe-map-frame">
                        <img id="pe-map-img" src="${STORY_CONFIG.mapImage}" alt="Map" draggable="false">
                        <div id="pe-pins-layer" style="position:absolute;inset:0;pointer-events:none;"></div>
                    </div>
                </div>

                <!-- Inspector panel -->
                <div class="pe-inspector" id="pe-inspector">
                    <div class="pe-no-selection">
                        <span>📌</span>
                        <p>Select a chapter or level from the sidebar, or drag a pin on the map</p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // ── DOM refs ───────────────────────────────────────────────
        const mapImg      = modal.querySelector('#pe-map-img');
        const pinsLayer   = modal.querySelector('#pe-pins-layer');
        const listEl      = modal.querySelector('#pe-list');
        const inspEl      = modal.querySelector('#pe-inspector');
        const tabCh       = modal.querySelector('#pe-tab-ch');
        const tabLv       = modal.querySelector('#pe-tab-lv');
        const canvasWrap  = modal.querySelector('#pe-canvas-wrap');

        // ── Helpers ────────────────────────────────────────────────
        function pctToFrame(pctX, pctY) {
            const fr = modal.querySelector('#pe-map-frame');
            return { x: (pctX / 100) * fr.offsetWidth, y: (pctY / 100) * fr.offsetHeight };
        }
        function frameToPct(px, py) {
            const fr = modal.querySelector('#pe-map-frame');
            return {
                x: Math.max(0, Math.min(100, (px / fr.offsetWidth)  * 100)),
                y: Math.max(0, Math.min(100, (py / fr.offsetHeight) * 100))
            };
        }
        function selKey(type, chIdx, lvIdx) {
            return type === 'chapter' ? `ch-${chIdx}` : `lv-${chIdx}-${lvIdx}`;
        }
        function setSelected(type, chIdx, lvIdx) {
            selected = (type == null) ? null : { type, chIdx, lvIdx };
            renderList();
            renderPins();
            renderInspector();
        }

        // ── Sidebar list ───────────────────────────────────────────
        function renderList() {
            listEl.innerHTML = '';
            if (activeTab === 'chapters') {
                editState.forEach((ch, ci) => {
                    const isSel = selected && selected.type === 'chapter' && selected.chIdx === ci;
                    const el = document.createElement('div');
                    el.className = 'pe-item' + (isSel ? ' selected' : '');
                    el.innerHTML = `<span class="pe-item-badge">Ch ${ci + 1}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ch.title.split(':').pop().trim()}</span>`;
                    el.onclick = () => setSelected('chapter', ci, null);
                    listEl.appendChild(el);
                });
            } else {
                editState.forEach((ch, ci) => {
                    ch.levels.forEach((lv, li) => {
                        const isSel = selected && selected.type === 'level' && selected.chIdx === ci && selected.lvIdx === li;
                        const el = document.createElement('div');
                        el.className = 'pe-item' + (isSel ? ' selected' : '');
                        el.innerHTML = `<span class="pe-item-badge level">Lv ${li + 1}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${lv.title.split(':').pop().trim()}</span>`;
                        el.onclick = () => setSelected('level', ci, li);
                        listEl.appendChild(el);
                    });
                });
            }
        }

        // ── Inspector ──────────────────────────────────────────────
        function renderInspector() {
            if (!selected) {
                inspEl.innerHTML = `<div class="pe-no-selection"><span>📌</span><p>Select a pin to edit its position and title</p></div>`;
                return;
            }
            const { type, chIdx, lvIdx } = selected;
            const ch  = editState[chIdx];
            const obj = type === 'chapter' ? ch : ch.levels[lvIdx];
            const color = type === 'chapter' ? '#818cf8' : '#c084fc';
            const label = type === 'chapter' ? `Chapter ${chIdx + 1}` : `Level ${lvIdx + 1}`;

            inspEl.innerHTML = `
                <h4 style="color:${color};">${label}</h4>
                <div class="pe-field">
                    <label>Title</label>
                    <input type="text" id="insp-title" value="${obj.title.replace(/"/g,'&quot;')}">
                </div>
                ${type === 'chapter' ? `<div class="pe-field"><label>Location</label><input type="text" id="insp-location" value="${ch.location.replace(/"/g,'&quot;')}"></div>` : ''}
                <div class="pe-field">
                    <label>Position (%)</label>
                    <div class="pe-coord-row">
                        <div>
                            <label style="font-size:9px;color:rgba(255,255,255,0.3);">X</label>
                            <input type="number" id="insp-x" value="${obj.mapX.toFixed(1)}" min="0" max="100" step="0.5">
                        </div>
                        <div>
                            <label style="font-size:9px;color:rgba(255,255,255,0.3);">Y</label>
                            <input type="number" id="insp-y" value="${obj.mapY.toFixed(1)}" min="0" max="100" step="0.5">
                        </div>
                    </div>
                </div>
                ${type === 'level' ? `<div class="pe-field"><label>Background URL</label><input type="text" id="insp-bg" value="${obj.background || ''}"></div>` : ''}
                <div style="font-size:10px;color:rgba(255,255,255,0.25);margin-top:12px;line-height:1.5;">
                    Tip: drag the pin on the map for precise placement, or type exact coordinates above.
                </div>
            `;

            // Live-bind inspector inputs → editState + re-render pins
            function bindInput(id, setter) {
                const el = modal.querySelector('#' + id);
                if (!el) return;
                el.addEventListener('input', () => { setter(el.value); renderPins(); });
            }
            bindInput('insp-title', v => { obj.title = v; });
            bindInput('insp-x',     v => { const n = parseFloat(v); if (!isNaN(n)) { obj.mapX = Math.max(0, Math.min(100, n)); renderPins(); } });
            bindInput('insp-y',     v => { const n = parseFloat(v); if (!isNaN(n)) { obj.mapY = Math.max(0, Math.min(100, n)); renderPins(); } });
            if (type === 'chapter') bindInput('insp-location', v => { ch.location = v; });
            if (type === 'level')   bindInput('insp-bg',       v => { obj.background = v; });
        }

        // ── Pin rendering + drag ───────────────────────────────────
        function renderPins() {
            pinsLayer.innerHTML = '';

            editState.forEach((ch, ci) => {
                // Chapter pin
                const isSelCh = selected && selected.type === 'chapter' && selected.chIdx === ci;
                const chPin = document.createElement('div');
                chPin.className = 'pe-pin';
                chPin.style.left = ch.mapX + '%';
                chPin.style.top  = ch.mapY + '%';
                chPin.style.pointerEvents = 'all';
                chPin.innerHTML = `
                    <div class="pe-pin-dot${isSelCh ? ' selected-dot' : ''}">⚔️</div>
                    <div class="pe-pin-label">Ch${ci + 1}</div>
                `;
                chPin.title = ch.title;
                makeDraggable(chPin, 'chapter', ci, null);
                chPin.addEventListener('click', e => { e.stopPropagation(); setSelected('chapter', ci, null); });
                pinsLayer.appendChild(chPin);

                // Level pins
                ch.levels.forEach((lv, li) => {
                    const isSelLv = selected && selected.type === 'level' && selected.chIdx === ci && selected.lvIdx === li;
                    const lvPin = document.createElement('div');
                    lvPin.className = 'pe-pin';
                    lvPin.style.left = lv.mapX + '%';
                    lvPin.style.top  = lv.mapY + '%';
                    lvPin.style.pointerEvents = 'all';
                    lvPin.innerHTML = `
                        <div class="pe-pin-dot level-dot${isSelLv ? ' selected-dot' : ''}">${li + 1}</div>
                        <div class="pe-pin-label" style="font-size:8px;">Lv${li + 1}</div>
                    `;
                    lvPin.title = lv.title;
                    makeDraggable(lvPin, 'level', ci, li);
                    lvPin.addEventListener('click', e => { e.stopPropagation(); setSelected('level', ci, li); });
                    pinsLayer.appendChild(lvPin);
                });
            });
        }

        function makeDraggable(pinEl, type, chIdx, lvIdx) {
            let dragging = false, startX, startY, startPctX, startPctY;
            const obj = type === 'chapter' ? editState[chIdx] : editState[chIdx].levels[lvIdx];

            function onDown(e) {
                e.preventDefault();
                dragging = true;
                pinEl.classList.add('dragging');
                const pt = e.touches ? e.touches[0] : e;
                startX = pt.clientX; startY = pt.clientY;
                startPctX = obj.mapX; startPctY = obj.mapY;
                // Select this pin
                setSelected(type, chIdx, lvIdx);

                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup',   onUp);
                window.addEventListener('touchmove', onMove, { passive: false });
                window.addEventListener('touchend',  onUp);
            }

            function onMove(e) {
                if (!dragging) return;
                e.preventDefault();
                const pt = e.touches ? e.touches[0] : e;
                const frame = modal.querySelector('#pe-map-frame');
                const rect  = frame.getBoundingClientRect();
                const dx = pt.clientX - startX;
                const dy = pt.clientY - startY;
                obj.mapX = Math.max(0, Math.min(100, startPctX + (dx / rect.width)  * 100));
                obj.mapY = Math.max(0, Math.min(100, startPctY + (dy / rect.height) * 100));
                pinEl.style.left = obj.mapX + '%';
                pinEl.style.top  = obj.mapY + '%';
                // Update inspector inputs live
                const ix = modal.querySelector('#insp-x');
                const iy = modal.querySelector('#insp-y');
                if (ix) ix.value = obj.mapX.toFixed(1);
                if (iy) iy.value = obj.mapY.toFixed(1);
            }

            function onUp() {
                dragging = false;
                pinEl.classList.remove('dragging');
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup',   onUp);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('touchend',  onUp);
            }

            pinEl.addEventListener('mousedown',  onDown);
            pinEl.addEventListener('touchstart', onDown, { passive: false });
        }

        // ── Tab switching ──────────────────────────────────────────
        tabCh.addEventListener('click', () => { activeTab = 'chapters'; tabCh.classList.add('active'); tabLv.classList.remove('active'); renderList(); });
        tabLv.addEventListener('click', () => { activeTab = 'levels';   tabLv.classList.add('active'); tabCh.classList.remove('active'); renderList(); });

        // ── Save + close ───────────────────────────────────────────
        modal.querySelector('#pe-save-btn').addEventListener('click', () => {
            // Write editState back into STORY_CHAPTERS
            editState.forEach((ed, ci) => {
                const ch = STORY_CHAPTERS[ci];
                ch.title    = ed.title;
                ch.location = ed.location;
                ch.mapX     = ed.mapX;
                ch.mapY     = ed.mapY;
                ed.levels.forEach((elv, li) => {
                    const lv = ch.levels[li];
                    lv.title      = elv.title;
                    lv.mapX       = elv.mapX;
                    lv.mapY       = elv.mapY;
                    lv.background = elv.background;
                });
            });
            saveStoryChanges();
            modal.remove();
        });

        modal.querySelector('#pe-close-btn').addEventListener('click', () => modal.remove());

        // ── Initial render ─────────────────────────────────────────
        renderList();
        // Wait for image to load so frame dimensions are correct
        mapImg.addEventListener('load', renderPins);
        if (mapImg.complete) renderPins();
    }

    window.updateChapterProp = function(chIdx, prop, value) {
        STORY_CHAPTERS[chIdx][prop] = value;
    };

    window.updateLevelProp = function(chIdx, lvIdx, prop, value) {
        STORY_CHAPTERS[chIdx].levels[lvIdx][prop] = value;
    };

    window.saveStoryChanges = function() {
        saveStoryProgress(); // Save the updated positions
        renderStoryScreen(); // Re-render the story screen with new positions
    };

    /* ─── Screen rendering hooks ───────────────────────────── */
    // Called by the patched showScreen in scripts.js
    window._playerScreenHooks = {
        lobby:       () => renderLobby(),
        collection:  () => renderCollection(),
        deckbuilder: () => renderDeckBuilder(),
        packshop:    () => renderPackShop(),
        story:       () => renderStoryScreen(),
    };

    /* ─── Init on load ──────────────────────────────────────── */
    window.addEventListener('nexus_ready', () => {
        if (_nexusReadyFired) return;   // ← prevent double-init
        _nexusReadyFired = true;

        loadPlayerData();
        refreshUI();

        // ── Build the final showScreen chain in one place ────────
        // _baseShowScreen is the raw original set by scripts.js window.onload
        const _rawShow = window._baseShowScreen || window.showScreen;
        window.showScreen = function(id) {
            // 1. Run original (handles .hidden-screen, nav-btn active, vault render etc.)
            _rawShow(id);
            // 2. Toggle arena body class + dismiss dialogue
            if (id === 'arena') {
                document.body.classList.add('arena-active');
            } else {
                document.body.classList.remove('arena-active');
                const box = document.getElementById('vn-dialogue');
                if (box) box.classList.remove('vn-visible');
            }
            // 3. Player-system screen hooks
            _playerScreenHooks[id]?.();
        };

        // Show lobby now that everything is ready
        window.showScreen('lobby');

        // Override draw to use deck
        window.draw = drawFromDeck;

        // Patch checkVictory — story battles get their own result screen;
        // regular battles use the standard overlay.
        const _origCheckVictory = window.checkVictory;
        window.checkVictory = async function() {
            const wasWin  = state.eHp <= 0;
            const wasLoss = state.pHp <= 0;
            if (wasWin || wasLoss) {
                if (_storyModeActive && _activeStoryLevel) {
                    // Story battle result
                    _storyModeActive = false;
                    const lv = _activeStoryLevel;
                    await showStoryOutro(wasWin);
                    if (wasWin) {
                        markLevelComplete(lv.id);
                        if (playerData) { playerData.points += lv.reward.points; playerData.wins++; savePlayerData(); }
                    } else {
                        if (playerData) { playerData.points += 10; playerData.losses++; savePlayerData(); }
                    }
                    applyArenaBackground(null);
                    // ── Restore enemy AI to defaults ───────────────────────
                    _activeEnemyPool = null;
                    if (window._baseEnemyDraw)      { window.enemyDraw      = window._baseEnemyDraw;      window._baseEnemyDraw      = null; }
                    if (window._basePickEnemyCard)  { window.pickEnemyCard  = window._basePickEnemyCard;  window._basePickEnemyCard  = null; }
                    showStoryResult(wasWin, lv);
                } else {
                    // Regular battle result
                    awardBattleResult(wasWin);
                    window.showBattleResult(wasWin);
                }
                return;
            }
            _origCheckVictory && _origCheckVictory();
        };

        // Check daily reward after short delay
        setTimeout(checkDailyReward, 800);
    });

    // Poll until scripts.js finishes loading ALL_CHARS, then fire nexus_ready once
    document.addEventListener('DOMContentLoaded', () => {
        const ready = setInterval(() => {
            if (typeof ALL_CHARS !== 'undefined' && ALL_CHARS.length > 0) {
                clearInterval(ready);
                if (!_nexusReadyFired) window.dispatchEvent(new Event('nexus_ready'));
            }
        }, 200);

        // Override dialogue speaker so story opponents use their real name
        const _origShowDialogue = typeof window.showDialogue === 'function' ? window.showDialogue : null;
        if (_origShowDialogue) {
            window.showDialogue = async function(speaker, text, opts = {}) {
                if (_storyModeActive && _activeStoryChapter && !opts._isStory) {
                    if (speaker === 'Opponent') {
                        speaker = _activeStoryChapter.opponent.name;
                        opts = { ...opts, portrait: _activeStoryChapter.opponent.portrait };
                    }
                }
                return _origShowDialogue(speaker, text, opts);
            };
        }
    });

console.log('[Player + Story] Combined script loaded — Redesigned Map Ready.');