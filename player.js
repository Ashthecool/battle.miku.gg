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
            imagePath: supabaseStorageUrl('common.png'),
            svgArt: makePackSVG('common', '#94a3b8', '#64748b'),
            color: '#94a3b8',
            glow: 'rgba(100,116,139,0.4)',
            weights: { COMMON:60, UNCOMMON:30, RARE:6, EPIC:3, LEGENDARY:1 }
        },
        {
            id: 'rare',
            name: 'Rare Pack',
            cost: 100,
            imagePath: supabaseStorageUrl('rare.png'),
            svgArt: makePackSVG('rare', '#60a5fa', '#3b82f6'),
            color: '#3b82f6',
            glow: 'rgba(59,130,246,0.4)',
            weights: { COMMON:30, UNCOMMON:30, RARE:30, EPIC:7, LEGENDARY:3 }
        },
        {
            id: 'epic',
            name: 'Epic Pack',
            cost: 200,
            imagePath: supabaseStorageUrl('epic.png'),
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

    async function showPackReveal(cards, pack) {
        const overlay = document.getElementById('pack-reveal-overlay');
        const container = document.getElementById('pack-reveal-cards');
        container.innerHTML = '';
        overlay.classList.add('visible');

        for (let i = 0; i < cards.length; i++) {
            const c = cards[i];
            const wrap = document.createElement('div');
            wrap.className = 'reveal-card-wrap';
            wrap.style.animationDelay = `${i * 180}ms`;

            // Badge
            const badge = document.createElement('div');
            badge.className = c.isNew ? 'new-badge' : 'dup-badge';
            badge.textContent = c.isNew ? 'NEW!' : 'Dupe';
            wrap.appendChild(badge);

            // Card image
            const cardDef = ALL_CHARS.find(x => x.name === c.name);
            const imgPath = cardDef ? getCardImage(c.name) : null;
            const imgFallback = cardDef ? getCardImageJpg(c.name) : null;
            const rarityColors = {COMMON:'#64748b',UNCOMMON:'#10b981',RARE:'#3b82f6',EPIC:'#a855f7',LEGENDARY:'#f59e0b'};
            if (imgPath) {
                const img = document.createElement('img');
                img.src = imgPath;
                img.onerror = () => { if (img.src !== imgFallback) img.src = imgFallback; };
                img.style.cssText = `width:100%;border-radius:12px;border:2px solid ${rarityColors[c.rarity]||'#64748b'};box-shadow:0 8px 24px rgba(0,0,0,0.6);`;
                wrap.appendChild(img);
            } else {
                const placeholder = document.createElement('div');
                placeholder.style.cssText = `width:100%;padding-bottom:140%;background:rgba(99,102,241,0.1);border-radius:12px;border:2px solid ${rarityColors[c.rarity]||'#6366f1'};position:relative;`;
                placeholder.innerHTML = `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:32px;">🃏</span>`;
                wrap.appendChild(placeholder);
            }

            // Name + rarity
            const name = document.createElement('div');
            name.style.cssText = `font-size:10px;font-weight:800;text-align:center;margin-top:6px;color:rgba(255,255,255,0.8);`;
            name.textContent = c.name;
            wrap.appendChild(name);
            const rar = document.createElement('div');
            rar.style.cssText = `font-size:9px;font-weight:900;text-align:center;text-transform:uppercase;letter-spacing:0.08em;`;
            rar.className = `rc-${c.rarity}`;
            rar.textContent = c.rarity;
            wrap.appendChild(rar);

            container.appendChild(wrap);
        }
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

    function goToArena() {
        // Check if player has a valid deck before entering arena
        if (!checkDeckBeforeBattle()) {
            return;
        }
        showScreen('arena');
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

    /* ─── Screen rendering hooks ───────────────────────────── */
    // Called by the patched showScreen in scripts.js
    const _playerScreenHooks = {
        lobby:       () => renderLobby(),
        collection:  () => renderCollection(),
        deckbuilder: () => renderDeckBuilder(),
        packshop:    () => renderPackShop(),
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

        // Patch checkVictory — award points THEN show result screen (no alert)
        const _origCheckVictory = window.checkVictory;
        window.checkVictory = function() {
            const wasWin  = state.eHp <= 0;
            const wasLoss = state.pHp <= 0;
            if (wasWin || wasLoss) {
                awardBattleResult(wasWin);
                // showBattleResult is defined above and also set on window
                window.showBattleResult(wasWin);
                return; // don't call original — it would alert() + redirect
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
    });